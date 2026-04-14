# BACKEND-PLAN.md
# Бэкенд для Telegram Mini App кофейни — план разработки

> Версия: 2.0 | Апрель 2026
> Стек: Supabase + Vercel (бесплатный план)
> Основа: brief.md + архитектурное решение v2

---

## Концепция

Владелец кофейни форкает репозиторий, деплоит на Vercel одной командой, создаёт проект в Supabase.
Первый запуск — настройка через adminку: название, логотип, меню, токен бота.
Дальше управляет сам: меняет цены, добавляет товары, смотрит заказы, делает рассылки.

**Всё бесплатно:** Vercel Free + Supabase Free tier.

---

## Стек

| Слой | Решение | Почему |
|---|---|---|
| Runtime (API) | Vercel Serverless Functions | Бесплатно, автодеплой из GitHub, нет постоянного сервера |
| База данных | Supabase (PostgreSQL) | 500 МБ бесплатно, мощнее SQLite, hosted |
| Хранилище файлов | Supabase Storage | 1 ГБ бесплатно, хранит фото меню и логотип |
| Realtime (заказы) | Supabase Realtime | Замена SSE — WebSocket-подписка на таблицу orders |
| Авторизация adminки | JWT + пароль из .env | Токен живёт 7 дней — владелец вводит пароль раз в неделю |
| Авторизация бариста | JWT + PIN из БД | Токен живёт 24 часа — бариста вводит PIN раз в день |
| Telegram Bot | node-telegram-bot-api | Webhook → Vercel Function, отправка уведомлений, рассылки |
| Cron-задачи | Vercel Cron Jobs | День рождения, неактивные клиенты, рассылки по расписанию |
| Хостинг Mini App | Vercel | Статика — бесплатно, быстро |
| Хостинг adminки и баристы | Vercel | Та же статика, раздаётся как /admin/ и /barista/ |

---

## Что хранится где

### Supabase PostgreSQL — все таблицы

**Меню перенесено из menu.json в БД** — Vercel не позволяет записывать файлы после деплоя.

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
available   BOOLEAN DEFAULT true     -- false = скрыто в Mini App, но не удалено
sort_order  INTEGER DEFAULT 0        -- порядок отображения
created_at  TIMESTAMPTZ DEFAULT NOW()
```

#### `settings` — настройки кофейни
```sql
key   TEXT PRIMARY KEY               -- 'cafe_name' | 'tagline' | 'address' | 'logo_url' | 'bot_token' | 'webhook_secret' | 'manager_tg_id' | ...
value TEXT
```
Всё в одной таблице ключ-значение. Adminка читает и пишет через `/api/admin/settings`.

#### `customers` — покупатели
```sql
id            SERIAL PRIMARY KEY
tg_id         TEXT UNIQUE NOT NULL   -- Telegram user_id
first_name    TEXT
username      TEXT                   -- @username (может быть null)
birthday      TEXT                   -- дата рождения 'MM-DD', вводится баристой
referral_code TEXT UNIQUE            -- уникальный код для реферальной ссылки
referred_by   TEXT                   -- tg_id пригласившего (null если пришёл сам)
source        TEXT DEFAULT 'direct'  -- 'direct' | 'qr' | 'yandex' | '2gis' | 'vk' | 'site' | 'referral'
status        TEXT DEFAULT 'visitor' -- 'visitor' — зашёл, 'buyer' — купил хотя бы раз
vip           BOOLEAN DEFAULT false  -- VIP-клиент, помечает владелец
created_at    TIMESTAMPTZ DEFAULT NOW()
last_seen     TIMESTAMPTZ
```

**Как фиксируется источник:**
Ссылки содержат UTM-параметр:
```
https://tg-coffee-catalog.vercel.app/?utm_source=yandex
https://tg-coffee-catalog.vercel.app/?utm_source=2gis
https://tg-coffee-catalog.vercel.app/?utm_source=vk
https://tg-coffee-catalog.vercel.app/?utm_source=qr
https://tg-coffee-catalog.vercel.app/?utm_source=site
```
При первом открытии app.js читает `utm_source` → передаёт в `POST /api/customers`.
Если параметра нет — `source = 'direct'`. Реферальная ссылка — `source = 'referral'`.

**Как фиксируется статус visitor / buyer:**
- Первое открытие → `POST /api/customers` → `status = 'visitor'`
- Оформил заказ → `POST /api/orders` → `status = 'buyer'`
- Обратно в visitor не возвращается.

#### `orders` — заказы
```sql
id              SERIAL PRIMARY KEY
customer_tg_id  TEXT               -- ссылка на customers.tg_id
items           JSONB              -- [{id, name, qty, price}]
total           INTEGER            -- сумма в рублях
delivery_type   TEXT               -- 'pickup' | 'delivery'
delivery_time   TEXT               -- время самовывоза
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
type        TEXT NOT NULL          -- 'cups_loyalty' | 'discount_first' | 'discount_percent' | 'buy_n_get_one' | 'birthday_discount' | 'referral'
config      JSONB                  -- параметры акции зависят от типа
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
order_id        INTEGER            -- к какому заказу (NULL если клиент без заказа из Mini App)
promo_id        INTEGER NOT NULL
customer_tg_id  TEXT NOT NULL
event           TEXT NOT NULL      -- 'cup_earned' | 'free_cup_given' | 'discount_applied'
value           INTEGER
marked_by       TEXT               -- 'barista' | 'system' | 'admin'
created_at      TIMESTAMPTZ DEFAULT NOW()
```

#### `customer_promo_progress` — прогресс по акциям
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
segment      TEXT DEFAULT 'all'  -- 'all' | 'buyers' | 'visitors' | 'inactive' | 'vip'
sent_to      INTEGER
scheduled_at TIMESTAMPTZ         -- NULL = сразу, дата = отложенная
sent         BOOLEAN DEFAULT false
created_at   TIMESTAMPTZ DEFAULT NOW()
```

#### `baristas` — сотрудники
```sql
id         SERIAL PRIMARY KEY
name       TEXT NOT NULL
pin        TEXT NOT NULL          -- 4-значный PIN, хранится в виде хеша
active     BOOLEAN DEFAULT true   -- false = уволен, доступ закрыт
created_at TIMESTAMPTZ DEFAULT NOW()
```

#### `shifts` — смены баристов
```sql
id            SERIAL PRIMARY KEY
barista_id    INTEGER NOT NULL
opened_at     TIMESTAMPTZ NOT NULL
closed_at     TIMESTAMPTZ
orders_count  INTEGER DEFAULT 0
total_cash    INTEGER DEFAULT 0   -- руб.
total_card    INTEGER DEFAULT 0   -- руб.
```

#### `barista_log` — лог действий бариста
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

URL файла: `https://<project>.supabase.co/storage/v1/object/public/menu-images/капучино.jpg`
Этот URL сохраняется в `menu_items.photo_url`.

### .env.local — секреты
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...        -- service_role ключ (полный доступ, только на сервере)
SUPABASE_ANON_KEY=eyJ...           -- anon ключ (для клиента, публичный)
ADMIN_PASSWORD=ваш_пароль
JWT_SECRET=случайная_строка_32_символа
JWT_EXPIRES_ADMIN=7d
JWT_EXPIRES_BARISTA=24h
BOT_TOKEN=                         -- заполняется через adminку
WEBHOOK_SECRET=случайная_строка
```

### auto-messages.json → таблица `settings`
Вместо отдельного файла settings.json — записи в таблице `settings`:
```
auto_welcome_enabled = 'true'
auto_welcome_text    = 'Привет! Добро пожаловать в Hot Black Coffee ☕'
auto_birthday_enabled = 'true'
auto_birthday_text   = '🎂 С днём рождения! Скидка 20%...'
auto_inactive_enabled = 'true'
auto_inactive_days   = '14'
auto_inactive_text   = 'Давно не заходил! Есть новинки в меню ☕'
barista_can_edit_menu = 'false'
setup_complete        = 'false'
```

---

## Как работает Realtime (замена SSE)

Вместо SSE-потока (который требует постоянный сервер) — Supabase Realtime:

```js
// barista.js (клиент)
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

supabase
  .channel('orders')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, payload => {
    // новый заказ — добавить в список, воспроизвести звук
    showNewOrder(payload.new)
    playBeep()
  })
  .subscribe()
```

**Преимущества перед SSE:**
- WebSocket через Supabase — автопереподключение встроено
- Не нужен постоянный сервер
- Работает даже при Vercel serverless (нет персистентного соединения с сервером)

---

## Как работают Cron-задачи (замена Express cron)

В `vercel.json` объявляются расписания:
```json
{
  "crons": [
    { "path": "/api/cron/birthday", "schedule": "0 6 * * *" },
    { "path": "/api/cron/inactive", "schedule": "0 7 * * *" },
    { "path": "/api/cron/broadcasts", "schedule": "*/5 * * * *" }
  ]
}
```

Vercel вызывает эти URL по расписанию — каждый URL это обычная serverless function.

---

## API — полный список

### Публичные (без авторизации, для Mini App)

| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/menu` | Возвращает позиции из таблицы menu_items (только available=true) |
| POST | `/api/orders` | Принимает заказ, сохраняет в БД, уведомляет через бота |
| GET | `/api/customers/:tg_id` | Данные клиента (имя, прогресс по акциям) |
| POST | `/api/customers` | Регистрирует клиента при первом заходе |
| GET | `/api/customers/:tg_id/referral` | Реферальная ссылка клиента |

### Интерфейс бариста (требуют JWT с ролью `barista`)

**Авторизация**
| Метод | URL | Что делает |
|---|---|---|
| POST | `/api/barista/login` | Проверяет личный PIN, возвращает JWT с barista_id и именем |

**Смена**
| Метод | URL | Что делает |
|---|---|---|
| POST | `/api/barista/shift/open` | Открыть смену |
| GET | `/api/barista/shift/summary` | Итог текущей смены: заказов, наличными, картой |
| POST | `/api/barista/shift/close` | Закрыть смену — фиксирует closed_at и итоги |

**Заказы**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/barista/orders` | Активные заказы (статус new / preparing) |
| PUT | `/api/barista/orders/:id/status` | Меняет статус, при ready — уведомляет клиента |

> Realtime-уведомления о новых заказах — через Supabase Realtime на клиенте, без отдельного API.

**Акции**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/barista/orders/:id/promos` | Активные акции применимые к заказу |
| POST | `/api/barista/orders/:id/promos/:promo_id` | Применить акцию к заказу |
| GET | `/api/barista/customers/search` | Поиск клиента по @username |
| POST | `/api/barista/customers/:tg_id/promos/:promo_id` | Применить акцию напрямую к клиенту |
| PUT | `/api/barista/customers/:tg_id/birthday` | Ввести / исправить дату рождения |

**Меню (только если владелец разрешил)**
| Метод | URL | Что делает |
|---|---|---|
| PUT | `/api/barista/menu/items/:id` | Редактировать позицию. 403 если barista_can_edit_menu=false |
| POST | `/api/barista/upload/image` | Загрузить фото в Supabase Storage. 403 если закрыто |

---

### Adminка (требуют JWT с ролью `admin`)

**Авторизация**
| Метод | URL | Что делает |
|---|---|---|
| POST | `/api/admin/login` | Проверяет пароль, возвращает JWT с ролью admin |

**Настройки кофейни**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/settings` | Название, слоган, адрес, логотип, токен бота |
| PUT | `/api/admin/settings` | Сохраняет в таблицу settings, при смене токена — перерегистрирует webhook |
| POST | `/api/admin/upload/logo` | Загружает логотип в Supabase Storage |

**Меню**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/menu` | Полное меню из menu_items для редактирования |
| POST | `/api/admin/menu/items` | Добавить позицию |
| PUT | `/api/admin/menu/items/:id` | Редактировать позицию |
| DELETE | `/api/admin/menu/items/:id` | Удалить позицию |
| PUT | `/api/admin/menu/items/:id/availability` | Скрыть / показать позицию |
| PUT | `/api/admin/menu/items/:id/sort` | Изменить порядок |
| GET | `/api/admin/menu/history` | История изменений меню |
| POST | `/api/admin/upload/image` | Загрузить фото в Supabase Storage |

**Заказы**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/orders` | Список заказов (фильтр: дата, статус) |
| PUT | `/api/admin/orders/:id/status` | Меняет статус, при ready — уведомляет клиента |
| PUT | `/api/admin/orders/:id/cancel` | Отмена с причиной |
| GET | `/api/admin/orders/stats` | Выручка за сегодня / неделю / месяц |

**Аналитика**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/analytics/top-items` | Топ позиций по продажам за период |
| GET | `/api/admin/analytics/avg-check` | Средний чек за период |
| GET | `/api/admin/analytics/peak-hours` | Заказы по часам — пиковое время |
| GET | `/api/admin/analytics/compare` | Сравнение двух периодов |
| GET | `/api/admin/analytics/conversion` | Конверсия visitor → buyer |
| GET | `/api/admin/analytics/sources` | По источникам: посетители, покупатели, выручка |
| GET | `/api/admin/analytics/categories` | Выручка по категориям |

**Клиенты**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/customers` | Список с фильтрами: status, source, vip |
| GET | `/api/admin/customers/:tg_id` | Профиль: история заказов, прогресс по акциям |
| PUT | `/api/admin/customers/:tg_id/cups` | Ручная корректировка кружек |
| PUT | `/api/admin/customers/:tg_id/vip` | Поставить / снять VIP |
| GET | `/api/admin/customers/export` | Выгрузка в CSV |

**Рассылки**
| Метод | URL | Что делает |
|---|---|---|
| POST | `/api/admin/broadcast` | Рассылка по сегменту (сразу или по расписанию) |
| GET | `/api/admin/broadcast/scheduled` | Запланированные рассылки |
| DELETE | `/api/admin/broadcast/scheduled/:id` | Отмена запланированной |
| GET | `/api/admin/broadcast/history` | История рассылок |

**Автосообщения**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/auto-messages` | Текущие настройки (welcome, birthday, inactive) |
| PUT | `/api/admin/auto-messages` | Включить/выключить, изменить текст |

**Акции**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/promos` | Список акций |
| POST | `/api/admin/promos` | Создать акцию |
| PUT | `/api/admin/promos/:id` | Редактировать |
| PUT | `/api/admin/promos/:id/toggle` | Включить / выключить |
| DELETE | `/api/admin/promos/:id` | Удалить |
| GET | `/api/admin/promos/:id/stats` | Статистика применений |

**Сотрудники**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/baristas` | Список баристов |
| POST | `/api/admin/baristas` | Добавить бариста (имя + PIN) |
| PUT | `/api/admin/baristas/:id/pin` | Сменить PIN |
| PUT | `/api/admin/baristas/:id/active` | Активировать / деактивировать |
| GET | `/api/admin/baristas/:id/shifts` | История смен бариста |

**Права бариста и лог**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/barista/settings` | Права бариста |
| PUT | `/api/admin/barista/settings` | Включить/выключить редактирование меню |
| GET | `/api/admin/barista/log` | Лог действий с фильтром |

**Первый запуск**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/admin/setup/status` | Проверить что заполнено |
| PUT | `/api/admin/setup/complete` | Завершить мастер настройки |

**Бот**
| Метод | URL | Что делает |
|---|---|---|
| POST | `/api/webhook` | Telegram webhook (защищён WEBHOOK_SECRET) |

**Cron (вызывает Vercel, не пользователь)**
| Метод | URL | Что делает |
|---|---|---|
| GET | `/api/cron/birthday` | Отправляет поздравления клиентам с ДР сегодня |
| GET | `/api/cron/inactive` | Напоминание клиентам, не заходившим N дней |
| GET | `/api/cron/broadcasts` | Проверяет scheduled_at и отправляет запланированные рассылки |

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

> ⚙️ — доступно только если владелец включил переключатель в adminке

---

## Логика ключевых сценариев

### Сценарий 0: Клиент открыл приложение (визит без заказа)
```
Клиент переходит по ссылке (с QR, Яндекс Карт, ВКонтакте и т.д.)
  → app.js читает utm_source из URL при загрузке
  → POST /api/customers { tg_id, first_name, username, source }
  → Если клиент новый — создать запись: status='visitor', source='qr' (или другой)
  → Если клиент уже есть — обновить last_seen (source и status не перезаписывать)
  → Клиент видит меню, но ничего не заказывает → остаётся visitor в базе
  → Владелец видит его в adminке в разделе «Только смотрели»
```

### Сценарий 1: Покупатель оформляет заказ
```
Mini App → POST /api/orders
  → Сохранить заказ в orders (статус 'new')
  → Найти клиента в customers, обновить status → 'buyer'
  → Отправить сообщение менеджеру в Telegram (через бота)
  → Supabase Realtime автоматически уведомляет подключённых баристов о новой строке в orders
  → Вернуть order_id в Mini App

  ⚠️ Кружки НЕ считаются автоматически.
     Только бариста нажимает кнопку — фиксируется в order_promos.
```

### Сценарий 2: Владелец меняет статус заказа
```
Adminка → PUT /api/admin/orders/:id/status { status: 'ready' }
  → Обновить статус в БД
  → Если статус 'ready' — бот отправляет клиенту: «Ваш заказ готов!»
  → Вернуть обновлённый заказ
```

### Сценарий 3: Рассылка клиентам
```
Adminка → POST /api/admin/broadcast { text: '...', segment: 'buyers', scheduled_at: null }
  → Если scheduled_at null — отправить немедленно:
    Выбрать нужных customers, бот отправляет сообщение каждому
    Сохранить в broadcasts: sent=true, sent_to=N
  → Если scheduled_at указан — сохранить в broadcasts (sent=false)
    Vercel Cron (/api/cron/broadcasts) каждые 5 минут проверяет и отправляет
```

### Сценарий 4: Бариста применяет акцию к заказу
```
Бариста видит заказ → список акций → нажимает «Применить»
  → POST /api/barista/orders/:id/promos/:promo_id
  → Проверить: акция уже применена? → если да — ошибка «Уже отмечено»
  → Определить тип акции (cups_loyalty / discount_first / и т.д.)

  Тип 'cups_loyalty':
    → order_promos: event='cup_earned', value=+1
    → customer_promo_progress.progress +1
    → Если progress >= totalCups:
         Создать заказ: items=[{name:'Бесплатная кружка', price:0}], total=0
         order_promos: event='free_cup_given', value=-totalCups
         progress сбросить в 0
         Уведомить клиента в Telegram «🎉 Бесплатная кружка!»

  Тип 'discount_first' / 'discount_percent':
    → order_promos: event='discount_applied', value=процент
    → Уведомить клиента «🎁 Скидка [N]% применена»
```

### Сценарий 5: Бариста ищет клиента вручную
```
Бариста → GET /api/barista/customers/search?username=alex
  → Найти в customers по полю username
  → Вернуть: имя, прогресс по каждой активной акции
  → Бариста выбирает акцию и нажимает «Применить»
  → POST /api/barista/customers/:tg_id/promos/:promo_id (order_id = null)
```

### Сценарий 6: Акция «Скидка в день рождения»
```
Первый раз (дата не известна):
  Клиент показывает паспорт → Бариста вводит дату
  → PUT /api/barista/customers/:tg_id/birthday { birthday: '03-15' }
  → Если сегодня ±daysWindow — акция применяется сразу

Последующие визиты:
  При открытии карточки заказа — система проверяет birthday
  Если в дне ±daysWindow — акция появляется в списке доступных
```

### Сценарий 7: Акция «Приведи друга»
```
Клиент нажимает «Поделиться»
  → GET /api/customers/:tg_id/referral
  → Генерируется referral_code → ссылка: https://t.me/bot?start=ref_КОД

Друг переходит → /start ref_КОД
  → /api/webhook → команда /start с параметром
  → Создать запись customers, сохранить referred_by = tg_id пригласившего

Друг делает первый заказ → POST /api/orders
  → referred_by заполнен → бонус пригласившему в order_promos
  → Уведомить пригласившего «🎉 Друг купил — тебе +1 кружка!»
```

### Сценарий 8: Cron — автосообщения
```
Vercel вызывает GET /api/cron/birthday (каждый день в 9:00 UTC):
  → Найти customers где birthday = сегодня ±daysWindow
  → Если auto_birthday_enabled = 'true' в settings
  → Бот отправляет поздравление каждому

Vercel вызывает GET /api/cron/inactive (каждый день в 10:00 UTC):
  → Найти customers где last_seen < (сегодня - N дней) И status = 'buyer'
  → Если auto_inactive_enabled = 'true'
  → Бот отправляет напоминание

Vercel вызывает GET /api/cron/broadcasts (каждые 5 минут):
  → Найти broadcasts где sent=false И scheduled_at <= NOW
  → Отправить, обновить sent=true, sent_to=N
```

### Сценарий 9: Владелец смотрит аналитику
```
Adminка → GET /api/admin/analytics/sources
  → PostgreSQL группирует customers + orders по source
  → Владелец видит: «С QR 40 человек, купили 28, выручка 18 400 ₽»

Adminка → GET /api/admin/analytics/top-items?period=week
  → Разворачивает JSONB-массив orders.items → GROUP BY name → TOP 5

Adminка → GET /api/admin/analytics/peak-hours
  → GROUP BY EXTRACT(HOUR FROM created_at) → [{hour: 9, orders: 12}, ...]
```

---

## UI Adminки — экраны и визуализация

### Библиотека

**Chart.js** — без npm, подключается CDN:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

Для выбора периода — нативный `<input type="date">`.

---

### Принцип drill-down (клик на график → таблица)

1. Клик на элемент графика (столбец, сектор, точку)
2. Под графиком раскрывается таблица — без перехода на другой экран
3. Таблица показывает детали кликнутого элемента
4. Повторный клик — сворачивает панель

---

### Навигация adminки

Нижняя панель — 4 вкладки:

```
┌─────────────────────────────────────┐
│                                     │
│         [контент вкладки]           │
│                                     │
├────────┬────────┬──────────┬────────┤
│   📊   │   ☕   │    📣    │   ⚙️  │
│Дашборд │  Меню  │Маркетинг │Настрой-│
│        │        │          │   ки   │
└────────┴────────┴──────────┴────────┘
```

---

### Экраны adminки

#### 📊 Вкладка 1 — Дашборд

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
│  ▼ Детали (drill-down — появляется при клике на график)         │
│  Дата       Клиент      Позиции              Сумма              │
│  14 апр     Иван К.     Капучино x2, Эклер   660 руб.          │
└─────────────────────────────────────────────────────────────────┘
```

**Drill-down:**

| Кликаешь | Видишь таблицу | API |
|---|---|---|
| Точка линейного графика | Заказы за этот день | `GET /api/admin/orders?date=2026-04-14` |
| Столбец «Топ позиций» | Заказы с этой позицией | `GET /api/admin/orders?item_name=Капучино&period=week` |
| Столбец «Пиковые часы» | Заказы в этот час | `GET /api/admin/orders?hour=10&period=week` |
| Сектор «Источники» | Клиенты с этого источника | `GET /api/admin/customers?source=qr` |
| Сектор «Категории» | Позиции категории | `GET /api/admin/analytics/top-items?category=Кофе` |
| Сегмент воронки | Клиенты на этом этапе | `GET /api/admin/customers?status=visitor` |

---

#### ☕ Вкладка 2 — Меню

Две внутренние вкладки: **Позиции** и **Акции**.

**Позиции:**
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

**Акции:**
```
┌─────────────────────────────────────┐
│  [Позиции]  [Акции]     [+ Создать] │
├─────────────────────────────────────┤
│  Каждая 6-я кружка бесплатно        │
│  [зел.] Активна         [Статистика]│
├─────────────────────────────────────┤
│  Скидка 10% на первый заказ         │
│  [зел.] Активна         [Статистика]│
└─────────────────────────────────────┘
```

---

#### 📣 Вкладка 3 — Маркетинг

Две внутренние вкладки: **Рассылки** и **Автосообщения**.

**Рассылки:**
```
┌─────────────────────────────────────┐
│  [Рассылки]  [Автосообщения]        │
├─────────────────────────────────────┤
│  Сегмент:                           │
│  [Все] [Покупатели] [Смотрели]      │
│  [Давно не заходили] [VIP]          │
│                                     │
│  Получателей в сегменте: 87 чел.    │
│                                     │
│  Текст сообщения:                   │
│  [________________________________] │
│                                     │
│  Отправить: [Сейчас] [Запланировать]│
│  Дата/время: [__ . __ . ____  __:__]│
│                                     │
│  [ Отправить ]                      │
├─────────────────────────────────────┤
│  Запланированные:                   │
│  14 мая 10:00 «Новинка: Круассан»   │
│                          [Отменить] │
└─────────────────────────────────────┘
```

**Автосообщения:**
```
┌─────────────────────────────────────┐
│  [Рассылки]  [Автосообщения]        │
├─────────────────────────────────────┤
│  [зел.] Приветствие новому клиенту  │
│  «Привет! Добро пожаловать...»      │
│                       [Редактировать]│
├─────────────────────────────────────┤
│  [зел.] День рождения               │
│  «С днём рождения! Скидка 20%...»   │
│                       [Редактировать]│
├─────────────────────────────────────┤
│  [кр.] Давно не заходил (14 дней)   │
│  «Давно не заходил! Есть новинки»   │
│                       [Редактировать]│
└─────────────────────────────────────┘
```

---

#### ⚙️ Вкладка 4 — Настройки

```
┌─────────────────────────────────────┐
│  Кофейня                            │
│  Название:  [Hot Black Coffee     ] │
│  Слоган:    [Настоящий кофе...    ] │
│  Адрес:     [ул. Примерная, 1     ] │
│  Логотип:   [текущий] [Загрузить  ] │
├─────────────────────────────────────┤
│  Telegram-бот                       │
│  Токен: [скрыт]        [Подключить] │
│  Подключён: @hotblackcoffeebot      │
├─────────────────────────────────────┤
│  Сотрудники                         │
│  Маша    [зел.] активна  [Сменить PIN] │
│  Петя    [кр.]  уволен   [Восстановить]│
│  [+ Добавить бариста]               │
│                                     │
│  Редактирование меню: [кр.][Включить]│
└─────────────────────────────────────┘
```

---

#### 🚀 Мастер первого запуска

Показывается при первом входе в adminку — пока 4 шага не пройдены.

```
┌─────────────────────────────────────┐
│  Добро пожаловать!                  │
│  Давай настроим твою кофейню.       │
│  Это займёт 5 минут.                │
│                                     │
│  ● Шаг 1 — Название и логотип       │
│  ○ Шаг 2 — Добавь первые позиции    │
│  ○ Шаг 3 — Добавь баристу           │
│  ○ Шаг 4 — Подключи Telegram-бота   │
│                                     │
│  Название кофейни:                  │
│  [________________________________] │
│  Слоган (одна строка):              │
│  [________________________________] │
│  Логотип: [Загрузить фото        ]  │
│                                     │
│  [ Дальше →                       ] │
└─────────────────────────────────────┘
```

---

#### Экраны бариста

**[Первый вход] — онбординг:**
```
┌─────────────────────────────────────┐
│  Привет, Маша! 👋                   │
│  Вот как здесь всё работает:        │
│                                     │
│  📦 Новый заказ — нажми             │
│     «Принять» чтобы начать          │
│                                     │
│  ☕ Кружка лояльности —             │
│     нажми «+1» в карточке заказа    │
│                                     │
│  🔍 Клиент без заказа —             │
│     найди по QR или @username       │
│                                     │
│  [ Понятно, начинаем! ]             │
└─────────────────────────────────────┘
```

**[Нет заказов] — пустой экран:**
```
┌─────────────────────────────────────┐
│  Пока заказов нет ☕                │
│                                     │
│  Топ сегодня:                       │
│  1. Капучино      — 47 шт           │
│  2. Латте         — 31 шт           │
│  3. Матча-латте   — 22 шт           │
│                                     │
│  Пик заказов:                       │
│  обычно с 09:00 до 11:00            │
└─────────────────────────────────────┘
```

**[Есть заказы] — список:**
```
┌─────────────────────────────────────┐
│  🔴 Новый  •  10:34                 │
│  Иван К.                            │
│  Капучино × 2, Эклер   660 ₽        │
│  [ Принять ]                        │
├─────────────────────────────────────┤
│  🟡 Готовится  •  10:21             │
│  Мария С.                           │
│  Латте, Матча-латте    440 ₽        │
│  [ Готов ] [ Акции ▾ ]              │
└─────────────────────────────────────┘
```

> Новые заказы появляются мгновенно через Supabase Realtime — без обновления страницы.
> При новом заказе — короткий бип (Web Audio API).

**[Поиск клиента] — наличные / карта без заказа:**
```
┌─────────────────────────────────────┐
│  [ @username  или  📷 QR ]          │
│                                     │
│  ✅ Клиент найден:                  │
│  Иван К. (@ivan_k)                  │
│  Кружек накоплено: 4 из 6           │
│                                     │
│  Способ оплаты:                     │
│  [ 💵 Наличкой ] [ 💳 Картой ]      │
│                                     │
│  [ + Отметить кружку ]              │
└─────────────────────────────────────┘
```

**[Закрытие смены] — кнопка в шапке:**
```
┌─────────────────────────────────────┐
│  Маша  •  смена с 09:00       [🚪]  │
├─────────────────────────────────────┤
│  ...список заказов...               │
└─────────────────────────────────────┘
```

При нажатии [🚪] — экран итогов смены:
```
┌─────────────────────────────────────┐
│  Смена завершена ✅                  │
│  09:00 — 18:45                      │
│                                     │
│  Заказов принято:  34               │
│  Наличными:        8 200 руб.       │
│  Картой:           14 600 руб.      │
│  Итого:            22 800 руб.      │
│                                     │
│  [ Закрыть смену ]                  │
└─────────────────────────────────────┘
```

---

## Структура файлов

```
tg-coffee-catalog/
├── tg-app/                    # Mini App (фронтенд клиента) — без изменений
│   ├── index.html
│   ├── app.js
│   └── style.css
│
├── api/                       # Vercel Serverless Functions
│   ├── menu.js                # GET /api/menu
│   ├── orders.js              # POST /api/orders
│   ├── customers/
│   │   ├── index.js           # POST /api/customers
│   │   ├── [tg_id].js         # GET /api/customers/:tg_id
│   │   └── [tg_id]/
│   │       └── referral.js    # GET /api/customers/:tg_id/referral
│   ├── admin/
│   │   ├── login.js
│   │   ├── settings.js
│   │   ├── menu/
│   │   │   ├── index.js
│   │   │   ├── history.js
│   │   │   └── items/
│   │   │       └── [id].js
│   │   ├── orders/
│   │   │   ├── index.js
│   │   │   └── stats.js
│   │   ├── analytics/
│   │   │   ├── top-items.js
│   │   │   ├── avg-check.js
│   │   │   ├── peak-hours.js
│   │   │   ├── compare.js
│   │   │   ├── conversion.js
│   │   │   ├── sources.js
│   │   │   └── categories.js
│   │   ├── customers/
│   │   │   ├── index.js
│   │   │   └── [tg_id].js
│   │   ├── broadcast/
│   │   │   ├── index.js
│   │   │   ├── scheduled.js
│   │   │   └── history.js
│   │   ├── auto-messages.js
│   │   ├── promos/
│   │   │   ├── index.js
│   │   │   └── [id].js
│   │   ├── baristas/
│   │   │   ├── index.js
│   │   │   └── [id].js
│   │   ├── barista/
│   │   │   ├── settings.js
│   │   │   └── log.js
│   │   ├── upload/
│   │   │   ├── logo.js
│   │   │   └── image.js
│   │   └── setup/
│   │       └── status.js
│   ├── barista/
│   │   ├── login.js
│   │   ├── orders/
│   │   │   ├── index.js
│   │   │   └── [id].js
│   │   ├── shift/
│   │   │   ├── open.js
│   │   │   ├── summary.js
│   │   │   └── close.js
│   │   ├── customers/
│   │   │   └── search.js
│   │   └── upload/
│   │       └── image.js
│   ├── webhook.js             # POST /api/webhook — Telegram Bot
│   └── cron/
│       ├── birthday.js        # Поздравления с ДР
│       ├── inactive.js        # Напоминания неактивным
│       └── broadcasts.js      # Запланированные рассылки
│
├── lib/                       # Общие утилиты (не serverless)
│   ├── supabase.js            # Supabase client (service role)
│   ├── auth.js                # JWT выдача и проверка
│   └── bot.js                 # Telegram Bot хелпер (отправка сообщений)
│
├── admin/                     # Adminка владельца (статика)
│   ├── index.html
│   ├── admin.js
│   └── admin.css
│
├── barista/                   # Интерфейс бариста (статика)
│   ├── index.html
│   ├── barista.js
│   └── barista.css
│
├── vercel.json                # Cron jobs + настройки деплоя
├── package.json
├── .env.local                 # Секреты (не в git)
└── BACKEND-PLAN.md            # Этот файл
```

### vercel.json
```json
{
  "crons": [
    { "path": "/api/cron/birthday",   "schedule": "0 6 * * *"  },
    { "path": "/api/cron/inactive",   "schedule": "0 7 * * *"  },
    { "path": "/api/cron/broadcasts", "schedule": "*/5 * * * *" }
  ]
}
```

---

## Порядок разработки

### Этап 1 — Основа Supabase
1. Создать проект в Supabase → получить URL и ключи
2. Создать все таблицы в Supabase Dashboard (SQL editor)
3. Наполнить `menu_items` из текущего menu.json (первичные данные)
4. `lib/supabase.js` — Supabase client с service_role ключом
5. `lib/auth.js` — выдача и проверка JWT для admin и barista

### Этап 2 — Публичное API
6. `api/menu.js` — `GET /api/menu` из таблицы menu_items
7. `api/customers/index.js` — `POST /api/customers` (регистрация, UTM)
8. `api/customers/[tg_id].js` — `GET /api/customers/:tg_id`
9. `api/orders.js` — `POST /api/orders` (приём, смена статуса visitor→buyer)

### Этап 3 — Adminка API
10. `api/admin/login.js`
11. `api/admin/menu/` — CRUD меню
12. `api/admin/orders/` — список и управление заказами
13. `api/admin/settings.js` — настройки кофейни
14. `api/admin/upload/` — загрузка в Supabase Storage

### Этап 4 — Интерфейс adminки
15. `admin/index.html` — 4 вкладки: Дашборд, Меню, Маркетинг, Настройки
16. Вкладка Меню: список позиций, CRUD, включить/выключить
17. Вкладка Настройки: название, логотип, сотрудники, Telegram-бот
18. Мастер первого запуска (4 шага)

### Этап 5 — Бариста
19. `api/barista/login.js` — вход по PIN
20. `api/barista/orders/` — активные заказы, смена статуса
21. `api/barista/shift/` — открытие и закрытие смены
22. `barista/index.html` — вход по PIN, список заказов, закрытие смены
23. Supabase Realtime в barista.js — мгновенные уведомления о новых заказах + звук

### Этап 6 — Telegram Bot
24. `lib/bot.js` — хелпер отправки сообщений через Telegram API
25. `api/webhook.js` — обработка /start (регистрация, реферал)
26. `api/admin/settings.js` — регистрация webhook при сохранении токена бота
27. Уведомления: «Заказ готов», «Бесплатная кружка», «Поздравление»

### Этап 7 — Рассылки и аналитика
28. `api/admin/broadcast/` — сегменты, рассылка, история
29. `api/admin/auto-messages.js` — welcome, birthday, inactive
30. `api/cron/` — birthday, inactive, broadcasts (Vercel Cron)
31. `api/admin/analytics/` — все 7 эндпоинтов аналитики
32. Вкладка Дашборд в adminке: Chart.js, drill-down, фильтр периода
33. Вкладка Маркетинг: рассылки, автосообщения

### Этап 8 — Акции и полировка
34. `api/admin/promos/` — CRUD акций, статистика
35. `api/barista/orders/[id].js` — применение акций к заказам
36. `api/barista/customers/search.js` — поиск + QR-код клиента
37. Онбординг бариста (первый вход — одноразовый экран)
38. `api/admin/barista/log.js` и `api/admin/menu/history.js`
39. Экспорт клиентов в CSV
40. Профиль клиента с историей заказов и VIP-меткой

---

## Важные ограничения

- **Рассылки через бота** работают только с клиентами, которые **сами написали боту** (нажали /start). Telegram запрещает писать первым.
- **Vercel Cron** работает только на Vercel — при локальной разработке cron не запускается, вызывать endpoint вручную.
- **Vercel Free** — 100 GB трафика в месяц, 100 часов выполнения функций. Для одной кофейни — с огромным запасом.
- **Supabase Realtime** требует anon-ключ на клиенте (barista.js). Его можно хранить в открытую — он только читает разрешённые таблицы (настраивается через Row Level Security).
- **Один экземпляр = одна кофейня.** Мультитенантность не заложена.
- **День рождения** — Telegram не передаёт. Бариста вводит вручную с паспорта клиента.
- **Реферальная программа** работает только если друг открывает бота через ссылку `/start ref_КОД`.
- **Загрузка фото** — Supabase Storage (не локальная папка). Максимум файла на Vercel Function — 4.5 МБ. Для больших фото сжимать на клиенте перед отправкой.
