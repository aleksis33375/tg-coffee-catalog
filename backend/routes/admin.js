const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const crypto = require('crypto')
const multer = require('multer')
const rateLimit = require('express-rate-limit')
const supabase = require('../db')
const auth = require('../middleware/auth')

// Б-А53: MIME-whitelist — исключает SVG (может содержать <script>) и прочий мусор
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES.has(file.mimetype)) return cb(null, true)
    cb(new Error('Разрешены только JPG, PNG, WebP или GIF'))
  }
})

// Б-А54: извлечь имя файла из Supabase public URL для последующего удаления
function extractStoragePath(url, bucket) {
  if (!url || typeof url !== 'string') return null
  const marker = `/storage/v1/object/public/${bucket}/`
  const i = url.indexOf(marker)
  if (i === -1) return null
  return decodeURIComponent(url.substring(i + marker.length).split('?')[0])
}

// Б-А39/57: форматирование даты в таймзоне кофейни (по умолчанию Europe/Moscow)
function dateInTZ(date, tz = 'Europe/Moscow') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date)
  const y = parts.find(p => p.type === 'year').value
  const m = parts.find(p => p.type === 'month').value
  const d = parts.find(p => p.type === 'day').value
  return `${y}-${m}-${d}`
}

// Б-А39: получить ISO-начало дня (00:00) в указанной таймзоне
function startOfDayISO(date, tz = 'Europe/Moscow') {
  const ymd = dateInTZ(date, tz)
  // Смещение таймзоны: берём из Date.toLocaleString с полем timeZoneName и парсим
  // Проще: используем Europe/Moscow = UTC+3 (без DST с 2014 г.)
  return `${ymd}T00:00:00+03:00`
}

// Б-А56: строгая валидация булевых значений
function coerceBool(v) {
  if (v === true || v === 'true') return true
  if (v === false || v === 'false') return false
  return null // невалидно
}

// Б-А76: парсит period/from/to из query → { since, until } в ISO
function parsePeriodRange(req) {
  if (req.query.from && req.query.to) {
    // Б-А85: валидируем даты, чтобы невалидная строка не вызвала toISOString() на NaN
    const sinceD = new Date(req.query.from + 'T00:00:00+03:00')
    const untilD = new Date(req.query.to   + 'T23:59:59+03:00')
    if (!isNaN(sinceD) && !isNaN(untilD) && sinceD <= untilD) {
      return { since: sinceD.toISOString(), until: untilD.toISOString() }
    }
  }
  const period = Math.min(parseInt(req.query.period) || 7, 365)
  return { since: new Date(Date.now() - period * 86400000).toISOString(), until: new Date().toISOString() }
}

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
  // Б-А45: короткий TTL — уменьшает окно для украденного токена
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_ADMIN || '12h'
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
  // Б-А58: брать расширение из whitelist, а не из mime-подстроки
  const ext = MIME_TO_EXT[req.file.mimetype] || 'bin'
  const name = `logo-${Date.now()}.${ext}`
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
  const { category, name, volume, description, photo_url, badge, emoji, gradient } = req.body
  if (!category || !name) return res.status(400).json({ error: 'category, name, price обязательны' })
  const price = Number(req.body.price)
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'price должен быть положительным числом' })

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

  // Б-А13: если товар не существует — 404, не создаём запись в menu_history с old_value: null
  const { data: old, error: oldErr } = await supabase.from('menu_items').select('*').eq('id', id).single()
  if (oldErr || !old) return res.status(404).json({ error: 'Позиция не найдена' })

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
  const { data: old, error: oldErr } = await supabase.from('menu_items').select('*').eq('id', id).single()
  if (oldErr || !old) return res.status(404).json({ error: 'Позиция не найдена' })

  const { error } = await supabase.from('menu_items').delete().eq('id', id)
  if (error) return res.status(500).json({ error: error.message })

  // Б-А54: удалить фото из Storage, чтобы не плодить orphan-файлы
  const photoPath = extractStoragePath(old.photo_url, 'menu-images')
  if (photoPath) {
    await supabase.storage.from('menu-images').remove([photoPath]).catch(() => {})
  }

  await supabase.from('menu_history').insert({
    item_id: Number(id), action: 'deleted', old_value: old, changed_by: 'admin'
  })

  res.json({ ok: true })
})

// PUT /api/admin/menu/items/:id/availability
router.put('/menu/items/:id/availability', auth('admin'), async (req, res) => {
  // Б-А56: жёсткая валидация булева поля — иначе можно записать 'yes', 1, {} и т.п.
  const available = coerceBool(req.body.available)
  if (available === null) return res.status(400).json({ error: 'available должно быть true или false' })
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
  // Б-А61: sort_order должен быть целым числом в разумных границах — иначе порядок меню можно сломать строкой/NaN
  const sort_order = Number.parseInt(req.body.sort_order, 10)
  if (!Number.isInteger(sort_order) || sort_order < 0 || sort_order > 9999) {
    return res.status(400).json({ error: 'sort_order должен быть целым числом от 0 до 9999' })
  }
  const { data, error } = await supabase.from('menu_items').update({ sort_order }).eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── ЗАКАЗЫ ──────────────────────────────────────────────────────────────────

// GET /api/admin/orders
router.get('/orders', auth('admin'), async (req, res) => {
  const { date, status } = req.query
  // Б-А55: кап limit, чтобы недобросовестный клиент не выкачивал всю базу одним запросом
  const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 50, 1), 200)
  const offset = Math.max(parseInt(req.query.offset) || 0, 0)
  let query = supabase.from('orders').select('*, customers(first_name, username)').order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (status) query = query.eq('status', status)
  // Б-А73: границы дня в МСК (UTC+3), иначе вечерние заказы после 21:00 МСК попадают в следующий UTC-день
  if (date) query = query.gte('created_at', date + 'T00:00:00+03:00').lte('created_at', date + 'T23:59:59+03:00')
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// PUT /api/admin/orders/:id/status
router.put('/orders/:id/status', auth('admin'), async (req, res) => {
  const { status } = req.body
  // Б-А49: whitelist допустимых статусов
  const VALID_STATUSES = ['new', 'preparing', 'ready', 'done', 'cancelled']
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Недопустимый статус' })
  const { data, error } = await supabase.from('orders').update({ status }).eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })

  // Уведомить клиента если заказ готов
  if (status === 'ready' && data.customer_tg_id && req.app.locals.bot) {
    req.app.locals.bot.sendMessage(data.customer_tg_id, '✅ Ваш заказ готов! Можно забирать.').catch(() => {})
  }

  res.json(data)
})

// GET /api/admin/orders/stats?period=7|30|90 OR from=YYYY-MM-DD&to=YYYY-MM-DD
// Б-А75: добавлены avg_check и new_customers; Б-А76/77: единый period/range
router.get('/orders/stats', auth('admin'), async (req, res) => {
  // Б-А39: «сегодня» считаем по Europe/Moscow
  const now = new Date()
  const todayStart = startOfDayISO(now)
  const { since, until } = parsePeriodRange(req)

  try {
    const [todayRes, periodRes, newCustRes] = await Promise.all([
      supabase.from('orders').select('total').gte('created_at', todayStart).eq('status', 'done'),
      supabase.from('orders').select('total').gte('created_at', since).lte('created_at', until).eq('status', 'done'),
      supabase.from('customers').select('id', { count: 'exact', head: true }).gte('created_at', since).lte('created_at', until)
    ])

    if (todayRes.error || periodRes.error) {
      const err = todayRes.error || periodRes.error
      return res.status(500).json({ error: err.message })
    }

    const sum = arr => (arr || []).reduce((s, o) => s + (o.total || 0), 0)
    const periodRevenue = sum(periodRes.data)
    const periodOrders  = periodRes.data?.length || 0

    res.json({
      today: { revenue: sum(todayRes.data), orders: todayRes.data?.length || 0 },
      period: {
        revenue: periodRevenue,
        orders:  periodOrders,
        avg_check:     periodOrders > 0 ? Math.round(periodRevenue / periodOrders) : 0,
        new_customers: newCustRes.count || 0
      }
    })
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Не удалось получить статистику' })
  }
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
  // Б-А56: строгая валидация boolean
  const active = coerceBool(req.body.active)
  if (active === null) return res.status(400).json({ error: 'active должно быть true или false' })
  const { data, error } = await supabase.from('baristas').update({ active }).eq('id', req.params.id).select('id, name, active').single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── КЛИЕНТЫ ─────────────────────────────────────────────────────────────────

// GET /api/admin/customers
router.get('/customers', auth('admin'), async (req, res) => {
  const { status, source, vip } = req.query
  // Б-А55: кап limit для /customers по той же причине, что и для /orders
  const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 50, 1), 200)
  const offset = Math.max(parseInt(req.query.offset) || 0, 0)
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
  // Б-А56: строгая валидация boolean
  const vip = coerceBool(req.body.vip)
  if (vip === null) return res.status(400).json({ error: 'vip должно быть true или false' })
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
  // Б-А60: кап limit по аналогии с /orders и /customers, чтобы один запрос
  // не выкачал всю таблицу логов и не подвесил сервер
  const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 50, 1), 200)
  const offset = Math.max(parseInt(req.query.offset) || 0, 0)

  const { data, error } = await supabase
    .from('barista_log')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return res.status(500).json({ error: error.message })

  // Подтягиваем имена баристы отдельным запросом
  if (data?.length) {
    const ids = [...new Set(data.map(r => r.barista_id).filter(Boolean))]
    if (!ids.length) return res.json(data)
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

// GET /api/admin/analytics/chart?period=7|30 OR from=YYYY-MM-DD&to=YYYY-MM-DD
// Б-А76/77/78: единый range, возвращаем данные для line-графика
router.get('/analytics/chart', auth('admin'), async (req, res) => {
  const { since, until } = parsePeriodRange(req)

  const { data, error } = await supabase
    .from('orders')
    .select('created_at, total')
    .gte('created_at', since)
    .lte('created_at', until)
    .eq('status', 'done')

  if (error) return res.status(500).json({ error: error.message })

  // Б-А57: группируем по дате в таймзоне кофейни (Europe/Moscow), а не по UTC
  const byDate = {}
  ;(data || []).forEach(o => {
    const date = dateInTZ(new Date(o.created_at))
    if (!byDate[date]) byDate[date] = { revenue: 0, orders: 0 }
    byDate[date].revenue += o.total || 0
    byDate[date].orders++
  })

  // Заполняем все дни диапазона (без пропусков)
  const result = []
  const d = new Date(since)
  const endStr = dateInTZ(new Date(until))
  while (true) {
    const date = dateInTZ(d)
    result.push({ date, ...(byDate[date] || { revenue: 0, orders: 0 }) })
    if (date >= endStr) break
    d.setDate(d.getDate() + 1)
    if (result.length > 400) break // safety cap
  }

  res.json(result)
})

// GET /api/admin/analytics/top-items?period=30 OR from=&to=
router.get('/analytics/top-items', auth('admin'), async (req, res) => {
  const { since, until } = parsePeriodRange(req)

  const { data, error } = await supabase
    .from('orders')
    .select('items')
    .gte('created_at', since)
    .lte('created_at', until)

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

// GET /api/admin/analytics/traffic-sources?period=|from=&to=
// Б-А79: источники трафика из таблицы customers
router.get('/analytics/traffic-sources', auth('admin'), async (req, res) => {
  const { since, until } = parsePeriodRange(req)
  const { data, error } = await supabase
    .from('customers')
    .select('source')
    .gte('created_at', since)
    .lte('created_at', until)
  if (error) return res.status(500).json({ error: error.message })
  const counts = {}
  ;(data || []).forEach(c => { const s = c.source || 'direct'; counts[s] = (counts[s] || 0) + 1 })
  res.json(Object.entries(counts).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count))
})

// GET /api/admin/analytics/peak-hours?period=|from=&to=
// Б-А80: распределение заказов по часам (Europe/Moscow)
router.get('/analytics/peak-hours', auth('admin'), async (req, res) => {
  const { since, until } = parsePeriodRange(req)
  const { data, error } = await supabase
    .from('orders')
    .select('created_at')
    .gte('created_at', since)
    .lte('created_at', until)
  if (error) return res.status(500).json({ error: error.message })
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false })
  const hours = {}
  ;(data || []).forEach(o => {
    const h = Number(hourFmt.format(new Date(o.created_at)))
    if (!Number.isFinite(h)) return
    hours[h] = (hours[h] || 0) + 1
  })
  const result = []
  for (let h = 0; h < 24; h++) {
    if (hours[h]) result.push({ hour: h, orders: hours[h] })
  }
  res.json(result)
})

// GET /api/admin/analytics/by-category?period=|from=&to=
// Б-А81: выручка по категориям меню
router.get('/analytics/by-category', auth('admin'), async (req, res) => {
  const { since, until } = parsePeriodRange(req)
  const [ordersRes, menuRes] = await Promise.all([
    supabase.from('orders').select('items').gte('created_at', since).lte('created_at', until).eq('status', 'done'),
    supabase.from('menu_items').select('id, category')
  ])
  if (ordersRes.error) return res.status(500).json({ error: ordersRes.error.message })
  // Б-А86: menuRes.error не критична — при неудаче вся выручка пойдёт в "Без категории"
  if (menuRes.error) console.warn('[by-category] menu_items query failed:', menuRes.error.message)
  const catMap = {}
  ;(menuRes.data || []).forEach(m => { catMap[m.id] = m.category || 'Без категории' })
  const revenue = {}
  ;(ordersRes.data || []).forEach(o => {
    if (!Array.isArray(o.items)) return
    o.items.forEach(i => {
      const cat = catMap[i.id] || 'Без категории'
      revenue[cat] = (revenue[cat] || 0) + (i.price || 0) * (i.qty || 1)
    })
  })
  res.json(Object.entries(revenue).map(([category, r]) => ({ category, revenue: Math.round(r) })).sort((a, b) => b.revenue - a.revenue))
})

// GET /api/admin/analytics/funnel
// Б-А82: воронка конверсии visitor → buyer
router.get('/analytics/funnel', auth('admin'), async (req, res) => {
  const { data, error } = await supabase.from('customers').select('status')
  if (error) return res.status(500).json({ error: error.message })
  const counts = { visitor: 0, buyer: 0 }
  ;(data || []).forEach(c => { if (c.status in counts) counts[c.status]++ })
  const total = counts.visitor + counts.buyer
  res.json([
    { label: 'Все клиенты', count: total },
    { label: 'Сделали заказ', count: counts.buyer }
  ])
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
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return res.status(400).json({ error: 'Текст сообщения обязателен' })
  // Б-А63: Telegram отклоняет сообщения длиннее 4096 символов — валидируем на входе,
  // чтобы не ловить молчаливые ошибки в цикле и не получать «отправлено 0 из 800»
  if (text.length > 4096) {
    return res.status(400).json({ error: 'Сообщение слишком длинное: максимум 4096 символов' })
  }

  const bot = req.app.locals.bot
  if (!bot) return res.status(503).json({ error: 'Бот не запущен' })

  const segment = target || 'all'

  // Б-А64: рассылка не должна держать HTTP-соединение — для 1000+ клиентов это
  // десятки секунд, nginx/браузер рвут по таймауту, админ жмёт повторно → дубли.
  // Пишем строку `broadcasts` со статусом, сразу возвращаем id, отправляем в фоне.
  const { data: bc, error: insErr } = await supabase.from('broadcasts').insert({
    text, segment, sent_to: 0, sent: false
  }).select().single()

  if (insErr) return res.status(500).json({ error: insErr.message })

  const { sendBroadcast } = require('../cron')
  sendBroadcast(bot, text, segment)
    .then(({ sent, total }) =>
      supabase.from('broadcasts').update({ sent_to: sent, sent: true }).eq('id', bc.id)
    )
    .catch(e => {
      console.error('broadcast failed:', e?.message || e)
      supabase.from('broadcasts').update({ sent: false }).eq('id', bc.id)
    })

  res.json({ broadcast_id: bc.id, status: 'queued' })
})

module.exports = router
