const cron    = require('node-cron')
const supabase = require('./db')

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── ЗАПУСК ВСЕХ ЗАДАЧ ─────────────────────────────────────────────────────────

function startCron(bot) {
  if (!bot) {
    console.warn('⚠️  Cron: бот не инициализирован — задачи не запущены')
    return
  }

  // Поздравление с ДР — каждый день в 9:00 МСК (6:00 UTC)
  cron.schedule('0 6 * * *', () => sendBirthdayGreetings(bot))

  // Напоминание неактивным — каждый понедельник в 10:00 МСК (7:00 UTC)
  cron.schedule('0 7 * * 1', () => sendInactiveReminders(bot))

  console.log('⏰ Cron-задачи запущены (ДР + неактивные)')
}

// ── ДЕНЬ РОЖДЕНИЯ ─────────────────────────────────────────────────────────────

async function sendBirthdayGreetings(bot) {
  // birthday хранится как "ММ-ДД", например "03-15"
  const now  = new Date()
  const mmdd = String(now.getMonth() + 1).padStart(2, '0') + '-' +
               String(now.getDate()).padStart(2, '0')

  const { data: customers } = await supabase
    .from('customers')
    .select('tg_id, first_name')
    .eq('birthday', mmdd)

  if (!customers?.length) return

  let sent = 0
  for (const c of customers) {
    const name = c.first_name ? `, ${c.first_name}` : ''
    try {
      await bot.sendMessage(
        c.tg_id,
        `🎂 С днём рождения${name}!\n\n` +
        `Дарим тебе скидку 10% на следующий заказ — ` +
        `просто покажи это сообщение баристе ☕`
      )
      sent++
    } catch {}
    await sleep(100) // не спамим Telegram API
  }
  console.log(`🎂 Поздравления с ДР: отправлено ${sent}/${customers.length}`)
}

// ── НЕАКТИВНЫЕ КЛИЕНТЫ ────────────────────────────────────────────────────────

async function sendInactiveReminders(bot) {
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString()

  const { data: customers } = await supabase
    .from('customers')
    .select('tg_id, first_name')
    .eq('status', 'buyer')
    .lt('last_seen', cutoff)
    .limit(200)

  if (!customers?.length) return

  let sent = 0
  for (const c of customers) {
    const name = c.first_name ? `, ${c.first_name}` : ''
    try {
      await bot.sendMessage(
        c.tg_id,
        `☕ Давно не виделись${name}!\n\n` +
        `В меню появились новинки — загляни, скучаем по тебе 🤍`
      )
      sent++
    } catch {}
    await sleep(100)
  }
  console.log(`📬 Напоминания неактивным: отправлено ${sent}/${customers.length}`)
}

// ── РУЧНАЯ РАССЫЛКА (вызывается из /api/admin/broadcast) ──────────────────────

async function sendBroadcast(bot, message, target) {
  let query = supabase.from('customers').select('tg_id').not('tg_id', 'is', null)

  if (target === 'buyers') {
    query = query.eq('status', 'buyer')
  } else if (target === 'inactive') {
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString()
    query = query.eq('status', 'buyer').lt('last_seen', cutoff)
  }
  // target === 'all' — без доп. фильтра

  const { data: customers } = await query.limit(1000)
  if (!customers?.length) return { sent: 0, total: 0 }

  let sent = 0
  for (const c of customers) {
    try {
      await bot.sendMessage(c.tg_id, message)
      sent++
    } catch {}
    await sleep(100)
  }

  console.log(`📣 Рассылка (${target}): отправлено ${sent}/${customers.length}`)
  return { sent, total: customers.length }
}

module.exports = { startCron, sendBroadcast }
