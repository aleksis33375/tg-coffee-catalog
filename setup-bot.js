/**
 * setup-bot.js — настройка Telegram-бота
 * Запустить один раз: node setup-bot.js
 */

const fs   = require('fs');
const path = require('path');

// Читаем .env без внешних зависимостей
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) { console.error('❌ Файл .env не найден'); process.exit(1); }
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key) process.env[key] = val;
    }
  });
}

loadEnv();

const TOKEN       = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL;
const BASE        = `https://api.telegram.org/bot${TOKEN}`;

if (!TOKEN) { console.error('❌ BOT_TOKEN не задан в .env'); process.exit(1); }

async function api(method, params = {}) {
  const res  = await fetch(`${BASE}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(params),
  });
  const json = await res.json();
  if (json.ok) {
    console.log(`✅ ${method}`);
  } else {
    console.error(`❌ ${method}: ${json.description}`);
  }
  return json;
}

async function setup() {
  console.log('🤖 Настройка бота Hot Black Coffee...\n');

  // 1. Описание бота — отображается на странице профиля
  await api('setMyDescription', {
    description:
      'Добро пожаловать в Hot Black Coffee! ☕\n' +
      'Здесь ты можешь посмотреть меню, выбрать напитки и десерты и оформить заказ — ' +
      'всё прямо в Telegram без звонков и очередей.\n' +
      'Нажми кнопку «Открыть меню» 👇',
  });

  // 2. Короткое описание — отображается в списке чатов
  await api('setMyShortDescription', {
    short_description: 'Заказывай кофе и десерты Hot Black Coffee прямо в Telegram. Быстро, без звонков.',
  });

  // 3. Команды бота
  await api('setMyCommands', {
    commands: [
      { command: 'start',   description: '☕ Открыть меню кофейни' },
      { command: 'help',    description: '❓ Как сделать заказ'    },
      { command: 'contact', description: '💬 Написать менеджеру'   },
    ],
  });

  // 4. Кнопка меню — открывает Mini App
  if (MINI_APP_URL) {
    await api('setChatMenuButton', {
      menu_button: {
        type:    'web_app',
        text:    '☕ Открыть меню',
        web_app: { url: MINI_APP_URL },
      },
    });
    console.log(`   → ${MINI_APP_URL}`);
  } else {
    console.warn('⚠️  MINI_APP_URL не задан — кнопка меню не установлена');
  }

  console.log('\n🎉 Готово! Проверь бота в Telegram.');
}

setup().catch(err => { console.error('❌ Ошибка:', err.message); process.exit(1); });
