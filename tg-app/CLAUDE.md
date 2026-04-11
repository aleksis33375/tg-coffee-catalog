# Telegram Mini App — Каталог кофейни

## Правило: отслеживание задач

После каждой выполненной задачи:
1. Отметить её как `[x]` в `../brief.md` (раздел «Поэкранный чеклист» или «Задачи v1.1»)
2. Показать пользователю полный актуальный список задач



Документация для разработки и поддержки проекта.

---

## Структура файлов

```
tg-app/
├── index.html        — точка входа, HTML-оболочка SPA (3 экрана)
├── style.css         — все стили: темы, карточки, анимации, адаптив
├── app.js            — вся логика: загрузка данных, навигация, Telegram SDK
├── data/
│   └── menu.json     — ВСЕ данные приложения: меню, категории, кофейня
└── CLAUDE.md         — этот файл
```

---

## Как работает навигация

Три экрана в одном HTML — переключаются CSS-классами:

```
.screen           — скрыт (translateX 100%, opacity 0)
.screen.active    — видим (translateX 0, opacity 1)
.screen.slide-exit — уходит влево (translateX -30%)
```

Переход вперёд (каталог → карточка → подтверждение):
- Старый экран получает `.slide-exit` и теряет `.active`
- Новый получает `.active`

Переход назад:
- Старый теряет `.active` и `.slide-exit` (уходит вправо по умолчанию)
- Новый получает `.active`

**Кнопка BackButton** — нативная кнопка Telegram (верхний левый угол).
Подключена через `tg.BackButton.onClick(handleBackButton)`.

**Кнопка MainButton** — нативная кнопка Telegram (нижняя полоса).
- На экране 2: текст «Записаться» → вызывает `openConfirm()`
- На экране 3: текст «Написать в Telegram» → вызывает `handleWriteToManager()`

---

## Как менять данные

### Сменить название и слоган кофейни

Открыть `data/menu.json`, секция `"cafe"`:

```json
"cafe": {
  "name": "Bona Coffee",
  "tagline": "Настоящий кофе рядом с тобой"
}
```

### Сменить Telegram-менеджера

Открыть `data/menu.json`, поле `"manager"`:

```json
"manager": "coffee_manager"
```

Вписать username без `@`. Это именно то, куда летит заявка при нажатии «Записаться».

### Добавить товар

В `data/menu.json` добавить объект в массив `"items"`:

```json
{
  "id": 16,
  "category": "Кофе",
  "name": "Название напитка",
  "price": 300,
  "description": "Описание 1–2 предложения. Что входит, объём.",
  "badge": "хит",
  "rating": "4.8",
  "review": "Цитата покупателя без кавычек",
  "emoji": "☕",
  "gradient": ["#начало_цвета", "#конец_цвета"]
}
```

`badge` — `"хит"`, `"новинка"` или `null` (без бейджа).
`gradient` — два hex-цвета для фона карточки. Подбирать под цвет напитка.
`emoji` — один символ, отображается поверх градиента.

### Добавить категорию

Добавить строку в `"categories"` (в нужном порядке — слева направо):

```json
"categories": ["Все", "Кофе", "Альтернатива", "Чай", "Десерты", "Новая категория"]
```

### Удалить товар

Удалить объект из `"items"`. ID должны оставаться уникальными.

---

## Как менять дизайн

Все цвета и размеры — в начале `style.css` в блоке `:root`:

```css
:root {
  --accent:      #2AABEE;   /* главный цвет (кнопки, табы, ссылки) */
  --price-color: #27AE60;   /* цвет цены */
  --badge-hit:   #E05C3A;   /* бейдж «Хит» */
  --badge-new:   #2AABEE;   /* бейдж «Новинка» */
  --radius-card: 16px;      /* скругление карточек */
  --gap:         12px;      /* отступ между карточками */
}
```

Telegram-цвета (`--tg-bg`, `--tg-text` и т.д.) лучше **не менять** —
они автоматически адаптируются под тему пользователя.

---

## Экраны — что где находится

### Экран 1: `#screen-catalog`
- `.catalog-header` — логотип, название, слоган
- `#category-tabs` — горизонтальные табы (генерируются в `app.js → renderTabs()`)
- `#catalog-grid` — сетка карточек (генерируются в `app.js → renderCards()`)

### Экран 2: `#screen-detail`
- `#detail-hero` — большое фото/градиент с эмоджи
- `#detail-badge-wrap` — бейдж «Хит»/«Новинка»
- `#detail-name`, `#detail-price` — название и цена
- `#detail-desc` — описание
- `#detail-review` — блок отзыва со звёздами

### Экран 3: `#screen-confirm`
- `.confirm-check` — анимированная SVG-галочка
- `#confirm-item-name`, `#confirm-item-price` — данные выбранного товара
- `.confirm-hint` — текст «Менеджер ответит...»

---

## Telegram SDK — что используется

| Метод | Где | Зачем |
|---|---|---|
| `tg.ready()` | старт | сообщить что загрузились |
| `tg.expand()` | старт | развернуть на весь экран |
| `tg.BackButton.show/hide()` | навигация | нативная кнопка «назад» |
| `tg.BackButton.onClick()` | навигация | обработчик кнопки «назад» |
| `tg.MainButton.show/hide()` | навигация | нативная кнопка внизу |
| `tg.MainButton.setText()` | навигация | менять текст кнопки |
| `tg.MainButton.onClick/offClick()` | навигация | подключать/отключать обработчик |
| `tg.HapticFeedback.impactOccurred()` | касания | тактильный отклик |
| `tg.HapticFeedback.selectionChanged()` | смена таба | лёгкий haptic |
| `tg.HapticFeedback.notificationOccurred()` | подтверждение | сигнал успеха |
| `tg.openTelegramLink()` | заявка | открыть чат с менеджером |
| `tg.themeParams` | стили | получить цвета темы |
| `tg.onEvent('themeChanged')` | стили | реагировать на смену темы |

---

## Тестирование

### В браузере (для разработки)

Открыть `tg-app/index.html` в браузере напрямую.

При открытии в браузере (не в Telegram) — автоматически инжектируются
вспомогательные кнопки (стрелка «назад» и кнопка внизу) для навигации.
Это только для разработки — в Telegram они не появятся.

### В Telegram

1. Создать бота через `@BotFather`
2. Включить Menu Button: `/setmenubutton` → выбрать бота → вставить URL приложения
3. Задеплоить `tg-app/` на HTTPS-хостинг (GitHub Pages, Vercel, Netlify)
4. В `@BotFather` → `Edit Bot` → `Edit Menu Button` → вставить URL
5. Открыть бота в Telegram → нажать кнопку → проверить

### Быстрый деплой на GitHub Pages

```bash
# В корне репозитория
git subtree push --prefix tg-coffee-catalog/tg-app origin gh-pages
```

URL будет: `https://<username>.github.io/<repo>/`

---

## Частые вопросы

**Q: Фото в карточках — как добавить реальные?**
Заменить поле `emoji` в menu.json на URL изображения, а в `createCardHTML()` в `app.js`
изменить рендер: вместо `<span>${item.emoji}</span>` использовать `<img src="${item.photo}">`.

**Q: Как добавить реальные фото в `card-img`?**
В `app.js` в функции `createCardHTML()` заменить:
```js
<span>${item.emoji}</span>
```
на:
```js
<img src="${item.photo}" alt="${item.name}" style="width:100%;height:100%;object-fit:cover;">
```
и добавить поле `"photo": "img/название.webp"` в каждый объект в menu.json.

**Q: Как изменить текст кнопки «Записаться»?**
В `app.js`, функция `openDetail()`:
```js
tg.MainButton.setText('Записаться'); // ← поменять здесь
```

**Q: Как добавить экран «О нас»?**
1. Добавить `<div id="screen-about" class="screen">` в `index.html`
2. Добавить кнопку в шапку каталога
3. В `app.js` вызвать `navigateTo('screen-about', 'forward')` по клику
