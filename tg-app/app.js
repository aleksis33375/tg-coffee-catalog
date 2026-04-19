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

// Адрес API — в продакшене заменить на адрес VPS (шаг 2)
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000/api'
  : '/api';

// Дефолтные стили карточек по категории (на случай если в БД нет поля)
const CATEGORY_DEFAULTS = {
  'Кофе':    { gradient: ['#5C3A21', '#C8813A'], emoji: '☕' },
  'Чай':     { gradient: ['#2D5A3D', '#57B374'], emoji: '🫖' },
  'Десерты': { gradient: ['#4A2060', '#9B59B6'], emoji: '🍰' },
};
const DEFAULT_GRADIENT = ['#333344', '#555566'];
const DEFAULT_EMOJI    = '☕';

// Экранирование пользовательских данных в HTML (против XSS)
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Безопасный URL для картинок: только http(s) и data:image, иначе пустая строка
function safeImageUrl(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (/^(https?:)?\/\//i.test(s) || /^data:image\//i.test(s) || s.startsWith('/')) {
    return s.replace(/["'\\\s]/g, encodeURIComponent);
  }
  return '';
}

// Состояние приложения — всё в одном объекте
const state = {
  menuData: null,           // загруженные данные из API
  tgId: null,               // Telegram user ID (строка)
  cupsProgress: 0,          // кружек накоплено (из БД)
  cupsPromoId: null,        // id акции loyalty_cups
  currentCategory: 'Кофе', // активная категория
  currentItem: null,        // выбранный товар (для экрана 2)
  currentScreen: 'catalog', // 'catalog' | 'detail' | 'confirm'
  cart: []                  // [{id, qty}]
};


/* ═══════════════════════════════════════════════════════
   ЗАГРУЗКА ДАННЫХ
   ═══════════════════════════════════════════════════════ */

async function loadMenu() {
  try {
    const res = await fetch(API_BASE + '/menu');
    if (!res.ok) throw new Error('Ошибка сервера');
    const { cafe, items, loyalty } = await res.json();

    // Строим список категорий из данных (сохраняем порядок первого появления)
    const cats = [...new Set(items.map(i => i.category).filter(Boolean))];

    // Б-А52: валидация hex-цвета — защита от CSS-инъекции в inline style
    // (админ мог сохранить строку вида `red;}</style><script>`)
    const isHexColor = (v) => typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)

    // Нормализуем поля товаров под формат приложения
    const normalizedItems = items.map(item => {
      const def = CATEGORY_DEFAULTS[item.category] || {};

      // gradient в Supabase может быть строкой JSON — парсим
      let gradient = def.gradient || DEFAULT_GRADIENT;
      if (Array.isArray(item.gradient)) {
        gradient = item.gradient;
      } else if (typeof item.gradient === 'string') {
        try { gradient = JSON.parse(item.gradient); } catch {}
      }
      // Б-А52: если что-то не hex — откатываемся к дефолту категории
      if (!Array.isArray(gradient) || gradient.length !== 2 || !isHexColor(gradient[0]) || !isHexColor(gradient[1])) {
        gradient = def.gradient || DEFAULT_GRADIENT;
      }

      return {
        ...item,
        photo:    item.photo_url || null,
        gradient,
        emoji:    item.emoji || def.emoji || DEFAULT_EMOJI,
      };
    });

    const staticPromos = getStaticPromos();
    // Б-А38: берём promo_id и порог из backend, а не хардкодим — акция может быть
    // пересоздана с другим id, или её может вообще не быть
    state.cupsPromoId = loyalty?.promo_id ?? null
    if (loyalty?.total_cups) state.cupsTotalCups = loyalty.total_cups

    state.menuData = {
      cafe: {
        name:    cafe.cafe_name || 'Hot Black Coffee',
        tagline: cafe.tagline   || '',
        address: cafe.address   || '',
      },
      categories: [...cats, 'Акции'],
      items: normalizedItems,
      promos: staticPromos,
    };

    await registerCustomer();
    await refreshCupsFromApi();
    initApp();
  } catch (err) {
    console.error('Ошибка загрузки меню:', err);
    showError('Не удалось загрузить меню. Попробуй перезапустить приложение.');
  }
}

// Статические промо (до шага 8 — реальные акции из БД)
function getStaticPromos() {
  return [{
    type: 'loyalty_cups',
    title: 'Кружка за кружкой',
    description: 'Купи 6 напитков — получи 7-й в подарок',
    totalCups: 6,
    items: ['Капучино', 'Латте', 'Американо', 'Флэт уайт'],
  }];
}

// Регистрация / обновление клиента при каждом заходе
async function registerCustomer() {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) return;

  state.tgId = String(user.id);

  // Без подписанного initData backend откажет (Б-А34)
  if (!tg?.initData) return;

  try {
    await fetch(API_BASE + '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        init_data: tg.initData,
        source:    'mini_app',
      }),
    });
  } catch {}
}

function showError(message) {
  const grid = document.getElementById('catalog-grid');
  grid.innerHTML = `
    <div style="grid-column:1/-1; padding:40px 16px; text-align:center; color:var(--tg-hint);">
      <div style="font-size:48px; margin-bottom:16px;">😔</div>
      <p>${escapeHtml(message)}</p>
    </div>`;
}


/* ═══════════════════════════════════════════════════════
   ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ
   Запускается после загрузки меню из API
   ═══════════════════════════════════════════════════════ */

function initApp() {
  const data = state.menuData;

  // Название и слоган кофейни из JSON
  document.getElementById('cafe-name').textContent = data.cafe.name;
  document.getElementById('cafe-tagline').textContent = data.cafe.tagline;

  // Рендерим табы и карточки
  renderTabs();
  renderCards();

  // Кнопка корзины — открывает экран подтверждения
  document.getElementById('cart-bar-btn')?.addEventListener('click', openConfirm);

  // Настраиваем BackButton Telegram (скрыт на главном)
  if (tg?.BackButton) {
    tg.BackButton.hide();
    tg.BackButton.onClick(handleBackButton);
  }

  // Онбординг → оффер при первом открытии
  showOnboardingIfNeeded();

  // Полоса «Поделиться с другом»
  document.getElementById('share-strip')?.addEventListener('click', handleShare);
}


/* ═══════════════════════════════════════════════════════
   КОРЗИНА
   ═══════════════════════════════════════════════════════ */

function cartGet(id) {
  return state.cart.find(i => i.id === id);
}

function cartAdd(id) {
  const entry = cartGet(id);
  if (entry) { entry.qty++; } else { state.cart.push({ id, qty: 1 }); }
  try { tg?.HapticFeedback?.impactOccurred('light'); } catch {}
  updateCardButton(id);
  updateDetailStepper();
  renderCartBar();
}

function cartDecrement(id) {
  const entry = cartGet(id);
  if (!entry) return;
  entry.qty--;
  if (entry.qty <= 0) state.cart = state.cart.filter(i => i.id !== id);
  try { tg?.HapticFeedback?.impactOccurred('light'); } catch {}
  updateCardButton(id);
  updateDetailStepper();
  renderCartBar();
}

function cartTotal() {
  return state.cart.reduce((sum, entry) => {
    const item = state.menuData.items.find(i => i.id === entry.id);
    return sum + (item ? item.price * entry.qty : 0);
  }, 0);
}

function cartCount() {
  return state.cart.reduce((sum, e) => sum + e.qty, 0);
}

function clearCart() {
  state.cart = [];
  renderCartBar();
  // Обновляем кнопки всех карточек в текущем виде
  document.querySelectorAll('.card').forEach(card => {
    const id = parseInt(card.dataset.id, 10);
    const btnArea = card.querySelector('.card-btn-area');
    if (btnArea) btnArea.innerHTML = cardButtonHTML(id);
  });
}

const CART_SPACER_ID = 'cart-bottom-spacer';

function renderCartBar() {
  const bar = document.getElementById('cart-bar');
  if (!bar) return;
  const count = cartCount();

  // Убираем старый спейсер при каждом вызове
  document.getElementById(CART_SPACER_ID)?.remove();

  // На экране подтверждения корзина скрыта — заказ уже показан там
  if (count === 0 || state.currentScreen === 'confirm') {
    bar.classList.remove('visible');
    // Сбрасываем оба способа отступа
    const container = document.getElementById('catalog-grid');
    if (container) container.style.paddingBottom = '';
    document.querySelector('.promo-cups-body')?.style.removeProperty('padding-bottom');
  } else {
    const plural = count === 1 ? 'позиция' : count < 5 ? 'позиции' : 'позиций';
    document.getElementById('cart-bar-count').textContent = `${count} ${plural}`;
    document.getElementById('cart-bar-price').textContent = `${cartTotal()} ₽`;
    bar.classList.add('visible');

    const container = document.getElementById('catalog-grid');
    if (container) {
      if (container.classList.contains('promo-list')) {
        // Flex-контейнер (Акции): DOM-спейсер — padding-bottom здесь ненадёжен в WebKit
        const spacer = document.createElement('div');
        spacer.id = CART_SPACER_ID;
        spacer.style.height = '96px';
        spacer.style.flexShrink = '0';
        container.appendChild(spacer);

        // Кнопки внутри карточки кружек — поднять выше cart bar
        const cupsBody = container.querySelector('.promo-cups-body');
        if (cupsBody) cupsBody.style.paddingBottom = '96px';
      } else {
        // CSS Grid (каталог): padding-bottom работает корректно, не ломает grid-layout
        container.style.paddingBottom = '96px';
      }
    }
  }
}

function cardButtonHTML(id) {
  const entry = cartGet(id);
  const qty = entry ? entry.qty : 0;
  if (qty === 0) {
    return `<button class="btn-cart-add" data-id="${id}">+ В корзину</button>`;
  }
  return `
    <div class="card-stepper">
      <button class="stepper-btn stepper-minus" data-id="${id}">−</button>
      <span class="stepper-qty">${qty}</span>
      <button class="stepper-btn stepper-plus" data-id="${id}">+</button>
    </div>`;
}

function updateCardButton(id) {
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  const btnArea = card.querySelector('.card-btn-area');
  if (btnArea) btnArea.innerHTML = cardButtonHTML(id);
}

function updateDetailStepper() {
  const item = state.currentItem;
  if (!item) return;
  const qty = cartGet(item.id)?.qty || 0;
  const el = document.getElementById('detail-qty');
  if (el) el.textContent = qty;
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

  // Единый обработчик кликов через делегирование (onclick — не накапливается при перерисовке)
  container.onclick = e => {
    if (e.target.closest('.btn-cart-add')) {
      const id = parseInt(e.target.closest('.btn-cart-add').dataset.id, 10);
      cartAdd(id);
      return;
    }
    if (e.target.closest('.stepper-plus')) {
      const id = parseInt(e.target.closest('.stepper-plus').dataset.id, 10);
      cartAdd(id);
      return;
    }
    if (e.target.closest('.stepper-minus')) {
      const id = parseInt(e.target.closest('.stepper-minus').dataset.id, 10);
      cartDecrement(id);
      return;
    }
    const card = e.target.closest('.card');
    if (card) openDetail(parseInt(card.dataset.id, 10));
  };

  // Появление + спейсер корзины
  requestAnimationFrame(() => {
    container.style.opacity = '1';
    container.style.transform = 'translateY(0)';
    renderCartBar(); // добавляет спейсер после рендера карточек
  });
}

function createCardHTML(item) {
  const gradient = `linear-gradient(135deg, ${item.gradient[0]}, ${item.gradient[1]})`;
  const safeName = escapeHtml(item.name);
  const safeVolume = escapeHtml(item.volume || '');
  const safeEmoji = escapeHtml(item.emoji || '');

  // Бейдж: хит / новинка
  let badgeHTML = '';
  if (item.badge) {
    badgeHTML = `<div class="badge badge-${item.badge === 'хит' ? 'hit' : 'new'}">${escapeHtml(item.badge)}</div>`;
  }

  // Фото или градиент+эмоджи
  const photoUrl = safeImageUrl(item.photo);
  const imgContent = photoUrl
    ? `<img src="${photoUrl}" alt="${safeName}" loading="lazy">`
    : `<span>${safeEmoji}</span>`;

  // Объём + цена: «300 мл — 220 ₽»
  const volumePart = item.volume ? `<span class="card-volume">${safeVolume}</span><span class="card-sep">&nbsp;–&nbsp;</span>` : '';
  const priceHTML = item.oldPrice
    ? `<div class="card-price-wrap">
         ${volumePart}<span class="card-price">${item.price} ₽</span>
         <span class="card-price-old">${item.oldPrice} ₽</span>
       </div>`
    : `<div class="card-price-wrap">
         ${volumePart}<span class="card-price">${item.price} ₽</span>
       </div>`;

  return `
    <article class="card" data-id="${item.id}" role="listitem" aria-label="${safeName}, ${item.price} ₽">
      <div class="card-img" style="background: ${gradient};" aria-hidden="true">
        ${badgeHTML}
        ${imgContent}
      </div>
      <div class="card-body">
        <div class="card-name">${safeName}</div>
        ${priceHTML}
        <div class="card-btn-area">${cardButtonHTML(item.id)}</div>
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

  // Кнопки кружек используют inline onclick — обработчики не нужны

  requestAnimationFrame(() => {
    container.style.opacity = '1';
    container.style.transform = 'translateY(0)';
    // Обновляем padding после смены класса контейнера
    renderCartBar();
  });
}

function renderPromoDiscount(promo) {
  const photosHTML = (promo.photos || []).map(src => {
    const safe = safeImageUrl(src);
    return safe ? `<img src="${safe}" alt="">` : '';
  }).join('');

  return `
    <div class="promo-card">
      <div class="promo-photos">
        ${photosHTML}
        <div class="promo-badge">Акция</div>
      </div>
      <div class="promo-body">
        <div class="promo-title"><span>−10%</span> на первый заказ<br>${escapeHtml(promo.subtitle)}</div>
        <p class="promo-desc">${escapeHtml(promo.description)}</p>
        <div class="promo-date">
          <div class="promo-date-dot"></div>
          ${escapeHtml(promo.dateLabel)}
        </div>
      </div>
    </div>`;
}

function renderPromoCups(promo) {
  const count        = getCupsCount();
  const needed       = promo.totalCups - 1; // 5 куплено → право на бесплатную
  const readyForFree = count === needed;     // ровно 5: пора отметить FREE-кружку
  const isFree       = count >= promo.totalCups; // 6: все кружки отмечены

  // Все кружки заполняются строго по порядку — каждая своим нажатием
  const cupsHTML = Array.from({ length: promo.totalCups }, (_, i) => {
    const isFreeCup = i === promo.totalCups - 1;
    const isFilled  = i < count; // заполняется только когда count > i
    return `
      <div class="cup ${isFilled ? 'filled' : ''} ${isFreeCup ? 'free-cup' : ''}">
        ${cupSVG()}
        <span class="cup-label">FREE</span>
      </div>`;
  }).join('');

  const remaining = needed - count;
  const declension = remaining === 1 ? 'кружку' : remaining < 5 ? 'кружки' : 'кружек';
  const statusText = isFree
    ? '🎉 Готово! Покажи этот экран бариста и сбрось счётчик.'
    : readyForFree
      ? '🎁 Твоя 6-я кружка бесплатна — отметь её!'
      : `Осталось ${remaining} ${declension} до бесплатной`;

  return `
    <div class="promo-card">
      <div class="promo-cups-body">
        <div class="promo-badge">Программа лояльности</div>
        <div class="promo-title">${escapeHtml(promo.title)}</div>
        <p class="promo-desc">${escapeHtml(promo.description)}</p>

        <div class="cups-row">${cupsHTML}</div>

        <div class="cups-status ${isFree || readyForFree ? 'ready' : ''}">${statusText}</div>

        ${state.tgId
          ? `<div class="cups-action">
               <button class="btn-cup-add" onclick="refreshCupsFromApi()">↻ Обновить</button>
             </div>
             <p class="promo-items-hint">Бариста начислит кружку при заказе</p>`
          : `<p class="promo-items-hint">Открой через Telegram чтобы видеть прогресс</p>`
        }
      </div>
    </div>`;
}

/* ── Счётчик кружек — загружается из API ── */

function getCupsCount() {
  return state.cupsProgress || 0;
}

async function refreshCupsFromApi() {
  if (!state.tgId || !state.cupsPromoId) return; // Б-А38: без акции не ищем progress
  try {
    const { progress } = await fetch(API_BASE + '/customers/' + state.tgId)
      .then(r => r.json())
      .then(d => {
        const cups = (d.progress || []).find(p => p.promo_id === state.cupsPromoId);
        return { progress: cups?.progress || 0 };
      });
    state.cupsProgress = progress;
    // Перерисовываем если вкладка Акции открыта
    if (state.currentCategory === 'Акции') {
      renderPromos(document.getElementById('catalog-grid'));
    }
  } catch {}
}


/* ═══════════════════════════════════════════════════════
   ОФФЕР ПРИ ПЕРВОМ ОТКРЫТИИ
   ═══════════════════════════════════════════════════════ */

const OFFER_KEY = 'hotblack_offer_seen';
const OFFER_URL = 'https://t.me/Prototip_Coffee_house_bot?start=from_app';

function showOfferIfNeeded() {
  if (localStorage.getItem(OFFER_KEY)) return; // уже видел — не показываем

  const modal = document.getElementById('offer-modal');
  if (!modal) return;

  modal.classList.remove('hidden');

  document.getElementById('offer-cta').onclick = () => {
    localStorage.setItem(OFFER_KEY, '1');
    dismissOffer();
    // Открываем бота через Telegram SDK или обычный браузер
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(OFFER_URL);
    } else {
      window.open(OFFER_URL, '_blank');
    }
  };

  document.getElementById('offer-skip').onclick = () => {
    localStorage.setItem(OFFER_KEY, '1');
    dismissOffer();
  };
}

function dismissOffer() {
  const modal = document.getElementById('offer-modal');
  if (!modal) return;
  modal.style.transition = 'opacity 0.25s ease';
  modal.style.opacity = '0';
  setTimeout(() => modal.classList.add('hidden'), 260);
}


/* ═══════════════════════════════════════════════════════
   ОНБОРДИНГ (первое открытие)
   ═══════════════════════════════════════════════════════ */

const ONBOARDING_KEY = 'hotblack_onboarding_seen';
const BOT_URL = 'https://tg-coffee-catalog.vercel.app/';

function showOnboardingIfNeeded() {
  if (localStorage.getItem(ONBOARDING_KEY)) {
    // Онбординг уже видел — сразу проверяем оффер
    showOfferIfNeeded();
    return;
  }

  const modal = document.getElementById('onboarding-modal');
  if (!modal) { showOfferIfNeeded(); return; }

  // Обращение по имени из Telegram
  const firstName = tg?.initDataUnsafe?.user?.first_name;
  if (firstName) {
    const nameEl = document.getElementById('onboarding-name');
    if (nameEl) nameEl.textContent = firstName;
  }

  modal.classList.remove('hidden');

  document.getElementById('onboarding-start').onclick = () => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    dismissOnboarding();
  };
}

function dismissOnboarding() {
  const modal = document.getElementById('onboarding-modal');
  if (!modal) { showOfferIfNeeded(); return; }
  modal.style.transition = 'opacity 0.25s ease';
  modal.style.opacity = '0';
  setTimeout(() => {
    modal.classList.add('hidden');
    showOfferIfNeeded();
  }, 260);
}


/* ═══════════════════════════════════════════════════════
   ПОДЕЛИТЬСЯ С ДРУГОМ
   ═══════════════════════════════════════════════════════ */

function handleShare() {
  try { tg?.HapticFeedback?.impactOccurred('light'); } catch {}

  const shareText = 'Заказывай кофе прямо в Telegram — без звонков и очередей!';

  // Приоритет 1: внутри Telegram Mini App — открываем диалог выбора контакта
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(
      `https://t.me/share/url?url=${encodeURIComponent(BOT_URL)}&text=${encodeURIComponent(shareText)}`
    );
    return;
  }

  // Приоритет 2: браузер — нативный Web Share API
  if (navigator.share) {
    navigator.share({ title: 'Hot Black Coffee', text: shareText, url: BOT_URL }).catch(() => {});
    return;
  }

  // Fallback: скопировать ссылку в буфер обмена
  navigator.clipboard?.writeText(BOT_URL).then(() => {
    alert('Ссылка скопирована!');
  }).catch(() => {
    alert(BOT_URL);
  });
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

  const safePhoto = safeImageUrl(item.photo);
  if (safePhoto) {
    // Реальное фото — через setProperty, CSS сам экранирует url()
    hero.style.backgroundImage = `url("${safePhoto}")`;
    hero.style.backgroundSize = 'cover';
    hero.style.backgroundPosition = 'center';
    hero.style.backgroundRepeat = 'no-repeat';
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
    ? `<div class="badge badge-${item.badge === 'хит' ? 'hit' : 'new'}">${escapeHtml(item.badge)}</div>`
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
    const stars = Math.max(0, Math.min(5, Math.round(parseFloat(item.rating))));
    reviewEl.innerHTML = `
      <div class="review-stars">
        ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}
        <span class="review-rating">${escapeHtml(item.rating)}</span>
      </div>
      <p class="review-text">«${escapeHtml(item.review)}»</p>`;
    reviewEl.style.display = '';
  } else {
    reviewEl.style.display = 'none';
  }

  // Прокручиваем тело к началу
  document.querySelector('.detail-body').scrollTop = 0;

  // Степпер — показываем текущее кол-во из корзины
  updateDetailStepper();
  document.getElementById('detail-minus').onclick = () => cartDecrement(item.id);
  document.getElementById('detail-plus').onclick  = () => cartAdd(item.id);

  // Показываем нативный BackButton Telegram
  if (tg?.BackButton) tg.BackButton.show();

  // MainButton — «← В меню»
  if (tg?.MainButton) {
    tg.MainButton.offClick(handleMainButton);
    tg.MainButton.offClick(handleSubmitOrder);
    tg.MainButton.setText('← В меню');
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
  if (cartCount() === 0) return;

  // Рендерим список позиций в корзине
  const listEl  = document.getElementById('confirm-cart-list');
  const totalEl = document.getElementById('confirm-total');

  listEl.innerHTML = state.cart.map(entry => {
    const item = state.menuData.items.find(i => i.id === entry.id);
    if (!item) return '';
    return `
      <div class="confirm-cart-item">
        <span class="confirm-cart-item-name">${escapeHtml(item.name)}</span>
        <span class="confirm-cart-item-qty">${entry.qty} шт</span>
        <span class="confirm-cart-item-price">${item.price * entry.qty} ₽</span>
      </div>`;
  }).join('');

  totalEl.innerHTML = `
    <span class="confirm-total-label">Итого</span>
    <span class="confirm-total-price">${cartTotal()} ₽</span>`;

  // Сбрасываем переключатель к «Самовывоз»
  initDeliveryToggle();

  // MainButton — «Оформить заказ»
  if (tg?.MainButton) {
    tg.MainButton.offClick(handleMainButton);
    tg.MainButton.offClick(handleSubmitOrder);
    tg.MainButton.setText('Оформить заказ');
    tg.MainButton.show();
    tg.MainButton.onClick(handleSubmitOrder);
  }

  if (tg?.BackButton) tg.BackButton.show();

  // Переход на экран 3
  navigateTo('screen-confirm', 'forward');
  // Скрываем полоску корзины — на экране подтверждения она не нужна
  renderCartBar();
}

function initDeliveryToggle() {
  // Сбрасываем поля
  document.getElementById('input-time').value = '';
  document.getElementById('input-address').value = '';

  // Активируем «Самовывоз» по умолчанию
  setDeliveryType('pickup');

  // Вешаем обработчики на табы
  document.querySelectorAll('.delivery-tab').forEach(btn => {
    btn.onclick = () => setDeliveryType(btn.dataset.type);
  });
}

function setDeliveryType(type) {
  document.querySelectorAll('.delivery-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  document.getElementById('field-address').classList.toggle('hidden', type !== 'delivery');
}

async function handleSubmitOrder() {
  if (cartCount() === 0) return;

  try { tg?.HapticFeedback?.notificationOccurred('success'); } catch {}

  // Без подписанного initData заказ отправить нельзя (Б-А34)
  if (!tg?.initData) {
    alert('Открой приложение через Telegram — в браузере заказ отправить нельзя.');
    return;
  }

  // Собираем позиции: id и qty — цену и name посчитает сервер (Б-А33)
  const items = state.cart.map(entry => ({ id: entry.id, qty: entry.qty }));

  // Данные доставки
  const isDelivery = document.querySelector('.delivery-tab[data-type="delivery"]')?.classList.contains('active');
  const time    = document.getElementById('input-time')?.value  || null;
  const address = document.getElementById('input-address')?.value?.trim() || null;

  // Блокируем кнопку на время запроса
  if (tg?.MainButton) { tg.MainButton.showProgress(); tg.MainButton.disable(); }
  const browserBtn = document.querySelector('.browser-main-btn');
  if (browserBtn) browserBtn.disabled = true;

  try {
    const res = await fetch(API_BASE + '/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        init_data:     tg.initData,
        items,
        delivery_type: isDelivery ? 'delivery' : 'pickup',
        delivery_time: time,
        comment:       address,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');

    clearCart();
    goBackToCatalog();
    showOrderSuccess(data.order_id);
  } catch (err) {
    console.error('Ошибка заказа:', err);
    try { tg?.HapticFeedback?.notificationOccurred('error'); } catch {}
    alert('Не удалось отправить заказ. Попробуй ещё раз.');
  } finally {
    if (tg?.MainButton) { tg.MainButton.hideProgress(); tg.MainButton.enable(); }
    if (browserBtn) browserBtn.disabled = false;
  }
}

function showOrderSuccess(orderId) {
  // Инжектируем стиль тоста если ещё нет
  if (!document.getElementById('order-toast-style')) {
    const s = document.createElement('style');
    s.id = 'order-toast-style';
    s.textContent = `
      .order-toast {
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px);
        background: #27ae60; color: #fff; padding: 12px 20px; border-radius: 12px;
        font-size: 15px; font-weight: 500; z-index: 9999; opacity: 0;
        transition: opacity 0.3s, transform 0.3s; white-space: nowrap; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      }
      .order-toast.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
    `;
    document.head.appendChild(s);
  }
  const toast = document.createElement('div');
  toast.className = 'order-toast';
  toast.textContent = orderId ? `✅ Заказ #${orderId} принят! Напишем когда будет готово.` : '✅ Заказ принят!';
  document.body.appendChild(toast);
  requestAnimationFrame(() => { requestAnimationFrame(() => toast.classList.add('visible')); });
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}


/* ═══════════════════════════════════════════════════════
   ОБРАБОТЧИКИ НАТИВНЫХ КНОПОК TELEGRAM
   ═══════════════════════════════════════════════════════ */

function handleMainButton() {
  // С любого экрана — назад в каталог
  if (state.currentScreen === 'detail' || state.currentScreen === 'confirm') {
    try { tg?.HapticFeedback?.impactOccurred('light'); } catch {}
    goBackToCatalog();
  }
}

function handleBackButton() {
  try { tg?.HapticFeedback?.impactOccurred('light'); } catch {}
  goBackToCatalog();
}

function goBackToCatalog() {
  if (tg?.MainButton) {
    tg.MainButton.hide();
    tg.MainButton.offClick(handleMainButton);
    tg.MainButton.offClick(handleSubmitOrder);
  }
  if (tg?.BackButton) tg.BackButton.hide();

  navigateTo('screen-catalog', 'back');
  state.currentItem = null;
  renderCartBar();
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
    const cartBar = document.getElementById('cart-bar');
    backBtn.classList.toggle('visible', screen !== 'catalog');

    if (screen === 'detail') {
      mainBtn.textContent = '← В меню';
      mainBtn.onclick = handleMainButton;
      mainBtn.classList.add('visible');
      // Cart bar — над синей кнопкой (высота browser-main-btn ~54px + зазор)
      if (cartBar) cartBar.style.setProperty('--cart-bar-bottom', '70px');
    } else if (screen === 'confirm') {
      mainBtn.textContent = 'Оформить заказ';
      mainBtn.onclick = handleSubmitOrder;
      mainBtn.classList.add('visible');
      // На confirm cart bar скрыт через renderCartBar — ничего не делаем
    } else {
      mainBtn.classList.remove('visible');
      if (cartBar) cartBar.style.removeProperty('--cart-bar-bottom');
    }

    // Обновляем состояние cart bar после смены экрана
    renderCartBar();
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
