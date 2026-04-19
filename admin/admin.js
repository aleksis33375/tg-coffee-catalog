const API = '/api'
let TOKEN = localStorage.getItem('admin_token') || ''

// ── УТИЛИТЫ ──────────────────────────────────────────────────────────────────

async function api(method, path, body, isForm) {
  const opts = {
    method,
    headers: TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}
  }
  if (body && !isForm) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  } else if (isForm) {
    opts.body = body
  }
  const res = await fetch(API + path, opts)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Ошибка сервера')
  return json
}

function toast(msg, isError) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = 'toast' + (isError ? ' error' : '')
  el.classList.remove('hidden')
  setTimeout(() => el.classList.add('hidden'), 3000)
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'))
  document.getElementById('screen-' + name).classList.remove('hidden')
}

function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'))
  document.getElementById('tab-' + name).classList.remove('hidden')
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('nav-' + name).classList.add('active')
  if (name === 'dashboard') loadDashboard()
  if (name === 'menu')      loadMenu()
  if (name === 'settings')  loadSettings()
  if (name === 'marketing') loadMarketing()
}

// ── ВХОД ─────────────────────────────────────────────────────────────────────

document.getElementById('form-login').addEventListener('submit', async e => {
  e.preventDefault()
  const password = document.getElementById('input-password').value
  try {
    const { token } = await api('POST', '/admin/login', { password })
    TOKEN = token
    localStorage.setItem('admin_token', token)
    document.getElementById('login-error').classList.add('hidden')
    await checkSetup()
  } catch {
    document.getElementById('login-error').classList.remove('hidden')
  }
})

async function checkSetup() {
  try {
    const s = await api('GET', '/admin/setup/status')
    if (!s.complete) {
      showScreen('wizard')
    } else {
      showScreen('app')
      loadDashboard()
    }
  } catch {
    showScreen('app')
    loadDashboard()
  }
}

function logout() {
  TOKEN = ''
  localStorage.removeItem('admin_token')
  showScreen('login')
}

// ── МАСТЕР ПЕРВОГО ЗАПУСКА ────────────────────────────────────────────────────

let wizardData = {}

async function wizardNext(step) {
  if (step === 1) {
    const name = document.getElementById('w-cafe-name').value.trim()
    const tagline = document.getElementById('w-tagline').value.trim()
    const address = document.getElementById('w-address').value.trim()
    if (name) {
      try { await api('PUT', '/admin/settings', { cafe_name: name, tagline, address }) } catch {}
    }
  }
  if (step === 3) {
    const name = document.getElementById('w-barista-name').value.trim()
    const pin = document.getElementById('w-barista-pin').value.trim()
    if (name && pin) {
      try { await api('POST', '/admin/baristas', { name, pin }) } catch (e) {
        if (e.message.includes('PIN')) { toast(e.message, true); return }
      }
    }
  }
  document.getElementById('wizard-' + step).classList.add('hidden')
  document.getElementById('wizard-' + (step + 1)).classList.remove('hidden')
  document.querySelectorAll('.step').forEach(s => {
    const n = Number(s.dataset.step)
    if (n < step + 1) s.classList.add('done')
    if (n === step + 1) s.classList.add('active')
  })
}

async function wizardFinish() {
  const token = document.getElementById('w-bot-token').value.trim()
  const mgr   = document.getElementById('w-manager-id').value.trim()
  if (token || mgr) {
    try { await api('PUT', '/admin/settings', { bot_token: token, manager_tg_id: mgr }) } catch {}
  }
  await api('PUT', '/admin/setup/complete', {})
  showScreen('app')
  loadDashboard()
}

// ── ДАШБОРД ──────────────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const stats = await api('GET', '/admin/orders/stats')
    document.getElementById('stat-today-revenue').textContent = stats.today.revenue.toLocaleString('ru') + ' ₽'
    document.getElementById('stat-today-orders').textContent = stats.today.orders + ' заказов'
    document.getElementById('stat-week-revenue').textContent = stats.week.revenue.toLocaleString('ru') + ' ₽'
    document.getElementById('stat-week-orders').textContent = stats.week.orders + ' заказов'
    document.getElementById('stat-month-revenue').textContent = stats.month.revenue.toLocaleString('ru') + ' ₽'
    document.getElementById('stat-month-orders').textContent = stats.month.orders + ' заказов'
  } catch {}

  loadChart(7)
  loadTopItems()

  try {
    const orders = await api('GET', '/admin/orders?limit=20')
    renderOrders(orders)
  } catch {}
}

// ── ГРАФИК ────────────────────────────────────────────────────────────────────

let revenueChart = null

async function loadChart(period) {
  try {
    const data = await api('GET', `/admin/analytics/chart?period=${period}`)
    renderChart(data)
  } catch {}
}

function setChartPeriod(period, btn) {
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  loadChart(period)
}

function renderChart(data) {
  const ctx = document.getElementById('revenue-chart')
  if (!ctx) return

  const labels  = data.map(d => {
    const dt = new Date(d.date + 'T12:00:00')
    return dt.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
  })
  const revenue = data.map(d => d.revenue)

  if (revenueChart) revenueChart.destroy()

  revenueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Выручка, ₽',
        data: revenue,
        backgroundColor: 'rgba(201,112,112,0.7)',
        borderColor: '#c97070',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ctx.parsed.y.toLocaleString('ru') + ' ₽'
          }
        }
      },
      scales: {
        x: { ticks: { color: '#8888aa', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          ticks: { color: '#8888aa', font: { size: 11 }, callback: v => v.toLocaleString('ru') },
          grid: { color: 'rgba(255,255,255,0.05)' },
          beginAtZero: true
        }
      }
    }
  })
}

// ── ТОП ТОВАРОВ ───────────────────────────────────────────────────────────────

async function loadTopItems() {
  try {
    const items = await api('GET', '/admin/analytics/top-items?period=30')
    renderTopItems(items)
  } catch {}
}

function renderTopItems(items) {
  const el = document.getElementById('top-items-list')
  if (!items.length) { el.innerHTML = '<div class="loading">Данных пока нет</div>'; return }
  const max = items[0].count
  el.innerHTML = items.map((item, i) => `
    <div class="top-item-row">
      <span class="top-item-rank">${i + 1}</span>
      <span class="top-item-name">${escapeHtml(item.name)}</span>
      <div class="top-item-bar-wrap">
        <div class="top-item-bar" style="width:${Math.round(item.count / max * 100)}%"></div>
      </div>
      <span class="top-item-count">${item.count} шт</span>
    </div>`).join('')
}

const STATUS_LABELS = { new: 'Новый', preparing: 'Готовится', ready: 'Готов', done: 'Выдан' }

function renderOrders(orders) {
  const list = document.getElementById('orders-list')
  if (!orders.length) { list.innerHTML = '<div class="loading">Заказов пока нет</div>'; return }
  list.innerHTML = orders.map(o => {
    const items = Array.isArray(o.items) ? o.items.map(i => `${escapeHtml(i.name)} ×${i.qty}`).join(', ') : ''
    const date = new Date(o.created_at).toLocaleString('ru', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
    const customer = escapeHtml(o.customers?.first_name || o.customer_tg_id || '—')
    const actions = o.status !== 'done' ? `
      <div class="order-actions">
        ${o.status === 'new'       ? `<button onclick="setOrderStatus(${o.id},'preparing')">Принять</button>` : ''}
        ${o.status === 'preparing' ? `<button onclick="setOrderStatus(${o.id},'ready')">Готов</button>` : ''}
        ${o.status === 'ready'     ? `<button onclick="setOrderStatus(${o.id},'done')">Выдан</button>` : ''}
      </div>` : ''
    return `<div class="order-card">
      <div class="order-header">
        <span class="order-id">#${o.id} — ${customer}</span>
        <span class="status-badge status-${o.status}">${STATUS_LABELS[o.status]}</span>
      </div>
      <div class="order-meta">${date}</div>
      <div class="order-items">${items}</div>
      <div class="order-total">${o.total} ₽</div>
      ${actions}
    </div>`
  }).join('')
}

async function setOrderStatus(id, status) {
  try {
    await api('PUT', `/admin/orders/${id}/status`, { status })
    toast('Статус обновлён')
    loadDashboard()
  } catch (e) { toast(e.message, true) }
}

// ── МЕНЮ ─────────────────────────────────────────────────────────────────────

let menuItems = []
let editingItemId = null

async function loadMenu() {
  try {
    menuItems = await api('GET', '/admin/menu')
    renderMenu()
  } catch (e) { toast(e.message, true) }
}

function renderMenu() {
  const list = document.getElementById('menu-list')
  if (!menuItems.length) { list.innerHTML = '<div class="loading">Меню пусто</div>'; return }
  list.innerHTML = menuItems.map(item => `
    <div class="menu-item">
      <div class="menu-item-info">
        <div class="menu-item-name">${item.emoji || ''} ${item.name} ${item.badge ? `<span class="status-badge status-new">${item.badge}</span>` : ''}</div>
        <div class="menu-item-meta">${item.category} · ${item.volume || ''}</div>
      </div>
      <div class="menu-item-price">${item.price} ₽</div>
      <div class="menu-item-actions">
        <button class="toggle ${item.available ? 'on' : ''}" onclick="toggleItem(${item.id}, ${!item.available})"></button>
        <button onclick="editItem(${item.id})">✏️</button>
      </div>
    </div>
  `).join('')
}

function showMenuTab(tab) {
  document.getElementById('menu-items-tab').classList.toggle('hidden', tab !== 'items')
  document.getElementById('menu-promos-tab').classList.toggle('hidden', tab !== 'promos')
  document.querySelectorAll('.inner-tab').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && tab === 'items') || (i === 1 && tab === 'promos'))
  })
}

async function toggleItem(id, available) {
  try {
    await api('PUT', `/admin/menu/items/${id}/availability`, { available })
    await loadMenu()
  } catch (e) { toast(e.message, true) }
}

function showAddItem() {
  editingItemId = null
  document.getElementById('item-form-title').textContent = 'Новая позиция'
  document.getElementById('f-category').value = 'Кофе'
  document.getElementById('f-name').value = ''
  document.getElementById('f-price').value = ''
  document.getElementById('f-volume').value = ''
  document.getElementById('f-description').value = ''
  document.getElementById('f-badge').value = ''
  // Б-А06: сброс файлового input, иначе фото от прошлого сохранения уйдёт новому товару
  document.getElementById('f-photo').value = ''
  const prev = document.getElementById('f-photo-preview')
  prev.classList.add('hidden')
  prev.removeAttribute('src')
  document.getElementById('item-form-overlay').classList.remove('hidden')
}

function editItem(id) {
  const item = menuItems.find(i => i.id === id)
  if (!item) return
  editingItemId = id
  document.getElementById('item-form-title').textContent = 'Редактировать позицию'
  document.getElementById('f-category').value = item.category || 'Кофе'
  document.getElementById('f-name').value = item.name || ''
  document.getElementById('f-price').value = item.price || ''
  document.getElementById('f-volume').value = item.volume || ''
  document.getElementById('f-description').value = item.description || ''
  document.getElementById('f-badge').value = item.badge || ''
  document.getElementById('f-photo').value = ''
  const prev = document.getElementById('f-photo-preview')
  if (item.photo_url) {
    prev.src = item.photo_url
    prev.classList.remove('hidden')
  } else {
    // Б-А07: скрыть превью если у редактируемого товара нет фото
    prev.classList.add('hidden')
    prev.removeAttribute('src')
  }
  document.getElementById('item-form-overlay').classList.remove('hidden')
}

function closeItemForm() {
  document.getElementById('item-form-overlay').classList.add('hidden')
}

// Превью фото при выборе
document.getElementById('f-photo').addEventListener('change', e => {
  const file = e.target.files[0]
  if (!file) return
  const prev = document.getElementById('f-photo-preview')
  prev.src = URL.createObjectURL(file)
  prev.classList.remove('hidden')
})

let isSavingItem = false

async function saveItem() {
  // Б-А05: guard против двойного клика — защищает от дублей
  if (isSavingItem) return
  const saveBtn = document.querySelector('#item-form-overlay .form-actions button:not(.btn-ghost)')

  const body = {
    category:    document.getElementById('f-category').value,
    name:        document.getElementById('f-name').value.trim(),
    price:       Number(document.getElementById('f-price').value),
    volume:      document.getElementById('f-volume').value.trim(),
    description: document.getElementById('f-description').value.trim(),
    badge:       document.getElementById('f-badge').value || null,
  }
  if (!body.name || !body.price) { toast('Заполни название и цену', true); return }

  isSavingItem = true
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Сохранение...' }

  // Б-А40: если позиция не сохранилась, а фото уже загружено в Storage —
  // сообщаем пользователю, что файл остался (потом подчистит DELETE /menu/items/:id,
  // а при создании – админ сохранит заново с тем же файлом)
  let uploadedPhotoUrl = null
  try {
    const photoFile = document.getElementById('f-photo').files[0]
    if (photoFile) {
      try {
        const form = new FormData()
        form.append('image', photoFile)
        const { url } = await api('POST', '/admin/upload/image', form, true)
        body.photo_url = url
        uploadedPhotoUrl = url
      } catch (e) { toast('Ошибка загрузки фото: ' + e.message, true); return }
    }

    try {
      if (editingItemId) {
        await api('PUT', `/admin/menu/items/${editingItemId}`, body)
        toast('Позиция обновлена')
      } else {
        await api('POST', '/admin/menu/items', body)
        toast('Позиция добавлена')
      }
      uploadedPhotoUrl = null // всё ок — фото привязано к позиции
      closeItemForm()
      await loadMenu()
    } catch (e) {
      if (uploadedPhotoUrl) {
        toast('Позиция не сохранена. Фото загружено, но не привязано — попробуй ещё раз', true)
      } else {
        toast(e.message, true)
      }
    }
  } finally {
    isSavingItem = false
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Сохранить' }
  }
}

// ── НАСТРОЙКИ ─────────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const s = await api('GET', '/admin/settings')
    document.getElementById('s-cafe-name').value = s.cafe_name || ''
    document.getElementById('s-tagline').value   = s.tagline   || ''
    document.getElementById('s-address').value   = s.address   || ''
    document.getElementById('s-manager-id').value = s.manager_tg_id || ''
    if (s.logo_url) {
      const prev = document.getElementById('s-logo-preview')
      prev.src = s.logo_url
      prev.classList.remove('hidden')
    }
    const { barista_can_edit_menu } = await api('GET', '/admin/barista/settings')
    document.getElementById('s-barista-menu').checked = barista_can_edit_menu
  } catch {}
  loadBaristas()
}

async function saveSettings() {
  const body = {
    cafe_name: document.getElementById('s-cafe-name').value.trim(),
    tagline:   document.getElementById('s-tagline').value.trim(),
    address:   document.getElementById('s-address').value.trim(),
  }

  const logoFile = document.getElementById('s-logo').files[0]
  if (logoFile) {
    try {
      const form = new FormData()
      form.append('logo', logoFile)
      const { url } = await api('POST', '/admin/upload/logo', form, true)
      const prev = document.getElementById('s-logo-preview')
      prev.src = url
      prev.classList.remove('hidden')
    } catch (e) { toast('Ошибка загрузки лого: ' + e.message, true); return }
  }

  try {
    await api('PUT', '/admin/settings', body)
    toast('Настройки сохранены')
  } catch (e) { toast(e.message, true) }
}

async function saveBotSettings() {
  const body = {
    bot_token:    document.getElementById('s-bot-token').value.trim(),
    manager_tg_id: document.getElementById('s-manager-id').value.trim(),
  }
  try {
    await api('PUT', '/admin/settings', body)
    toast('Бот подключён')
  } catch (e) { toast(e.message, true) }
}

async function saveBaristaSettings() {
  const val = document.getElementById('s-barista-menu').checked
  try {
    await api('PUT', '/admin/barista/settings', { barista_can_edit_menu: val })
  } catch {}
}

// ── БАРИСТЫ ──────────────────────────────────────────────────────────────────

let baristas = []
const togglingBaristaIds = new Set()

async function loadBaristas() {
  try {
    baristas = await api('GET', '/admin/baristas')
    const el = document.getElementById('baristas-list')
    if (!baristas.length) { el.innerHTML = '<div class="loading">Баристы не добавлены</div>'; return }
    el.innerHTML = baristas.map(b => `
      <div class="barista-row" data-barista-id="${b.id}">
        <div>
          <div class="barista-name">${escapeHtml(b.name)}</div>
          <div class="barista-status">${b.active ? 'Активен' : 'Уволен'}</div>
        </div>
        <div class="barista-actions">
          <button onclick="openPinForm(${b.id})">PIN</button>
          <button onclick="toggleBarista(${b.id}, ${!b.active})" class="${b.active ? 'btn-ghost' : ''}">
            ${b.active ? 'Уволить' : 'Вернуть'}
          </button>
        </div>
      </div>
    `).join('')
  } catch {}
}

// Б-А09: форма добавления бариста (заменяет blocking prompt)
function showAddBarista() {
  document.getElementById('bf-name').value = ''
  document.getElementById('bf-pin').value = ''
  document.getElementById('barista-form-overlay').classList.remove('hidden')
  setTimeout(() => document.getElementById('bf-name').focus(), 50)
}

function closeBaristaForm() {
  document.getElementById('barista-form-overlay').classList.add('hidden')
}

let isSavingBarista = false

async function saveNewBarista() {
  if (isSavingBarista) return
  const name = document.getElementById('bf-name').value.trim()
  const pin = document.getElementById('bf-pin').value.trim()
  if (!name) { toast('Введи имя бариста', true); return }
  if (!/^\d{4}$/.test(pin)) { toast('PIN — ровно 4 цифры', true); return }

  const btn = document.getElementById('bf-save-btn')
  isSavingBarista = true
  btn.disabled = true
  btn.textContent = 'Сохранение...'
  try {
    await api('POST', '/admin/baristas', { name, pin })
    toast('Бариста добавлен')
    closeBaristaForm()
    await loadBaristas()
  } catch (e) {
    toast(e.message, true)
  } finally {
    isSavingBarista = false
    btn.disabled = false
    btn.textContent = 'Сохранить'
  }
}

// Б-А10: форма смены PIN (заменяет blocking prompt)
let pinFormBaristaId = null

function openPinForm(id) {
  const b = baristas.find(x => x.id === id)
  if (!b) return
  pinFormBaristaId = id
  document.getElementById('pin-form-title').textContent = `Новый PIN для ${b.name}`
  document.getElementById('pf-pin').value = ''
  document.getElementById('pin-form-overlay').classList.remove('hidden')
  setTimeout(() => document.getElementById('pf-pin').focus(), 50)
}

function closePinForm() {
  document.getElementById('pin-form-overlay').classList.add('hidden')
  pinFormBaristaId = null
}

let isSavingPin = false

async function saveNewPin() {
  if (isSavingPin || !pinFormBaristaId) return
  const pin = document.getElementById('pf-pin').value.trim()
  if (!/^\d{4}$/.test(pin)) { toast('PIN — ровно 4 цифры', true); return }

  const btn = document.getElementById('pf-save-btn')
  isSavingPin = true
  btn.disabled = true
  btn.textContent = 'Сохранение...'
  try {
    await api('PUT', `/admin/baristas/${pinFormBaristaId}/pin`, { pin })
    toast('PIN изменён')
    closePinForm()
  } catch (e) {
    toast(e.message, true)
  } finally {
    isSavingPin = false
    btn.disabled = false
    btn.textContent = 'Сохранить'
  }
}

// Б-А08: guard против двойного клика — блокирует повторный запрос пока идёт первый
async function toggleBarista(id, active) {
  if (togglingBaristaIds.has(id)) return
  togglingBaristaIds.add(id)
  const row = document.querySelector(`.barista-row[data-barista-id="${id}"]`)
  const buttons = row ? row.querySelectorAll('.barista-actions button') : []
  buttons.forEach(b => b.disabled = true)
  try {
    await api('PUT', `/admin/baristas/${id}/active`, { active })
    toast(active ? 'Доступ восстановлен' : 'Доступ закрыт')
    await loadBaristas()
  } catch (e) {
    toast(e.message, true)
    buttons.forEach(b => b.disabled = false)
  } finally {
    togglingBaristaIds.delete(id)
  }
}

// ── МАРКЕТИНГ ─────────────────────────────────────────────────────────────────

async function loadMarketing() {
  loadBroadcastHistory()

  // Счётчик символов в поле сообщения
  const msg = document.getElementById('bc-message')
  const counter = document.getElementById('bc-counter')
  if (msg && counter) {
    msg.oninput = () => {
      const len = msg.value.length
      counter.textContent = len ? `${len} символов` : ''
    }
  }
}

async function sendBroadcast() {
  const message = document.getElementById('bc-message').value.trim()
  const target  = document.getElementById('bc-target').value

  if (!message) { toast('Введи текст сообщения', true); return }
  // Б-А63: Telegram не принимает сообщения длиннее 4096 символов
  if (message.length > 4096) { toast('Сообщение слишком длинное: максимум 4096 символов', true); return }

  const btn = document.getElementById('bc-send-btn')
  btn.disabled = true
  btn.textContent = 'Отправка...'

  try {
    // Б-А64: бэкенд ставит рассылку в очередь и сразу отвечает — не ждём конца отправки в HTTP
    await api('POST', '/admin/broadcast', { message, target })
    toast('Рассылка запущена. Обновите историю через минуту.')
    document.getElementById('bc-message').value = ''
    document.getElementById('bc-counter').textContent = ''
    loadBroadcastHistory()
  } catch (e) {
    toast(e.message, true)
  } finally {
    btn.disabled = false
    btn.textContent = '📣 Отправить'
  }
}

async function loadBroadcastHistory() {
  try {
    const list = await api('GET', '/admin/broadcasts')
    renderBroadcastHistory(list)
  } catch {}
}

const TARGET_LABELS = { all: 'Все', buyers: 'Покупатели', inactive: 'Неактивные' }

function renderBroadcastHistory(list) {
  const el = document.getElementById('broadcasts-list')
  if (!list.length) { el.innerHTML = '<div class="loading">Рассылок ещё не было</div>'; return }
  el.innerHTML = list.map(b => {
    const date = new Date(b.created_at).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    const segment = TARGET_LABELS[b.segment] || b.segment
    return `<div class="broadcast-row">
      <div class="broadcast-row-msg">${escapeHtml(b.text || '')}</div>
      <div class="broadcast-row-meta">${date} · ${segment} · ${b.sent_to ?? 0} получателей</div>
    </div>`
  }).join('')
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

// ── CSV-ЭКСПОРТ ───────────────────────────────────────────────────────────────

function exportCustomersCSV() {
  const url = '/api/admin/customers/export'
  const a = document.createElement('a')
  a.href = url
  a.setAttribute('Authorization', 'Bearer ' + TOKEN) // не работает через href — используем fetch
  // Fetch + blob download
  fetch(url, { headers: { Authorization: 'Bearer ' + TOKEN } })
    .then(r => {
      if (!r.ok) throw new Error('Ошибка экспорта')
      return r.blob()
    })
    .then(blob => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'customers.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    })
    .catch(e => toast(e.message, true))
}

// ── QR-КОД ────────────────────────────────────────────────────────────────────

async function generateQR() {
  // Б-А12: тянем имя бота из настроек, а не хардкодим старый username
  let botUsername = ''
  try {
    const s = await api('GET', '/admin/settings')
    botUsername = (s.bot_username || '').trim()
  } catch {}

  if (!botUsername) {
    toast('Сначала укажи имя бота в настройках', true)
    return
  }

  const botUrl = `https://t.me/${botUsername}?start=cup`
  const container = document.getElementById('qr-container')
  container.innerHTML = ''
  const canvas = document.createElement('canvas')
  canvas.style.borderRadius = '8px'
  container.appendChild(canvas)

  QRCode.toCanvas(canvas, botUrl, {
    width: 200,
    color: { dark: '#e8e8f0', light: '#1e1e32' }
  }, err => {
    if (err) toast('Ошибка QR: ' + err.message, true)
  })
}

// ── ЛОГ БАРИСТЫ ───────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  shift_closed:   'Смена закрыта',
  status_changed: 'Статус заказа',
  birthday_set:   'ДР установлен',
  cup_added:      'Кружка ☕',
  cups_reset:     'Кружки сброшены',
}

async function loadBaristaLog() {
  const el = document.getElementById('barista-log-list')
  el.innerHTML = '<div class="loading">Загрузка...</div>'
  try {
    const data = await api('GET', '/admin/barista-log?limit=30')
    if (!data.length) { el.innerHTML = '<div class="loading">Действий пока нет</div>'; return }
    el.innerHTML = data.map(row => {
      const date = new Date(row.created_at).toLocaleString('ru', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
      const barista = row.barista_name || `#${row.barista_id}`
      const action  = ACTION_LABELS[row.barista_action] || row.barista_action
      const detail  = row.details ? ' · ' + formatLogDetail(row.barista_action, row.details) : ''
      return `<div class="log-row">
        <div class="log-row-action">${action}${detail}</div>
        <div class="log-row-meta">${barista} · ${date}</div>
      </div>`
    }).join('')
  } catch (e) { toast(e.message, true) }
}

function formatLogDetail(action, d) {
  // Б-А11: фолбэк на '—' вместо undefined/NaN, если поля нет в старых логах
  if (!d || typeof d !== 'object') return ''
  if (action === 'cup_added')      return `${d.cups_after ?? '—'}/${d.total_cups ?? '—'}`
  if (action === 'status_changed') return d.status || '—'
  if (action === 'birthday_set')   return d.birthday || '—'
  if (action === 'shift_closed')   return `${d.orders_count ?? 0} заказов`
  return ''
}

// ── СТАРТ ─────────────────────────────────────────────────────────────────────

if (TOKEN) {
  checkSetup()
} else {
  showScreen('login')
}
