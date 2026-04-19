const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const rateLimit = require('express-rate-limit')
const supabase = require('../db')

// Rate-limit для публичных POST — 30 запросов/мин на IP
const publicWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Подожди минуту' }
})

/**
 * Проверка подписи Telegram WebApp initData (Б-А34).
 * Возвращает { ok: true, user } или { ok: false }.
 * Алгоритм: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return { ok: false }
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash) return { ok: false }
    params.delete('hash')

    const dataCheckString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n')

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
    const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

    if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calcHash, 'hex'))) {
      return { ok: false }
    }

    // Защита от replay: auth_date не старше 24 часов
    const authDate = parseInt(params.get('auth_date'), 10)
    if (!authDate || Date.now() / 1000 - authDate > 86400) return { ok: false }

    const userJson = params.get('user')
    if (!userJson) return { ok: false }
    const user = JSON.parse(userJson)
    return { ok: true, user }
  } catch {
    return { ok: false }
  }
}

// GET /api/config — публичная конфигурация для клиентов (anon ключ для Realtime)
router.get('/config', (_req, res) => {
  res.json({
    supabase_url: process.env.SUPABASE_URL,
    supabase_anon_key: process.env.SUPABASE_ANON_KEY
  })
})

// GET /api/menu — отдать меню клиенту (только доступные позиции)
router.get('/menu', async (req, res) => {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('available', true)
    .order('sort_order')

  if (error) return res.status(500).json({ error: error.message })

  // Настройки кофейни (название, слоган)
  const { data: settings } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['cafe_name', 'tagline', 'address'])

  const cafe = {}
  if (settings) settings.forEach(s => { cafe[s.key] = s.value })

  // Б-А38: отдаём актуальный id акции лояльности,
  // чтобы клиент не хардкодил «promo_id === 1»
  const { data: promo } = await supabase
    .from('promos')
    .select('id, config')
    .eq('type', 'loyalty_cups')
    .eq('active', true)
    .maybeSingle()

  const loyalty = promo ? { promo_id: promo.id, total_cups: promo.config?.total_cups || 6 } : null

  res.json({ cafe, items: data, loyalty })
})

// POST /api/customers — зарегистрировать клиента при первом заходе
router.post('/customers', publicWriteLimiter, async (req, res) => {
  const { init_data, source } = req.body

  // Б-А34: tg_id берём ТОЛЬКО из подписанного Telegram initData, а не из body
  const botToken = process.env.BOT_TOKEN
  const check = verifyTelegramInitData(init_data, botToken)
  if (!check.ok) return res.status(401).json({ error: 'Неверная подпись Telegram' })

  const tg_id = String(check.user.id)
  // Б-А51: ограничение длины строк от Telegram — защита от мусора в БД
  const first_name = String(check.user.first_name || '').slice(0, 100)
  const username   = String(check.user.username   || '').slice(0, 64)

  // Проверить существует ли клиент
  const { data: existing } = await supabase
    .from('customers')
    .select('id, status, source')
    .eq('tg_id', tg_id)
    .single()

  if (existing) {
    // Клиент уже есть — обновить last_seen
    await supabase
      .from('customers')
      .update({ last_seen: new Date().toISOString(), first_name, username })
      .eq('tg_id', tg_id)

    return res.json({ status: 'exists', customer: existing })
  }

  // Новый клиент — создать запись с уникальным referral_code (retry при коллизии)
  let inserted = null
  let lastError = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const referral_code = crypto.randomBytes(6).toString('base64url').slice(0, 8).toUpperCase()
    const { data, error } = await supabase
      .from('customers')
      .insert({
        tg_id,
        first_name,
        username,
        source: source || 'direct',
        status: 'visitor',
        referral_code,
        last_seen: new Date().toISOString()
      })
      .select()
      .single()

    if (!error) { inserted = data; break }
    lastError = error
    if (error.code !== '23505') break // не UNIQUE — прекращаем retry
  }

  if (!inserted) return res.status(500).json({ error: lastError?.message || 'Не удалось создать клиента' })

  res.json({ status: 'created', customer: inserted })
})

// GET /api/customers/:tg_id — данные клиента и прогресс по акциям
router.get('/customers/:tg_id', async (req, res) => {
  const { tg_id } = req.params

  const { data: customer, error } = await supabase
    .from('customers')
    .select('*')
    .eq('tg_id', tg_id)
    .single()

  if (error) return res.status(404).json({ error: 'Клиент не найден' })

  // Прогресс по акциям
  const { data: progress } = await supabase
    .from('customer_promo_progress')
    .select('promo_id, progress')
    .eq('customer_tg_id', tg_id)

  res.json({ customer, progress: progress || [] })
})

// GET /api/customers/:tg_id/referral — реферальная ссылка
router.get('/customers/:tg_id/referral', async (req, res) => {
  const { tg_id } = req.params

  const { data: customer, error } = await supabase
    .from('customers')
    .select('referral_code')
    .eq('tg_id', tg_id)
    .single()

  if (error) return res.status(404).json({ error: 'Клиент не найден' })

  // Имя бота из настроек
  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'bot_username')
    .single()

  const botUsername = setting?.value || 'your_bot'
  const link = `https://t.me/${botUsername}?start=ref_${customer.referral_code}`

  res.json({ link, code: customer.referral_code })
})

// POST /api/orders — принять заказ (Б-А33: total пересчитывается на сервере)
router.post('/orders', publicWriteLimiter, async (req, res) => {
  const { init_data, items, delivery_type } = req.body
  // Б-А51: жёстко ограничиваем длину текстовых полей, иначе можно записать
  // в БД мегабайтный "комментарий" и раздуть диск
  const comment       = typeof req.body.comment       === 'string' ? req.body.comment.slice(0, 500)       : null
  const delivery_time = typeof req.body.delivery_time === 'string' ? req.body.delivery_time.slice(0, 200) : null

  // Б-А34 (для заказов): tg_id обязателен и должен быть подписан Telegram
  const check = verifyTelegramInitData(init_data, process.env.BOT_TOKEN)
  if (!check.ok) return res.status(401).json({ error: 'Неверная подпись Telegram' })
  const customer_tg_id = String(check.user.id)

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items обязательны' })
  }
  // Б-А51: ограничение количества позиций в заказе (защита от flood)
  if (items.length > 50) return res.status(400).json({ error: 'Слишком много позиций' })

  // Базовая валидация структуры позиций
  const badItem = items.find(i => !i || typeof i.id !== 'number' || typeof i.qty !== 'number' || i.qty <= 0 || i.qty > 100)
  if (badItem) return res.status(400).json({ error: 'Некорректные позиции' })

  // Б-А33: тянем актуальные цены из БД — клиент цену не задаёт
  const ids = [...new Set(items.map(i => i.id))]
  const { data: menuRows, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name, price, available')
    .in('id', ids)

  if (menuErr) return res.status(500).json({ error: menuErr.message })

  const menuMap = new Map(menuRows.map(m => [m.id, m]))
  for (const i of items) {
    const m = menuMap.get(i.id)
    if (!m || !m.available) {
      return res.status(400).json({ error: `Позиция ${i.id} недоступна` })
    }
  }

  // Собираем серверную версию items с ценой и именем из БД
  const serverItems = items.map(i => {
    const m = menuMap.get(i.id)
    return { id: m.id, name: m.name, price: m.price, qty: i.qty }
  })
  const total = serverItems.reduce((sum, i) => sum + i.price * i.qty, 0)

  // Сохранить заказ
  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      customer_tg_id,
      items: serverItems,
      total,
      delivery_type: delivery_type === 'delivery' ? 'delivery' : 'pickup',
      delivery_time,
      comment,
      status: 'new'
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  // Обновить статус клиента visitor → buyer
  await supabase
    .from('customers')
    .update({ status: 'buyer', last_seen: new Date().toISOString() })
    .eq('tg_id', customer_tg_id)

  // Уведомление в Telegram менеджеру
  if (req.app.locals.bot) {
    const itemsList = serverItems.map(i => `${i.name} × ${i.qty}`).join(', ')
    const manager_tg_id = req.app.locals.manager_tg_id
    if (manager_tg_id) {
      req.app.locals.bot.sendMessage(
        manager_tg_id,
        `🆕 Новый заказ #${order.id}\n👤 tg: ${customer_tg_id}\n🛒 ${itemsList}\n💰 ${total} ₽`
      ).catch(() => {})
    }
  }

  res.json({ order_id: order.id, total, status: 'ok' })
})

module.exports = router
