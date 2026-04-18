# Баги — Модуль «Администратор»

Аудит проведён: 2026-04-16  
Расширенный аудит фронтенда и бэкенда: 2026-04-19  
Файлы: `admin/admin.js`, `admin/index.html`, `admin/admin.css`, `backend/routes/admin.js`,
`backend/routes/public.js`, `backend/routes/barista.js`, `tg-app/app.js`, `barista/barista.js`,
`backend/cron.js`, `backend/bot.js`, `backend/server.js`

---

## Критические

**Б-А01 — XSS в `renderTopItems`**  
Файл: [admin/admin.js:228](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L228)  
`${item.name}` вставляется raw в `innerHTML`. Имя товара из БД может содержать `<script>alert(1)</script>`.  
Решение: заменить `item.name` на `escapeHtml(item.name)`.  
Статус: ✅ исправлен (2026-04-19)

---

**Б-А02 — XSS в `renderOrders`**  
Файл: [admin/admin.js:242](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L242)  
`${i.name}` и `${customer}` (имя клиента из БД) вставляются raw в `innerHTML`.  
Решение: применить `escapeHtml()` к `i.name` и `customer`.  
Статус: ✅ исправлен (2026-04-19)

---

**Б-А03 — Ошибки upsert настроек не проверяются**  
Файл: [backend/routes/admin.js:51-53](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L51)  
В цикле `for (const { key, value } of updates)` результат `await supabase.from('settings').upsert(...)` не проверяется — молчаливый сбой сохранения.  
Решение: деструктурировать `{ error }` и вернуть 500 при ошибке.  
Статус: ✅ исправлен (2026-04-19)

---

**Б-А04 — Нет защиты от брутфорса на `/api/admin/login`**  
Файл: [backend/routes/admin.js:14](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L14)  
Пароль администратора можно подобрать неограниченным числом запросов без задержки или блокировки.  
Решение: подключить `express-rate-limit` — 5 попыток / 15 мин на IP.  
Статус: ✅ исправлен (2026-04-19) — добавлен `loginLimiter` + `app.set('trust proxy', 1)` в server.js

---

## Средние

**Б-А05 — Двойное нажатие «Сохранить» создаёт дубли в меню**  
Файл: [admin/admin.js:362](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L362)  
`saveItem()` не имеет `isRequesting` флага — два быстрых клика отправляют два POST-запроса.  
Решение: добавить guard `isRequesting` или блокировать кнопку на время запроса.  
Статус: ✅ исправлен (2026-04-19) — флаг `isSavingItem` + disable кнопки на время запроса

---

**Б-А06 — `showAddItem()` не сбрасывает файловый input**  
Файл: [admin/admin.js:317](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L317)  
После добавления товара с фото файл остаётся в `f-photo` — при следующем добавлении фото уйдёт к новому товару.  
Решение: добавить `document.getElementById('f-photo').value = ''` при сбросе формы.  
Статус: ✅ исправлен (2026-04-19) — `f-photo.value = ''` и `prev.removeAttribute('src')` в showAddItem/editItem

---

**Б-А07 — Превью фото не скрывается при редактировании товара без фото**  
Файл: [admin/admin.js:330](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L330)  
Если у предыдущего товара было фото, а у редактируемого нет — превью предыдущего остаётся видимым.  
Решение: добавить `else { prev.classList.add('hidden') }` когда `!item.photo_url`.  
Статус: ✅ исправлен (2026-04-19) — добавлена else-ветка с скрытием превью и очисткой src

---

**Б-А08 — Нет guard в `toggleBarista()`**  
Файл: [admin/admin.js:502](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L502)  
Двойной клик «Уволить» / «Вернуть» делает два запроса — статус бариста мигает туда-обратно.  
Решение: добавить `isRequesting` флаг или отключать кнопку на время запроса.  
Статус: ✅ исправлен (2026-04-19) — Set `togglingBaristaIds` + disable кнопок строки на время запроса

---

**Б-А09 — `showAddBarista()` использует блокирующий `prompt()`**  
Файл: [admin/admin.js:484](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L484)  
`prompt()` блокирует поток, не стилизован, на iOS ведёт себя непредсказуемо; введённые данные не валидируются перед отправкой.  
Решение: заменить на модальную форму со встроенной валидацией.  
Статус: ✅ исправлен (2026-04-19) — добавлен `#barista-form-overlay` с валидацией PIN `/^\d{4}$/` и guard от двойного клика

---

**Б-А10 — `changePin()` использует блокирующий `prompt()`**  
Файл: [admin/admin.js:494](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L494)  
Аналогично Б-А09 — блокирующий `prompt()` без валидации формата PIN.  
Решение: заменить на модальную форму.  
Статус: ✅ исправлен (2026-04-19) — добавлен `#pin-form-overlay` с валидацией PIN и guard

---

**Б-А11 — `formatLogDetail()` выводит `undefined` при неполных данных**  
Файл: [admin/admin.js:649](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L649)  
Если `row.details.cups_after` или `total_cups` отсутствуют — в лог выводится `undefined/undefined`.  
Решение: добавить fallback: `d.cups_after ?? '?'` и `d.total_cups ?? '?'`.  
Статус: ⬜ не исправлен

---

**Б-А12 — QR-код с захардкоженным именем бота**  
Файл: [admin/admin.js:605](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L605)  
URL `https://t.me/Prototip_Coffee_house_bot?start=cup` зашит в код — не читает `bot_username` из настроек.  
Решение: читать `bot_username` через `/admin/settings` перед генерацией QR.  
Статус: ⬜ не исправлен

---

**Б-А13 — История меню пишется с `old_value: null` при несуществующем товаре**  
Файл: [backend/routes/admin.js:130-137](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L130)  
`select('*').eq('id', id).single()` не проверяет ошибку — если товар не найден, `old = null` и запись в `menu_history` создаётся с `old_value: null`.  
Решение: проверить ошибку/null после select и вернуть 404 если товар не существует.  
Статус: ⬜ не исправлен

---

## Низкие

**Б-А14 — `renderMenu()` вставляет `item.name`, `item.badge` без экранирования**  
Файл: [admin/admin.js:290](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L290)  
Данные вводит сам администратор, поэтому менее критично, но XSS всё равно возможен.  
Решение: применить `escapeHtml()` к `item.name` и `item.badge`.  
Статус: ⬜ не исправлен

---

**Б-А15 — `loadDashboard()` глотает все ошибки**  
Файл: [admin/admin.js:128](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L128)  
Пустые `catch {}` — пользователь не видит причину пустого дашборда при сетевой ошибке.  
Решение: `catch (e) { console.error(e) }` или `toast(e.message, true)`.  
Статус: ⬜ не исправлен

---

**Б-А16 — `setOrderStatus()` перезагружает весь дашборд**  
Файл: [admin/admin.js:266](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L266)  
После смены статуса заказа вызывается `loadDashboard()` — пересоздаёт график и отправляет 4+ запроса вместо точечного обновления.  
Решение: выделить `loadOrders()` как отдельную функцию и вызывать только её.  
Статус: ⬜ не исправлен

---

**Б-А17 — `checkSetup()` при сетевой ошибке молча открывает приложение**  
Файл: [admin/admin.js:72](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L72)  
В `catch` показывает экран `app` вместо уведомления об ошибке подключения.  
Решение: показывать `toast` и оставаться на login-экране при ошибке сети.  
Статус: ⬜ не исправлен

---

**Б-А18 — `logout()` не сбрасывает переменные состояния**  
Файл: [admin/admin.js:78](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L78)  
`menuItems`, `editingItemId`, `revenueChart` не обнуляются — артефакты данных при повторном входе.  
Решение: сбросить все переменные состояния при logout.  
Статус: ⬜ не исправлен

---

**Б-А19 — `loadBaristas()` глотает ошибки**  
Файл: [admin/admin.js:462](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L462)  
Пустой `catch {}` — при ошибке загрузки список баристы пуст без объяснения.  
Решение: `catch (e) { toast(e.message, true) }`.  
Статус: ⬜ не исправлен

---

**Б-А20 — `saveSettings()` не сохраняет `manager_tg_id`**  
Файл: [admin/admin.js:417](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L417)  
`manager_tg_id` не входит в `body` функции `saveSettings` — сохраняется только через `saveBotSettings()`.  
Решение: включить `manager_tg_id` в `body` или объединить функции.  
Статус: ⬜ не исправлен

---

**Б-А21 — `loadSettings()` глотает ошибки**  
Файл: [admin/admin.js:399](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L399)  
Пустой `catch {}` — при ошибке поля настроек остаются пустыми без уведомления.  
Решение: `catch (e) { toast(e.message, true) }`.  
Статус: ⬜ не исправлен

---

**Б-А22 — Мёртвый код `a.setAttribute('Authorization', ...)`**  
Файл: [admin/admin.js:581](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L581)  
Атрибут на теге `<a>` не добавляет заголовок в HTTP-запрос — строка бесполезна и вводит в заблуждение.  
Решение: удалить строку 582.  
Статус: ⬜ не исправлен

---

**Б-А23 — `loadBaristaLog()` без пагинации**  
Файл: [admin/admin.js:630](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L630)  
Запрашивает только 30 записей, нет кнопки «Загрузить ещё» — история обрезается.  
Решение: добавить пагинацию или кнопку подгрузки следующей страницы.  
Статус: ⬜ не исправлен

---

**Б-А24 — `renderBroadcastHistory()` выводит строку "null" при отсутствующем сегменте**  
Файл: [admin/admin.js:563](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L563)  
`TARGET_LABELS[b.segment] || b.segment` — если `b.segment` равен `null`, отображается строка "null".  
Решение: `TARGET_LABELS[b.segment] || b.segment || '—'`.  
Статус: ⬜ не исправлен

---

**Б-А25 — `wizardNext(1)` молча игнорирует ошибку сохранения**  
Файл: [admin/admin.js:94](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L94)  
Пустой `catch {}` — ошибка сохранения настроек на первом шаге мастера игнорируется, мастер идёт дальше.  
Решение: `catch (e) { toast(e.message, true); return }`.  
Статус: ⬜ не исправлен

---

**Б-А26 — `wizardNext(3)` не валидирует формат PIN**  
Файл: [admin/admin.js:99](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L99)  
Проверяется только `if (name && pin)`, но не `/^\d{4}$/.test(pin)` — нецифровой или короткий PIN передаётся на backend.  
Решение: добавить `if (!/^\d{4}$/.test(pin)) { toast('PIN — 4 цифры', true); return }`.  
Статус: ⬜ не исправлен

---

**Б-А27 — Backend не валидирует `price <= 0`**  
Файл: [backend/routes/admin.js:101](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L101)  
`!price` ловит `0`, но отрицательная цена (`price = -100`) проходит валидацию и сохраняется.  
Решение: `if (!category || !name || !price || price <= 0)`.  
Статус: ⬜ не исправлен

---

**Б-А28 — `/admin/barista-log` — запрос с пустым `ids` вызовет ошибку Supabase**  
Файл: [backend/routes/admin.js:369](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L369)  
Если все `barista_id` в log равны null, `ids = []` и `.in('id', [])` вернёт ошибку от PostgREST.  
Решение: добавить ранний выход `if (!ids.length) { res.json(data); return }`.  
Статус: ⬜ не исправлен

---

**Б-А29 — `loadSettings()` не скрывает превью лого если `logo_url` пустой**  
Файл: [admin/admin.js:407](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L407)  
`if (s.logo_url)` показывает превью, но если `logo_url` отсутствует — старое превью остаётся видимым.  
Решение: добавить `else { prev.classList.add('hidden') }`.  
Статус: ⬜ не исправлен

---

**Б-А30 — Счётчик символов рассылки переустанавливается при каждом вызове `loadMarketing()`**  
Файл: [admin/admin.js:513](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L513)  
`msg.oninput = ...` назначается заново при каждом переключении на вкладку «Маркетинг» — предыдущее значение счётчика не сбрасывается.  
Решение: назначать обработчик один раз в инициализации или сбрасывать счётчик при каждом `loadMarketing()`.  
Статус: ⬜ не исправлен

---

**Б-А31 — `/api/admin/orders/stats` без try/catch**  
Файл: [backend/routes/admin.js:210](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L210)  
`Promise.all([...])` не обёрнут в try/catch — при сбое одного из запросов сервер вернёт 500 без JSON-тела, фронтенд получит неразборчивую ошибку.  
Решение: обернуть в `try/catch`, вернуть `{ error }` при ошибке.  
Статус: ⬜ не исправлен

---

**Б-А32 — Сравнение пароля администратора уязвимо к timing-атаке**  
Файл: [backend/routes/admin.js:16](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L16)  
`password !== process.env.ADMIN_PASSWORD` — прямое сравнение строк завершается раньше при несовпадении первого символа, что позволяет измерять время ответа.  
Решение: `crypto.timingSafeEqual(Buffer.from(password), Buffer.from(process.env.ADMIN_PASSWORD))`.  
Статус: ✅ исправлен (2026-04-19)

---

## Новые баги (расширенный аудит 2026-04-19)

### Критические

**Б-А33 — Клиент задаёт `total` заказа сам**  
Файл: [backend/routes/public.js:127](../../../Documents/Projects/tg-coffee-catalog/backend/routes/public.js#L127)  
`POST /api/orders` принимает `total` из тела запроса и сохраняет без проверки — любой клиент может заказать «Раф 500 ₽» за 1 ₽.  
Решение: пересчитывать `total` на сервере по `items[].id` из таблицы `menu`, игнорировать клиентское значение.  
Статус: ✅ исправлен (2026-04-19) — сервер тянет цены из `menu_items` и считает total сам

---

**Б-А34 — `POST /api/customers` не валидирует `tg_id`**  
Файл: [backend/routes/public.js:36](../../../Documents/Projects/tg-coffee-catalog/backend/routes/public.js#L36)  
Клиент передаёт любой `tg_id` и регистрируется под чужим Telegram-ID — подмена личности и порча лояльности.  
Решение: валидировать `initData` от Telegram WebApp (HMAC по `BOT_TOKEN`) и брать `tg_id` из `initData.user.id`, а не из body.  
Статус: ✅ исправлен (2026-04-19) — `verifyTelegramInitData()` проверяет HMAC-подпись + TTL 24ч

---

**Б-А35 — XSS в Mini App через данные меню и отзывы**  
Файл: [tg-app/app.js:402](../../../Documents/Projects/tg-coffee-catalog/tg-app/app.js#L402), [tg-app/app.js:755](../../../Documents/Projects/tg-coffee-catalog/tg-app/app.js#L755), [tg-app/app.js:823](../../../Documents/Projects/tg-coffee-catalog/tg-app/app.js#L823)  
`item.name`, `item.description`, `review.text`, `promo.name`, `photo_url` (внутри `url(...)`) вставляются в `innerHTML` без экранирования.  
Решение: завести `escapeHtml()` в Mini App и применить ко всем пользовательским полям; для `photo_url` использовать `encodeURI`.  
Статус: ✅ исправлен (2026-04-19) — `escapeHtml()` + `safeImageUrl()` во всех точках рендера

---

**Б-А36 — Нет rate-limit на `POST /orders` и `POST /customers`**  
Файл: [backend/routes/public.js](../../../Documents/Projects/tg-coffee-catalog/backend/routes/public.js)  
Любой может создать 10 000 фейковых заказов/клиентов за минуту — засорит БД, сломает cron, породит спам менеджеру.  
Решение: подключить `express-rate-limit` — 30 запросов/мин на IP для создающих эндпоинтов публичного API.  
Статус: ✅ исправлен (2026-04-19) — `publicWriteLimiter` 30/мин

---

### Средние

**Б-А37 — `refreshCupsFromApi` берёт акцию с `progress > 0`, а не по id**  
Файл: [tg-app/app.js:550](../../../Documents/Projects/tg-coffee-catalog/tg-app/app.js#L550)  
`promos.find(p => p.progress > 0)` — если у клиента несколько активных акций, прогресс чашек может отрисоваться от чужой акции.  
Решение: `promos.find(p => p.promo_id === state.cupsPromoId)`.  
Статус: ⬜ не исправлен

---

**Б-А38 — Хардкод `promoId = 1` в Mini App и backend**  
Файлы: [tg-app/app.js:75](../../../Documents/Projects/tg-coffee-catalog/tg-app/app.js#L75), [backend/routes/barista.js:347](../../../Documents/Projects/tg-coffee-catalog/backend/routes/barista.js#L347)  
`state.cupsPromoId = 1` и `promoId = promo?.id || 1` — если базовая акция «Кружка за кружкой» создана не первой (например, админ её пересоздал) — id будет другим, система отметок сломается.  
Решение: искать акцию по `type: 'loyalty_cups'` и кэшировать найденный id, не полагаться на `= 1`.  
Статус: ⬜ не исправлен

---

**Б-А39 — `/admin/orders/stats` считает «сегодня» по UTC**  
Файл: [backend/routes/admin.js:205](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L205)  
`new Date().toISOString().slice(0,10)` в MSK (UTC+3) после 21:00 уже «завтра» по UTC — вечерние заказы не попадают в статистику за текущий день.  
Решение: сформировать границы дня в нужной таймзоне (по умолчанию `Europe/Moscow`) или брать таймзону из `settings`.  
Статус: ⬜ не исправлен

---

**Б-А40 — `saveItem` загружает фото до вставки товара → orphan при ошибке**  
Файл: [admin/admin.js:374](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L374)  
Фото льётся в Storage первым; если `POST /admin/menu` упадёт — файл останется в bucket бесконечно.  
Решение: либо сначала создавать запись товара и только затем грузить фото, либо при ошибке `POST /menu` удалять загруженный файл.  
Статус: ⬜ не исправлен

---

**Б-А41 — `playBeep` плодит `AudioContext` на каждый заказ**  
Файл: [barista/barista.js:68](../../../Documents/Projects/tg-coffee-catalog/barista/barista.js#L68)  
`new AudioContext()` создаётся на каждый звуковой сигнал. Chrome ограничивает ~6 контекстов — после 6 заказов бариста перестаёт слышать пинг.  
Решение: создать один общий `AudioContext` при старте панели и переиспользовать.  
Статус: ⬜ не исправлен

---

**Б-А42 — `logout` бариста не отписывается от Supabase Realtime**  
Файл: [barista/barista.js:354](../../../Documents/Projects/tg-coffee-catalog/barista/barista.js#L354)  
При logout канал `supabase.channel(...).subscribe()` не закрывается — при повторном логине подписок становится больше, уведомления дублируются, память течёт.  
Решение: хранить ссылку на канал и вызывать `supabase.removeChannel(channel)` в logout.  
Статус: ⬜ не исправлен

---

### Низкие

**Б-А43 — Генерация `referral_code` без проверки уникальности**  
Файлы: [backend/routes/public.js:59](../../../Documents/Projects/tg-coffee-catalog/backend/routes/public.js#L59), [backend/bot.js:35](../../../Documents/Projects/tg-coffee-catalog/backend/bot.js#L35)  
`Math.random().toString(36).slice(2,10)` теоретически может коллизиться; нет retry при UNIQUE-ошибке.  
Решение: использовать `crypto.randomBytes(6).toString('base64url')`, обернуть вставку в retry-loop (3 попытки).  
Статус: ⬜ не исправлен

---

**Б-А44 — Рассылка получает только первые 1000 клиентов**  
Файл: [backend/cron.js:98](../../../Documents/Projects/tg-coffee-catalog/backend/cron.js#L98)  
`supabase.from('customers').select(...).limit(1000)` — после роста базы клиенты с id > 1000 (по порядку) не получат рассылку.  
Решение: пагинация по `range(0, 999)`, `range(1000, 1999)`, … либо курсор по `id`.  
Статус: ⬜ не исправлен

---

**Б-А45 — `logout` чистит только localStorage, JWT остаётся валидным**  
Файлы: [admin/admin.js:78](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L78), [barista/barista.js:354](../../../Documents/Projects/tg-coffee-catalog/barista/barista.js#L354)  
Украденный токен работает до истечения (admin — 7 дней, barista — 24 ч), даже после logout.  
Решение: таблица `revoked_tokens` (jti + exp) и проверка в middleware; или короткие access + refresh.  
Статус: ⬜ не исправлен

---

**Б-А46 — Нет `helmet` — отсутствуют защитные HTTP-заголовки**  
Файл: [backend/server.js](../../../Documents/Projects/tg-coffee-catalog/backend/server.js)  
Нет `X-Frame-Options`, `Content-Security-Policy`, `X-Content-Type-Options` — повышенный риск clickjacking/MIME-sniffing.  
Решение: `app.use(require('helmet')({ contentSecurityPolicy: false }))` (CSP подкрутим отдельно под Telegram WebApp).  
Статус: ⬜ не исправлен

---

## Баги второй волны (диагностика 2026-04-19 после фиксов Б-А33-36)

### Критические

**Б-А47 — Нет rate-limit на `/api/barista/login` — брутфорс PIN**  
Файл: [backend/routes/barista.js:11](../../../Documents/Projects/tg-coffee-catalog/backend/routes/barista.js#L11)  
PIN — всего 4 цифры (10 000 комбинаций). Зная URL барриста-панели, любой может подобрать PIN за минуты и залогиниться под бариста, начислять кружки, закрывать чужие смены.  
Решение: такой же `rateLimit` как у админа — 10 попыток / 15 мин на IP.  
Статус: ✅ исправлен (2026-04-19) — `loginLimiter` 10/15мин

---

### Средние

**Б-А48 — XSS в топ-товарах панели бариста**  
Файл: [barista/barista.js:289](../../../Documents/Projects/tg-coffee-catalog/barista/barista.js#L289)  
В `loadEmptyState()` `${i.name}` рендерится в `innerHTML` без экранирования (в отличие от `renderOrders`, где `escHtml` применён).  
Решение: `${escHtml(i.name)}`.  
Статус: ⬜ не исправлен

---

**Б-А49 — `PUT /barista/orders/:id/status` не валидирует `status` и `payment`**  
Файл: [backend/routes/barista.js:191](../../../Documents/Projects/tg-coffee-catalog/backend/routes/barista.js#L191)  
Бариста (или кто-то с его токеном) может отправить `status: 'hacked'` или `payment: <длинная строка>` — значения запишутся в БД без проверки, сломают статистику смены и фильтры.  
Решение: whitelist `['new','preparing','ready','done','cancelled']` для status и `['cash','card',null]` для payment.  
Статус: ⬜ не исправлен

---

**Б-А50 — HTML-injection в приветствии бота**  
Файл: [backend/bot.js:52](../../../Documents/Projects/tg-coffee-catalog/backend/bot.js#L52)  
`firstName` клиента подставляется в HTML-сообщение (`parse_mode: 'HTML'`). Если имя Telegram = `<b>test</b>` — разметка проявится; теги Telegram (`<a href>`) дадут кликабельную ссылку от имени бота.  
Решение: экранировать `firstName` перед подстановкой в HTML.  
Статус: ⬜ не исправлен

---

**Б-А51 — Нет ограничения длины текстовых полей в `POST /orders` и `POST /customers`**  
Файл: [backend/routes/public.js](../../../Documents/Projects/tg-coffee-catalog/backend/routes/public.js)  
`comment`, `delivery_time`, `first_name`, `username` принимаются без ограничения длины — злоумышленник может послать 1 МБ JSON → разрастание БД, замедление запросов.  
Решение: обрезать/валидировать длину (comment ≤ 500 симв., time/address ≤ 200 симв.) + `express.json({ limit: '10kb' })` в server.js.  
Статус: ⬜ не исправлен

---

**Б-А52 — CSS-injection через `gradient` в Mini App**  
Файл: [tg-app/app.js:createCardHTML](../../../Documents/Projects/tg-coffee-catalog/tg-app/app.js)  
`item.gradient[0]`, `item.gradient[1]` вставляются в `style="background: linear-gradient(135deg, ${...})"` без проверки. Админ (или украденный admin-токен) может вставить `#fff); background: url(//evil.com/x.jpg` — нарушит верстку и утечёт запрос на внешний домен.  
Решение: валидатор hex-цвета `/^#[0-9a-f]{3,8}$/i`, иначе fallback на DEFAULT_GRADIENT.  
Статус: ⬜ не исправлен

---

**Б-А53 — `multer` без фильтра MIME-type для загрузки фото**  
Файл: [backend/routes/admin.js:11](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L11)  
Админ-панель принимает любой файл как «фото» товара — `.exe` с расширением `.jpg`, HTML со скриптом и т.д. В сочетании с nginx static может быть опасно. **Отдельно опасен SVG**: может содержать `<script>` и выполнится при открытии URL картинки из Storage.  
Решение: `fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype))` — **исключить SVG**.  
Статус: ⬜ не исправлен

---

## Баги третьей волны (диагностика 2026-04-19 после фикса Б-А47)

### Средние

**Б-А54 — DELETE товара не удаляет фото из Storage**  
Файл: [backend/routes/admin.js:160](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L160)  
Удаление товара через `/admin/menu/items/:id` убирает запись из БД, но `photo_url` остаётся в bucket `menu-images`. Со временем Storage распухает за счёт мусора.  
Решение: перед удалением записи вызвать `supabase.storage.from('menu-images').remove([...])`; если путь хранится — чистить bucket.  
Статус: ⬜ не исправлен

---

**Б-А55 — `limit`/`offset` в admin API без потолка → DoS-риск**  
Файлы: [backend/routes/admin.js:196](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L196), [backend/routes/admin.js:284](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L284)  
Запросы `/admin/orders?limit=999999` или `/admin/customers?limit=999999` вытянут всю БД — нагрузка на Supabase и память Node.  
Решение: `const limit = Math.min(parseInt(req.query.limit) || 50, 200)`.  
Статус: ⬜ не исправлен

---

**Б-А56 — Нет валидации булевых значений `vip`, `active`, `available`**  
Файлы: [backend/routes/admin.js:174](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L174), [backend/routes/admin.js:274](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L274), [backend/routes/admin.js:296](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L296)  
Значение `req.body.active` / `vip` / `available` пишется в БД как есть. Если прислать `"yes"`, `null`, объект — пройдёт молча, сломает фильтры Supabase.  
Решение: `const val = req.body.X === true || req.body.X === 'true'` или 400 если не boolean.  
Статус: ⬜ не исправлен

---

**Б-А57 — `/admin/analytics/chart` группирует по UTC-дате**  
Файл: [backend/routes/admin.js:412-423](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L412)  
`o.created_at.slice(0,10)` и `new Date(...).toISOString().slice(0,10)` — UTC. В MSK (UTC+3) заказы после 21:00 попадут в «следующий день» графика.  
Решение: приводить дату к таймзоне кофейни (MSK по умолчанию).  
Статус: ⬜ не исправлен

---

**Б-А58 — `upload/logo` — расширение файла из MIME ломается для SVG/webp**  
Файл: [backend/routes/admin.js:96](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L96)  
`req.file.mimetype.split('/')[1]` для `image/svg+xml` → расширение `svg+xml` в имени файла. Не критично (URL будет странный), но риск поломки ссылок и путаницы для браузера.  
Решение: whitelist `{ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }`.  
Статус: ⬜ не исправлен

---

## Сводная таблица

| ID | Серьёзность | Описание | Статус |
|---|---|---|---|
| Б-А01 | 🔴 Критический | XSS в renderTopItems | ✅ исправлен |
| Б-А02 | 🔴 Критический | XSS в renderOrders | ✅ исправлен |
| Б-А03 | 🔴 Критический | Ошибки upsert настроек не проверяются | ✅ исправлен |
| Б-А04 | 🔴 Критический | Нет защиты от брутфорса на /admin/login | ✅ исправлен |
| Б-А05 | 🟡 Средний | Двойной клик «Сохранить» создаёт дубли | ✅ исправлен |
| Б-А06 | 🟡 Средний | showAddItem() не сбрасывает f-photo | ✅ исправлен |
| Б-А07 | 🟡 Средний | Превью фото не скрывается при редактировании без фото | ✅ исправлен |
| Б-А08 | 🟡 Средний | Нет guard в toggleBarista() | ✅ исправлен |
| Б-А09 | 🟡 Средний | showAddBarista() использует prompt() | ✅ исправлен |
| Б-А10 | 🟡 Средний | changePin() использует prompt() | ✅ исправлен |
| Б-А11 | 🟡 Средний | formatLogDetail() выводит undefined при неполных данных | ⬜ не исправлен |
| Б-А12 | 🟡 Средний | QR-код с захардкоженным именем бота | ⬜ не исправлен |
| Б-А13 | 🟡 Средний | История меню пишется с old_value: null | ⬜ не исправлен |
| Б-А14 | 🔵 Низкий | renderMenu() без escaping | ⬜ не исправлен |
| Б-А15 | 🔵 Низкий | loadDashboard() глотает все ошибки | ⬜ не исправлен |
| Б-А16 | 🔵 Низкий | setOrderStatus() перезагружает весь дашборд | ⬜ не исправлен |
| Б-А17 | 🔵 Низкий | checkSetup() при ошибке молча открывает приложение | ⬜ не исправлен |
| Б-А18 | 🔵 Низкий | logout() не сбрасывает переменные состояния | ⬜ не исправлен |
| Б-А19 | 🔵 Низкий | loadBaristas() глотает ошибки | ⬜ не исправлен |
| Б-А20 | 🔵 Низкий | saveSettings() не сохраняет manager_tg_id | ⬜ не исправлен |
| Б-А21 | 🔵 Низкий | loadSettings() глотает ошибки | ⬜ не исправлен |
| Б-А22 | 🔵 Низкий | Мёртвый код a.setAttribute('Authorization') | ⬜ не исправлен |
| Б-А23 | 🔵 Низкий | loadBaristaLog() без пагинации | ⬜ не исправлен |
| Б-А24 | 🔵 Низкий | renderBroadcastHistory() выводит строку "null" | ⬜ не исправлен |
| Б-А25 | 🔵 Низкий | wizardNext(1) молча игнорирует ошибку | ⬜ не исправлен |
| Б-А26 | 🔵 Низкий | wizardNext(3) не валидирует формат PIN | ⬜ не исправлен |
| Б-А27 | 🔵 Низкий | Backend не валидирует price <= 0 | ⬜ не исправлен |
| Б-А28 | 🔵 Низкий | barista-log — запрос с пустым ids[] | ⬜ не исправлен |
| Б-А29 | 🔵 Низкий | loadSettings() не скрывает старое превью лого | ⬜ не исправлен |
| Б-А30 | 🔵 Низкий | Счётчик символов рассылки переустанавливается | ⬜ не исправлен |
| Б-А31 | 🔵 Низкий | /orders/stats без try/catch | ⬜ не исправлен |
| Б-А32 | 🔵 Низкий | Пароль администратора уязвим к timing-атаке | ✅ исправлен |
| Б-А33 | 🔴 Критический | Клиент задаёт total заказа сам | ✅ исправлен |
| Б-А34 | 🔴 Критический | POST /customers не валидирует tg_id (подмена) | ✅ исправлен |
| Б-А35 | 🔴 Критический | XSS в Mini App (меню, отзывы, акции, фото) | ✅ исправлен |
| Б-А36 | 🔴 Критический | Нет rate-limit на POST /orders и /customers | ✅ исправлен |
| Б-А37 | 🟡 Средний | refreshCupsFromApi выбирает промо по progress, а не id | ⬜ не исправлен |
| Б-А38 | 🟡 Средний | Хардкод promoId = 1 в Mini App и backend | ⬜ не исправлен |
| Б-А39 | 🟡 Средний | /orders/stats считает «сегодня» по UTC | ⬜ не исправлен |
| Б-А40 | 🟡 Средний | saveItem: orphan-фото в Storage при ошибке | ⬜ не исправлен |
| Б-А41 | 🟡 Средний | playBeep плодит AudioContext — beep глохнет после 6 заказов | ⬜ не исправлен |
| Б-А42 | 🟡 Средний | barista logout не отписывается от Realtime | ⬜ не исправлен |
| Б-А43 | 🔵 Низкий | referral_code без retry на UNIQUE | ⬜ не исправлен |
| Б-А44 | 🔵 Низкий | Рассылка — limit(1000) без пагинации | ⬜ не исправлен |
| Б-А45 | 🔵 Низкий | logout не инвалидирует JWT на сервере | ⬜ не исправлен |
| Б-А46 | 🔵 Низкий | Нет helmet — отсутствуют защитные заголовки | ⬜ не исправлен |
| Б-А47 | 🔴 Критический | Нет rate-limit на /barista/login — брутфорс PIN | ✅ исправлен |
| Б-А48 | 🟡 Средний | XSS в топ-товарах панели бариста | ⬜ не исправлен |
| Б-А49 | 🟡 Средний | /barista/orders/status не валидирует status/payment | ⬜ не исправлен |
| Б-А50 | 🟡 Средний | HTML-injection в приветствии бота | ⬜ не исправлен |
| Б-А51 | 🟡 Средний | Нет ограничения длины текстовых полей в публичном API | ⬜ не исправлен |
| Б-А52 | 🟡 Средний | CSS-injection через gradient в Mini App | ⬜ не исправлен |
| Б-А53 | 🟡 Средний | multer без фильтра MIME — любой файл (в т.ч. SVG с JS) как фото | ⬜ не исправлен |
| Б-А54 | 🟡 Средний | DELETE товара не удаляет фото из Storage (orphan) | ⬜ не исправлен |
| Б-А55 | 🟡 Средний | limit/offset в admin API без потолка — DoS-риск | ⬜ не исправлен |
| Б-А56 | 🟡 Средний | Нет валидации булевых полей vip/active/available | ⬜ не исправлен |
| Б-А57 | 🟡 Средний | /analytics/chart группирует по UTC, а не MSK | ⬜ не исправлен |
| Б-А58 | 🟡 Средний | upload/logo — расширение файла из MIME ломается для SVG/webp | ⬜ не исправлен |
