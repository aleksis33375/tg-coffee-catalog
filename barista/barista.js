const API = '/api'
let TOKEN = localStorage.getItem('barista_token') || ''
let BARISTA_NAME = localStorage.getItem('barista_name') || ''
let BARISTA_ID   = localStorage.getItem('barista_id')   || ''
let SHIFT_ID     = null
let SHIFT_OPENED = null
let supabaseClient = null
let foundCustomerTgId = null
let pendingRewardTgId = null
let isRequesting = false

// ── УТИЛИТЫ ──────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {})
    }
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(API + path, opts)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Ошибка')
  return json
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.classList.remove('hidden')
  setTimeout(() => el.classList.add('hidden'), 2500)
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'))
  const el = document.getElementById('screen-' + name)
  if (el) el.classList.remove('hidden')
}

function showMainTab(tab) {
  if (tab === 'orders') {
    showScreen('main')
    document.getElementById('nav-orders').classList.add('active')
    document.getElementById('nav-search').classList.remove('active')
  } else {
    document.getElementById('search-input').value = ''
    document.getElementById('search-result').classList.add('hidden')
    document.getElementById('search-not-found').classList.add('hidden')
    foundCustomerTgId = null
    showScreen('search')
    document.getElementById('nav-orders').classList.remove('active')
    document.getElementById('nav-search').classList.add('active')
  }
}

// ── ЗВУК ─────────────────────────────────────────────────────────────────────

// Б-А41: один общий AudioContext на весь сеанс.
// Создание нового на каждый звонок течёт по памяти, а браузер ещё и упирается
// в лимит одновременных контекстов (~6 в Chrome) после пары десятков заказов
let _audioCtx = null
function playBeep() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    // iOS блокирует AudioContext до первого touch — возобновляем, если заснул
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {})
    const ctx = _audioCtx
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
  } catch {}
}

// ── PIN-ВХОД ──────────────────────────────────────────────────────────────────

let pinValue = ''

function pinPress(digit) {
  if (pinValue.length >= 4) return
  pinValue += digit
  updateDots()
  if (pinValue.length === 4) setTimeout(submitPin, 100)
}

function pinDel() {
  pinValue = pinValue.slice(0, -1)
  updateDots()
}

function updateDots() {
  for (let i = 1; i <= 4; i++) {
    document.getElementById('dot-' + i).classList.toggle('filled', i <= pinValue.length)
  }
}

async function submitPin() {
  document.getElementById('pin-error').classList.add('hidden')
  try {
    const { token, barista_id, name } = await api('POST', '/barista/login', { pin: pinValue })
    TOKEN = token
    BARISTA_NAME = name
    BARISTA_ID = String(barista_id)
    localStorage.setItem('barista_token', token)
    localStorage.setItem('barista_name', name)
    localStorage.setItem('barista_id', BARISTA_ID)
    await afterLogin()
  } catch {
    document.getElementById('pin-error').classList.remove('hidden')
    pinValue = ''
    updateDots()
  }
}

// ── ПОСЛЕ ВХОДА ───────────────────────────────────────────────────────────────

async function afterLogin() {
  // Открыть смену
  try {
    const { shift_id, opened_at } = await api('POST', '/barista/shift/open')
    SHIFT_ID = shift_id
    SHIFT_OPENED = opened_at
  } catch (e) {
    toast('Не удалось открыть смену: ' + e.message)
  }

  // Онбординг — показать только один раз
  const seenKey = 'onboarding_' + BARISTA_ID
  if (!localStorage.getItem(seenKey)) {
    document.getElementById('onboarding-greeting').textContent = `Привет, ${BARISTA_NAME}! 👋`
    showScreen('onboarding')
  } else {
    enterMain()
  }
}

function finishOnboarding() {
  localStorage.setItem('onboarding_' + BARISTA_ID, '1')
  enterMain()
}

// ── ГЛАВНЫЙ ЭКРАН ─────────────────────────────────────────────────────────────

async function enterMain() {
  document.getElementById('header-name').textContent = BARISTA_NAME
  if (SHIFT_OPENED) {
    const t = new Date(SHIFT_OPENED)
    document.getElementById('header-shift').textContent =
      'смена с ' + t.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
  }
  showScreen('main')
  await loadOrders()
  await loadEmptyState()
  await startRealtime()
}

// ── ЗАКАЗЫ ────────────────────────────────────────────────────────────────────

const STATUS_LABEL = { new: '🔴 Новый', preparing: '🟡 Готовится', ready: '🟢 Готов' }
const STATUS_BADGE = { new: 'badge-new', preparing: 'badge-preparing', ready: 'badge-ready' }

async function loadOrders() {
  try {
    const orders = await api('GET', '/barista/orders')
    renderOrders(orders)
  } catch (e) { toast('Не удалось загрузить заказы: ' + e.message) }
}

function renderOrders(orders) {
  const list = document.getElementById('orders-list')
  const empty = document.getElementById('empty-state')

  if (!orders.length) {
    list.innerHTML = ''
    empty.classList.remove('hidden')
    return
  }
  empty.classList.add('hidden')

  list.innerHTML = orders.map(o => {
    const items = Array.isArray(o.items) ? o.items.map(i => `${escHtml(i.name)} ×${escHtml(i.qty)}`).join(', ') : ''
    const time = new Date(o.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
    const customer = o.customer_tg_id ? `ID ${o.customer_tg_id}` : 'Без аккаунта'

    let buttons = ''
    if (o.status === 'new') {
      buttons = `<button class="btn-accept" onclick="setStatus(${o.id},'preparing')">Принять</button>`
    } else if (o.status === 'preparing') {
      const cupBtn = o.customer_tg_id
        ? `<button class="btn-cup" onclick="addCupForOrder(${o.id},'${o.customer_tg_id}')">+1 ☕</button>`
        : ''
      buttons = `
        <button class="btn-ready" onclick="setStatus(${o.id},'ready')">Готов ✓</button>
        ${cupBtn}`
    } else if (o.status === 'ready') {
      buttons = `
        <button class="btn-done btn-done-cash" onclick="setStatus(${o.id},'done','cash')">💵 Наличные</button>
        <button class="btn-done btn-done-card" onclick="setStatus(${o.id},'done','card')">💳 Карта</button>`
    }

    return `<div class="order-card status-${o.status}" id="order-${o.id}">
      <div class="order-top">
        <span class="order-status-badge ${STATUS_BADGE[o.status]}">${STATUS_LABEL[o.status]}</span>
        <span class="order-time">${time}</span>
      </div>
      <div class="order-customer">${customer}</div>
      <div class="order-items-text">${items}</div>
      <div class="order-total">${o.total} ₽</div>
      <div class="order-buttons">${buttons}</div>
    </div>`
  }).join('')
}

async function setStatus(id, status, payment) {
  if (isRequesting) return
  isRequesting = true
  try {
    await api('PUT', `/barista/orders/${id}/status`, { status, payment })
    await loadOrders()
    if (status === 'done') {
      const label = payment === 'cash' ? 'наличными' : 'картой'
      toast(`Заказ выдан ✓ — оплата ${label}`)
    }
  } catch (e) { toast(e.message) }
  finally { isRequesting = false }
}

async function addCupForOrder(orderId, customerTgId) {
  if (isRequesting) return
  isRequesting = true
  try {
    const { progress, total, reward } = await api('POST', '/barista/customers/cups', {
      customer_tg_id: String(customerTgId),
      order_id: orderId
    })
    if (reward) {
      pendingRewardTgId = String(customerTgId)
      document.getElementById('modal-reward').classList.remove('hidden')
    } else {
      toast(`☕ Кружка засчитана: ${progress}/${total}`)
    }
  } catch (e) { toast(e.message) }
  finally { isRequesting = false }
}

async function confirmFreeDrink() {
  if (!pendingRewardTgId) return
  const tgId = pendingRewardTgId
  pendingRewardTgId = null // предотвращаем повторный вызов до ответа
  try {
    await api('POST', '/barista/customers/cups/reset', { customer_tg_id: tgId })
    closeRewardModal()
    toast('🎁 Бесплатный напиток выдан, кружки сброшены')
    // Скрываем карточку клиента — следующий поиск начнётся с чистого состояния
    const cupsEl = document.getElementById('found-cups')
    if (cupsEl) cupsEl.textContent = 0
    document.getElementById('search-result').classList.add('hidden')
    foundCustomerTgId = null
  } catch (e) {
    pendingRewardTgId = tgId // вернуть при ошибке
    toast(e.message)
  }
}

function closeRewardModal() {
  document.getElementById('modal-reward').classList.add('hidden')
  pendingRewardTgId = null
}

// ── ПУСТОЙ ЭКРАН (аналитика) ──────────────────────────────────────────────────

async function loadEmptyState() {
  try {
    const top = await api('GET', '/barista/analytics/top-items')
    const topEl = document.getElementById('top-items')
    if (top.length) {
      // Б-А48: экранируем название и количество — name приходит из заказов клиента,
      // может содержать HTML если позиция была импортирована с кавычками/тегами
      topEl.innerHTML = '<h4>Топ за месяц</h4>' +
        top.map((i, idx) => `
          <div class="top-item-row">
            <span>${idx + 1}. ${escHtml(i.name)}</span>
            <span class="top-item-count">${escHtml(i.count)} шт</span>
          </div>`).join('')
    }
  } catch {}

  try {
    const { peak } = await api('GET', '/barista/analytics/peak-hours')
    document.getElementById('peak-hours').innerHTML =
      `Пик заказов за месяц: <strong>${peak}</strong>`
  } catch {}
}

// ── REALTIME ──────────────────────────────────────────────────────────────────

let realtimeChannel = null

async function startRealtime() {
  // Б-А42: на всякий случай отключаем предыдущий канал, если был
  await stopRealtime()
  try {
    const { supabase_url, supabase_anon_key } = await api('GET', '/config')
    supabaseClient = supabase.createClient(supabase_url, supabase_anon_key)

    realtimeChannel = supabaseClient
      .channel('new-orders')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        payload => {
          playBeep()
          toast('🆕 Новый заказ!')
          loadOrders()
        }
      )
      .subscribe(status => {
        const strip = document.getElementById('conn-strip')
        if (status === 'SUBSCRIBED') {
          strip.classList.add('hidden')
        } else {
          strip.classList.remove('hidden')
        }
      })
  } catch {}
}

// Б-А42: при выходе/закрытии смены отписываемся от канала,
// иначе socket остаётся висеть в фоне и продолжает получать события
async function stopRealtime() {
  try {
    if (realtimeChannel && supabaseClient) {
      await supabaseClient.removeChannel(realtimeChannel)
    }
  } catch {}
  realtimeChannel = null
}

// ── ЗАКРЫТИЕ СМЕНЫ ────────────────────────────────────────────────────────────

async function confirmCloseShift() {
  try {
    const { shift, summary } = await api('GET', '/barista/shift/summary')

    const opened = new Date(shift.opened_at)
    const now = new Date()
    const timeStr = opened.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) +
      ' — ' + now.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })

    document.getElementById('shift-time').textContent = timeStr
    document.getElementById('shift-orders').textContent = summary.orders_count
    document.getElementById('shift-cash').textContent = summary.total_cash.toLocaleString('ru') + ' ₽'
    document.getElementById('shift-card').textContent = summary.total_card.toLocaleString('ru') + ' ₽'
    document.getElementById('shift-total').textContent =
      (summary.total_cash + summary.total_card).toLocaleString('ru') + ' ₽'
    document.getElementById('shift-walkin-cash').textContent = (summary.walkin_cash ?? 0) + ' шт'
    document.getElementById('shift-walkin-card').textContent = (summary.walkin_card ?? 0) + ' шт'

    document.getElementById('modal-shift').classList.remove('hidden')
  } catch (e) { toast(e.message) }
}

async function closeShift() {
  try {
    await api('POST', '/barista/shift/close')
    closeModal()
    toast('✅ Смена закрыта')
    // Б-А42: при выходе обрываем Realtime-канал до очистки состояния
    await stopRealtime()
    setTimeout(() => {
      TOKEN = ''
      BARISTA_NAME = ''
      BARISTA_ID = ''
      localStorage.removeItem('barista_token')
      localStorage.removeItem('barista_name')
      localStorage.removeItem('barista_id')
      pinValue = ''
      updateDots()
      showScreen('pin')
    }, 2000)
  } catch (e) { toast(e.message) }
}

function closeModal() {
  document.getElementById('modal-shift').classList.add('hidden')
}

// ── ПОИСК КЛИЕНТА ─────────────────────────────────────────────────────────────

async function searchCustomer() {
  const username = document.getElementById('search-input').value.trim()
  if (!username) return

  document.getElementById('search-result').classList.add('hidden')
  document.getElementById('search-not-found').classList.add('hidden')
  foundCustomerTgId = null

  try {
    const { customer, progress } = await api('GET', `/barista/customers/search?username=${encodeURIComponent(username)}`)
    foundCustomerTgId = customer.tg_id

    document.getElementById('found-name').textContent = customer.first_name || '—'
    document.getElementById('found-username').textContent =
      customer.username ? ('@' + customer.username) : 'Без @username'

    const cups = Array.isArray(progress)
      ? progress.find(p => p.promo_type === 'loyalty_cups')
      : null
    document.getElementById('found-cups').textContent = cups ? cups.progress : 0

    document.getElementById('search-result').classList.remove('hidden')
  } catch {
    document.getElementById('search-not-found').classList.remove('hidden')
  }
}

async function markCupDirect(payment) {
  if (!foundCustomerTgId || isRequesting) return
  if (payment !== 'cash' && payment !== 'card') return
  isRequesting = true
  try {
    const { progress, total, reward } = await api('POST', '/barista/customers/cups', {
      customer_tg_id: String(foundCustomerTgId),
      payment
    })
    const payLabel = payment === 'cash' ? 'наличными' : 'картой'
    const rawName = document.getElementById('found-name').textContent || ''
    const namePrefix = rawName && rawName !== '—' ? `${rawName} — ` : ''
    document.getElementById('found-cups').textContent = progress
    if (reward) {
      pendingRewardTgId = String(foundCustomerTgId)
      document.getElementById('modal-reward').classList.remove('hidden')
    } else {
      toast(`☕ ${namePrefix}${payLabel}. Кружка: ${progress}/${total}`)
    }
  } catch (e) { toast(e.message) }
  finally { isRequesting = false }
}

// ── СТАРТ ─────────────────────────────────────────────────────────────────────

if (TOKEN) {
  // Уже залогинен — проверим токен
  api('GET', '/barista/orders')
    .then(async () => {
      await enterMain()
    })
    .catch(() => {
      TOKEN = ''
      localStorage.removeItem('barista_token')
      showScreen('pin')
      setTimeout(() => toast('Сессия истекла, войдите снова'), 100)
    })
} else {
  showScreen('pin')
}
