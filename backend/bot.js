const TelegramBot = require('node-telegram-bot-api')
const crypto      = require('crypto')
const supabase    = require('./db')

let bot = null

function createBot(token, miniAppUrl) {
  if (!token) {
    console.warn('⚠️  BOT_TOKEN не задан — бот не запущен')
    return null
  }

  bot = new TelegramBot(token, { polling: true })

  // ── /start ────────────────────────────────────────────────────────────────
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId     = msg.chat.id
    const tgId       = String(msg.from.id)
    const firstName  = msg.from.first_name || ''
    const username   = msg.from.username   || ''
    const startParam = (match[1] || '').trim()

    // Определяем источник
    let source = 'bot'
    if (startParam.startsWith('ref_')) source = 'referral'
    else if (startParam === 'from_app') source = 'mini_app'

    // Регистрируем или обновляем клиента
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('tg_id', tgId)
      .single()

    if (!existing) {
      // Б-А43: криптостойкий referral_code + retry при коллизии UNIQUE
      for (let attempt = 0; attempt < 5; attempt++) {
        const referral_code = crypto.randomBytes(6).toString('base64url').slice(0, 8).toUpperCase()
        const { error } = await supabase.from('customers').insert({
          tg_id: tgId,
          first_name: firstName,
          username,
          source,
          status: 'visitor',
          referral_code,
          last_seen: new Date().toISOString()
        })
        if (!error) break
        if (error.code !== '23505') break
      }
    } else {
      await supabase
        .from('customers')
        .update({ first_name: firstName, username, last_seen: new Date().toISOString() })
        .eq('tg_id', tgId)
    }

    // Б-А50: экранируем first_name для HTML-режима — иначе имя вроде
    // "<script>" или "&amp;" ломает сообщение (parse_mode: 'HTML' ниже)
    const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ))
    const greeting = firstName ? `Привет, ${escapeHTML(firstName)}! ` : 'Привет! '
    const text = greeting +
      '☕ Добро пожаловать в <b>Hot Black Coffee</b>!\n\n' +
      'Здесь ты можешь выбрать напиток и оформить заказ прямо в Telegram — ' +
      'без звонков и очередей.\n\n' +
      'Нажми кнопку ниже чтобы открыть меню 👇'

    const opts = { parse_mode: 'HTML' }
    if (miniAppUrl) {
      opts.reply_markup = {
        inline_keyboard: [[
          { text: '☕ Открыть меню', web_app: { url: miniAppUrl } }
        ]]
      }
    }

    bot.sendMessage(chatId, text, opts).catch(() => {})
  })

  // ── /help ─────────────────────────────────────────────────────────────────
  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      '❓ <b>Как сделать заказ:</b>\n\n' +
      '1. Нажми кнопку <b>☕ Открыть меню</b>\n' +
      '2. Выбери напитки и десерты\n' +
      '3. Нажми «Оформить заказ»\n' +
      '4. Жди уведомления — напишем когда будет готово\n\n' +
      'По любым вопросам: /contact',
      { parse_mode: 'HTML' }
    ).catch(() => {})
  })

  // ── /contact ──────────────────────────────────────────────────────────────
  bot.onText(/\/contact/, async (msg) => {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'manager_tg_id')
      .single()

    const text = data?.value
      ? `💬 Напишите нам напрямую — мы ответим быстро`
      : '💬 Для связи воспользуйтесь кнопкой меню.'

    bot.sendMessage(msg.chat.id, text).catch(() => {})
  })

  // ── Ошибки polling ────────────────────────────────────────────────────────
  bot.on('polling_error', (err) => {
    // Игнорируем ETELEGRAM 409 — несколько экземпляров бота
    if (err.code !== 'ETELEGRAM' || !err.message.includes('409')) {
      console.error('Bot polling error:', err.message)
    }
  })

  console.log('🤖 Бот запущен (polling)')
  return bot
}

function getBot() { return bot }

module.exports = { createBot, getBot }
