/* ═══════════════════════════════════════════════════════
   ИНИЦИАЛИЗАЦИЯ TELEGRAM MINI APP
   ═══════════════════════════════════════════════════════ */

// Получаем объект Telegram WebApp — главный SDK
const tg = window.Telegram?.WebApp;

// Сообщаем Telegram, что приложение готово к работе
if (tg) {
  tg.ready();
  tg.expand(); // разворачиваем на весь экран сразу
}

// Состояние приложения — всё в одном объекте
const state = {
  menuData: null,          // загруженные данные из menu.json
  currentCategory: 'Кофе', // активная категория
  currentItem: null,       // выбранный товар (для экрана 2 и 3)
  currentScreen: 'catalog' // 'catalog' | 'detail' | 'confirm'
};


/* ═══════════════════════════════════════════════════════
   ЗАГРУЗКА ДАННЫХ
   ═══════════════════════════════════════════════════════ */

async function loadMenu() {
  try {
    const response = await fetch('data/menu.json');
    if (!response.ok) throw new Error('Не удалось загрузить меню');
    state.menuData = await response.json();
    initApp();
  } catch (err) {
    console.error('Ошибка загрузки меню:', err);
    showError('Не удалось загрузить меню. Попробуй перезапустить приложение.');
  }
}

function showError(message) {
  const grid = document.getElementById('catalog-grid');
  grid.innerHTML = `
    <div style="grid-column:1/-1; padding:40px 16px; text-align:center; color:var(--tg-hint);">
      <div style="font-size:48px; margin-bottom:16px;">😔</div>
      <p>${message}</p>
    </div>`;
}


/* ═══════════════════════════════════════════════════════
   ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ
   Запускается после загрузки menu.json
   ═══════════════════════════════════════════════════════ */

function initApp() {
  const data = state.menuData;

  // Название и слоган кофейни из JSON
  document.getElementById('cafe-name').textContent = data.cafe.name;
  document.getElementById('cafe-tagline').textContent = data.cafe.tagline;

  // Рендерим табы и карточки
  renderTabs();
  renderCards();

  // Настраиваем BackButton Telegram (скрыт на главном)
  if (tg?.BackButton) {
    tg.BackButton.hide();
    tg.BackButton.onClick(handleBackButton);
  }
}


/* ═══════════════════════════════════════════════════════
   РЕНДЕР ТАБОВ КАТЕГОРИЙ
   ═══════════════════════════════════════════════════════ */

function renderTabs() {
  const container = document.getElementById('category-tabs');
  container.innerHTML = '';

  state.menuData.categories.forEach(category => {
    const tab = document.createElement('button');
    tab.className = 'tab' + (category === state.currentCategory ? ' active' : '');
    tab.textContent = category;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', category === state.currentCategory);
    tab.addEventListener('click', () => selectCategory(category));
    container.appendChild(tab);
  });
}

function selectCategory(category) {
  if (category === state.currentCategory) return;

  // Лёгкий haptic при смене таба
  tg?.HapticFeedback?.selectionChanged();

  state.currentCategory = category;

  // Обновляем активный таб
  document.querySelectorAll('.tab').forEach(tab => {
    const isActive = tab.textContent === category;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive);
  });

  renderCards();
}


/* ═══════════════════════════════════════════════════════
   РЕНДЕР КАРТОЧЕК ТОВАРОВ
   ═══════════════════════════════════════════════════════ */

function renderCards() {
  const container = document.getElementById('catalog-grid');

  // Вкладка «Акции» — отдельный рендер
  if (state.currentCategory === 'Акции') {
    renderPromos(container);
    return;
  }

  // Фильтруем по категории
  const items = state.currentCategory === 'Все'
    ? state.menuData.items
    : state.menuData.items.filter(item => item.category === state.currentCategory);

  // Анимация: скрываем → обновляем → показываем
  container.style.opacity = '0';
  container.style.transform = 'translateY(8px)';
  container.style.transition = 'opacity 0.18s, transform 0.18s';

  // Восстанавливаем класс сетки (если до этого была вкладка «Акции»)
  container.className = 'catalog-grid';

  container.innerHTML = items.map(item => createCardHTML(item)).join('');

  // Навешиваем обработчики на кнопки
  container.querySelectorAll('.btn-select').forEach(btn => {
    const id = parseInt(btn.dataset.id, 10);
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // не открываем карточку при клике на кнопку
      openDetail(id);
    });
  });

  // Клик по самой карточке тоже открывает детали
  container.querySelectorAll('.card').forEach(card => {
    const id = parseInt(card.dataset.id, 10);
    card.addEventListener('click', () => openDetail(id));
  });

  // Появление
  requestAnimationFrame(() => {
    container.style.opacity = '1';
    container.style.transform = 'translateY(0)';
  });
}

function createCardHTML(item) {
  const gradient = `linear-gradient(135deg, ${item.gradient[0]}, ${item.gradient[1]})`;

  // Бейдж: акция — отдельный стиль, хит/новинка — стандартный
  let badgeHTML = '';
  if (item.badge === 'акция' && item.promoLabel) {
    badgeHTML = `<div class="badge badge-promo">${item.promoLabel}</div>`;
  } else if (item.badge) {
    badgeHTML = `<div class="badge badge-${item.badge === 'хит' ? 'hit' : 'new'}">${item.badge}</div>`;
  }

  // Фото или градиент+эмоджи
  const imgContent = item.photo
    ? `<img src="${item.photo}" alt="${item.name}" loading="lazy">`
    : `<span>${item.emoji}</span>`;

  // Цена: если есть старая — показываем зачёркнутую
  const priceHTML = item.oldPrice
    ? `<div class="card-price-wrap">
         <span class="card-price">${item.price} ₽</span>
         <span class="card-price-old">${item.oldPrice} ₽</span>
       </div>`
    : `<div class="card-price">${item.price} ₽</div>`;

  return `
    <article class="card" data-id="${item.id}" role="listitem" aria-label="${item.name}, ${item.price} ₽">
      <div class="card-img" style="background: ${gradient};" aria-hidden="true">
        ${badgeHTML}
        ${imgContent}
      </div>
      <div class="card-body">
        <div class="card-name">${item.name}</div>
        ${priceHTML}
        <button class="btn-select" data-id="${item.id}" aria-label="Выбрать ${item.name}">
          Выбрать
        </button>
      </div>
    </article>`;
}


/* ═══════════════════════════════════════════════════════
   РЕНДЕР АКЦИЙ
   ═══════════════════════════════════════════════════════ */

// SVG кружки в стиле скетча
function cupSVG() {
  return `<svg class="cup-svg" viewBox="0 0 50 58" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path class="cup-rim" d="M6 13 Q25 9 44 13" stroke-linecap="round"/>
    <path class="cup-body" d="M6 13 L11 52 Q25 55 39 52 L44 13 Z" stroke-linejoin="round"/>
    <path class="cup-handle" d="M39 22 Q52 22 52 33 Q52 44 39 44" stroke-linecap="round"/>
  </svg>`;
}

function renderPromos(container) {
  const promos = state.menuData.promos || [];

  // Меняем класс контейнера на promo-list
  container.className = 'promo-list';
  container.style.opacity = '0';
  container.style.transform = 'translateY(8px)';
  container.style.transition = 'opacity 0.18s, transform 0.18s';

  container.innerHTML = promos.map(promo => {
    if (promo.type === 'discount_first') return renderPromoDiscount(promo);
    if (promo.type === 'loyalty_cups')  return renderPromoCups(promo);
    return '';
  }).join('');

  // Навешиваем обработчики на кнопки кружек
  const btnAdd   = container.querySelector('.btn-cup-add');
  const btnReset = container.querySelector('.btn-cup-reset');
  if (btnAdd)   btnAdd.addEventListener('click',   addCup);
  if (btnReset) btnReset.addEventListener('click', resetCups);

  requestAnimationFrame(() => {
    container.style.opacity = '1';
    container.style.transform = 'translateY(0)';
  });
}

function renderPromoDiscount(promo) {
  const photosHTML = promo.photos.map(src =>
    `<img src="${src}" alt="">`
  ).join('');

  return `
    <div class="promo-card">
      <div class="promo-photos">
        ${photosHTML}
        <div class="promo-badge">Акция</div>
      </div>
      <div class="promo-body">
        <div class="promo-title"><span>−10%</span> на первый заказ<br>${promo.subtitle}</div>
        <p class="promo-desc">${promo.description}</p>
        <div class="promo-date">
          <div class="promo-date-dot"></div>
          ${promo.dateLabel}
        </div>
      </div>
    </div>`;
}

function renderPromoCups(promo) {
  const count = getCupsCount();           // 0–5: сколько уже куплено
  const isFree = count >= promo.totalCups - 1; // 5 куплено → 6-я бесплатна

  // Генерируем 6 кружек
  const cupsHTML = Array.from({ length: promo.totalCups }, (_, i) => {
    const isFreeCup = i === promo.totalCups - 1;
    const isFilled  = isFreeCup ? isFree : i < count;
    return `
      <div class="cup ${isFilled ? 'filled' : ''} ${isFreeCup ? 'free-cup' : ''}">
        ${cupSVG()}
        <span class="cup-label">FREE</span>
      </div>`;
  }).join('');

  const statusText = isFree
    ? '🎉 Твоя 6-я кружка бесплатно! Покажи бариста.'
    : `Осталось ${promo.totalCups - 1 - count} кружки до бесплатной`;

  return `
    <div class="promo-card">
      <div class="promo-cups-body">
        <div class="promo-badge">Программа лояльности</div>
        <div class="promo-title">${promo.title}</div>
        <p class="promo-desc">${promo.description}</p>

        <div class="cups-row">${cupsHTML}</div>

        <div class="cups-status ${isFree ? 'ready' : ''}">${statusText}</div>

        <div class="cups-action">
          <button class="btn-cup-add" ${isFree ? 'disabled style="opacity:0.5"' : ''}>
            ${isFree ? '🎁 Забери бесплатную!' : '☕ Отметить кружку'}
          </button>
          <button class="btn-cup-reset" title="Сбросить">↺</button>
        </div>

        <p class="promo-items-hint">Участвуют: ${promo.items.join(', ')}</p>
      </div>
    </div>`;
}

/* ── Логика счётчика кружек (хранится в localStorage) ── */

const CUPS_KEY = 'hotblack_cups_count';

function getCupsCount() {
  return parseInt(localStorage.getItem(CUPS_KEY) || '0', 10);
}

function addCup() {
  const count = getCupsCount();
  const total = state.menuData.promos.find(p => p.type === 'loyalty_cups')?.totalCups || 6;

  if (count >= total - 1) return; // уже готово — ждём списания

  tg?.HapticFeedback?.impactOccurred('medium');
  localStorage.setItem(CUPS_KEY, count + 1);

  // Перерисовываем промо
  const container = document.getElementById('catalog-grid');
  renderPromos(container);
}

function resetCups() {
  tg?.HapticFeedback?.impactOccurred('light');

  if (tg?.showConfirm) {
    tg.showConfirm('Сбросить счётчик кружек?', (confirmed) => {
      if (confirmed) { localStorage.setItem(CUPS_KEY, '0'); renderPromos(document.getElementById('catalog-grid')); }
    });
  } else {
    // Fallback для браузера
    if (confirm('Сбросить счётчик кружек?')) {
      localStorage.setItem(CUPS_KEY, '0');
      renderPromos(document.getElementById('catalog-grid'));
    }
  }
}


/* ═══════════════════════════════════════════════════════
   НАВИГАЦИЯ МЕЖДУ ЭКРАНАМИ
   ═══════════════════════════════════════════════════════ */

/**
 * Переход между экранами.
 * fromId — ID текущего экрана, toId — ID следующего.
 * direction: 'forward' | 'back'
 */
function navigateTo(toId, direction = 'forward') {
  const currentId = `screen-${state.currentScreen}`;
  const from = document.getElementById(currentId);
  const to   = document.getElementById(toId);

  if (!from || !to || from === to) return;

  if (direction === 'forward') {
    // Текущий уходит влево, новый приходит справа
    from.classList.add('slide-exit');
    from.classList.remove('active');
    from.setAttribute('aria-hidden', 'true');

    to.classList.remove('slide-exit');
    to.classList.add('active');
    to.setAttribute('aria-hidden', 'false');

    // Убираем класс slide-exit после анимации
    setTimeout(() => from.classList.remove('slide-exit'), 300);
  } else {
    // Назад: новый приходит слева (убираем slide-exit), текущий уходит вправо
    from.classList.remove('active', 'slide-exit');
    from.setAttribute('aria-hidden', 'true');

    to.classList.remove('slide-exit');
    to.classList.add('active');
    to.setAttribute('aria-hidden', 'false');
  }

  // Обновляем состояние
  state.currentScreen = toId.replace('screen-', '');
}


/* ═══════════════════════════════════════════════════════
   ЭКРАН 2: ОТКРЫТИЕ КАРТОЧКИ ТОВАРА
   ═══════════════════════════════════════════════════════ */

function openDetail(itemId) {
  const item = state.menuData.items.find(i => i.id === itemId);
  if (!item) return;

  state.currentItem = item;

  // Haptic — тактильный отклик при открытии
  tg?.HapticFeedback?.impactOccurred('light');

  // Заполняем данные
  const gradient = `linear-gradient(135deg, ${item.gradient[0]}, ${item.gradient[1]})`;
  const hero = document.getElementById('detail-hero');
  const emojiEl = document.getElementById('detail-emoji');

  if (item.photo) {
    // Реальное фото — на весь блок, эмоджи скрываем
    hero.style.background = `url('${item.photo}') center/cover no-repeat`;
    emojiEl.textContent = '';
    emojiEl.style.display = 'none';
  } else {
    // Градиент + эмоджи как fallback
    hero.style.background = gradient;
    emojiEl.style.display = '';
    emojiEl.textContent = item.emoji;
  }

  // Бейдж на детальной карточке
  const badgeWrap = document.getElementById('detail-badge-wrap');
  badgeWrap.innerHTML = item.badge
    ? `<div class="badge badge-${item.badge === 'хит' ? 'hit' : 'new'}">${item.badge}</div>`
    : '';

  document.getElementById('detail-name').textContent = item.name;
  const detailPrice = document.getElementById('detail-price');
  if (item.oldPrice) {
    detailPrice.innerHTML = `<span class="detail-price-new">${item.price} ₽</span><span class="detail-price-old">${item.oldPrice} ₽</span>`;
  } else {
    detailPrice.textContent = `${item.price} ₽`;
  }
  document.getElementById('detail-desc').textContent = item.description;

  // Отзыв
  const reviewEl = document.getElementById('detail-review');
  if (item.review && item.rating) {
    const stars = Math.round(parseFloat(item.rating));
    reviewEl.innerHTML = `
      <div class="review-stars">
        ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}
        <span class="review-rating">${item.rating}</span>
      </div>
      <p class="review-text">«${item.review}»</p>`;
    reviewEl.style.display = '';
  } else {
    reviewEl.style.display = 'none';
  }

  // Прокручиваем тело к началу
  document.querySelector('.detail-body').scrollTop = 0;

  // Показываем нативный BackButton Telegram
  if (tg?.BackButton) tg.BackButton.show();

  // Показываем нативный MainButton «Записаться»
  if (tg?.MainButton) {
    tg.MainButton.setText('Записаться');
    tg.MainButton.show();
    tg.MainButton.onClick(handleMainButton);
  }

  // Переход на экран 2
  navigateTo('screen-detail', 'forward');
}


/* ═══════════════════════════════════════════════════════
   ЭКРАН 3: ПОДТВЕРЖДЕНИЕ И ПЕРЕХОД В ЧАТ
   ═══════════════════════════════════════════════════════ */

function openConfirm() {
  const item = state.currentItem;
  if (!item) return;

  // Заполняем данные на экране подтверждения
  document.getElementById('confirm-item-name').textContent = item.name;
  document.getElementById('confirm-item-price').textContent = `${item.price} ₽`;

  // MainButton меняем на «Написать в Telegram»
  if (tg?.MainButton) {
    tg.MainButton.offClick(handleMainButton);
    tg.MainButton.setText('Написать в Telegram');
    tg.MainButton.onClick(handleWriteToManager);
  }

  // Переход на экран 3
  navigateTo('screen-confirm', 'forward');
}

function handleWriteToManager() {
  const item = state.currentItem;
  if (!item) return;

  // Haptic — подтверждение действия
  tg?.HapticFeedback?.notificationOccurred('success');

  // Формируем текст заявки
  const managerUsername = state.menuData.manager;
  const text = `Хочу записаться на «${item.name}» (${item.price} ₽)`;
  const encodedText = encodeURIComponent(text);
  const url = `https://t.me/${managerUsername}?text=${encodedText}`;

  // Открываем чат с менеджером внутри Telegram
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(url);
  } else {
    // Fallback для браузера (при разработке)
    window.open(url, '_blank');
  }
}


/* ═══════════════════════════════════════════════════════
   ОБРАБОТЧИКИ НАТИВНЫХ КНОПОК TELEGRAM
   ═══════════════════════════════════════════════════════ */

function handleMainButton() {
  // С экрана 2 — переходим на экран 3 (подтверждение)
  if (state.currentScreen === 'detail') {
    tg?.HapticFeedback?.impactOccurred('medium');
    openConfirm();
  }
}

function handleBackButton() {
  tg?.HapticFeedback?.impactOccurred('light');

  if (state.currentScreen === 'detail') {
    // Назад к каталогу
    goBackToCatalog();
  } else if (state.currentScreen === 'confirm') {
    // Назад к карточке товара
    goBackToDetail();
  }
}

function goBackToCatalog() {
  // Скрываем MainButton и BackButton
  if (tg?.MainButton) {
    tg.MainButton.hide();
    tg.MainButton.offClick(handleMainButton);
  }
  if (tg?.BackButton) tg.BackButton.hide();

  navigateTo('screen-catalog', 'back');
  state.currentItem = null;
}

function goBackToDetail() {
  // Возвращаем MainButton «Записаться»
  if (tg?.MainButton) {
    tg.MainButton.offClick(handleWriteToManager);
    tg.MainButton.setText('Записаться');
    tg.MainButton.onClick(handleMainButton);
    tg.MainButton.show();
  }

  navigateTo('screen-detail', 'back');
}


/* ═══════════════════════════════════════════════════════
   FALLBACK ДЛЯ ПРЕВЬЮ В БРАУЗЕРЕ
   Когда открываем не в Telegram, кнопки Telegram недоступны —
   рендерим нативную кнопку «Записаться» внутри страницы.
   ═══════════════════════════════════════════════════════ */

function isTelegramContext() {
  return !!(tg && tg.initData);
}

function setupBrowserFallback() {
  if (isTelegramContext()) return; // в Telegram — не нужно

  // Кнопка «Назад» в браузере
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' || e.key === 'Backspace') handleBackButton();
  });

  // Предупреждение в консоли
  console.info(
    '%c[TMA Fallback] Приложение открыто в браузере, не в Telegram.\n' +
    'BackButton и MainButton недоступны. Используй реальное устройство для теста.',
    'color: #2AABEE; font-weight: bold;'
  );

  // Добавляем видимые кнопки для тестирования в браузере
  injectBrowserControls();
}

function injectBrowserControls() {
  const style = document.createElement('style');
  style.textContent = `
    .browser-back-btn {
      position: fixed;
      top: 12px; left: 12px;
      z-index: 9999;
      background: rgba(255,255,255,0.92);
      border: none;
      border-radius: 50%;
      width: 44px; height: 44px;
      font-size: 20px;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      color: #000;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .browser-back-btn:active {
      transform: scale(0.92);
      box-shadow: 0 1px 4px rgba(0,0,0,0.15);
    }
    .browser-back-btn.visible { display: flex; }
    .browser-main-btn {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 9998;
      background: var(--accent);
      color: #fff;
      border: none;
      padding: 16px;
      font-size: 17px;
      font-weight: 600;
      cursor: pointer;
      display: none;
    }
    .browser-main-btn.visible { display: block; }
  `;
  document.head.appendChild(style);

  // Кнопка назад
  const backBtn = document.createElement('button');
  backBtn.className = 'browser-back-btn';
  backBtn.innerHTML = '←';
  backBtn.title = 'Назад';
  backBtn.addEventListener('click', handleBackButton);
  document.body.appendChild(backBtn);

  // Кнопка действия
  const mainBtn = document.createElement('button');
  mainBtn.className = 'browser-main-btn';
  mainBtn.textContent = 'Записаться';
  document.body.appendChild(mainBtn);

  // Синхронизируем видимость с экранами
  const origNavigate = navigateTo;
  window.navigateTo = function(toId, dir) {
    origNavigate(toId, dir);
    const screen = toId.replace('screen-', '');
    backBtn.classList.toggle('visible', screen !== 'catalog');
    mainBtn.classList.toggle('visible', screen === 'detail' || screen === 'confirm');

    if (screen === 'detail') {
      mainBtn.textContent = 'Записаться';
      mainBtn.onclick = handleMainButton;
    } else if (screen === 'confirm') {
      mainBtn.textContent = 'Написать в Telegram';
      mainBtn.onclick = handleWriteToManager;
    }
  };
}


/* ═══════════════════════════════════════════════════════
   СТАРТ
   ═══════════════════════════════════════════════════════ */

// Подстраховка: если Telegram передал тему — применяем
if (tg?.themeParams) {
  const p = tg.themeParams;
  const root = document.documentElement.style;
  if (p.bg_color)          root.setProperty('--tg-theme-bg-color',          p.bg_color);
  if (p.text_color)        root.setProperty('--tg-theme-text-color',        p.text_color);
  if (p.hint_color)        root.setProperty('--tg-theme-hint-color',        p.hint_color);
  if (p.section_bg_color)  root.setProperty('--tg-theme-section-bg-color',  p.section_bg_color);
  if (p.button_color)      root.setProperty('--tg-theme-button-color',      p.button_color);
  if (p.button_text_color) root.setProperty('--tg-theme-button-text-color', p.button_text_color);
}

// Слушаем смену темы в реальном времени (пользователь переключил тему)
if (tg) {
  tg.onEvent('themeChanged', () => {
    const p = tg.themeParams;
    const root = document.documentElement.style;
    if (p.bg_color)         root.setProperty('--tg-theme-bg-color',         p.bg_color);
    if (p.text_color)       root.setProperty('--tg-theme-text-color',       p.text_color);
    if (p.hint_color)       root.setProperty('--tg-theme-hint-color',       p.hint_color);
    if (p.section_bg_color) root.setProperty('--tg-theme-section-bg-color', p.section_bg_color);
  });
}

// Fallback для браузера
setupBrowserFallback();

// Загружаем меню и запускаем
loadMenu();
