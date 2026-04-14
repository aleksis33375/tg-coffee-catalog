require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()

// CORS — разрешаем запросы с Mini App на Vercel и локально
app.use(cors({
  origin: [
    process.env.MINI_APP_URL,
    'http://localhost:3000',
    'http://localhost:5500'
  ],
  credentials: true
}))

app.use(express.json())

// Статика: adminка и интерфейс бариста
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')))
app.use('/barista', express.static(path.join(__dirname, '..', 'barista')))

// Маршруты API
app.use('/api', require('./routes/public'))
app.use('/api/admin', require('./routes/admin'))
// app.use('/api/barista', require('./routes/barista')) // подключим на шаге 5
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

const PORT = process.env.PORT || 3000
app.listen(PORT, async () => {
  await loadSettings()
  console.log(`Сервер запущен на порту ${PORT}`)
})
