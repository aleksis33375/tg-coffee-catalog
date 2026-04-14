# BACKEND-PLAN.md
# Бэкенд для Telegram Mini App кофейни — план разработки

> Версия: 3.0 | Апрель 2026
> Стек: VPS Beget + Supabase + Vercel (Mini App)
> Основа: brief.md + архитектурное решение v3

---

## Концепция

Владелец кофейни разворачивает Express-сервер на VPS Beget, подключает Supabase как базу данных и хранилище файлов.
Первый запуск — настройка через adminку: название, логотип, меню, токен бота.
Дальше управляет сам: меняет цены, добавляет товары, смотрит заказы, делает рассылки.

---

## Стек

| Слой | Решение | Почему |
|---|---|---|
| Runtime | Node.js + Express | Постоянный процесс — Bot и SSE работают нативно |
| Процесс-менеджер | PM2 | Держит Express запущенным 24/7, перезапускает при сбоях |
| Reverse proxy | nginx | HTTPS, раздача статики (admin, barista), проксирование на Express |
| SSL | Let's Encrypt (certbot) | Бесплатный HTTPS — обязателен для Telegram Mini App |
| База данных | Supabase (PostgreSQL) | Управляемая БД с интерфейсом, бэкапами и 500 МБ бесплатно |
| Хранилище файлов | Supabase Storage | 1 ГБ бесплатно, CDN, хранит фото меню и логотип |
| Realtime (заказы) | Supabase Realtime | WebSocket-подписка на таблицу orders — мгновенные уведомления баристе |
| Cron-задачи | node-cron | Запускается внутри Express-процесса — birthday, inactive, рассылки |
| Авторизация adminки | JWT + пароль из .env | Токен живёт 7 дней |
| Авторизация бариста | JWT + PIN из БД | Токен живёт 24 часа (одна смена) |
| Telegram Bot | node-telegram-bot-api | Webhook → Express, отправка уведомлений, рассылки |
| Хостинг Mini App | Vercel | Статика — бесплатно, CDN, быстро по всему миру |
| Хостинг сервера | VPS Beget | ~250-500 руб/мес, постоянный сервер, данные в России |

---

## Схема размещения

```
Клиент в Telegram
       ↓
   Mini App (Vercel — статика, бесплатно)
       ↓ HTTPS API-запросы
   nginx на VPS Beget (reverse proxy + HTTPS)
       ↓
   Express (Node.js) — pm2 держит запущенным
       ├── Supabase PostgreSQL (БД — заказы, клиенты, смены)
       ├── Supabase Storage (фото меню, логотип)
       ├── Supabase Realtime (WebSocket → бариста)
       ├── /admin/ → статика adminки (nginx раздаёт)
       ├── /barista/ → статика интерфейса бариста (nginx)
       └── Telegram Bot API → уведомления клиентам
```

---

## Что хранится где

### Supabase PostgreSQL — все таблицы

#### `menu_items` — позиции меню
```sql
id          SERIAL PRIMARY KEY
category    TEXT NOT NULL            -- 'Кофе' | 'Чай' | 'Десерты' | 'Акции'
name        TEXT NOT NULL
price       INTEGER NOT NULL         -- в рублях
volume      TEXT                     -- '300 мл' | '200 гр'
description TEXT
photo_url   TEXT                     -- URL из Supabase Storage
badge       TEXT                     -- 'хит' | 'новинка' | null
emoji       TEXT
gradient    TEXT                     -- JSON: ["#5C3A21", "#C8813A"]
available   BOOLEAN DEFAULT true     -- false = скрыто, но не удалено
sort_order  INTEGER DEFAULT 0
created_at  TIMESTAMPTZ DEFAULT NOW()
```

#### `settings` — настройки кофейни
```sql
key   TEXT PRIMARY KEY
value TEXT
```
Все настройки в одной таблице ключ-значение:
```
cafe_name, tagline, address, logo_url, bot_token, webhook_secret,
manager_tg_id, barista_can_edit_menu, setup_complete,
auto_welcome_enabled, auto_welcome_text,
auto_birthday_enabled, auto_birthday_text,
auto_inactive_enabled, auto_inactive_days, auto_inactive_text
```

#### `customers` — покупатели
```sql
id            SERIAL PRIMARY KEY
tg_id         TEXT UNIQUE NOT NULL
first_name    TEXT
username      TEXT                   -- @username (может быть null)
birthday      TEXT                   -- 'MM-DD', вводит бариста с паспорта
referral_code TEXT UNIQUE
referred_by   TEXT                   -- tg_id пригласившего
source        TEXT DEFAULT 'direct'  -- 'direct' | 'qr' | 'yandex' | '2gis' | 'vk' | 'site' | 'referral'
status        TEXT DEFAULT 'visitor' -- 'visitor' | 'buyer'
vip           BOOLEAN DEFAULT false
created_at    TIMESTAMPTZ DEFAULT NOW()
last_seen     TIMESTAMPTZ
```

**Как фиксируется источник (UTM):**
```
https://tg-coffee-catalog.vercel.app/?utm_source=yandex
https://tg-coffee-catalog.vercel.app/?utm_source=2gis
https://tg-coffee-catalog.vercel.app/?utm_source=vk
https://tg-coffee-catalog.vercel.app/?utm_source=qr
https://tg-coffee-catalog.vercel.app/?utm_source=site
```
app.js читает `utm_source` → передаёт в `POST /api/customers`.

**Статус visitor / buyer:**
- Первое открытие → `status = 'visitor'`
- Оформил заказ → `status = 'buyer'` (обратно не возвращается)

#### `orders` — заказы
```sql
id              SERIAL PRIMARY KEY
customer_tg_id  TEXT
items           JSONB              -- [{id, name, qty, price}]
total           INTEGER
delivery_type   TEXT               -- 'pickup' | 'delivery'
delivery_time   TEXT
comment         TEXT
status          TEXT DEFAULT 'new' -- 'new' | 'preparing' | 'ready' | 'done'
payment         TEXT               -- 'card' | 'cash' | null
created_at      TIMESTAMPTZ DEFAULT NOW()
notified        BOOLEAN DEFAULT false
```

#### `promos` — акции
```sql
id          SERIAL PRIMARY KEY
name        TEXT NOT NULL
type        TEXT NOT NULL
config      JSONB
active      BOOLEAN DEFAULT true
created_at  TIMESTAMPTZ DEFAULT NOW()
```

**Типы акций:**

| Тип | Название | config |
|---|---|---|
| `cups_loyalty` | Каждая N-я кружка бесплатно | `{ "totalCups": 6, "items": ["Капучино"] }` |
| `discount_first` | Скидка на первый заказ | `{ "percent": 10 }` |
| `discount_percent` | Скидка % на заказ | `{ "percent": 15, "minTotal": 500 }` |
| `buy_n_get_one` | Купи N — получи следующий бесплатно | `{ "buyCount": 2, "items": ["Капучино"] }` |
| `birthday_discount` | Скидка в день рождения | `{ "percent": 20, "daysWindow": 7 }` |
| `referral` | Приведи друга — получи бонус | `{ "bonusType": "cups", "bonusValue": 1 }` |

#### `order_promos` — применённые акции
```sql
id              SERIAL PRIMARY KEY
order_id        INTEGER
promo_id        INTEGER NOT NULL
customer_tg_id  TEXT NOT NULL
event           TEXT NOT NULL      -- 'cup_earned' | 'free_cup_given' | 'discount_applied'
value           INTEGER
marked_by       TEXT               -- 'barista' | 'system' | 'admin'
created_at      TIMESTAMPTZ DEFAULT NOW()
```

#### `customer_promo_progress` — прогресс клиента по акциям
```sql
customer_tg_id  TEXT NOT NULL
promo_id        INTEGER NOT NULL
progress        INTEGER DEFAULT 0
updated_at      TIMESTAMPTZ
PRIMARY KEY (customer_tg_id, promo_id)
```

#### `broadcasts` — история рассылок
```sql
id           SERIAL PRIMARY KEY
text         TEXT NOT NULL
segment      TEXT DEFAULT 'all'   -- 'all' | 'buyers' | 'visitors' | 'inactive' | 'vip'
sent_to      INTEGER
scheduled_at TIMESTAMPTZ
sent         BOOLEAN DEFAULT false
created_at   TIMESTAMPTZ DEFAULT NOW()
```

#### `baristas` — сотрудники
```sql
id         SERIAL PRIMARY KEY
name       TEXT NOT NULL
pin        TEXT NOT NULL          -- 4-значный PIN, хранится хешем
active     BOOLEAN DEFAULT true
created_at TIMESTAMPTZ DEFAULT NOW()
```

#### `shifts` — смены баристов
```sql
id            SERIAL PRIMARY KEY
barista_id    INTEGER NOT NULL
opened_at     TIMESTAMPTZ NOT NULL
closed_at     TIMESTAMPTZ
orders_count  INTEGER DEFAULT 0
total_cash    INTEGER DEFAULT 0
total_card    INTEGER DEFAULT 0
```

#### `barista_log` — лог действий
```sql
id              SERIAL PRIMARY KEY
barista_id      INTEGER NOT NULL
barista_action  TEXT NOT NULL      -- 'cup_marked' | 'discount_applied' | 'status_changed' | 'birthday_set' | 'menu_edited' | 'shift_closed'
order_id        INTEGER
customer_tg_id  TEXT
details         JSONB
created_at      TIMESTAMPTZ DEFAULT NOW()
```

#### `menu_history` — история изменений меню
```sql
id          SERIAL PRIMARY KEY
item_id     INTEGER NOT NULL
action      TEXT NOT NULL          -- 'price_changed' | 'name_changed' | 'added' | 'deleted' | 'availability_changed'
old_value   JSONB
new_value   JSONB
changed_by  TEXT                   -- 'admin' | 'barista'
created_at  TIMESTAMPTZ DEFAULT NOW()
```

### Supabase Storage — файлы

Два bucket'а:
- `menu-images` — фото позиций меню (публичный)
- `cafe-assets` — логотип кофейни (публичный)

URL: `https://<project>.supabase.co/storage/v1/object/public/menu-images/капучино.jpg`
Сохраняется в `menu_items.photo_url`.

### .env — секреты
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...        -- service_role ключ (только на сервере)
SUPABASE_ANON_KEY=eyJ...           -- anon ключ (для клиента barista.js)
ADMIN_PASSWORD=ваш_пароль
JWT_SECRET=случайная_строка_32_символа
JWT_EXPIRES_ADMIN=7d
JWT_EXPIRES_BARISTA=24h
BOT_TOKEN=                         -- заполняется через adminку
WEBHOOK_SECRET=случайная_строка
PORT=3000
```

---

## Как работает Realtime (уведомления баристе)

Supabase Realtime — WebSocket-подписка прямо из браузера бариста.
Express на VPS в этом не участвует — браузер соединяется с Supabase напрямую.

```js
// barista.js (браузер планшета)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

supabase
  .channel('orders')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, payload => {
    showNewOrder(payload.new)
    playBeep()  // Web Audio API
  })
  .subscribe()
```

Автопереподключение встроено в Supabase client — при потере связи восстанавливается само.

---

## Как работают Cron-задачи

`node-cron` запускается внутри Express-процесса при старте сервера:

```js
// backend/cron.js
const cron = require('node-cron')

cron.schedule('0 9 * * *', sendBirthdayMessages)   // каждый день в 9:00
cron.schedule('0 10 * * *', sendInactiveMessages)  // каждый день в 10:00
cron.schedule('*/5 * * * *', sendScheduledBroadcasts) // каждые 5 минут
```

PM2 держит процесс живым — cron не пропускает расписание.

---

## API — полный список

### Публичные (без авторизации, для Mini App)

| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/menu` | Меню из menu_items (только available=true) |
| POST | `/api/orders` | Принять заказ, уведомить бота |
| GET | `/api/customers/:tg_id` | Данные клиента и прогресс по акциям |
| POST | `/api/customers` | Зарегистрировать при первом заходе |
| GET | `/api/customers/:tg_id/referral` | Реферальная ссылка |

### Интерфейс бариста (JWT с ролью `barista`)

**Авторизация**
| Метод | URL | Что делает |
|---|---|---|
| POST | `/api/barista/login` | Проверить PIN, вернуть JWT |

**Смена**
| Метод | URL | Что делает |
|---|---|---|
| POST | `/api/barista/shift/open` | Открыть смену |
| GET | `/api/barista/shift/summary` | Итог текущей смены |
| POST | `/api/barista/shift/close` | Закрыть смену |

**Заказы**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/barista/orders` | Активные заказы (new / preparing) |
| PUT | `/api/barista/orders/:id/status` | Сменить статус, при ready — уведомить клиента |

> Новые заказы приходят через Supabase Realtime — без отдельного API.

**Акции**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/barista/orders/:id/promos` | Доступные акции к заказу |
| POST | `/api/barista/orders/:id/promos/:promo_id` | Применить акцию |
| GET | `/api/barista/customers/search` | Поиск клиента по @username |
| POST | `/api/barista/customers/:tg_id/promos/:promo_id` | Применить акцию напрямую к клиенту |
| PUT | `/api/barista/customers/:tg_id/birthday` | Ввести дату рождения |

**Меню (если разрешено)**
| Метод | URL | Что делает |
|---|---|---|
| PUT | `/api/barista/menu/items/:id` | Редактировать позицию. 403 если закрыто |
| POST | `/api/barista/upload/image` | Загрузить фото в Supabase Storage |

---

### Adminка (JWT с ролью `admin`)

**Авторизация**
| Метод | URL | Что делает |
|---|---|---|
| POST | `/api/admin/login` | Проверить пароль, вернуть JWT |

**Настройки**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/settings` | Читать из таблицы settings |
| PUT | `/api/admin/settings` | Сохранить, при смене токена — перерегистрировать webhook |
| POST | `/api/admin/upload/logo` | Загрузить логотип в Supabase Storage |

**Меню**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/menu` | Полное меню для редактирования |
| POST | `/api/admin/menu/items` | Добавить позицию |
| PUT | `/api/admin/menu/items/:id` | Редактировать позицию |
| DELETE | `/api/admin/menu/items/:id` | Удалить позицию |
| PUT | `/api/admin/menu/items/:id/availability` | Скрыть / показать |
| PUT | `/api/admin/menu/items/:id/sort` | Изменить порядок |
| GET | `/api/admin/menu/history` | История изменений |
| POST | `/api/admin/upload/image` | Загрузить фото в Supabase Storage |

**Заказы**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/orders` | Список с фильтрами: дата, статус |
| PUT | `/api/admin/orders/:id/status` | Сменить статус |
| PUT | `/api/admin/orders/:id/cancel` | Отменить с причиной |
| GET | `/api/admin/orders/stats` | Выручка за сегодня / неделю / месяц |

**Аналитика**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/analytics/top-items` | Топ позиций за период |
| GET | `/api/admin/analytics/avg-check` | Средний чек |
| GET | `/api/admin/analytics/peak-hours` | Заказы по часам |
| GET | `/api/admin/analytics/compare` | Сравнение двух периодов |
| GET | `/api/admin/analytics/conversion` | Конверсия visitor → buyer |
| GET | `/api/admin/analytics/sources` | По источникам: посетители, покупатели, выручка |
| GET | `/api/admin/analytics/categories` | Выручка по категориям |

**Клиенты**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/customers` | Список с фильтрами: status, source, vip |
| GET | `/api/admin/customers/:tg_id` | Профиль: история, прогресс по акциям |
| PUT | `/api/admin/customers/:tg_id/cups` | Ручная корректировка кружек |
| PUT | `/api/admin/customers/:tg_id/vip` | Поставить / снять VIP |
| GET | `/api/admin/customers/export` | Выгрузка в CSV |

**Рассылки**
| Метод | URL | Что делает |
|---|---|---|
| POST | `/api/admin/broadcast` | Рассылка по сегменту (сразу или по расписанию) |
| GET | `/api/admin/broadcast/scheduled` | Запланированные рассылки |
| DELETE | `/api/admin/broadcast/scheduled/:id` | Отменить запланированную |
| GET | `/api/admin/broadcast/history` | История рассылок |

**Автосообщения**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/auto-messages` | Настройки (welcome, birthday, inactive) |
| PUT | `/api/admin/auto-messages` | Включить/выключить, изменить текст |

**Акции**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/promos` | Список акций |
| POST | `/api/admin/promos` | Создать |
| PUT | `/api/admin/promos/:id` | Редактировать |
| PUT | `/api/admin/promos/:id/toggle` | Включить / выключить |
| DELETE | `/api/admin/promos/:id` | Удалить |
| GET | `/api/admin/promos/:id/stats` | Статистика применений |

**Сотрудники**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/baristas` | Список баристов |
| POST | `/api/admin/baristas` | Добавить (имя + PIN) |
| PUT | `/api/admin/baristas/:id/pin` | Сменить PIN |
| PUT | `/api/admin/baristas/:id/active` | Активировать / деактивировать |
| GET | `/api/admin/baristas/:id/shifts` | История смен |

**Права бариста и лог**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/barista/settings` | Текущие права |
| PUT | `/api/admin/barista/settings` | Включить/выключить редактирование меню |
| GET | `/api/admin/barista/log` | Лог действий с фильтром |

**Первый запуск**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/setup/status` | Что из настроек заполнено |
| PUT | `/api/admin/setup/complete` | Завершить мастер настройки |

**Бот**
| Метод | URL | Что делает |
|---|---|---|
| POST | `/api/webhook` | Telegram webhook (защищён WEBHOOK_SECRET) |

---

## Кто что видит

| Действие | Покупатель | Бариста | Владелец |
|---|---|---|---|
| Просмотр меню | ✅ | ✅ | ✅ |
| Оформить заказ | ✅ | — | — |
| Видеть свои кружки | ✅ | — | — |
| Видеть все активные заказы | — | ✅ | ✅ |
| Менять статус заказа | — | ✅ | ✅ |
| Отметить кружку / скидку | — | ✅ | ✅ |
| Искать клиента по @username | — | ✅ | ✅ |
| Редактировать позиции меню | — | ⚙️ если разрешено | ✅ |
| Добавить / удалить позицию | — | ❌ | ✅ |
| Просмотр всех клиентов | — | ❌ | ✅ |
| Ручная правка кружек | — | ❌ | ✅ |
| Рассылки | — | ❌ | ✅ |
| Настройки кофейни / бота | — | ❌ | ✅ |
| Управление правами бариста | — | ❌ | ✅ |
| Смена PIN бариста | — | ❌ | ✅ |
| Статистика и выручка | — | ❌ | ✅ |

> ⚙️ — только если владелец включил переключатель в adminке

---

## Логика ключевых сценариев

### Сценарий 0: Клиент открыл приложение (визит без заказа)
```
Клиент переходит по ссылке (с QR, Яндекс Карт, ВКонтакте и т.д.)
  → app.js читает utm_source из URL
  → POST /api/customers { tg_id, first_name, username, source }
  → Новый → запись: status='visitor', source='qr'
  → Уже есть → обновить last_seen (source и status не перезаписывать)
  → Ничего не заказал → остаётся visitor
```

### Сценарий 1: Покупатель оформляет заказ
```
Mini App → POST /api/orders
  → Сохранить в orders (статус 'new')
  → customers: status → 'buyer'
  → Бот отправляет уведомление менеджеру
  → Supabase Realtime → браузер бариста получает новую строку orders → звук + карточка
  → Вернуть order_id в Mini App

  ⚠️ Кружки не считаются автоматически — только бариста нажимает кнопку.
```

### Сценарий 2: Бариста меняет статус заказа
```
Бариста → PUT /api/barista/orders/:id/status { status: 'ready' }
  → Обновить в БД
  → Если 'ready' — бот отправляет клиенту «Ваш заказ готов!»
```

### Сценарий 3: Рассылка клиентам
```
Adminка → POST /api/admin/broadcast { text, segment, scheduled_at }
  → Если scheduled_at null — отправить сразу
  → Если scheduled_at указан — сохранить, node-cron отправит в нужное время
```

### Сценарий 4: Бариста применяет акцию
```
POST /api/barista/orders/:id/promos/:promo_id
  → Проверить: уже применена? → ошибка «Уже отмечено»
  → cups_loyalty: progress +1 → при достижении totalCups → бесплатная кружка
  → discount: записать в order_promos, уведомить клиента
```

### Сценарий 5: Бариста ищет клиента вручную
```
GET /api/barista/customers/search?username=alex
  → Найти по username
  → Вернуть прогресс по акциям
  → POST /api/barista/customers/:tg_id/promos/:promo_id (order_id = null)
```

### Сценарий 6: Акция «Скидка в день рождения»
```
Первый раз: бариста вводит дату с паспорта
  → PUT /api/barista/customers/:tg_id/birthday { birthday: '03-15' }

Последующие визиты:
  → При открытии карточки — система проверяет birthday ±daysWindow
  → Если в диапазоне — акция появляется в списке доступных
```

### Сценарий 7: Акция «Приведи друга»
```
GET /api/customers/:tg_id/referral → ссылка https://t.me/bot?start=ref_КОД
Друг открывает → /api/webhook → /start → referred_by сохраняется
Друг делает первый заказ → бонус пригласившему
```

### Сценарий 8: Cron — автосообщения
```
node-cron 9:00 → birthday: найти customers где birthday = сегодня ±N → бот отправляет
node-cron 10:00 → inactive: найти last_seen < (сегодня - N дней) → бот напоминает
node-cron */5 → broadcasts: найти sent=false И scheduled_at <= NOW → отправить
```

### Сценарий 9: Владелец смотрит аналитику
```
GET /api/admin/analytics/sources
  → PostgreSQL группирует customers + orders по source
  → «С QR 40 человек, купили 28, выручка 18 400 ₽»

GET /api/admin/analytics/top-items?period=week
  → Разворачивает JSONB-массив orders.items → GROUP BY name → TOP 5

GET /api/admin/analytics/peak-hours
  → GROUP BY EXTRACT(HOUR FROM created_at)
```

---

## UI Adminки — экраны и визуализация

### Библиотека

**Chart.js** — CDN, без сборщика:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

---

### Принцип drill-down (клик на график → таблица)

1. Клик на элемент графика
2. Под графиком раскрывается таблица — без перехода на другой экран
3. Повторный клик — сворачивает

---

### Навигация adminки

```
┌─────────────────────────────────────┐
│         [контент вкладки]           │
├────────┬────────┬──────────┬────────┤
│   📊   │   ☕   │    📣    │   ⚙️  │
│Дашборд │  Меню  │Маркетинг │Настрой-│
│        │        │          │   ки   │
└────────┴────────┴──────────┴────────┘
```

---

### Экраны adminки

#### 📊 Дашборд
```
┌─────────────────────────────────────────────────────────────────┐
│  [Сегодня] [Неделя] [Месяц] [__ апр — __ апр]  □ Сравнить      │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│ Выручка      │ Заказов      │ Средний чек  │ Новых клиентов     │
│ 42 800 руб.  │    187       │    229 руб.  │        23          │
├──────────────┴──────────────┴──────────────┴────────────────────┤
│  Выручка по дням — линейный график                              │
├─────────────────────────┬───────────────────────────────────────┤
│  Топ позиций            │  Источники трафика                    │
│  Капучино  ████████ 47  │  QR 38% Яндекс 24% ВК 18%           │
├─────────────────────────┼───────────────────────────────────────┤
│  Пиковые часы           │  Выручка по категориям               │
│  9 10 11 12 13          │  Кофе 58% Чай 24% Десерты 18%        │
├─────────────────────────┴───────────────────────────────────────┤
│  Воронка: Зашли 120 → Открыли 80 → Купили 45                   │
├─────────────────────────────────────────────────────────────────┤
│  ▼ Детали (drill-down при клике на график)                      │
│  Дата       Клиент      Позиции              Сумма              │
│  14 апр     Иван К.     Капучино x2, Эклер   660 руб.          │
└─────────────────────────────────────────────────────────────────┘
```

**Drill-down:**

| Кликаешь | Видишь | API |
|---|---|---|
| Точка линейного графика | Заказы за день | `GET /api/admin/orders?date=2026-04-14` |
| Столбец «Топ позиций» | Заказы с этой позицией | `GET /api/admin/orders?item_name=Капучино` |
| Столбец «Пиковые часы» | Заказы в этот час | `GET /api/admin/orders?hour=10` |
| Сектор «Источники» | Клиенты с источника | `GET /api/admin/customers?source=qr` |
| Сектор «Категории» | Позиции категории | `GET /api/admin/analytics/top-items?category=Кофе` |
| Сегмент воронки | Клиенты на этапе | `GET /api/admin/customers?status=visitor` |

#### ☕ Меню (Позиции + Акции)
```
┌─────────────────────────────────────┐
│  [Позиции]  [Акции]     [+ Добавить]│
├─────────────────────────────────────┤
│  Капучино                   220 руб.│
│  [зел.] Доступен  (стрелки) [Ред.]  │
├─────────────────────────────────────┤
│  Латте                      250 руб.│
│  [кр.] Скрыт      (стрелки) [Ред.]  │
└─────────────────────────────────────┘
```

#### 📣 Маркетинг (Рассылки + Автосообщения)
```
┌─────────────────────────────────────┐
│  Сегмент: [Все] [Покупатели] [VIP]  │
│  Получателей: 87 чел.               │
│  [________________________________] │
│  [Сейчас] [Запланировать __:__]     │
│  [ Отправить ]                      │
└─────────────────────────────────────┘
```

#### ⚙️ Настройки
```
┌─────────────────────────────────────┐
│  Название / Слоган / Адрес / Лого   │
│  Telegram-бот: [токен] [Подключить] │
│  Маша [зел.]  [Сменить PIN]         │
│  Петя [кр.]   [Восстановить]        │
│  [+ Добавить бариста]               │
│  Меню для бариста: [выкл.][Включить]│
└─────────────────────────────────────┘
```

#### 🚀 Мастер первого запуска
```
┌─────────────────────────────────────┐
│  Давай настроим твою кофейню!       │
│  ● Шаг 1 — Название и логотип       │
│  ○ Шаг 2 — Добавь позиции           │
│  ○ Шаг 3 — Добавь баристу           │
│  ○ Шаг 4 — Подключи Telegram-бота   │
│  [ Дальше → ]                       │
└─────────────────────────────────────┘
```

---

### Экраны бариста

**[Первый вход] — онбординг:**
```
┌─────────────────────────────────────┐
│  Привет, Маша! 👋                   │
│  📦 Новый заказ — нажми «Принять»  │
│  ☕ Кружка — нажми «+1» в карточке │
│  🔍 Клиент без заказа — QR или @   │
│  [ Понятно, начинаем! ]             │
└─────────────────────────────────────┘
```

**[Нет заказов]:**
```
┌─────────────────────────────────────┐
│  Пока заказов нет ☕                │
│  Топ сегодня:                       │
│  1. Капучино — 47 шт               │
│  2. Латте    — 31 шт               │
│  Пик: обычно с 09:00 до 11:00       │
└─────────────────────────────────────┘
```

**[Есть заказы]:**
```
┌─────────────────────────────────────┐
│  Маша  •  смена с 09:00       [🚪]  │
├─────────────────────────────────────┤
│  🔴 Новый  •  10:34                 │
│  Иван К. — Капучино × 2   660 ₽    │
│  [ Принять ]                        │
├─────────────────────────────────────┤
│  🟡 Готовится  •  10:21             │
│  Мария С. — Латте, Матча  440 ₽    │
│  [ Готов ] [ Акции ▾ ]              │
└─────────────────────────────────────┘
```

> Новые заказы появляются без перезагрузки — Supabase Realtime.
> При новом заказе — короткий бип (Web Audio API).

**[Поиск клиента]:**
```
┌─────────────────────────────────────┐
│  [ @username  или  📷 QR ]          │
│  ✅ Иван К. — Кружек: 4 из 6       │
│  [ 💵 Наличкой ] [ 💳 Картой ]      │
│  [ + Отметить кружку ]              │
└─────────────────────────────────────┘
```

**[Закрытие смены]:**
```
┌─────────────────────────────────────┐
│  Смена завершена ✅  09:00 — 18:45  │
│  Заказов: 34                        │
│  Наличными:   8 200 руб.            │
│  Картой:     14 600 руб.            │
│  [ Закрыть смену ]                  │
└─────────────────────────────────────┘
```

---

## Структура файлов

```
tg-coffee-catalog/
├── tg-app/                    # Mini App (Vercel) — без изменений
│   ├── index.html
│   ├── app.js
│   └── style.css
│
├── backend/                   # Express сервер (VPS Beget)
│   ├── server.js              # Точка входа: Express, CORS, маршруты, статика
│   ├── db.js                  # Supabase client (service_role)
│   ├── bot.js                 # Telegram Bot — отправка сообщений
│   ├── cron.js                # node-cron: birthday, inactive, broadcasts
│   │
│   ├── routes/
│   │   ├── public.js          # GET /api/menu, POST /api/orders, customers
│   │   ├── admin.js           # Все /api/admin/* маршруты
│   │   ├── barista.js         # Все /api/barista/* маршруты
│   │   └── webhook.js         # POST /api/webhook
│   │
│   └── middleware/
│       └── auth.js            # JWT проверка + роль (admin | barista)
│
├── admin/                     # Adminка владельца (статика → nginx на VPS)
│   ├── index.html
│   ├── admin.js
│   └── admin.css
│
├── barista/                   # Интерфейс бариста (статика → nginx на VPS)
│   ├── index.html
│   ├── barista.js
│   └── barista.css
│
├── nginx.conf                 # Конфиг nginx для VPS
├── ecosystem.config.js        # PM2 конфиг (автозапуск, количество процессов)
├── package.json
├── .env                       # Секреты (не в git)
└── BACKEND-PLAN.md
```

### ecosystem.config.js (PM2)
```js
module.exports = {
  apps: [{
    name: 'coffee-backend',
    script: 'backend/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: { NODE_ENV: 'production' }
  }]
}
```

### nginx.conf (пример)
```nginx
server {
  listen 443 ssl;
  server_name yourdomain.ru;

  # SSL от Let's Encrypt
  ssl_certificate /etc/letsencrypt/live/yourdomain.ru/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/yourdomain.ru/privkey.pem;

  # Adminка и бариста — статика
  location /admin/ {
    root /var/www/coffee;
    try_files $uri $uri/ /admin/index.html;
  }

  location /barista/ {
    root /var/www/coffee;
    try_files $uri $uri/ /barista/index.html;
  }

  # API — проксируется на Express
  location /api/ {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
  }
}
```

---

## Порядок разработки

### Этап 1 — Supabase и сервер
1. Создать проект в Supabase → URL и ключи
2. Создать все таблицы в SQL editor Supabase
3. Наполнить `menu_items` из текущего menu.json
4. `backend/db.js` — Supabase client
5. `backend/server.js` — Express с CORS, маршрутами
6. `backend/middleware/auth.js` — JWT

### Этап 2 — Публичное API
7. `routes/public.js` — меню, заказы, клиенты

### Этап 3 — Admin API
8. `routes/admin.js` — login, меню, заказы, настройки
9. Загрузка фото в Supabase Storage

### Этап 4 — Интерфейс adminки
10. `admin/index.html` — 4 вкладки
11. Меню: CRUD, включить/выключить
12. Настройки: название, логотип, сотрудники, бот
13. Мастер первого запуска (4 шага)

### Этап 5 — Бариста
14. `routes/barista.js` — login, заказы, смена
15. `barista/index.html` — PIN-вход, список заказов, закрытие смены
16. Supabase Realtime в barista.js — мгновенные уведомления + звук

### Этап 6 — Telegram Bot
17. `backend/bot.js` — отправка сообщений
18. `routes/webhook.js` — /start, реферальные ссылки
19. Регистрация webhook при сохранении токена в настройках

### Этап 7 — Рассылки и аналитика
20. `backend/cron.js` — node-cron: birthday, inactive, broadcasts
21. `routes/admin.js` — broadcast, auto-messages, analytics
22. Дашборд в adminке: Chart.js, drill-down, фильтр периода
23. Вкладка Маркетинг: рассылки, автосообщения

### Этап 8 — Акции и полировка
24. Акции: CRUD в adminке, применение баристой
25. Поиск клиента по @username / QR
26. Онбординг бариста (первый вход)
27. Лог действий бариста, история изменений меню
28. Экспорт клиентов в CSV
29. Профиль клиента с историей и VIP

---

## Развёртывание на VPS Beget

### Что нужно сделать один раз
```bash
# 1. Установить Node.js и PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install nodejs
sudo npm install -g pm2

# 2. Установить nginx
sudo apt install nginx

# 3. SSL через Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.ru

# 4. Клонировать репозиторий
git clone https://github.com/ваш/repo.git /var/www/coffee
cd /var/www/coffee && npm install

# 5. Создать .env с ключами Supabase и Bot token

# 6. Запустить через PM2
pm2 start ecosystem.config.js
pm2 save           # запомнить процессы
pm2 startup        # автозапуск после перезагрузки VPS
```

### Обновление после изменений
```bash
cd /var/www/coffee
git pull
npm install        # если изменились зависимости
pm2 restart coffee-backend
```

---

## Важные ограничения

- **Рассылки через бота** — только клиентам, которые сами написали боту (/start). Telegram запрещает первым писать незнакомым.
- **HTTPS обязателен** — Telegram Mini App не открывается по HTTP. Let's Encrypt решает бесплатно.
- **Supabase Realtime** требует anon-ключ в barista.js — он публичный, но доступ ограничивается через Row Level Security в Supabase.
- **Один экземпляр = одна кофейня.**
- **День рождения** — Telegram не передаёт. Бариста вводит вручную.
- **Реферальная программа** — только если друг открыл бота по ссылке `/start ref_КОД`.
- **Домен обязателен** — для SSL на VPS нужен свой домен (можно взять на Beget, от ~200 руб/год).
