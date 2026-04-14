const express = require('express')
const router = express.Router()
const supabase = require('../db')

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

  res.json({ cafe, items: data })
})

// POST /api/customers — зарегистрировать клиента при первом заходе
router.post('/customers', async (req, res) => {
  const { tg_id, first_name, username, source } = req.body

  if (!tg_id) return res.status(400).json({ error: 'tg_id обязателен' })

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

  // Новый клиент — создать запись
  const referral_code = Math.random().toString(36).slice(2, 10).toUpperCase()

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

  if (error) return res.status(500).json({ error: error.message })

  res.json({ status: 'created', customer: data })
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

// POST /api/orders — принять заказ
router.post('/orders', async (req, res) => {
  const { customer_tg_id, items, total, delivery_type, delivery_time, comment } = req.body

  if (!items || !total) return res.status(400).json({ error: 'items и total обязательны' })

  // Сохранить заказ
  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      customer_tg_id,
      items,
      total,
      delivery_type: delivery_type || 'pickup',
      delivery_time,
      comment,
      status: 'new'
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  // Обновить статус клиента visitor → buyer
  if (customer_tg_id) {
    await supabase
      .from('customers')
      .update({ status: 'buyer', last_seen: new Date().toISOString() })
      .eq('tg_id', customer_tg_id)
  }

  // Уведомление в Telegram — отправляется через bot.js (подключается в server.js)
  if (req.app.locals.bot && customer_tg_id) {
    const itemsList = items.map(i => `${i.name} × ${i.qty}`).join(', ')
    const manager_tg_id = req.app.locals.manager_tg_id
    if (manager_tg_id) {
      req.app.locals.bot.sendMessage(
        manager_tg_id,
        `🆕 Новый заказ #${order.id}\n👤 tg: ${customer_tg_id}\n🛒 ${itemsList}\n💰 ${total} ₽`
      ).catch(() => {})
    }
  }

  res.json({ order_id: order.id, status: 'ok' })
})

module.exports = router
