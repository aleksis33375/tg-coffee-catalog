require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const path = require('path')
const { createBot }  = require('./bot')
const { startCron }  = require('./cron')

const app = express()

// За nginx — доверяем X-Forwarded-For (иначе req.ip = 127.0.0.1 и rate-limit ломается)
app.set('trust proxy', 1)

// Б-А46: защитные HTTP-заголовки (X-Frame-Options, X-Content-Type-Options и т.д.).
// CSP отключён — Telegram WebApp инжектит свои скрипты/стили, CSP подкрутим отдельно.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))

// CORS — разрешаем запросы с Mini App на Vercel и локально
app.use(cors({
  origin: [
    process.env.MINI_APP_URL,
    'http://localhost:3000',
    'http://localhost:5500'
  ],
  credentials: true
}))

// Б-А51: ограничение размера JSON-тела — защита от DoS «огромным телом».
// 10 КБ хватает на все сценарии (заказ на 50 позиций + init_data + комментарий)
app.use(express.json({ limit: '10kb' }))

// Статика: Mini App, adminка и интерфейс бариста
const staticOpts = { maxAge: '7d' }
app.use('/admin',   express.static(path.join(__dirname, '..', 'admin')))
app.use('/barista', express.static(path.join(__dirname, '..', 'barista')))
app.use('/',        express.static(path.join(__dirname, '..', 'tg-app'), staticOpts))

// Маршруты API
app.use('/api', require('./routes/public'))
app.use('/api/admin', require('./routes/admin'))
app.use('/api/barista', require('./routes/barista'))
// app.use('/api', require('./routes/webhook'))         // подключим на шаге 6

// Загрузить настройки менеджера из БД при старте
const supabase = require('./db')
async function loadSettings() {
  const { data } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['manager_tg_id', 'bot_token', 'cafe_name'])

  if (data) {
    data.forEach(s => { app.locals[s.key] = s.value })
    console.log('Настройки загружены:', data.map(s => s.key).join(', '))
  }
}

// Создать базовые акции если их ещё нет
async function seedPromos() {
  const { data } = await supabase.from('promos').select('id').limit(1)
  if (data?.length) return // уже есть

  await supabase.from('promos').insert([
    { name: 'Кружка за кружкой', type: 'loyalty_cups',    config: { total_cups: 6 }, active: true },
    { name: 'Скидка на первый',  type: 'discount_first',  config: { percent: 10 },   active: true },
  ])
  console.log('✅ Базовые акции созданы')
}

const PORT = process.env.PORT || 3000
app.listen(PORT, async () => {
  await loadSettings()
  await seedPromos()

  // Запускаем Telegram-бота и cron
  const bot = createBot(process.env.BOT_TOKEN, process.env.MINI_APP_URL)
  if (bot) {
    app.locals.bot = bot
    startCron(bot)
  }

  console.log(`Сервер запущен на порту ${PORT}`)
})
