const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const crypto = require('crypto')
const multer = require('multer')
const rateLimit = require('express-rate-limit')
const supabase = require('../db')
const auth = require('../middleware/auth')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } })

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Попробуй через 15 минут' }
})

// ─── АВТОРИЗАЦИЯ ────────────────────────────────────────────────────────────

// POST /api/admin/login
router.post('/login', loginLimiter, async (req, res) => {
  const { password } = req.body
  const expected = process.env.ADMIN_PASSWORD
  if (!password || !expected) {
    return res.status(401).json({ error: 'Неверный пароль' })
  }
  const pwdBuf = Buffer.from(String(password))
  const expBuf = Buffer.from(expected)
  if (pwdBuf.length !== expBuf.length || !crypto.timingSafeEqual(pwdBuf, expBuf)) {
    return res.status(401).json({ error: 'Неверный пароль' })
  }
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_ADMIN || '7d'
  })
  res.json({ token })
})

// ─── НАСТРОЙКИ ──────────────────────────────────────────────────────────────

// GET /api/admin/settings
router.get('/settings', auth('admin'), async (req, res) => {
  const { data, error } = await supabase.from('settings').select('key, value')
  if (error) return res.status(500).json({ error: error.message })
  const result = {}
  data.forEach(s => { result[s.key] = s.value })
  // Скрыть bot_token из ответа
  if (result.bot_token) result.bot_token = result.bot_token ? '••••••••' : ''
  res.json(result)
})

// PUT /api/admin/settings
router.put('/settings', auth('admin'), async (req, res) => {
  const allowed = ['cafe_name', 'tagline', 'address', 'manager_tg_id', 'bot_token', 'bot_username']
  const updates = []

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates.push({ key, value: req.body[key] })
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Нечего обновлять' })

  for (const { key, value } of updates) {
    const { error } = await supabase.from('settings').upsert({ key, value })
    if (error) return res.status(500).json({ error: error.message })
  }

  // Обновить app.locals если сменился bot_token или manager_tg_id
  if (req.body.manager_tg_id) req.app.locals.manager_tg_id = req.body.manager_tg_id
  if (req.body.bot_token) req.app.locals.bot_token = req.body.bot_token

  res.json({ ok: true })
})

// ─── ЗАГРУЗКА ФАЙЛОВ ─────────────────────────────────────────────────────────

// POST /api/admin/upload/image
router.post('/upload/image', auth('admin'), upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' })
  const name = `${Date.now()}-${req.file.originalname.replace(/[^\w.]/g, '_')}`
  const { error } = await supabase.storage.from('menu-images').upload(name, req.file.buffer, {
    contentType: req.file.mimetype, upsert: false
  })
  if (error) return res.status(500).json({ error: error.message })
  const { data } = supabase.storage.from('menu-images').getPublicUrl(name)
  res.json({ url: data.publicUrl })
})

// POST /api/admin/upload/logo
router.post('/upload/logo', auth('admin'), upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' })
  const name = `logo-${Date.now()}.${req.file.mimetype.split('/')[1]}`
  const { error } = await supabase.storage.from('cafe-assets').upload(name, req.file.buffer, {
    contentType: req.file.mimetype, upsert: true
  })
  if (error) return res.status(500).json({ error: error.message })
  const { data } = supabase.storage.from('cafe-assets').getPublicUrl(name)
  await supabase.from('settings').upsert({ key: 'logo_url', value: data.publicUrl })
  res.json({ url: data.publicUrl })
})

// ─── МЕНЮ ───────────────────────────────────────────────────────────────────

// GET /api/admin/menu
router.get('/menu', auth('admin'), async (req, res) => {
  const { data, error } = await supabase.from('menu_items').select('*').order('sort_order')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/admin/menu/items
router.post('/menu/items', auth('admin'), async (req, res) => {
  const { category, name, price, volume, description, photo_url, badge, emoji, gradient } = req.body
  if (!category || !name || !price) return res.status(400).json({ error: 'category, name, price обязательны' })

  const { data: maxSort } = await supabase.from('menu_items').select('sort_order').order('sort_order', { ascending: false }).limit(1)
  const sort_order = maxSort?.[0]?.sort_order + 1 || 1

  const { data, error } = await supabase.from('menu_items').insert({
    category, name, price, volume, description, photo_url, badge, emoji,
    gradient: typeof gradient === 'object' ? JSON.stringify(gradient) : gradient,
    available: true, sort_order
  }).select().single()

  if (error) return res.status(500).json({ error: error.message })

  await supabase.from('menu_history').insert({
    item_id: data.id, action: 'added',
    new_value: data, changed_by: 'admin'
  })

  res.json(data)
})

// PUT /api/admin/menu/items/:id
router.put('/menu/items/:id', auth('admin'), async (req, res) => {
  const { id } = req.params
  const fields = ['category', 'name', 'price', 'volume', 'description', 'photo_url', 'badge', 'emoji', 'gradient']
  const updates = {}
  fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f] })
  if (updates.gradient && typeof updates.gradient === 'object') updates.gradient = JSON.stringify(updates.gradient)

  const { data: old } = await supabase.from('menu_items').select('*').eq('id', id).single()
  const { data, error } = await supabase.from('menu_items').update(updates).eq('id', id).select().single()
  if (error) return res.status(500).json({ error: error.message })

  await supabase.from('menu_history').insert({
    item_id: Number(id), action: 'price_changed',
    old_value: old, new_value: data, changed_by: 'admin'
  })

  res.json(data)
})

// DELETE /api/admin/menu/items/:id
router.delete('/menu/items/:id', auth('admin'), async (req, res) => {
  const { id } = req.params
  const { data: old } = await supabase.from('menu_items').select('*').eq('id', id).single()
  const { error } = await supabase.from('menu_items').delete().eq('id', id)
  if (error) return res.status(500).json({ error: error.message })

  await supabase.from('menu_history').insert({
    item_id: Number(id), action: 'deleted', old_value: old, changed_by: 'admin'
  })

  res.json({ ok: true })
})

// PUT /api/admin/menu/items/:id/availability
router.put('/menu/items/:id/availability', auth('admin'), async (req, res) => {
  const { available } = req.body
  const { data, error } = await supabase.from('menu_items').update({ available }).eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  await supabase.from('menu_history').insert({
    item_id: Number(req.params.id), action: 'availability_changed',
    new_value: { available }, changed_by: 'admin'
  })
  res.json(data)
})

// PUT /api/admin/menu/items/:id/sort
router.put('/menu/items/:id/sort', auth('admin'), async (req, res) => {
  const { sort_order } = req.body
  const { data, error } = await supabase.from('menu_items').update({ sort_order }).eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── ЗАКАЗЫ ──────────────────────────────────────────────────────────────────

// GET /api/admin/orders
router.get('/orders', auth('admin'), async (req, res) => {
  const { date, status, limit = 50, offset = 0 } = req.query
  let query = supabase.from('orders').select('*, customers(first_name, username)').order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (status) query = query.eq('status', status)
  if (date) query = query.gte('created_at', date + 'T00:00:00').lte('created_at', date + 'T23:59:59')
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// PUT /api/admin/orders/:id/status
router.put('/orders/:id/status', auth('admin'), async (req, res) => {
  const { status } = req.body
  const { data, error } = await supabase.from('orders').update({ status }).eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })

  // Уведомить клиента если заказ готов
  if (status === 'ready' && data.customer_tg_id && req.app.locals.bot) {
    req.app.locals.bot.sendMessage(data.customer_tg_id, '✅ Ваш заказ готов! Можно забирать.').catch(() => {})
  }

  res.json(data)
})

// GET /api/admin/orders/stats
router.get('/orders/stats', auth('admin'), async (req, res) => {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const weekAgo = new Date(now - 7 * 86400000).toISOString()
  const monthAgo = new Date(now - 30 * 86400000).toISOString()

  const [todayRes, weekRes, monthRes] = await Promise.all([
    supabase.from('orders').select('total').gte('created_at', today + 'T00:00:00').eq('status', 'done'),
    supabase.from('orders').select('total').gte('created_at', weekAgo).eq('status', 'done'),
    supabase.from('orders').select('total').gte('created_at', monthAgo).eq('status', 'done')
  ])

  const sum = arr => (arr || []).reduce((s, o) => s + (o.total || 0), 0)

  res.json({
    today: { revenue: sum(todayRes.data), orders: todayRes.data?.length || 0 },
    week:  { revenue: sum(weekRes.data),  orders: weekRes.data?.length  || 0 },
    month: { revenue: sum(monthRes.data), orders: monthRes.data?.length || 0 }
  })
})

// ─── БАРИСТЫ ─────────────────────────────────────────────────────────────────

// GET /api/admin/baristas
router.get('/baristas', auth('admin'), async (req, res) => {
  const { data, error } = await supabase.from('baristas').select('id, name, active, created_at').order('id')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/admin/baristas
router.post('/baristas', auth('admin'), async (req, res) => {
  const { name, pin } = req.body
  if (!name || !pin) return res.status(400).json({ error: 'name и pin обязательны' })
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN должен быть 4 цифры' })

  const hashed = await bcrypt.hash(pin, 10)
  const { data, error } = await supabase.from('baristas').insert({ name, pin: hashed }).select('id, name, active').single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// PUT /api/admin/baristas/:id/pin
router.put('/baristas/:id/pin', auth('admin'), async (req, res) => {
  const { pin } = req.body
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN должен быть 4 цифры' })
  const hashed = await bcrypt.hash(pin, 10)
  const { error } = await supabase.from('baristas').update({ pin: hashed }).eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// PUT /api/admin/baristas/:id/active
router.put('/baristas/:id/active', auth('admin'), async (req, res) => {
  const { active } = req.body
  const { data, error } = await supabase.from('baristas').update({ active }).eq('id', req.params.id).select('id, name, active').single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── КЛИЕНТЫ ─────────────────────────────────────────────────────────────────

// GET /api/admin/customers
router.get('/customers', auth('admin'), async (req, res) => {
  const { status, source, vip, limit = 50, offset = 0 } = req.query
  let query = supabase.from('customers').select('*').order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (status) query = query.eq('status', status)
  if (source) query = query.eq('source', source)
  if (vip !== undefined) query = query.eq('vip', vip === 'true')
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// PUT /api/admin/customers/:tg_id/vip
router.put('/customers/:tg_id/vip', auth('admin'), async (req, res) => {
  const { vip } = req.body
  const { data, error } = await supabase.from('customers').update({ vip }).eq('tg_id', req.params.tg_id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── ПРАВА БАРИСТА ───────────────────────────────────────────────────────────

// GET /api/admin/barista/settings
router.get('/barista/settings', auth('admin'), async (req, res) => {
  const { data } = await supabase.from('settings').select('value').eq('key', 'barista_can_edit_menu').single()
  res.json({ barista_can_edit_menu: data?.value === 'true' })
})

// PUT /api/admin/barista/settings
router.put('/barista/settings', auth('admin'), async (req, res) => {
  const { barista_can_edit_menu } = req.body
  await supabase.from('settings').upsert({ key: 'barista_can_edit_menu', value: String(barista_can_edit_menu) })
  res.json({ ok: true })
})

// ─── ПЕРВЫЙ ЗАПУСК ───────────────────────────────────────────────────────────

// GET /api/admin/setup/status
router.get('/setup/status', auth('admin'), async (req, res) => {
  const { data } = await supabase.from('settings').select('key, value')
    .in('key', ['cafe_name', 'bot_token', 'setup_complete'])
  const s = {}
  data?.forEach(r => { s[r.key] = r.value })
  res.json({
    complete: s.setup_complete === 'true',
    has_cafe_name: !!s.cafe_name && s.cafe_name !== 'Hot Black Coffee',
    has_bot: !!s.bot_token
  })
})

// PUT /api/admin/setup/complete
router.put('/setup/complete', auth('admin'), async (req, res) => {
  await supabase.from('settings').upsert({ key: 'setup_complete', value: 'true' })
  res.json({ ok: true })
})

// GET /api/admin/customers/export — CSV-экспорт клиентской базы
router.get('/customers/export', auth('admin'), async (req, res) => {
  const { data, error } = await supabase
    .from('customers')
    .select('tg_id, first_name, username, status, source, vip, birthday, last_seen, created_at')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const header = ['tg_id', 'Имя', 'Username', 'Статус', 'Источник', 'VIP', 'ДР', 'Последний визит', 'Дата регистрации']
  const rows = (data || []).map(c => [
    c.tg_id,
    c.first_name || '',
    c.username   ? '@' + c.username : '',
    c.status     || '',
    c.source     || '',
    c.vip        ? 'да' : 'нет',
    c.birthday   || '',
    c.last_seen  ? new Date(c.last_seen).toLocaleDateString('ru')  : '',
    c.created_at ? new Date(c.created_at).toLocaleDateString('ru') : ''
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))

  const csv = '\uFEFF' + [header.join(','), ...rows].join('\r\n') // BOM для Excel

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="customers_${new Date().toISOString().slice(0,10)}.csv"`)
  res.send(csv)
})

// GET /api/admin/barista-log — история действий баристы
router.get('/barista-log', auth('admin'), async (req, res) => {
  const { limit = 50 } = req.query

  const { data, error } = await supabase
    .from('barista_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Number(limit))

  if (error) return res.status(500).json({ error: error.message })

  // Подтягиваем имена баристы отдельным запросом
  if (data?.length) {
    const ids = [...new Set(data.map(r => r.barista_id).filter(Boolean))]
    const { data: baristas } = await supabase
      .from('baristas')
      .select('id, name')
      .in('id', ids)
    const nameMap = {}
    baristas?.forEach(b => { nameMap[b.id] = b.name })
    data.forEach(r => { r.barista_name = nameMap[r.barista_id] || null })
  }

  res.json(data || [])
})

// ─── АНАЛИТИКА ───────────────────────────────────────────────────────────────

// GET /api/admin/analytics/chart?period=7|30
router.get('/analytics/chart', auth('admin'), async (req, res) => {
  const period = Math.min(parseInt(req.query.period) || 7, 90)
  const since  = new Date(Date.now() - period * 86400000).toISOString()

  const { data, error } = await supabase
    .from('orders')
    .select('created_at, total')
    .gte('created_at', since)
    .eq('status', 'done')

  if (error) return res.status(500).json({ error: error.message })

  // Группируем по дате
  const byDate = {}
  ;(data || []).forEach(o => {
    const date = o.created_at.slice(0, 10)
    if (!byDate[date]) byDate[date] = { revenue: 0, orders: 0 }
    byDate[date].revenue += o.total || 0
    byDate[date].orders++
  })

  // Заполняем все дни периода (без пропусков)
  const result = []
  for (let i = period - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    result.push({ date, ...(byDate[date] || { revenue: 0, orders: 0 }) })
  }

  res.json(result)
})

// GET /api/admin/analytics/top-items?period=30
router.get('/analytics/top-items', auth('admin'), async (req, res) => {
  const period = Math.min(parseInt(req.query.period) || 30, 365)
  const since  = new Date(Date.now() - period * 86400000).toISOString()

  const { data, error } = await supabase
    .from('orders')
    .select('items')
    .gte('created_at', since)

  if (error) return res.status(500).json({ error: error.message })

  const counts = {}
  ;(data || []).forEach(o => {
    if (!Array.isArray(o.items)) return
    o.items.forEach(i => { counts[i.name] = (counts[i.name] || 0) + (i.qty || 1) })
  })

  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }))

  res.json(top)
})

// ─── РАССЫЛКИ ────────────────────────────────────────────────────────────────

// GET /api/admin/broadcasts — история
router.get('/broadcasts', auth('admin'), async (req, res) => {
  const { data, error } = await supabase
    .from('broadcasts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// POST /api/admin/broadcast — отправить рассылку
router.post('/broadcast', auth('admin'), async (req, res) => {
  const { message, target } = req.body
  if (!message?.trim()) return res.status(400).json({ error: 'Текст сообщения обязателен' })

  const bot = req.app.locals.bot
  if (!bot) return res.status(503).json({ error: 'Бот не запущен' })

  const { sendBroadcast } = require('../cron')
  const { sent, total } = await sendBroadcast(bot, message.trim(), target || 'all')

  await supabase.from('broadcasts').insert({
    text:     message.trim(),
    segment:  target || 'all',
    sent_to:  sent,
    sent:     true
  })

  res.json({ sent, total })
})

module.exports = router
