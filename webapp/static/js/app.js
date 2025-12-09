// /static/js/app.js
// Полный клиентский скрипт для 3D Printer MiniApp
// Функции: tabs, telegram init, theme toggle, models, submit model,
// calendar с аккордеоном слотов, бронирование, личный кабинет, админ-панель
console.log("✅ app.js loaded");

// -------------------- ИНИЦИАЛИЗАЦИЯ TELEGRAM --------------------
const tg = window.Telegram?.WebApp;
try { tg?.expand(); } catch (e) { /* ignore */ }

const initUser = tg?.initDataUnsafe?.user;
const myId = initUser?.id;
const ADMIN_ID = 1127824573;

// Helper: safe element getter
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// -------------------- THEME TOGGLE --------------------
const THEME_KEY = 'themePreference';

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  // update toggle UI if present
  const btn = $('#themeToggleBtn');
  if (btn) {
    btn.setAttribute('aria-pressed', theme === 'dark');
    btn.innerText = theme === 'dark' ? '🌙' : '☀️';
  }
}

function initTheme() {
  // priority: saved preference -> Telegram colorScheme -> system
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) {
    applyTheme(saved);
    return;
  }
  const tgScheme = tg?.colorScheme;
  if (tgScheme) {
    applyTheme(tgScheme);
    return;
  }
  const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(systemDark ? 'dark' : 'light');
}

function createThemeToggle() {
  const header = document.querySelector('.app-header');
  if (!header) return;

  // create button container if not exists
  if (!$('#themeToggleBtn')) {
    const btn = document.createElement('button');
    btn.id = 'themeToggleBtn';
    btn.className = 'ml-3 p-2 rounded-full transition';
    btn.style.fontSize = '18px';
    btn.title = 'Переключить тему';
    btn.setAttribute('aria-pressed', 'false');

    btn.addEventListener('click', () => {
      const current = document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem(THEME_KEY, next);
    });

    // place button to the right inside header (after nav)
    // find nav and insert after
    const nav = header.querySelector('#tabs');
    if (nav) nav.insertAdjacentElement('afterend', btn);
    else header.appendChild(btn);
  }
  // ensure initial state
  applyTheme(localStorage.getItem(THEME_KEY) || tg?.colorScheme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}

// -------------------- TABS (вкладки) --------------------
function initTabs() {
  document.querySelectorAll('#tabs button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#tabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');

      const tab = b.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      const target = document.getElementById(tab);
      if (target) target.classList.add('active');

      // focus behavior for accessibility
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // quick buttons on home that have data-tab attribute
  document.querySelectorAll('.quick-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      const tabBtn = document.querySelector(`#tabs button[data-tab="${tab}"]`);
      if (tabBtn) tabBtn.click();
    });
  });
}

// -------------------- WELCOME / USER --------------------
function initWelcome() {
  const welcomeEl = $('#welcome') || $('#welcomeName');
  const avatarEl = $('#welcomeAvatar') || $('#userAvatar');
  const name = initUser?.first_name || 'Гость';
  const username = initUser?.username ? `@${initUser.username}` : '@guest';

  if (welcomeEl) welcomeEl.innerText = `Привет, ${name}!`;
  if ($('#welcomeName')) $('#welcomeName').innerText = `Привет, ${name}!`;
  if (avatarEl && initUser?.photo_url) avatarEl.src = initUser.photo_url;
}

// -------------------- ADMIN TAB VISIBILITY --------------------
function initAdminVisibility() {
  const adminTabBtn = $('#adminTab');
  const adminPanel = $('#admin');

  if (!initUser) return;

  // Список админов (по username или ID)
  const ADMINS = ['shezyyy'];
  const ADMIN_IDS = [1127824573];

  const isAdmin =
    (initUser.username && ADMINS.includes(initUser.username)) ||
    (initUser.id && ADMIN_IDS.includes(initUser.id));

  // Скрываем или показываем элементы
  if (adminTabBtn) adminTabBtn.style.display = isAdmin ? '' : 'none';
  if (adminPanel) adminPanel.style.display = isAdmin ? '' : 'none';
}


// -------------------- MODELS (Библиотека) --------------------
async function loadModels() {
  const wrap = $('#models');
  if (!wrap) return;
  try {
    const res = await fetch('/api/models');
    if (!res.ok) { wrap.innerHTML = `<div class="text-sm text-red-500">Ошибка загрузки моделей</div>`; return; }
    const arr = await res.json();
    wrap.innerHTML = '';
    arr.forEach(m => {
      const div = document.createElement('div');
      div.className = 'model flex items-center gap-3 bg-transparent p-2 rounded';
      div.innerHTML = `
        <div style="width:80px;height:80px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-right:8px;overflow:hidden;">
          ${m.image ? `<img src="${m.image}" style="width:100%;height:100%;object-fit:cover;">` : `<div class="text-sm text-gray-500">Нет фото</div>`}
        </div>
        <div style="flex:1">
          <div class="text-sm font-medium">${escapeHtml(m.title)}</div>
          <div class="text-xs text-gray-500 mt-1"><a href="${m.file}" target="_blank" class="text-blue-600 underline">Скачать</a></div>
        </div>
      `;
      wrap.appendChild(div);
    });
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="text-sm text-red-500">Ошибка: ${e.message}</div>`;
  }
}

// simple HTML escaper
function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
  });
}

// submit model form
function initSubmitForm() {
  const form = $('#submitForm');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    fd.append('tg_user', initUser?.id || '');

    try {
      const res = await fetch('/api/submit_model', { method: 'POST', body: fd });
      const j = await res.json();

      // Показываем сообщение от сервера
      $('#submitResult').innerText = j.success ? j.message : (j.error || 'Ошибка');

      if (j.success) form.reset();

      // обновляем pending модели для админа
      if (myId === ADMIN_ID) loadPending();
    } catch (err) {
      $('#submitResult').innerText = 'Успешно отправлено!';
      console.error(err);
    }
  });
}

// -------------------- CALENDAR (аккордеон дат -> слоты) --------------------
const calendarWrap = document.getElementById('calendar');
const slotsContainer = document.getElementById('slotsContainer');
let selectedDayOffset = null;

function renderCalendar() {
  calendarWrap.innerHTML = '';

  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);

    const dayBtn = document.createElement('div');
    dayBtn.className = 'day cursor-pointer inline-block px-3 py-2 rounded-md text-center bg-gray-800 text-white m-1';
    dayBtn.innerHTML = `<div>${d.toLocaleDateString()}</div><div class="text-xs">${d.toLocaleDateString(undefined, { weekday: 'short' })}</div>`;

    dayBtn.addEventListener('click', () => {
      const selectedDay = document.querySelector('.day.selected');

      if (selectedDayOffset === i) {
        // клик на уже выбранную дату — скрываем блок
        selectedDayOffset = null;
        dayBtn.classList.remove('selected');

        const existing = dayBtn.nextElementSibling;
        if (existing && existing.classList.contains('slots-block')) {
          existing.classList.remove('show'); // плавное скрытие
          setTimeout(() => existing.remove(), 400); // удалить после transition
        }
      } else {
        selectedDayOffset = i;
        document.querySelectorAll('.day').forEach(x => x.classList.remove('selected'));
        dayBtn.classList.add('selected');
        loadSlots(i);
      }
    });

    calendarWrap.appendChild(dayBtn);
  }
}


async function loadSlots(offset) {
  const slotsContainer = document.getElementById("slotsContainer");
  if (!slotsContainer) return;

  slotsContainer.innerHTML = "";

  slotsContainer.innerHTML = '<div class="text-gray-500 text-sm">Загрузка слотов...</div>';
  if (slotsContainer) slotsContainer.innerHTML = '<div class="text-gray-500 text-sm">Загрузка слотов...</div>';
  const res = await fetch(`/api/slots/${offset}`);
  const arr = await res.json();

  const slotWrap = document.createElement('div');
  slotWrap.className = 'flex flex-wrap justify-center gap-3 mt-2 transition-all duration-300';

  arr.forEach(slot => {
    const btn = document.createElement('button');

    btn.className = `slot-button px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
      slot.occupied
        ? 'bg-red-600 text-white cursor-not-allowed opacity-80'
        : 'bg-gray-700 hover:bg-gray-600 text-white'
    }`;

    btn.innerText = new Date(slot.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    btn.disabled = slot.occupied;

    if (!slot.occupied) {
      btn.addEventListener('click', () => bookSlot(slot));
    }

    slotWrap.appendChild(btn);
  });

  // --- плавный блок слотов ---
  const selectedDay = document.querySelector('.day.selected');

  if (selectedDay) {
    // удаляем предыдущий блок, если есть
    const existing = selectedDay.nextElementSibling;
    if (existing && existing.classList.contains('slots-block')) {
      existing.classList.remove('show');
      setTimeout(() => existing.remove(), 400); // ждем окончания transition
    }

    const block = document.createElement('div');
    block.className = 'slots-block w-full text-center mt-3 mb-5';
    block.appendChild(slotWrap);
    selectedDay.insertAdjacentElement('afterend', block);


    setTimeout(() => block.classList.add('show'), 50);

    // плавно показать
    requestAnimationFrame(() => {
      block.classList.add('show');
    });
  }
}





async function bookSlot(slot) {
  if (!confirm('Забронировать ' + new Date(slot.start).toLocaleString() + '?')) return;

  const payload = {
    start: slot.start,
    end: slot.end,
    tg_user: initUser?.id || null,
  };

  const res = await fetch('/api/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    alert('✅ Забронировано');
    if (selectedDayOffset !== null) loadSlots(selectedDayOffset);
    loadMyBookings();
  } else {
    const text = await res.text();
    console.error('Ошибка бронирования:', text);
    alert('❌ Ошибка бронирования: ' + text);
  }
}

// ====== Отмена брони для клиента ======
async function cancelBooking(id) {
  if (!confirm("Отменить бронирование?")) return;
  const res = await fetch('/api/book/cancel', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({booking_id: id})
  });
  if (res.ok) {
    alert('Бронирование отменено');
    loadMyBookings();
    if (selectedDayOffset !== null) loadSlots(selectedDayOffset);
  } else alert('Ошибка');
}

// ====== Загрузка бронирований клиента ======
async function loadMyBookings() {
  const res = await fetch(`/api/bookings?tg_user=${initUser?.id || ''}`);
  const arr = await res.json();
  const wrap = document.getElementById('myBookings');
  wrap.innerHTML = '';
  arr.forEach(b => {
    const el = document.createElement('div');
    el.className = 'flex justify-between items-center p-3 bg-gray-700 rounded-lg';
    el.innerHTML = `
      <div>
        <p>${b.title || "Бронирование"}</p>
        <p class="text-sm text-gray-300">${new Date(b.start).toLocaleString()} — ${new Date(b.end).toLocaleString()}</p>
      </div>
      <button class="text-red-400 hover:text-red-600 font-semibold" onclick="cancelBooking(${b.id})">Отменить</button>
    `;
    wrap.appendChild(el);
  });
}

// -------------------- ADMIN: BOOKINGS, PENDING MODELS, USERS STATS --------------------
// ====== Загрузка всех бронирований для админа ======
async function loadAdminBookings() {
  const res = await fetch('/api/bookings?all=true');
  const arr = await res.json();
  const wrap = document.getElementById('adminBookings');
  wrap.innerHTML = '';

  if (arr.length === 0) {
    wrap.innerHTML = `<p class="text-gray-500">Бронирований пока нет.</p>`;
    return;
  }

  arr.forEach(b => {
    const el = document.createElement('div');
    el.className = 'flex justify-between items-center p-3 bg-gray-700 rounded-lg';
    el.innerHTML = `
      <div>
        <p class="font-medium">${b.title || 'Бронирование'}</p>
        <p class="text-sm text-gray-300">
          ${new Date(b.start).toLocaleString()} — ${new Date(b.end).toLocaleString()}<br>
          <span class="text-gray-400">Пользователь: ${b.user_name || 'неизвестно'} (@${b.tg_user || 'guest'})</span>
        </p>
      </div>
      <button class="text-red-400 hover:text-red-600 font-semibold" onclick="adminCancelBooking(${b.id})">Отменить</button>
    `;
    wrap.appendChild(el);
  });
}

// ====== Отмена брони админом ======
async function adminCancelBooking(id) {
  if (!confirm("Отменить бронирование?")) return;
  const res = await fetch('/api/book/cancel', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({booking_id: id})
  });
  if (res.ok) {
    alert('Бронирование отменено');
    loadAdminBookings();
    if (selectedDayOffset !== null) loadSlots(selectedDayOffset);
    loadMyBookings();
  } else alert('Ошибка');
}

// ====== Загрузка всех пользователей ======
async function loadUsersStats() {
  const res = await fetch('/api/users');
  const arr = await res.json();
  const wrap = document.getElementById('usersStats');
  wrap.innerHTML = '';

  arr.forEach(u => {
    const el = document.createElement('div');
    el.className = 'p-2 bg-gray-800 rounded-lg';
    el.innerHTML = `
      <p class="font-medium">${u.first_name || 'Гость'}</p>
      <p class="text-xs text-gray-400">@${u.username || 'guest'}</p>
      <p class="text-xs text-gray-400">Броней: ${u.booking_count || 0}</p>
    `;
    wrap.appendChild(el);
  });
}

// ====== Загрузка на старте ======
if (myId === ADMIN_ID) {
  loadAdminBookings();
  loadUsersStats();
}

// -------------------- ЛИЧНЫЙ КАБИНЕТ: аватар, имя, ник (localStorage) --------------------
// -------------------- ЛИЧНЫЙ КАБИНЕТ: аватар, имя, ник (localStorage) --------------------
function initProfile() {
  const nameEl = $('#userName');
  const usernameEl = $('#userUsername');
  const avatarEl = $('#userAvatar');
  const fileInput = $('#avatarInput');

  // Загружаем сохраненные данные
  const savedAvatar = localStorage.getItem('userAvatar');
  const savedName = localStorage.getItem('userName');
  const savedUsername = localStorage.getItem('userUsername');

  // Данные из Telegram
  const tgUser = initUser;
  const name = savedName || tgUser?.first_name || 'Гость';
  const username = savedUsername || (tgUser?.username ? `@${tgUser.username}` : '@guest');
  const avatar = savedAvatar || tgUser?.photo_url || '/static/img/default-avatar.png';

  // Устанавливаем значения
  if (nameEl) nameEl.value = name;
  if (usernameEl) usernameEl.value = username;
  if (avatarEl) avatarEl.src = avatar;

  // === Сохранение имени и ника при изменении ===
  if (nameEl) {
    nameEl.addEventListener('blur', () => {
      const newName = nameEl.value.trim() || 'Гость';
      localStorage.setItem('userName', newName);
      const welcomeName = $('#welcomeName');
      if (welcomeName) welcomeName.innerText = `Привет, ${newName}!`;
    });
  }

  if (usernameEl) {
    usernameEl.addEventListener('blur', () => {
      let newUsername = usernameEl.value.trim();
      if (!newUsername.startsWith('@')) newUsername = '@' + newUsername;
      localStorage.setItem('userUsername', newUsername);
      usernameEl.value = newUsername; // нормализуем отображение
    });
  }


  // === Загрузка и предпросмотр аватарки ===
  if (fileInput && avatarEl) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result;
        avatarEl.src = base64;
        localStorage.setItem('userAvatar', base64);

        // также обновляем аватарку приветствия, если она есть
        const welcomeAvatar = $('#welcomeAvatar');
        if (welcomeAvatar) welcomeAvatar.src = base64;
      };
      reader.readAsDataURL(file);
    });
  }
}


// -------------------- INITIALIZATION --------------------
function bindHeaderActions() {
  // add theme toggle
  createThemeToggle();

  // create "Admin Refresh" controls (if admin)
  if (myId === ADMIN_ID) {
    // nothing additional here; loadPending etc. will run
  }
}

async function initAll() {
  initTheme();
  createThemeToggle();
  initTabs();
  initWelcome();
  initAdminVisibility();
  bindHeaderActions();

  await loadModels();
  initSubmitForm();
  initCalendar();
  initProfile();

  // load bookings lists
  await loadMyBookings();
  if (myId === ADMIN_ID) {
    await loadAdminBookings();
    await loadPending();
    await loadUserStats();
  }

  // bind admin refresh button if exist (older template)
  const loadBookingsBtn = $('#loadBookings');
  if (loadBookingsBtn) {
    loadBookingsBtn.addEventListener('click', async () => {
      // show all bookings quickly
      const res = await fetch('/api/bookings?all=true');
      if (!res.ok) { alert('Ошибка'); return; }
      const arr = await res.json();
      const s = arr.map(a => `${a.id}: ${new Date(a.start).toLocaleString()} (${a.tg_user})`).join('\n');
      alert(s || 'Пусто');
    });
  }

  // if older export button exists: hide or rebind harmlessly
  const exportBtn = $('#exportExcel');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      alert('Выгрузка БД отключена — используйте модерацию в админке.');
    });
  }

    // === Автообновление каждые 30 секунд ===
  setInterval(() => {
    console.log("🔄 Auto-refreshing slots and bookings...");
    if (selectedDayOffset !== null) {
      loadSlots(selectedDayOffset); // обновляем слоты выбранного дня
    }
    loadMyBookings(); // обновляем список "Мои бронирования"
    if (myId === ADMIN_ID) {
      loadAdminBookings(); // обновляем список в админке
    }
  }, 30000); // каждые 30 секунд

}

// run
document.addEventListener('DOMContentLoaded', () => {
  initAll().catch(e => console.error('init error', e));
});

document.addEventListener('DOMContentLoaded', () => {
  loadMyBookings();
});

function initCalendar() {
  renderCalendar();
}

