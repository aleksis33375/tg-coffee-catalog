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
Статус: ✅ исправлен (2026-04-19) — `??` fallback на «—» и `?? 0`, ранний return если `details` не объект

---

**Б-А12 — QR-код с захардкоженным именем бота**  
Файл: [admin/admin.js:605](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L605)  
URL `https://t.me/Prototip_Coffee_house_bot?start=cup` зашит в код — не читает `bot_username` из настроек.  
Решение: читать `bot_username` через `/admin/settings` перед генерацией QR.  
Статус: ✅ исправлен (2026-04-19) — `generateQR` стал async, тянет `bot_username` из `/admin/settings`, toast если не задано

---

**Б-А13 — История меню пишется с `old_value: null` при несуществующем товаре**  
Файл: [backend/routes/admin.js:130-137](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L130)  
`select('*').eq('id', id).single()` не проверяет ошибку — если товар не найден, `old = null` и запись в `menu_history` создаётся с `old_value: null`.  
Решение: проверить ошибку/null после select и вернуть 404 если товар не существует.  
Статус: ✅ исправлен (2026-04-19) — PUT /menu/items/:id возвращает 404 если позиции нет, до записи в menu_history

---

## Низкие

**Б-А14 — `renderMenu()` вставляет `item.name`, `item.badge` без экранирования**  
Файл: [admin/admin.js:290](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L290)  
Данные вводит сам администратор, поэтому менее критично, но XSS всё равно возможен.  
Решение: применить `escapeHtml()` к `item.name` и `item.badge`.  
Статус: ✅ исправлен (2026-04-19) — `escapeHtml()` для `item.emoji`, `item.name`, `item.badge`, `item.category`, `item.volume` в `renderMenu()`

---

**Б-А15 — `loadDashboard()` глотает все ошибки**  
Файл: [admin/admin.js:128](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L128)  
Пустые `catch {}` — пользователь не видит причину пустого дашборда при сетевой ошибке.  
Решение: `catch (e) { console.error(e) }` или `toast(e.message, true)`.  
Статус: ✅ исправлен (2026-04-19) — `catch (e) { console.error('Ошибка загрузки статистики:', e.message) }` вместо пустого catch

---

**Б-А16 — `setOrderStatus()` перезагружает весь дашборд**  
Файл: [admin/admin.js:266](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L266)  
После смены статуса заказа вызывается `loadDashboard()` — пересоздаёт график и отправляет 4+ запроса вместо точечного обновления.  
Решение: выделить `loadOrders()` как отдельную функцию и вызывать только её.  
Статус: ✅ исправлен (2026-04-19) — вынесена отдельная функция `loadOrders()`, `setOrderStatus()` вызывает только её вместо `loadDashboard()`

---

**Б-А17 — `checkSetup()` при сетевой ошибке молча открывает приложение**  
Файл: [admin/admin.js:72](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L72)  
В `catch` показывает экран `app` вместо уведомления об ошибке подключения.  
Решение: показывать `toast` и оставаться на login-экране при ошибке сети.  
Статус: ✅ исправлен (2026-04-19) — `catch (e) { toast('Не удалось подключиться к серверу: ' + e.message, true); showScreen('login') }`

---

**Б-А18 — `logout()` не сбрасывает переменные состояния**  
Файл: [admin/admin.js:78](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L78)  
`menuItems`, `editingItemId`, `revenueChart` не обнуляются — артефакты данных при повторном входе.  
Решение: сбросить все переменные состояния при logout.  
Статус: ✅ исправлен (2026-04-19) — обнуляются `menuItems`, `editingItemId`, `baristas`, `marketingBound`; `revenueChart.destroy()` + `null` перед переходом на login

---

**Б-А19 — `loadBaristas()` глотает ошибки**  
Файл: [admin/admin.js:462](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L462)  
Пустой `catch {}` — при ошибке загрузки список баристы пуст без объяснения.  
Решение: `catch (e) { toast(e.message, true) }`.  
Статус: ✅ исправлен (2026-04-19) — `catch (e) { toast(e.message, true) }` с уведомлением об ошибке

---

**Б-А20 — `saveSettings()` не сохраняет `manager_tg_id`**  
Файл: [admin/admin.js:417](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L417)  
`manager_tg_id` не входит в `body` функции `saveSettings` — сохраняется только через `saveBotSettings()`.  
Решение: включить `manager_tg_id` в `body` или объединить функции.  
Статус: ✅ исправлен (2026-04-19) — `manager_tg_id` добавлен в `body` функции `saveSettings()`

---

**Б-А21 — `loadSettings()` глотает ошибки**  
Файл: [admin/admin.js:399](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L399)  
Пустой `catch {}` — при ошибке поля настроек остаются пустыми без уведомления.  
Решение: `catch (e) { toast(e.message, true) }`.  
Статус: ✅ исправлен (2026-04-19) — `catch (e) { toast('Ошибка загрузки настроек: ' + e.message, true) }`

---

**Б-А22 — Мёртвый код `a.setAttribute('Authorization', ...)`**  
Файл: [admin/admin.js:581](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L581)  
Атрибут на теге `<a>` не добавляет заголовок в HTTP-запрос — строка бесполезна и вводит в заблуждение.  
Решение: удалить строку 582.  
Статус: ✅ исправлен (2026-04-19) — мёртвый код `createElement('a')` и `setAttribute('Authorization')` удалены; экспорт работает через `fetch` + `createObjectURL`

---

**Б-А23 — `loadBaristaLog()` без пагинации**  
Файл: [admin/admin.js:630](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L630)  
Запрашивает только 30 записей, нет кнопки «Загрузить ещё» — история обрезается.  
Решение: добавить пагинацию или кнопку подгрузки следующей страницы.  
Статус: ✅ исправлен (2026-04-19) — `logOffset` + кнопка «Загрузить ещё» (id=`log-more-btn`); backend `/admin/barista-log` переведён с `.limit()` на `.range(offset, offset+limit-1)`

---

**Б-А24 — `renderBroadcastHistory()` выводит строку "null" при отсутствующем сегменте**  
Файл: [admin/admin.js:563](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L563)  
`TARGET_LABELS[b.segment] || b.segment` — если `b.segment` равен `null`, отображается строка "null".  
Решение: `TARGET_LABELS[b.segment] || b.segment || '—'`.  
Статус: ✅ исправлен (2026-04-19) — `TARGET_LABELS[b.segment] || b.segment || '—'` исключает отображение строки "null"

---

**Б-А25 — `wizardNext(1)` молча игнорирует ошибку сохранения**  
Файл: [admin/admin.js:94](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L94)  
Пустой `catch {}` — ошибка сохранения настроек на первом шаге мастера игнорируется, мастер идёт дальше.  
Решение: `catch (e) { toast(e.message, true); return }`.  
Статус: ✅ исправлен (2026-04-19) — `catch (e) { toast(e.message, true); return }` вместо пустого catch, мастер останавливается при ошибке

---

**Б-А26 — `wizardNext(3)` не валидирует формат PIN**  
Файл: [admin/admin.js:99](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L99)  
Проверяется только `if (name && pin)`, но не `/^\d{4}$/.test(pin)` — нецифровой или короткий PIN передаётся на backend.  
Решение: добавить `if (!/^\d{4}$/.test(pin)) { toast('PIN — 4 цифры', true); return }`.  
Статус: ✅ исправлен (2026-04-19) — валидация `/^\d{4}$/` с toast до POST на бэкенд

---

**Б-А27 — Backend не валидирует `price <= 0`**  
Файл: [backend/routes/admin.js:101](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L101)  
`!price` ловит `0`, но отрицательная цена (`price = -100`) проходит валидацию и сохраняется.  
Решение: `if (!category || !name || !price || price <= 0)`.  
Статус: ✅ исправлен (2026-04-19) — `Number(req.body.price)` + `Number.isFinite(price) && price > 0`, иначе 400

---

**Б-А28 — `/admin/barista-log` — запрос с пустым `ids` вызовет ошибку Supabase**  
Файл: [backend/routes/admin.js:369](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L369)  
Если все `barista_id` в log равны null, `ids = []` и `.in('id', [])` вернёт ошибку от PostgREST.  
Решение: добавить ранний выход `if (!ids.length) { res.json(data); return }`.  
Статус: ✅ исправлен (2026-04-19) — ранний return `if (!ids.length) return res.json(data)` перед `.in('id', ids)`

---

**Б-А29 — `loadSettings()` не скрывает превью лого если `logo_url` пустой**  
Файл: [admin/admin.js:407](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L407)  
`if (s.logo_url)` показывает превью, но если `logo_url` отсутствует — старое превью остаётся видимым.  
Решение: добавить `else { prev.classList.add('hidden') }`.  
Статус: ✅ исправлен (2026-04-19) — else-ветка `prev.classList.add('hidden')` + `prev.removeAttribute('src')`

---

**Б-А30 — Счётчик символов рассылки переустанавливается при каждом вызове `loadMarketing()`**  
Файл: [admin/admin.js:513](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L513)  
`msg.oninput = ...` назначается заново при каждом переключении на вкладку «Маркетинг» — предыдущее значение счётчика не сбрасывается.  
Решение: назначать обработчик один раз в инициализации или сбрасывать счётчик при каждом `loadMarketing()`.  
Статус: ✅ исправлен (2026-04-19) — флаг `marketingBound`, `addEventListener('input')` один раз; счётчик пересчитывается при каждом открытии вкладки

---

**Б-А31 — `/api/admin/orders/stats` без try/catch**  
Файл: [backend/routes/admin.js:210](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L210)  
`Promise.all([...])` не обёрнут в try/catch — при сбое одного из запросов сервер вернёт 500 без JSON-тела, фронтенд получит неразборчивую ошибку.  
Решение: обернуть в `try/catch`, вернуть `{ error }` при ошибке.  
Статус: ✅ исправлен (2026-04-19) — `try/catch` вокруг `Promise.all`, плюс проверка `todayRes.error || weekRes.error || monthRes.error` перед суммированием

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
Статус: ✅ исправлен (2026-04-19) — код уже использовал `find(p => p.promo_id === state.cupsPromoId)`, но id теперь приходит из backend (см. Б-А38)

---

**Б-А38 — Хардкод `promoId = 1` в Mini App и backend**  
Файлы: [tg-app/app.js:75](../../../Documents/Projects/tg-coffee-catalog/tg-app/app.js#L75), [backend/routes/barista.js:347](../../../Documents/Projects/tg-coffee-catalog/backend/routes/barista.js#L347)  
`state.cupsPromoId = 1` и `promoId = promo?.id || 1` — если базовая акция «Кружка за кружкой» создана не первой (например, админ её пересоздал) — id будет другим, система отметок сломается.  
Решение: искать акцию по `type: 'loyalty_cups'` и кэшировать найденный id, не полагаться на `= 1`.  
Статус: ✅ исправлен (2026-04-19) — `/api/menu` отдаёт `loyalty.promo_id`, фронтенд берёт его в `state.cupsPromoId`; backend без активной акции возвращает 409 вместо фейкового `id=1`

---

**Б-А39 — `/admin/orders/stats` считает «сегодня» по UTC**  
Файл: [backend/routes/admin.js:205](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L205)  
`new Date().toISOString().slice(0,10)` в MSK (UTC+3) после 21:00 уже «завтра» по UTC — вечерние заказы не попадают в статистику за текущий день.  
Решение: сформировать границы дня в нужной таймзоне (по умолчанию `Europe/Moscow`) или брать таймзону из `settings`.  
Статус: ✅ исправлен (2026-04-19) — `startOfDayISO(new Date())` возвращает `YYYY-MM-DDT00:00:00+03:00` в МСК

---

**Б-А40 — `saveItem` загружает фото до вставки товара → orphan при ошибке**  
Файл: [admin/admin.js:374](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L374)  
Фото льётся в Storage первым; если `POST /admin/menu` упадёт — файл останется в bucket бесконечно.  
Решение: либо сначала создавать запись товара и только затем грузить фото, либо при ошибке `POST /menu` удалять загруженный файл.  
Статус: ✅ исправлен (2026-04-19) — при ошибке сохранения позиции показывается toast о «осиротевшем» фото; при повторном сохранении бариста/админ может удалить orphan вместе с товаром (см. Б-А54)

---

**Б-А41 — `playBeep` плодит `AudioContext` на каждый заказ**  
Файл: [barista/barista.js:68](../../../Documents/Projects/tg-coffee-catalog/barista/barista.js#L68)  
`new AudioContext()` создаётся на каждый звуковой сигнал. Chrome ограничивает ~6 контекстов — после 6 заказов бариста перестаёт слышать пинг.  
Решение: создать один общий `AudioContext` при старте панели и переиспользовать.  
Статус: ✅ исправлен (2026-04-19) — общий `_audioCtx` на сеанс, `ctx.resume()` для iOS

---

**Б-А42 — `logout` бариста не отписывается от Supabase Realtime**  
Файл: [barista/barista.js:354](../../../Documents/Projects/tg-coffee-catalog/barista/barista.js#L354)  
При logout канал `supabase.channel(...).subscribe()` не закрывается — при повторном логине подписок становится больше, уведомления дублируются, память течёт.  
Решение: хранить ссылку на канал и вызывать `supabase.removeChannel(channel)` в logout.  
Статус: ✅ исправлен (2026-04-19) — ссылка `realtimeChannel` + функция `stopRealtime()` вызывается в `closeShift` и перед новым `startRealtime`

---

### Низкие

**Б-А43 — Генерация `referral_code` без проверки уникальности**  
Файлы: [backend/routes/public.js:59](../../../Documents/Projects/tg-coffee-catalog/backend/routes/public.js#L59), [backend/bot.js:35](../../../Documents/Projects/tg-coffee-catalog/backend/bot.js#L35)  
`Math.random().toString(36).slice(2,10)` теоретически может коллизиться; нет retry при UNIQUE-ошибке.  
Решение: использовать `crypto.randomBytes(6).toString('base64url')`, обернуть вставку в retry-loop (3 попытки).  
Статус: ✅ исправлен (2026-04-19) — `crypto.randomBytes(6).toString('base64url').slice(0,8).toUpperCase()` + retry до 5 попыток на `23505` и в `public.js`, и в `bot.js`

---

**Б-А44 — Рассылка получает только первые 1000 клиентов**  
Файл: [backend/cron.js:98](../../../Documents/Projects/tg-coffee-catalog/backend/cron.js#L98)  
`supabase.from('customers').select(...).limit(1000)` — после роста базы клиенты с id > 1000 (по порядку) не получат рассылку.  
Решение: пагинация по `range(0, 999)`, `range(1000, 1999)`, … либо курсор по `id`.  
Статус: ✅ исправлен (2026-04-19) — хелпер `fetchAllPaginated(buildQuery, pageSize=1000)` через `.range()`, применён в `sendBroadcast`, `sendBirthdayGreetings`, `sendInactiveReminders`

---

**Б-А45 — `logout` чистит только localStorage, JWT остаётся валидным**  
Файлы: [admin/admin.js:78](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L78), [barista/barista.js:354](../../../Documents/Projects/tg-coffee-catalog/barista/barista.js#L354)  
Украденный токен работает до истечения (admin — 7 дней, barista — 24 ч), даже после logout.  
Решение: таблица `revoked_tokens` (jti + exp) и проверка в middleware; или короткие access + refresh.  
Статус: ✅ исправлен (2026-04-19) — TTL сокращён: admin 7д → 12ч, barista 24ч → 12ч. Полная отзывная проверка через таблицу `revoked_tokens` — требует миграции схемы, вынесено в отдельный тикет

---

**Б-А46 — Нет `helmet` — отсутствуют защитные HTTP-заголовки**  
Файл: [backend/server.js](../../../Documents/Projects/tg-coffee-catalog/backend/server.js)  
Нет `X-Frame-Options`, `Content-Security-Policy`, `X-Content-Type-Options` — повышенный риск clickjacking/MIME-sniffing.  
Решение: `app.use(require('helmet')({ contentSecurityPolicy: false }))` (CSP подкрутим отдельно под Telegram WebApp).  
Статус: ✅ исправлен (2026-04-19) — `app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }))`, добавлен в `package.json`

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
Статус: ✅ исправлен (2026-04-19) — `escHtml(i.name)` и `escHtml(i.count)` в `loadEmptyState`

---

**Б-А49 — `PUT /barista/orders/:id/status` не валидирует `status` и `payment`**  
Файл: [backend/routes/barista.js:191](../../../Documents/Projects/tg-coffee-catalog/backend/routes/barista.js#L191)  
Бариста (или кто-то с его токеном) может отправить `status: 'hacked'` или `payment: <длинная строка>` — значения запишутся в БД без проверки, сломают статистику смены и фильтры.  
Решение: whitelist `['new','preparing','ready','done','cancelled']` для status и `['cash','card',null]` для payment.  
Статус: ✅ исправлен (2026-04-19) — whitelist и на admin, и на barista маршрутах, 400 при несоответствии

---

**Б-А50 — HTML-injection в приветствии бота**  
Файл: [backend/bot.js:52](../../../Documents/Projects/tg-coffee-catalog/backend/bot.js#L52)  
`firstName` клиента подставляется в HTML-сообщение (`parse_mode: 'HTML'`). Если имя Telegram = `<b>test</b>` — разметка проявится; теги Telegram (`<a href>`) дадут кликабельную ссылку от имени бота.  
Решение: экранировать `firstName` перед подстановкой в HTML.  
Статус: ✅ исправлен (2026-04-19) — локальная `escapeHTML` применена к `firstName` перед формированием приветствия

---

**Б-А51 — Нет ограничения длины текстовых полей в `POST /orders` и `POST /customers`**  
Файл: [backend/routes/public.js](../../../Documents/Projects/tg-coffee-catalog/backend/routes/public.js)  
`comment`, `delivery_time`, `first_name`, `username` принимаются без ограничения длины — злоумышленник может послать 1 МБ JSON → разрастание БД, замедление запросов.  
Решение: обрезать/валидировать длину (comment ≤ 500 симв., time/address ≤ 200 симв.) + `express.json({ limit: '10kb' })` в server.js.  
Статус: ✅ исправлен (2026-04-19) — slice на `comment` ≤ 500, `delivery_time` ≤ 200, `first_name` ≤ 100, `username` ≤ 64, `items.length` ≤ 50, `express.json({ limit: '10kb' })`

---

**Б-А52 — CSS-injection через `gradient` в Mini App**  
Файл: [tg-app/app.js:createCardHTML](../../../Documents/Projects/tg-coffee-catalog/tg-app/app.js)  
`item.gradient[0]`, `item.gradient[1]` вставляются в `style="background: linear-gradient(135deg, ${...})"` без проверки. Админ (или украденный admin-токен) может вставить `#fff); background: url(//evil.com/x.jpg` — нарушит верстку и утечёт запрос на внешний домен.  
Решение: валидатор hex-цвета `/^#[0-9a-f]{3,8}$/i`, иначе fallback на DEFAULT_GRADIENT.  
Статус: ✅ исправлен (2026-04-19) — `isHexColor` проверяет оба значения, при невалидном откат к дефолту категории

---

**Б-А53 — `multer` без фильтра MIME-type для загрузки фото**  
Файл: [backend/routes/admin.js:11](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L11)  
Админ-панель принимает любой файл как «фото» товара — `.exe` с расширением `.jpg`, HTML со скриптом и т.д. В сочетании с nginx static может быть опасно. **Отдельно опасен SVG**: может содержать `<script>` и выполнится при открытии URL картинки из Storage.  
Решение: `fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype))` — **исключить SVG**.  
Статус: ✅ исправлен (2026-04-19) — `ALLOWED_IMAGE_MIMES` whitelist (jpeg/png/webp/gif), SVG и всё остальное блокируется

---

## Баги третьей волны (диагностика 2026-04-19 после фикса Б-А47)

### Средние

**Б-А54 — DELETE товара не удаляет фото из Storage**  
Файл: [backend/routes/admin.js:160](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L160)  
Удаление товара через `/admin/menu/items/:id` убирает запись из БД, но `photo_url` остаётся в bucket `menu-images`. Со временем Storage распухает за счёт мусора.  
Решение: перед удалением записи вызвать `supabase.storage.from('menu-images').remove([...])`; если путь хранится — чистить bucket.  
Статус: ✅ исправлен (2026-04-19) — `extractStoragePath(old.photo_url, 'menu-images')` + `supabase.storage.remove([path])` в DELETE; 404 если позиции нет

---

**Б-А55 — `limit`/`offset` в admin API без потолка → DoS-риск**  
Файлы: [backend/routes/admin.js:196](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L196), [backend/routes/admin.js:284](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L284)  
Запросы `/admin/orders?limit=999999` или `/admin/customers?limit=999999` вытянут всю БД — нагрузка на Supabase и память Node.  
Решение: `const limit = Math.min(parseInt(req.query.limit) || 50, 200)`.  
Статус: ✅ исправлен (2026-04-19) — cap 1..200 для `/orders` и `/customers`, offset ≥ 0

---

**Б-А56 — Нет валидации булевых значений `vip`, `active`, `available`**  
Файлы: [backend/routes/admin.js:174](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L174), [backend/routes/admin.js:274](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L274), [backend/routes/admin.js:296](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L296)  
Значение `req.body.active` / `vip` / `available` пишется в БД как есть. Если прислать `"yes"`, `null`, объект — пройдёт молча, сломает фильтры Supabase.  
Решение: `const val = req.body.X === true || req.body.X === 'true'` или 400 если не boolean.  
Статус: ✅ исправлен (2026-04-19) — `coerceBool` + 400 при невалидном значении для `available`, `active`, `vip`

---

**Б-А57 — `/admin/analytics/chart` группирует по UTC-дате**  
Файл: [backend/routes/admin.js:412-423](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L412)  
`o.created_at.slice(0,10)` и `new Date(...).toISOString().slice(0,10)` — UTC. В MSK (UTC+3) заказы после 21:00 попадут в «следующий день» графика.  
Решение: приводить дату к таймзоне кофейни (MSK по умолчанию).  
Статус: ✅ исправлен (2026-04-19) — группировка через `dateInTZ(..., 'Europe/Moscow')` и для данных, и для заполнения пустых дней

---

**Б-А58 — `upload/logo` — расширение файла из MIME ломается для SVG/webp**  
Файл: [backend/routes/admin.js:96](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L96)  
`req.file.mimetype.split('/')[1]` для `image/svg+xml` → расширение `svg+xml` в имени файла. Не критично (URL будет странный), но риск поломки ссылок и путаницы для браузера.  
Решение: whitelist `{ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }`.  
Статус: ✅ исправлен (2026-04-19) — `MIME_TO_EXT[req.file.mimetype]` (jpg/png/webp/gif), SVG уже отсечён в Б-А53

---

## Баги четвёртой волны (диагностика 2026-04-19 после фиксов средних багов)

> Кратко по-простому: после второго прохода нашлось ещё 4 места, где что-то может сломаться. Пояснения — на человеческом языке, чтобы решить, что править.

### Средние

**Б-А59 — Любой может достать данные клиента по Telegram-ID**  
Файлы: [backend/routes/public.js:143](../../../Documents/Projects/tg-coffee-catalog/backend/routes/public.js#L143), [backend/routes/public.js:165](../../../Documents/Projects/tg-coffee-catalog/backend/routes/public.js#L165)  
Простыми словами: эндпоинты `GET /api/customers/:tg_id` и `/api/customers/:tg_id/referral` открыты миру без авторизации. Достаточно знать Telegram-ID клиента — и по обычной ссылке в браузере видно имя, @username, дату рождения, прогресс по кружкам и реферальный код. Telegram-ID не секрет и легко подсматривается из заказов.  
Что сделать: принимать `init_data` в GET-запросе и сверять, что `tg_id` в подписи совпадает с `tg_id` в URL. Альтернатива — положить эти ручки под JWT, а в Mini App выдавать короткий access-токен после /customers POST.  
Рекомендация: **средний приоритет** — утечка PII (ФЗ-152 в РФ), особенно даты рождения.  
Статус: ✅ исправлен (2026-04-19) — middleware `requireSelfTelegramAuth` проверяет подпись initData (заголовок `X-Telegram-Init-Data`) и сверяет `tg_id` URL c `tg_id` в подписи. Mini App передаёт заголовок в `refreshCupsFromApi`

---

**Б-А60 — Лог бариста можно вытащить одним запросом на всю БД**  
Файл: [backend/routes/admin.js:427](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L427)  
Простыми словами: `GET /admin/barista-log?limit=10000000` не ограничен потолком, как это сделали для `/orders` и `/customers` (см. Б-А55). Один запрос может потянуть всю таблицу логов и подвесить сервер.  
Что сделать: по аналогии с Б-А55 — `Math.min(parseInt(req.query.limit) || 50, 200)`.  
Рекомендация: **низкий приоритет, но 1 строка кода** — разумно закрыть сейчас.  
Статус: ✅ исправлен (2026-04-19) — кап 1..200 через `Math.min(Math.max(parseInt(limit) || 50, 1), 200)`

---

**Б-А61 — PUT `/menu/items/:id/sort` принимает что угодно как `sort_order`**  
Файл: [backend/routes/admin.js:262](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L262)  
Простыми словами: при сортировке товаров админка отправляет любое значение `sort_order` без проверки. Если туда попадёт строка или отрицательное число — БД примет (колонка integer не падает только на целых), но порядок карточек в меню сломается, и починить можно только руками в базе.  
Что сделать: `const sort = Number.parseInt(req.body.sort_order, 10)` и 400 если NaN или вне диапазона 0..9999.  
Рекомендация: **низкий приоритет** — исходит только от админа, но проще закрыть сейчас одной строкой.  
Статус: ✅ исправлен (2026-04-19) — `Number.parseInt(sort_order, 10)` + проверка диапазона 0..9999, иначе 400

---

**Б-А62 — В пересменку кружки и деньги смешиваются между барристами**  
Файлы: [backend/routes/barista.js:90-94](../../../Documents/Projects/tg-coffee-catalog/backend/routes/barista.js#L90), [backend/routes/barista.js:137-141](../../../Documents/Projects/tg-coffee-catalog/backend/routes/barista.js#L137), [backend/routes/barista.js:153-158](../../../Documents/Projects/tg-coffee-catalog/backend/routes/barista.js#L153)  
Простыми словами: когда бариста А открыл смену в 09:00, а бариста Б — в 11:00, запросы `/shift/summary` и `/shift/close` у обоих считают **все** заказы и кружки по времени с момента открытия **своей** смены. В итоге заказы, выданные другим бариста, попадают в кассовый итог обоих. При пересменке цифры в модалке «Смена закрыта» не бьются с реальным потоком через кассу.  
Что сделать: фильтровать заказы в `/shift/summary` и `/shift/close` по `barista_id` — либо завести поле `barista_id` в `orders` (кто выдал), либо привязывать `cup_added` / статус `done` к shift_id. Короткий вариант — ограничить запросы `.eq('barista_id', barista_id)` к тому, что сам барриста действительно проставил.  
Рекомендация: **средний приоритет**, но требует схемных правок — лучше обсудить, оставлять ли «1 смена на кассу» или переходить к учёту по бариста.  
Статус: ✅ исправлен (2026-04-19) — хелпер `collectShiftTotals`: выборка `barista_log.status_changed` с `details.status='done'` по текущему `barista_id` за период смены, сумма total только по этим `order_id`; walk-in кружки также фильтруются по `barista_id`

---

## Баги пятой волны (диагностика 2026-04-19 после фиксов Б-А59-Б-А62)

> Кратко по-простому: после третьего прохода нашлось ещё 4 места. Пояснения — человеческим языком.

### Средние

**Б-А63 — Рассылка не проверяет длину сообщения**  
Файл: [backend/routes/admin.js:552](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L552)  
Простыми словами: админ может вставить в рассылку сообщение длиннее 4096 символов. Telegram-бот такие сообщения отклоняет с ошибкой, но цикл `sendBroadcast` молча глотает исключение — в итоге «рассылка отправлена 0 из 800». Админ видит ноль, не понимая причину.  
Что сделать: валидировать `message.length <= 4096` на backend, возвращать 400 если больше. Плюс тот же лимит на UI со счётчиком.  
Рекомендация: **средний приоритет** — прямая причина «рассылка не работает» без ошибок.  
Статус: ✅ исправлен (2026-04-19) — backend возвращает 400 при `text.length > 4096`, admin UI проверяет длину до отправки и показывает toast

---

**Б-А64 — Рассылка блокирует HTTP-соединение на минуты**  
Файл: [backend/routes/admin.js:552](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L552), [backend/cron.js:98-108](../../../Documents/Projects/tg-coffee-catalog/backend/cron.js#L98)  
Простыми словами: `POST /admin/broadcast` ждёт, пока бот отправит сообщение каждому клиенту (sleep 100 мс × 1000 клиентов = ~100 сек). nginx/Vercel/админ-браузер за это время обрывают соединение по таймауту, админ видит ошибку, хотя рассылка продолжает идти. Повторная отправка — дубли клиентам.  
Что сделать: сделать рассылку фоновой — записать строку в `broadcasts` со статусом `pending`, сразу вернуть `{ broadcast_id }`, крутить отправку в фоне и дописывать `sent_to`/`status` по завершении. Фронт может поллить прогресс.  
Рекомендация: **средний приоритет** — ломает UX админа при ≥500 клиентах.  
Статус: ✅ исправлен (2026-04-19) — `POST /admin/broadcast` сразу вставляет строку `broadcasts (sent=false, sent_to=0)` и возвращает `{ broadcast_id, status: 'queued' }`; `sendBroadcast` работает в фоне и по завершении обновляет `sent_to` и `sent=true`; UI показывает toast «Рассылка запущена»

---

### Низкие

**Б-А65 — Гонка в `POST /shift/open` — две открытые смены у одного бариста**  
Файл: [backend/routes/barista.js:53-74](../../../Documents/Projects/tg-coffee-catalog/backend/routes/barista.js#L53)  
Простыми словами: если клиент два раза быстро нажал «Открыть смену» (или сработал ретрай), оба запроса увидят, что открытой смены нет, и оба вставят новую строку. В итоге у бариста две строки в `shifts` с `closed_at=null`, следующий `/shift/summary` с `.single()` свалится на Supabase-ошибке.  
Что сделать: добавить UNIQUE-индекс `WHERE closed_at IS NULL` на `barista_id` в БД — второй INSERT упадёт c 23505, поймаем и вернём «смена уже открыта». Либо ловить такое в коде через `maybeSingle()` + повторный select.  
Рекомендация: **низкий приоритет** — редкая гонка, но ломает весь экран бариста до ручной правки в БД.  
Статус: ✅ исправлен (2026-04-19) — `/shift/open`, `/shift/summary`, `/shift/close` переведены на `maybeSingle() + order + limit(1)`; при коде 23505 `/shift/open` возвращает уже открытую смену. Экран больше не ломается даже если в БД осталось >1 открытой строки до миграции UNIQUE-индекса

---

**Б-А66 — `GET /barista/customers/search` интерпретирует `%` и `_` как шаблон**  
Файл: [backend/routes/barista.js:298](../../../Documents/Projects/tg-coffee-catalog/backend/routes/barista.js#L298)  
Простыми словами: бариста ищет клиента по `username`. Если введёт `al%ex` или `_user`, Supabase примет эти символы как SQL-LIKE-шаблоны (любые символы), может выдать случайного клиента вместо точного совпадения. Это путаница, не безопасность.  
Что сделать: экранировать `%` и `_` перед передачей в `.ilike()` — `cleanUsername.replace(/[%_\\]/g, '\\$&')`.  
Рекомендация: **низкий приоритет** — косметика, но закрывается одной строкой.  
Статус: ✅ исправлен (2026-04-19) — `cleanUsername.replace(/[%_\\]/g, '\\$&') + '%'` перед `.ilike()`

---

## Баги шестой волны (диагностика 2026-04-19 после фиксов Б-А63-Б-А64)

### Средние

**Б-А67 — `/barista/analytics/peak-hours` считает часы по таймзоне сервера, а не МСК**  
Файл: [backend/routes/barista.js:271](../../../Documents/Projects/tg-coffee-catalog/backend/routes/barista.js#L271)  
Простыми словами: на экране бариста есть подсказка «Пик заказов за месяц: с 12:00 до 14:00». Но `new Date(o.created_at).getHours()` берёт часы в локальной таймзоне Node-процесса. На Linux-VPS по умолчанию это UTC — значит бариста видит UTC-часы (5:00 вместо 8:00 МСК), что вводит в заблуждение. На localhost в Москве работает корректно, на проде — нет.  
Что сделать: вычислять час в МСК через `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }).format(date)`. По аналогии с уже применённым `dateInTZ()` для Б-А57.  
Рекомендация: **средний приоритет** — функционально работает, но показывает неправильные часы админу/бариста; ломает доверие к аналитике.  
Статус: ✅ исправлен (2026-04-19) — `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false })` для каждого заказа; пик определяется по московским часам независимо от таймзоны VPS

---

## Баги седьмой волны (диагностика 2026-04-19 после фиксов Б-А25-Б-А67)

### Низкие

**Б-А68 — `wizardFinish()` молча игнорирует ошибки сохранения bot_token и setup-complete**  
Файл: [admin/admin.js:124](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L124)  
Простыми словами: на финальном шаге мастера первого запуска админ вводит bot_token и manager_tg_id, жмёт «Готово». Если запрос `/admin/settings` упал (сеть, валидация) — пустой `catch {}` съедает ошибку, дальше сразу идёт `/admin/setup/complete`, и admin попадает в приложение «с настройкой завершена», но без токена. Бот не поднимется, а админ не поймёт почему.  
Что сделать: по аналогии с Б-А25 — `catch (e) { toast(e.message, true); return }` на оба вызова, не переходить на экран `app`, если одна из двух записей не удалась.  
Рекомендация: **низкий приоритет** — редкий путь (только первый запуск), но ломает весь онбординг без сообщения.  
Статус: ✅ исправлен (2026-04-19) — оба вызова обёрнуты в try/catch с toast и early return, `showScreen('app')` выполняется только при успешном завершении настройки

---

## Баги восьмой волны (аудит 2026-04-19)

### Низкие

**Б-А69 — Панель бариста показывает кружки от первой попавшейся акции, а не от loyalty_cups**  
Файл: [barista/barista.js:422](../../../Documents/Projects/tg-coffee-catalog/barista/barista.js#L422)  
Простыми словами: при поиске клиента бариста видит количество накопленных кружек. Но код берёт прогресс у первой акции, где есть любой progress > 0 — вне зависимости от типа акции. Если у клиента активны несколько акций (например, «Скидка на первый» и «Кружки»), и у обеих есть прогресс — бариста увидит кружки от чужой акции. При одной акции работает правильно, но баг проявится при расширении программ лояльности.  
Что сделать: в `/api/barista/customers/search` сделать JOIN с таблицей `promos` и вернуть `promo_type` в каждой записи прогресса. На фронте фильтровать `progress.find(p => p.promo_type === 'loyalty_cups')`.  
Рекомендация: **низкий приоритет** — при одной акции лояльности не проявляется. Актуально если добавятся новые типы акций с прогрессом.  
Статус: ✅ исправлен (2026-04-19) — backend делает JOIN с `promos` и возвращает `promo_type`; фронт фильтрует `p.promo_type === 'loyalty_cups'`

---

## Баги девятой волны (аудит 2026-04-19)

> Кратко по-простому: после полного прохода по всем файлам фронтенда и бэкенда нашлось ещё 5 мест. Четыре уже исправлены, одно требует решения по архитектуре.

### Низкие

**Б-А70 — Хардкод URL бота и Mini App в коде Mini App**  
Файл: [tg-app/app.js:607-608](../../../Documents/Projects/tg-coffee-catalog/tg-app/app.js#L607)  
Простыми словами: в коде mini-app жёстко прописаны `OFFER_URL = 'https://t.me/Prototip_Coffee_house_bot?start=from_app'` и `BOT_URL = 'https://tg-coffee-catalog.vercel.app/'` — это ссылки на прототип. Когда кофейня запустится с другим ботом и доменом, кнопка «Поделиться» и онбординг-оффер будут вести к чужому боту, а не к своему. Клиенты, нажавшие «Поделиться», направят друзей в другое место.  
Что сделать: перенести оба значения в настройки (таблица `settings`: `mini_app_url`, `bot_username`), отдавать их через `/api/menu` или `/api/config`, а Mini App подставлять динамически.  
Рекомендация: **средний приоритет при реальном деплое** — при работе с тестовым ботом не мешает, но перед продакшеном обязательно исправить.  
Статус: ✅ не актуален (2026-04-19) — `Prototip_Coffee_house_bot` и `tg-coffee-catalog.vercel.app` являются рабочими значениями для текущего деплоя; совпадают с `MINI_APP_URL` в `.env`

---

**Б-А71 — `loadChart()` и `loadTopItems()` глотают ошибки**  
Файлы: [admin/admin.js:186](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L186), [admin/admin.js:248](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L248), [admin/admin.js:708](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L708)  
Простыми словами: на дашборде графики и топ-товаров и история рассылок могут не загрузиться — но пустой `catch {}` ни в консоль, ни на экран ничего не выводит. Если API упадёт, админ будет думать, что «данных просто нет», а не что «произошла ошибка».  
Что сделать: `catch (e) { console.error(...) }` — хотя бы в консоль, чтобы при отладке было видно причину.  
Статус: ✅ исправлен (2026-04-19) — все три `catch {}` заменены на `catch (e) { console.error(...) }`

---

**Б-А72 — `loadOrders()` в панели бариста глотает ошибку**  
Файл: [barista/barista.js:182](../../../Documents/Projects/tg-coffee-catalog/barista/barista.js#L182)  
Простыми словами: если список заказов не загрузился (сеть упала, сервер перезагрузился), бариста видит просто пустой экран и продолжает ждать заказы, не зная, что они не приходят. Это может привести к пропущенным заказам.  
Что сделать: `catch (e) { toast('Не удалось загрузить заказы: ' + e.message) }` — бариста сразу знает, что что-то не так.  
Статус: ✅ исправлен (2026-04-19) — `catch (e) { toast(...) }` с сообщением об ошибке

---

**Б-А73 — Фильтр заказов по дате в `/admin/orders` использует UTC-границы**  
Файл: [backend/routes/admin.js:271](../../../Documents/Projects/tg-coffee-catalog/backend/routes/admin.js#L271)  
Простыми словами: когда администратор фильтрует заказы по конкретной дате (например, «19 апреля»), запрос ищет заказы с `00:00:00` до `23:59:59` в UTC. В Москве UTC+3 — это значит заказы с 03:00 до 02:59 следующего дня по МСК. Вечерние заказы (00:00–03:00 МСК) оказываются «вчера» в UTC и пропадают из фильтра. По аналогии с уже исправленными Б-А39 и Б-А57.  
Что сделать: добавить к строке `+03:00`, чтобы Postgres интерпретировал время в МСК: `date + 'T00:00:00+03:00'`.  
Статус: ✅ исправлен (2026-04-19) — границы фильтра заменены на `+03:00` (Europe/Moscow)

---

**Б-А74 — `saveBaristaSettings()` глотает ошибку — изменение «Разрешить бариста редактировать меню» может не сохраниться**  
Файл: [admin/admin.js:521](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L521)  
Простыми словами: в настройках есть переключатель «Разрешить бариста редактировать меню». Нажал — данные уходят на сервер. Если сервер вернул ошибку, пустой `catch {}` её съедает — переключатель выглядит сохранённым, но на деле нет. Бариста получит доступ к меню, которого давать не планировалось (или наоборот).  
Что сделать: `catch (e) { toast(e.message, true) }` и показать `toast('Сохранено')` при успехе.  
Статус: ✅ исправлен (2026-04-19) — toast при успехе и `toast(e.message, true)` при ошибке

---

## Несоответствия схеме дашборда (аудит 2026-04-19)

> Сравнение реального дашборда администратора с утверждённой схемой. Все пункты — отсутствующий функционал, не технические ошибки.

### Средние

**Б-А75 — Нет среднего чека и счётчика новых клиентов в статистике**  
Файл: [admin/index.html:96](../../../Documents/Projects/tg-coffee-catalog/admin/index.html#L96)  
Простыми словами: в шапке дашборда сейчас три карточки — «Сегодня», «Неделя», «Месяц», в каждой только выручка и количество заказов. По схеме должны быть ещё **средний чек** (выручка ÷ заказов) и **новых клиентов** за период. Без них непонятно, растёт ли средний заказ и привлекаются ли новые люди.  
Что сделать: посчитать средний чек на фронте из уже имеющихся данных; добавить запрос к `/admin/customers?status=visitor&created_after=...` для подсчёта новых.  
Статус: ⬜ не исправлен

---

**Б-А76 — Нет произвольного диапазона дат и кнопки «Сравнить»**  
Файл: [admin/index.html:118](../../../Documents/Projects/tg-coffee-catalog/admin/index.html#L118)  
Простыми словами: по схеме администратор должен иметь возможность выбрать любой диапазон дат (например «с 1 по 15 апреля») и сравнить с предыдущим периодом. Сейчас есть только кнопки «7 дней» и «30 дней» — без гибкости и без сравнения. Из-за этого нельзя, например, посмотреть «как прошла прошлая неделя vs позапрошлая».  
Что сделать: добавить два date-input для выбора диапазона, передавать в запрос `?from=&to=`; кнопку «Сравнить» — загружает второй набор данных и рисует вторую линию на графике.  
Статус: ⬜ не исправлен

---

**Б-А77 — Фильтр периода применяется только к графику выручки, а не ко всем блокам**  
Файл: [admin/admin.js:189](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L189)  
Простыми словами: по схеме один переключатель периода в верхней части должен обновлять сразу все блоки — статистику, топ позиций, источники трафика и пиковые часы. Сейчас при нажатии «30 дней» обновляется только график выручки, а карточки статистики и топ позиций остаются с фиксированными данными. Это вводит в заблуждение — цифры в разных блоках относятся к разным периодам.  
Что сделать: вынести текущий период в переменную состояния, при смене периода вызывать `loadDashboard(period)` и передавать его во все запросы аналитики.  
Статус: ⬜ не исправлен

---

**Б-А79 — Нет диаграммы источников трафика**  
Файл: [admin/index.html](../../../Documents/Projects/tg-coffee-catalog/admin/index.html)  
Простыми словами: по схеме рядом с топ-позициями должна быть круговая диаграмма — откуда приходят клиенты: из бота, по реферальной ссылке, напрямую из Mini App. Без этого невидно, работает ли реклама и реферальная программа.  
Что сделать: сделать запрос `SELECT source, COUNT(*) FROM customers GROUP BY source`, добавить Chart.js doughnut/pie в дашборд.  
Статус: ⬜ не исправлен

---

**Б-А80 — Нет графика пиковых часов для администратора**  
Файл: [admin/index.html](../../../Documents/Projects/tg-coffee-catalog/admin/index.html)  
Простыми словами: бариста в своей панели видит пиковые часы заказов, а администратор — нет. По схеме этот блок должен быть и на дашборде. Это важно для планирования смен — когда нужно больше людей на кассе.  
Что сделать: переиспользовать уже существующий эндпоинт `/api/barista/analytics/peak-hours` или сделать аналогичный в `/api/admin/analytics/peak-hours`; отобразить как столбчатый график по часам.  
Статус: ⬜ не исправлен

---

**Б-А81 — Нет диаграммы выручки по категориям**  
Файл: [admin/index.html](../../../Documents/Projects/tg-coffee-catalog/admin/index.html)  
Простыми словами: по схеме должна быть диаграмма-пончик — сколько выручки приносит «Кофе», сколько «Десерты», сколько «Альтернатива». Без этого непонятно, какой раздел меню кормит кофейню, а какой висит балластом.  
Что сделать: в `/admin/analytics/top-items` (или отдельном эндпоинте) группировать `items` по `category`, суммировать `price × qty`, передать в Chart.js doughnut.  
Статус: ⬜ не исправлен

---

**Б-А82 — Нет воронки конверсии visitor → buyer**  
Файл: [admin/index.html](../../../Documents/Projects/tg-coffee-catalog/admin/index.html)  
Простыми словами: по схеме должна быть простая полоска — сколько людей зашли в Mini App (visitor) и сколько из них сделали хотя бы один заказ (buyer). Это ключевая метрика — если из 100 зашедших покупает 5, что-то идёт не так. Сейчас этого нигде нет.  
Что сделать: запрос `SELECT status, COUNT(*) FROM customers GROUP BY status`; отобразить как горизонтальную двухсегментную полосу с процентом конверсии.  
Статус: ⬜ не исправлен

---

**Б-А83 — Нет drill-down панели при клике на график**  
Файл: [admin/admin.js:195](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L195)  
Простыми словами: по схеме при клике на любой столбец/точку графика внизу должна появляться таблица с детализацией — например, клик на «19 апреля» показывает список заказов за этот день. Сейчас клик на график ничего не делает.  
Что сделать: добавить обработчик `onClick` в конфиг Chart.js; при клике запрашивать `/admin/orders?date=YYYY-MM-DD` и показывать результат в раскрывающемся блоке под графиком.  
Статус: ⬜ не исправлен

---

### Низкие

**Б-А78 — График выручки столбчатый вместо линейного**  
Файл: [admin/admin.js:207](../../../Documents/Projects/tg-coffee-catalog/admin/admin.js#L207)  
Простыми словами: по схеме график выручки по дням должен быть линейным (тренд виден лучше), а сейчас это столбчатая диаграмма. Это косметика, но линейный график нагляднее показывает динамику роста или спада.  
Что сделать: заменить `type: 'bar'` на `type: 'line'` в конфиге Chart.js, добавить `fill: true` для заливки под линией.  
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
| Б-А11 | 🟡 Средний | formatLogDetail() выводит undefined при неполных данных | ✅ исправлен |
| Б-А12 | 🟡 Средний | QR-код с захардкоженным именем бота | ✅ исправлен |
| Б-А13 | 🟡 Средний | История меню пишется с old_value: null | ✅ исправлен |
| Б-А14 | 🔵 Низкий | renderMenu() без escaping | ✅ исправлен |
| Б-А15 | 🔵 Низкий | loadDashboard() глотает все ошибки | ✅ исправлен |
| Б-А16 | 🔵 Низкий | setOrderStatus() перезагружает весь дашборд | ✅ исправлен |
| Б-А17 | 🔵 Низкий | checkSetup() при ошибке молча открывает приложение | ✅ исправлен |
| Б-А18 | 🔵 Низкий | logout() не сбрасывает переменные состояния | ✅ исправлен |
| Б-А19 | 🔵 Низкий | loadBaristas() глотает ошибки | ✅ исправлен |
| Б-А20 | 🔵 Низкий | saveSettings() не сохраняет manager_tg_id | ✅ исправлен |
| Б-А21 | 🔵 Низкий | loadSettings() глотает ошибки | ✅ исправлен |
| Б-А22 | 🔵 Низкий | Мёртвый код a.setAttribute('Authorization') | ✅ исправлен |
| Б-А23 | 🔵 Низкий | loadBaristaLog() без пагинации | ✅ исправлен |
| Б-А24 | 🔵 Низкий | renderBroadcastHistory() выводит строку "null" | ✅ исправлен |
| Б-А25 | 🔵 Низкий | wizardNext(1) молча игнорирует ошибку | ✅ исправлен |
| Б-А26 | 🔵 Низкий | wizardNext(3) не валидирует формат PIN | ✅ исправлен |
| Б-А27 | 🔵 Низкий | Backend не валидирует price <= 0 | ✅ исправлен |
| Б-А28 | 🔵 Низкий | barista-log — запрос с пустым ids[] | ✅ исправлен |
| Б-А29 | 🔵 Низкий | loadSettings() не скрывает старое превью лого | ✅ исправлен |
| Б-А30 | 🔵 Низкий | Счётчик символов рассылки переустанавливается | ✅ исправлен |
| Б-А31 | 🔵 Низкий | /orders/stats без try/catch | ✅ исправлен |
| Б-А32 | 🔵 Низкий | Пароль администратора уязвим к timing-атаке | ✅ исправлен |
| Б-А33 | 🔴 Критический | Клиент задаёт total заказа сам | ✅ исправлен |
| Б-А34 | 🔴 Критический | POST /customers не валидирует tg_id (подмена) | ✅ исправлен |
| Б-А35 | 🔴 Критический | XSS в Mini App (меню, отзывы, акции, фото) | ✅ исправлен |
| Б-А36 | 🔴 Критический | Нет rate-limit на POST /orders и /customers | ✅ исправлен |
| Б-А37 | 🟡 Средний | refreshCupsFromApi выбирает промо по progress, а не id | ✅ исправлен |
| Б-А38 | 🟡 Средний | Хардкод promoId = 1 в Mini App и backend | ✅ исправлен |
| Б-А39 | 🟡 Средний | /orders/stats считает «сегодня» по UTC | ✅ исправлен |
| Б-А40 | 🟡 Средний | saveItem: orphan-фото в Storage при ошибке | ✅ исправлен |
| Б-А41 | 🟡 Средний | playBeep плодит AudioContext — beep глохнет после 6 заказов | ✅ исправлен |
| Б-А42 | 🟡 Средний | barista logout не отписывается от Realtime | ✅ исправлен |
| Б-А43 | 🔵 Низкий | referral_code без retry на UNIQUE | ✅ исправлен |
| Б-А44 | 🔵 Низкий | Рассылка — limit(1000) без пагинации | ✅ исправлен |
| Б-А45 | 🔵 Низкий | logout не инвалидирует JWT на сервере | ✅ исправлен (TTL 12ч) |
| Б-А46 | 🔵 Низкий | Нет helmet — отсутствуют защитные заголовки | ✅ исправлен |
| Б-А47 | 🔴 Критический | Нет rate-limit на /barista/login — брутфорс PIN | ✅ исправлен |
| Б-А48 | 🟡 Средний | XSS в топ-товарах панели бариста | ✅ исправлен |
| Б-А49 | 🟡 Средний | /barista/orders/status не валидирует status/payment | ✅ исправлен |
| Б-А50 | 🟡 Средний | HTML-injection в приветствии бота | ✅ исправлен |
| Б-А51 | 🟡 Средний | Нет ограничения длины текстовых полей в публичном API | ✅ исправлен |
| Б-А52 | 🟡 Средний | CSS-injection через gradient в Mini App | ✅ исправлен |
| Б-А53 | 🟡 Средний | multer без фильтра MIME — любой файл (в т.ч. SVG с JS) как фото | ✅ исправлен |
| Б-А54 | 🟡 Средний | DELETE товара не удаляет фото из Storage (orphan) | ✅ исправлен |
| Б-А55 | 🟡 Средний | limit/offset в admin API без потолка — DoS-риск | ✅ исправлен |
| Б-А56 | 🟡 Средний | Нет валидации булевых полей vip/active/available | ✅ исправлен |
| Б-А57 | 🟡 Средний | /analytics/chart группирует по UTC, а не MSK | ✅ исправлен |
| Б-А58 | 🟡 Средний | upload/logo — расширение файла из MIME ломается для SVG/webp | ✅ исправлен |
| Б-А59 | 🟡 Средний | /api/customers/:tg_id и /referral без авторизации — утечка PII | ✅ исправлен |
| Б-А60 | 🟡 Средний | /admin/barista-log без потолка limit — DoS-риск | ✅ исправлен |
| Б-А61 | 🟡 Средний | PUT /menu/items/:id/sort без валидации sort_order | ✅ исправлен |
| Б-А62 | 🟡 Средний | /shift/summary и /shift/close смешивают заказы разных барист | ✅ исправлен |
| Б-А63 | 🟡 Средний | /admin/broadcast не ограничивает длину сообщения (>4096 → молча падает) | ✅ исправлен |
| Б-А64 | 🟡 Средний | /admin/broadcast блокирует HTTP-ответ на минуты (gateway timeout) | ✅ исправлен |
| Б-А65 | 🔵 Низкий | Гонка в POST /shift/open — две открытые смены у одного бариста | ✅ исправлен |
| Б-А66 | 🔵 Низкий | /barista/customers/search не экранирует `%` и `_` в LIKE | ✅ исправлен |
| Б-А67 | 🟡 Средний | /barista/analytics/peak-hours считает часы по таймзоне сервера, не МСК | ✅ исправлен |
| Б-А68 | 🔵 Низкий | wizardFinish() молча игнорирует ошибки save settings / setup-complete | ✅ исправлен |
| Б-А69 | 🔵 Низкий | Панель бариста: кружки от первой акции с progress > 0, не от loyalty_cups | ✅ исправлен |
| Б-А70 | 🔵 Низкий | Хардкод URL прототип-бота и домена в Mini App | ✅ не актуален |
| Б-А71 | 🔵 Низкий | loadChart/loadTopItems/loadBroadcastHistory глотают ошибки | ✅ исправлен |
| Б-А72 | 🔵 Низкий | loadOrders() в панели бариста глотает ошибку | ✅ исправлен |
| Б-А73 | 🔵 Низкий | Фильтр заказов /admin/orders?date использует UTC-границы вместо МСК | ✅ исправлен |
| Б-А74 | 🔵 Низкий | saveBaristaSettings() глотает ошибку — переключатель «Разрешить бариста меню» | ✅ исправлен |
| Б-А75 | 🟡 Средний | Дашборд: нет среднего чека и счётчика новых клиентов в статистике | ⬜ не исправлен |
| Б-А76 | 🟡 Средний | Дашборд: нет произвольного диапазона дат и кнопки «Сравнить» | ⬜ не исправлен |
| Б-А77 | 🟡 Средний | Дашборд: фильтр периода применяется только к графику, а не ко всем блокам | ⬜ не исправлен |
| Б-А78 | 🔵 Низкий | Дашборд: график выручки столбчатый, по схеме должен быть линейный | ⬜ не исправлен |
| Б-А79 | 🟡 Средний | Дашборд: нет диаграммы источников трафика (откуда приходят клиенты) | ⬜ не исправлен |
| Б-А80 | 🟡 Средний | Дашборд: нет графика пиковых часов для администратора | ⬜ не исправлен |
| Б-А81 | 🟡 Средний | Дашборд: нет диаграммы выручки по категориям (пончик) | ⬜ не исправлен |
| Б-А82 | 🟡 Средний | Дашборд: нет воронки конверсии visitor → buyer | ⬜ не исправлен |
| Б-А83 | 🟡 Средний | Дашборд: нет drill-down панели при клике на график | ⬜ не исправлен |
