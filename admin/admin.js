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

  try {
    const orders = await api('GET', '/admin/orders?limit=20')
    renderOrders(orders)
  } catch {}
}

const STATUS_LABELS = { new: 'Новый', preparing: 'Готовится', ready: 'Готов', done: 'Выдан' }

function renderOrders(orders) {
  const list = document.getElementById('orders-list')
  if (!orders.length) { list.innerHTML = '<div class="loading">Заказов пока нет</div>'; return }
  list.innerHTML = orders.map(o => {
    const items = Array.isArray(o.items) ? o.items.map(i => `${i.name} ×${i.qty}`).join(', ') : ''
    const date = new Date(o.created_at).toLocaleString('ru', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
    const customer = o.customers?.first_name || o.customer_tg_id || '—'
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
  document.getElementById('f-photo-preview').classList.add('hidden')
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
  if (item.photo_url) {
    const prev = document.getElementById('f-photo-preview')
    prev.src = item.photo_url
    prev.classList.remove('hidden')
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

async function saveItem() {
  const body = {
    category:    document.getElementById('f-category').value,
    name:        document.getElementById('f-name').value.trim(),
    price:       Number(document.getElementById('f-price').value),
    volume:      document.getElementById('f-volume').value.trim(),
    description: document.getElementById('f-description').value.trim(),
    badge:       document.getElementById('f-badge').value || null,
  }
  if (!body.name || !body.price) { toast('Заполни название и цену', true); return }

  // Загрузить фото если выбрано
  const photoFile = document.getElementById('f-photo').files[0]
  if (photoFile) {
    try {
      const form = new FormData()
      form.append('image', photoFile)
      const { url } = await api('POST', '/admin/upload/image', form, true)
      body.photo_url = url
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
    closeItemForm()
    await loadMenu()
  } catch (e) { toast(e.message, true) }
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

async function loadBaristas() {
  try {
    const list = await api('GET', '/admin/baristas')
    const el = document.getElementById('baristas-list')
    if (!list.length) { el.innerHTML = '<div class="loading">Баристы не добавлены</div>'; return }
    el.innerHTML = list.map(b => `
      <div class="barista-row">
        <div>
          <div class="barista-name">${b.name}</div>
          <div class="barista-status">${b.active ? 'Активен' : 'Уволен'}</div>
        </div>
        <div class="barista-actions">
          <button onclick="changePin(${b.id}, '${b.name}')">PIN</button>
          <button onclick="toggleBarista(${b.id}, ${!b.active})" class="${b.active ? 'btn-ghost' : ''}">
            ${b.active ? 'Уволить' : 'Вернуть'}
          </button>
        </div>
      </div>
    `).join('')
  } catch {}
}

function showAddBarista() {
  const name = prompt('Имя бариста:')
  if (!name) return
  const pin = prompt('PIN (4 цифры):')
  if (!pin) return
  api('POST', '/admin/baristas', { name, pin })
    .then(() => { toast('Бариста добавлен'); loadBaristas() })
    .catch(e => toast(e.message, true))
}

function changePin(id, name) {
  const pin = prompt(`Новый PIN для ${name} (4 цифры):`)
  if (!pin) return
  api('PUT', `/admin/baristas/${id}/pin`, { pin })
    .then(() => toast('PIN изменён'))
    .catch(e => toast(e.message, true))
}

async function toggleBarista(id, active) {
  try {
    await api('PUT', `/admin/baristas/${id}/active`, { active })
    toast(active ? 'Доступ восстановлен' : 'Доступ закрыт')
    loadBaristas()
  } catch (e) { toast(e.message, true) }
}

// ── СТАРТ ─────────────────────────────────────────────────────────────────────

if (TOKEN) {
  checkSetup()
} else {
  showScreen('login')
}
