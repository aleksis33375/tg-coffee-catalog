const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const supabase = require('../db')
const auth = require('../middleware/auth')

// ─── АВТОРИЗАЦИЯ ─────────────────────────────────────────────────────────────

// POST /api/barista/login
router.post('/login', async (req, res) => {
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

  const token = jwt.sign(
    { role: 'barista', barista_id: found.id, name: found.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_BARISTA || '24h' }
  )

  res.json({ token, barista_id: found.id, name: found.name })
})

// ─── СМЕНА ───────────────────────────────────────────────────────────────────

// POST /api/barista/shift/open
router.post('/shift/open', auth('barista'), async (req, res) => {
  const { barista_id } = req.user

  // Проверить нет ли уже открытой смены
  const { data: open } = await supabase
    .from('shifts')
    .select('id, opened_at')
    .eq('barista_id', barista_id)
    .is('closed_at', null)
    .single()

  if (open) return res.json({ shift_id: open.id, opened_at: open.opened_at, already_open: true })

  const { data, error } = await supabase
    .from('shifts')
    .insert({ barista_id, opened_at: new Date().toISOString() })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ shift_id: data.id, opened_at: data.opened_at })
})

// GET /api/barista/shift/summary
router.get('/shift/summary', auth('barista'), async (req, res) => {
  const { barista_id } = req.user

  const { data: shift } = await supabase
    .from('shifts')
    .select('*')
    .eq('barista_id', barista_id)
    .is('closed_at', null)
    .single()

  if (!shift) return res.status(404).json({ error: 'Открытой смены нет' })

  // Считаем заказы за смену
  const { data: orders } = await supabase
    .from('orders')
    .select('total, payment')
    .gte('created_at', shift.opened_at)
    .eq('status', 'done')

  const summary = { orders_count: 0, total_cash: 0, total_card: 0 }
  if (orders) {
    orders.forEach(o => {
      summary.orders_count++
      if (o.payment === 'cash') summary.total_cash += o.total || 0
      else summary.total_card += o.total || 0
    })
  }

  res.json({ shift, summary })
})

// POST /api/barista/shift/close
router.post('/shift/close', auth('barista'), async (req, res) => {
  const { barista_id } = req.user

  const { data: shift } = await supabase
    .from('shifts')
    .select('*')
    .eq('barista_id', barista_id)
    .is('closed_at', null)
    .single()

  if (!shift) return res.status(404).json({ error: 'Открытой смены нет' })

  const { data: orders } = await supabase
    .from('orders')
    .select('total, payment')
    .gte('created_at', shift.opened_at)
    .eq('status', 'done')

  let orders_count = 0, total_cash = 0, total_card = 0
  if (orders) {
    orders.forEach(o => {
      orders_count++
      if (o.payment === 'cash') total_cash += o.total || 0
      else total_card += o.total || 0
    })
  }

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
    details: { orders_count, total_cash, total_card }
  })

  res.json({ shift: data, orders_count, total_cash, total_card })
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
    ).catch(() => {})
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

  const hours = {}
  data.forEach(o => {
    const h = new Date(o.created_at).getHours()
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

  res.json({ peak, hours: Object.entries(hours).map(([h, c]) => ({ hour: Number(h), count: c })) })
})

// ─── ПОИСК КЛИЕНТА ───────────────────────────────────────────────────────────

// GET /api/barista/customers/search?username=alex
router.get('/customers/search', auth('barista'), async (req, res) => {
  const { username } = req.query
  if (!username) return res.status(400).json({ error: 'username обязателен' })

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .ilike('username', username.replace('@', ''))
    .single()

  if (error) return res.status(404).json({ error: 'Клиент не найден' })

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
  const { data: promo } = await supabase
    .from('promos')
    .select('id, config')
    .eq('type', 'loyalty_cups')
    .eq('active', true)
    .single()

  const promoId   = promo?.id   || 1
  const totalCups = promo?.config?.total_cups || 6

  // Получить или создать прогресс
  const { data: existing } = await supabase
    .from('customer_promo_progress')
    .select('progress')
    .eq('customer_tg_id', customer_tg_id)
    .eq('promo_id', promoId)
    .single()

  const current     = existing?.progress || 0
  const newProgress = current + 1

  await supabase
    .from('customer_promo_progress')
    .upsert({
      customer_tg_id,
      promo_id:   promoId,
      progress:   newProgress,
      updated_at: new Date().toISOString()
    }, { onConflict: 'customer_tg_id,promo_id' })

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
    if (newProgress >= totalCups) {
      // Набрали нужное количество — бесплатный напиток!
      bot.sendMessage(
        customer_tg_id,
        `🎉 Поздравляем! Ты накопил ${totalCups} кружек — следующий напиток бесплатно!\n\nПокажи это сообщение баристе ☕`
      ).catch(() => {})
    } else {
      bot.sendMessage(
        customer_tg_id,
        `☕ Кружка засчитана! У тебя ${newProgress} из ${totalCups}.\n\nЕщё ${totalCups - newProgress} — и следующий напиток бесплатно 🎁`
      ).catch(() => {})
    }
  }

  res.json({ progress: newProgress, total: totalCups, reward: newProgress >= totalCups })
})

// POST /api/barista/customers/cups/reset — сброс после выдачи бесплатной кружки
router.post('/customers/cups/reset', auth('barista'), async (req, res) => {
  const { customer_tg_id } = req.body
  if (!customer_tg_id) return res.status(400).json({ error: 'customer_tg_id обязателен' })

  const { data: promo } = await supabase
    .from('promos')
    .select('id')
    .eq('type', 'loyalty_cups')
    .eq('active', true)
    .single()

  const promoId = promo?.id || 1

  await supabase
    .from('customer_promo_progress')
    .upsert({ customer_tg_id, promo_id: promoId, progress: 0, updated_at: new Date().toISOString() },
      { onConflict: 'customer_tg_id,promo_id' })

  await supabase.from('barista_log').insert({
    barista_id:     req.user.barista_id,
    barista_action: 'cups_reset',
    customer_tg_id,
    details:        { reason: 'free_drink_issued' }
  })

  res.json({ ok: true })
})

module.exports = router
