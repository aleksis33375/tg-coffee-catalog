const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const rateLimit = require('express-rate-limit')
const supabase = require('../db')
const auth = require('../middleware/auth')

// ─── АВТОРИЗАЦИЯ ─────────────────────────────────────────────────────────────

// Брутфорс PIN (4 цифры = 10 000 комбинаций) — 10 попыток / 15 мин на IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Попробуй через 15 минут' }
})

// POST /api/barista/login
router.post('/login', loginLimiter, async (req, res) => {
  const { pin } = req.body
  if (!pin) return res.status(400).json({ error: 'PIN обязателен' })

  const { data: baristas, error } = await supabase
    .from('baristas')
    .select('id, name, pin, active')
    .eq('active', true)

  if (error) return res.status(500).json({ error: error.message })
  if (!baristas.length) return res.status(401).json({ error: 'Баристы не добавлены' })

  let found = null
  for (const b of baristas) {
    const match = await bcrypt.compare(pin, b.pin)
    if (match) { found = b; break }
  }

  if (!found) return res.status(401).json({ error: 'Неверный PIN' })

  // Б-А45: короткий TTL — сокращает окно для украденного токена до конца смены
  const token = jwt.sign(
    { role: 'barista', barista_id: found.id, name: found.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_BARISTA || '12h' }
  )

  res.json({ token, barista_id: found.id, name: found.name })
})

// ─── СМЕНА ───────────────────────────────────────────────────────────────────

// POST /api/barista/shift/open
router.post('/shift/open', auth('barista'), async (req, res) => {
  const { barista_id } = req.user

  // Б-А65: maybeSingle — не падаем, если открытых смен 0 или >1 из-за гонки.
  const { data: open } = await supabase
    .from('shifts')
    .select('id, opened_at')
    .eq('barista_id', barista_id)
    .is('closed_at', null)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (open) return res.json({ shift_id: open.id, opened_at: open.opened_at, already_open: true })

  const { data, error } = await supabase
    .from('shifts')
    .insert({ barista_id, opened_at: new Date().toISOString() })
    .select()
    .single()

  // Б-А65: если параллельный INSERT обогнал (UNIQUE-индекс WHERE closed_at IS NULL),
  // Postgres вернёт 23505 — возвращаем уже открытую смену вместо 500.
  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('shifts')
        .select('id, opened_at')
        .eq('barista_id', barista_id)
        .is('closed_at', null)
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (existing) return res.json({ shift_id: existing.id, opened_at: existing.opened_at, already_open: true })
    }
    return res.status(500).json({ error: error.message })
  }
  res.json({ shift_id: data.id, opened_at: data.opened_at })
})

// Б-А62: итоги смены должны учитывать ТОЛЬКО то, что закрыл текущий бариста.
// Ищем его действия `status_changed → done` в barista_log за смену и тянем по этим order_id.
// Walk-in кружки — только с barista_id текущего бариста.
async function collectShiftTotals(barista_id, opened_at) {
  const { data: doneLog } = await supabase
    .from('barista_log')
    .select('order_id, details')
    .eq('barista_id', barista_id)
    .eq('barista_action', 'status_changed')
    .gte('created_at', opened_at)

  const orderIds = [...new Set(
    (doneLog || [])
      .filter(l => l.details?.status === 'done' && l.order_id)
      .map(l => l.order_id)
  )]

  let orders_count = 0, total_cash = 0, total_card = 0
  if (orderIds.length) {
    const { data: orders } = await supabase
      .from('orders')
      .select('total, payment, status')
      .in('id', orderIds)
      .eq('status', 'done')
    if (orders) {
      orders.forEach(o => {
        orders_count++
        if (o.payment === 'cash')      total_cash += o.total || 0
        else if (o.payment === 'card') total_card += o.total || 0
      })
    }
  }

  const { data: walkIns } = await supabase
    .from('barista_log')
    .select('details')
    .eq('barista_id', barista_id)
    .eq('barista_action', 'cup_added')
    .is('order_id', null)
    .gte('created_at', opened_at)

  let walkin_cash = 0, walkin_card = 0
  if (walkIns) {
    walkIns.forEach(l => {
      if (l.details?.payment === 'cash')      walkin_cash++
      else if (l.details?.payment === 'card') walkin_card++
    })
  }

  return { orders_count, total_cash, total_card, walkin_cash, walkin_card }
}

// GET /api/barista/shift/summary
router.get('/shift/summary', auth('barista'), async (req, res) => {
  const { barista_id } = req.user

  // Б-А65: maybeSingle + order — не падаем, если из-за гонки открытых смен оказалось >1
  const { data: shift } = await supabase
    .from('shifts')
    .select('*')
    .eq('barista_id', barista_id)
    .is('closed_at', null)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!shift) return res.status(404).json({ error: 'Открытой смены нет' })

  const totals = await collectShiftTotals(barista_id, shift.opened_at)
  res.json({ shift, summary: totals })
})

// POST /api/barista/shift/close
router.post('/shift/close', auth('barista'), async (req, res) => {
  const { barista_id } = req.user

  // Б-А65: maybeSingle + order — устойчивы к гонке двух открытых смен
  const { data: shift } = await supabase
    .from('shifts')
    .select('*')
    .eq('barista_id', barista_id)
    .is('closed_at', null)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!shift) return res.status(404).json({ error: 'Открытой смены нет' })

  const { orders_count, total_cash, total_card, walkin_cash, walkin_card } =
    await collectShiftTotals(barista_id, shift.opened_at)

  const { data, error } = await supabase
    .from('shifts')
    .update({ closed_at: new Date().toISOString(), orders_count, total_cash, total_card })
    .eq('id', shift.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  await supabase.from('barista_log').insert({
    barista_id,
    barista_action: 'shift_closed',
    details: { orders_count, total_cash, total_card, walkin_cash, walkin_card }
  })

  res.json({ shift: data, orders_count, total_cash, total_card, walkin_cash, walkin_card })
})

// ─── ЗАКАЗЫ ──────────────────────────────────────────────────────────────────

// GET /api/barista/orders — активные заказы
router.get('/orders', auth('barista'), async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .in('status', ['new', 'preparing'])
    .order('created_at', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// PUT /api/barista/orders/:id/status
router.put('/orders/:id/status', auth('barista'), async (req, res) => {
  const { status, payment } = req.body
  // Б-А49: whitelist допустимых значений — защита от мусора в БД
  const VALID_STATUSES = ['new', 'preparing', 'ready', 'done', 'cancelled']
  const VALID_PAYMENTS = ['cash', 'card']
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Недопустимый статус' })
  if (payment !== undefined && payment !== null && !VALID_PAYMENTS.includes(payment)) {
    return res.status(400).json({ error: 'Недопустимый способ оплаты' })
  }
  const updates = { status }
  if (payment) updates.payment = payment

  const { data, error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  // Уведомить клиента если заказ готов
  if (status === 'ready' && data.customer_tg_id && req.app.locals.bot) {
    req.app.locals.bot.sendMessage(
      data.customer_tg_id,
      '✅ Ваш заказ готов! Можно забирать.'
    ).catch(e => console.error('bot notify ready:', data.customer_tg_id, e.message))
  }

  await supabase.from('barista_log').insert({
    barista_id: req.user.barista_id,
    barista_action: 'status_changed',
    order_id: Number(req.params.id),
    details: { status, payment }
  })

  res.json(data)
})

// ─── АНАЛИТИКА ДЛЯ ПУСТОГО ЭКРАНА ────────────────────────────────────────────

// GET /api/barista/analytics/top-items
router.get('/analytics/top-items', auth('barista'), async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('items')
    .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())

  if (error) return res.status(500).json({ error: error.message })

  const counts = {}
  data.forEach(o => {
    if (!Array.isArray(o.items)) return
    o.items.forEach(i => {
      counts[i.name] = (counts[i.name] || 0) + (i.qty || 1)
    })
  })

  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }))

  res.json(top)
})

// GET /api/barista/analytics/peak-hours
router.get('/analytics/peak-hours', auth('barista'), async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('created_at')
    .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())

  if (error) return res.status(500).json({ error: error.message })

  // Б-А67: считаем час в Europe/Moscow (а не в таймзоне Node-процесса).
  // На Linux-проде по умолчанию UTC — без явной TZ бариста видел неверные часы.
  const hourFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    hour12: false
  })
  const hours = {}
  data.forEach(o => {
    const h = Number(hourFmt.format(new Date(o.created_at)))
    if (!Number.isFinite(h)) return
    hours[h] = (hours[h] || 0) + 1
  })

  const sorted = Object.entries(hours)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hour]) => Number(hour))
    .sort((a, b) => a - b)

  const peak = sorted.length >= 2
    ? `с ${sorted[0]}:00 до ${sorted[sorted.length - 1] + 1}:00`
    : sorted.length === 1 ? `в ${sorted[0]}:00` : 'данных пока нет'

  res.json({ peak })
})

// ─── ПОИСК КЛИЕНТА ───────────────────────────────────────────────────────────

// GET /api/barista/customers/search?username=alex
router.get('/customers/search', auth('barista'), async (req, res) => {
  const { username } = req.query
  const cleanUsername = (username || '').trim().replace('@', '')
  if (!cleanUsername) return res.status(400).json({ error: 'username обязателен' })

  // Б-А66: экранируем LIKE-спецсимволы, чтобы ввод вроде `al%ex` или `_user`
  // не воспринимался как шаблон и не возвращал случайного клиента
  const likePattern = cleanUsername.replace(/[%_\\]/g, '\\$&') + '%'

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .ilike('username', likePattern)
    .limit(1)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Клиент не найден' })

  const { data: progress } = await supabase
    .from('customer_promo_progress')
    .select('promo_id, progress')
    .eq('customer_tg_id', data.tg_id)

  res.json({ customer: data, progress: progress || [] })
})

// PUT /api/barista/customers/:tg_id/birthday
router.put('/customers/:tg_id/birthday', auth('barista'), async (req, res) => {
  const { birthday } = req.body
  if (!birthday || !/^\d{2}-\d{2}$/.test(birthday)) {
    return res.status(400).json({ error: 'Формат даты: MM-DD (например 03-15)' })
  }
  const { data, error } = await supabase
    .from('customers')
    .update({ birthday })
    .eq('tg_id', req.params.tg_id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  await supabase.from('barista_log').insert({
    barista_id: req.user.barista_id,
    barista_action: 'birthday_set',
    customer_tg_id: req.params.tg_id,
    details: { birthday }
  })

  res.json(data)
})

// ─── КРУЖКИ ЛОЯЛЬНОСТИ ───────────────────────────────────────────────────────

// POST /api/barista/customers/cups — зачислить кружку клиенту
router.post('/customers/cups', auth('barista'), async (req, res) => {
  const { customer_tg_id, order_id, payment } = req.body
  if (!customer_tg_id) return res.status(400).json({ error: 'customer_tg_id обязателен' })

  // Найти активную акцию лояльности
  const { data: promo, error: promoError } = await supabase
    .from('promos')
    .select('id, config')
    .eq('type', 'loyalty_cups')
    .eq('active', true)
    .single()

  if (promoError && promoError.code !== 'PGRST116') {
    return res.status(500).json({ error: 'Ошибка загрузки акции лояльности' })
  }

  // Б-А38: если активной акции нет — не городим фейковый promo_id=1.
  // Без акции кружки не начисляем, иначе получим orphan-progress без привязки к реальной промо.
  if (!promo) return res.status(409).json({ error: 'Активная акция лояльности не настроена' })

  const promoId   = promo.id
  const totalCups = promo.config?.total_cups || 6

  // Атомарный инкремент через оптимистичную блокировку (защита от гонки)
  // Читаем текущее значение → обновляем только если оно не изменилось → повторяем при конфликте
  let current = 0
  let newProgress = 1
  let succeeded = false
  const MAX_RETRIES = 5

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { data: existing } = await supabase
      .from('customer_promo_progress')
      .select('progress')
      .eq('customer_tg_id', customer_tg_id)
      .eq('promo_id', promoId)
      .maybeSingle()

    current = existing?.progress ?? 0
    newProgress = current + 1

    if (!existing) {
      // Первая кружка — вставляем новую запись
      const { error } = await supabase
        .from('customer_promo_progress')
        .insert({ customer_tg_id, promo_id: promoId, progress: 1, updated_at: new Date().toISOString() })
      if (!error) { newProgress = 1; succeeded = true; break }
      // Параллельный INSERT — повторяем
    } else {
      // Обновляем только если прогресс не изменился с момента чтения
      const { data: updated } = await supabase
        .from('customer_promo_progress')
        .update({ progress: newProgress, updated_at: new Date().toISOString() })
        .eq('customer_tg_id', customer_tg_id)
        .eq('promo_id', promoId)
        .eq('progress', current)
        .select('progress')
      if (updated && updated.length > 0) { succeeded = true; break }
      // 0 строк обновлено — кто-то опередил, повторяем
    }
  }

  if (!succeeded) {
    return res.status(409).json({ error: 'Конфликт при обновлении кружек. Попробуйте ещё раз.' })
  }

  // Лог действия бариста
  await supabase.from('barista_log').insert({
    barista_id:     req.user.barista_id,
    barista_action: 'cup_added',
    customer_tg_id,
    order_id:       order_id || null,
    details:        { cups_before: current, cups_after: newProgress, total_cups: totalCups, payment: payment || null }
  })

  // Уведомление клиенту
  const bot = req.app.locals.bot
  if (bot) {
    if (newProgress === totalCups) {
      // Точно достигли порога — бесплатный напиток!
      bot.sendMessage(
        customer_tg_id,
        `🎉 Поздравляем! Ты накопил ${totalCups} кружек — следующий напиток бесплатно!\n\nПокажи это сообщение баристе ☕`
      ).catch(e => console.error('bot notify reward:', customer_tg_id, e.message))
    } else {
      // newProgress < totalCups — обычное начисление, либо > totalCups (защитная ветка)
      const remaining = totalCups - newProgress
      const msg = remaining > 0
        ? `☕ Кружка засчитана! У тебя ${newProgress} из ${totalCups}.\n\nЕщё ${remaining} — и следующий напиток бесплатно 🎁`
        : `☕ Кружка засчитана! У тебя ${newProgress} кружек.`
      bot.sendMessage(customer_tg_id, msg)
        .catch(e => console.error('bot notify cups:', customer_tg_id, e.message))
    }
  }

  res.json({ progress: newProgress, total: totalCups, reward: newProgress === totalCups })
})

// POST /api/barista/customers/cups/reset — сброс после выдачи бесплатной кружки
router.post('/customers/cups/reset', auth('barista'), async (req, res) => {
  const { customer_tg_id } = req.body
  if (!customer_tg_id) return res.status(400).json({ error: 'customer_tg_id обязателен' })

  const { data: promo, error: promoError } = await supabase
    .from('promos')
    .select('id, config')
    .eq('type', 'loyalty_cups')
    .eq('active', true)
    .single()

  if (promoError && promoError.code !== 'PGRST116') {
    return res.status(500).json({ error: 'Ошибка загрузки акции лояльности' })
  }

  // Б-А38: без активной акции сбрасывать нечего и привязывать некуда
  if (!promo) return res.status(409).json({ error: 'Активная акция лояльности не настроена' })

  const promoId   = promo.id
  const totalCups = promo.config?.total_cups || 6

  const { error: resetError } = await supabase
    .from('customer_promo_progress')
    .upsert({ customer_tg_id, promo_id: promoId, progress: 0, updated_at: new Date().toISOString() },
      { onConflict: 'customer_tg_id,promo_id' })

  if (resetError) return res.status(500).json({ error: resetError.message })

  await supabase.from('barista_log').insert({
    barista_id:     req.user.barista_id,
    barista_action: 'cups_reset',
    customer_tg_id,
    details:        { reason: 'free_drink_issued', issued_at: new Date().toISOString(), cups_threshold: totalCups }
  })

  res.json({ ok: true })
})

module.exports = router
