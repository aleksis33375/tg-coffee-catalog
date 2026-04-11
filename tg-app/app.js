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
  currentItem: null,       // выбранный товар (для экрана 2)
  currentScreen: 'catalog', // 'catalog' | 'detail' | 'confirm'
  cart: []                 // [{id, qty}]
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

  // Бейдж: хит / новинка
  let badgeHTML = '';
  if (item.badge) {
    badgeHTML = `<div class="badge badge-${item.badge === 'хит' ? 'hit' : 'new'}">${item.badge}</div>`;
  }

  // Фото или градиент+эмоджи
  const imgContent = item.photo
    ? `<img src="${item.photo}" alt="${item.name}" loading="lazy">`
    : `<span>${item.emoji}</span>`;

  // Объём + цена: «300 мл — 220 ₽»
  const volumePart = item.volume ? `<span class="card-volume">${item.volume}</span><span class="card-sep">&nbsp;–&nbsp;</span>` : '';
  const priceHTML = item.oldPrice
    ? `<div class="card-price-wrap">
         ${volumePart}<span class="card-price">${item.price} ₽</span>
         <span class="card-price-old">${item.oldPrice} ₽</span>
       </div>`
    : `<div class="card-price-wrap">
         ${volumePart}<span class="card-price">${item.price} ₽</span>
       </div>`;

  return `
    <article class="card" data-id="${item.id}" role="listitem" aria-label="${item.name}, ${item.price} ₽">
      <div class="card-img" style="background: ${gradient};" aria-hidden="true">
        ${badgeHTML}
        ${imgContent}
      </div>
      <div class="card-body">
        <div class="card-name">${item.name}</div>
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

  // Навешиваем обработчики на кнопки кружек (onclick — не накапливается при перерисовке)
  const btnAdd   = container.querySelector('.btn-cup-add');
  const btnReset = container.querySelector('.btn-cup-reset');
  if (btnAdd)   btnAdd.onclick = addCup;
  if (btnReset) btnReset.onclick = resetCups;

  requestAnimationFrame(() => {
    container.style.opacity = '1';
    container.style.transform = 'translateY(0)';
    // Обновляем padding после смены класса контейнера
    renderCartBar();
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

  const btnDisabled = isFree ? 'disabled style="opacity:0.5"' : '';
  const btnText     = isFree       ? '✓ Готово'
                    : readyForFree ? '🎁 Отметить бесплатную'
                    :                '☕ Отметить кружку';

  return `
    <div class="promo-card">
      <div class="promo-cups-body">
        <div class="promo-badge">Программа лояльности</div>
        <div class="promo-title">${promo.title}</div>
        <p class="promo-desc">${promo.description}</p>

        <div class="cups-row">${cupsHTML}</div>

        <div class="cups-action">
          <button class="btn-cup-add" ${btnDisabled}>${btnText}</button>
          <button class="btn-cup-reset" title="Сбросить">↺</button>
        </div>

        <div class="cups-status ${isFree || readyForFree ? 'ready' : ''}">${statusText}</div>

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

  if (count >= total) return; // все 6 кружек отмечены — ждём сброса

  tg?.HapticFeedback?.impactOccurred('medium');
  localStorage.setItem(CUPS_KEY, count + 1);

  // Перерисовываем промо
  const container = document.getElementById('catalog-grid');
  renderPromos(container);
}

function resetCups() {
  if (confirm('Сбросить счётчик кружек?')) {
    try { tg?.HapticFeedback?.impactOccurred('light'); } catch {}
    localStorage.setItem(CUPS_KEY, '0');
    renderPromos(document.getElementById('catalog-grid'));
  }
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

  // Степпер — показываем текущее кол-во из корзины
  updateDetailStepper();
  document.getElementById('detail-minus').onclick = () => cartDecrement(item.id);
  document.getElementById('detail-plus').onclick  = () => cartAdd(item.id);

  // Показываем нативный BackButton Telegram
  if (tg?.BackButton) tg.BackButton.show();

  // MainButton — «← В меню»
  if (tg?.MainButton) {
    tg.MainButton.offClick(handleMainButton);
    tg.MainButton.offClick(handleWriteToManager);
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
        <span class="confirm-cart-item-name">${item.name}</span>
        <span class="confirm-cart-item-qty">${entry.qty} шт</span>
        <span class="confirm-cart-item-price">${item.price * entry.qty} ₽</span>
      </div>`;
  }).join('');

  totalEl.innerHTML = `
    <span class="confirm-total-label">Итого</span>
    <span class="confirm-total-price">${cartTotal()} ₽</span>`;

  // Сбрасываем переключатель к «Самовывоз»
  initDeliveryToggle();

  // MainButton — «Написать в Telegram»
  if (tg?.MainButton) {
    tg.MainButton.offClick(handleMainButton);
    tg.MainButton.offClick(handleWriteToManager);
    tg.MainButton.setText('Написать в Telegram');
    tg.MainButton.show();
    tg.MainButton.onClick(handleWriteToManager);
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

function handleWriteToManager() {
  if (cartCount() === 0) return;

  // Haptic — подтверждение действия
  try { tg?.HapticFeedback?.notificationOccurred('success'); } catch {}

  // Собираем позиции заказа
  const lines = state.cart.map(entry => {
    const item = state.menuData.items.find(i => i.id === entry.id);
    return item ? `• ${item.name} × ${entry.qty} = ${item.price * entry.qty} ₽` : '';
  }).filter(Boolean);

  // Данные о доставке
  const isDelivery = document.querySelector('.delivery-tab[data-type="delivery"]')?.classList.contains('active');
  const time    = document.getElementById('input-time')?.value;
  const address = document.getElementById('input-address')?.value?.trim();

  const deliveryType = isDelivery ? '🚗 Доставка' : '🏠 Самовывоз';
  let text = `Хочу сделать заказ:\n${lines.join('\n')}\nИтого: ${cartTotal()} ₽\nСпособ получения: ${deliveryType}`;
  if (time)    text += `\nВремя: ${time}`;
  if (address) text += `\nАдрес: ${address}`;

  const managerUsername = state.menuData.manager;
  const url = `https://t.me/${managerUsername}?text=${encodeURIComponent(text)}`;

  // Открываем чат, очищаем корзину
  clearCart();
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(url);
  } else {
    window.open(url, '_blank');
  }
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
    tg.MainButton.offClick(handleWriteToManager);
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
      mainBtn.textContent = 'Написать в Telegram';
      mainBtn.onclick = handleWriteToManager;
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
