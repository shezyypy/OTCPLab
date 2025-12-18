// static/js/app.js
console.log("✅ app.js loaded");

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/* -------------------------
   Init Telegram / user
   ------------------------- */
const tg = window.Telegram?.WebApp;
try { tg?.ready(); } catch(e){ /* ignore */ }

const query = new URLSearchParams(location.search);

const initUserFromTG = () => {
  try {
    const u = tg?.initDataUnsafe?.user;
    if (!u) return null;
    return {
      id: u.id,
      first_name: u.first_name || "",
      last_name: u.last_name || "",
      username: u.username || "",
      photo_url: u.photo_url || "/static/img/default-avatar.png"
    };
  } catch(e) { return null; }
};

const initUserFromParams = () => {
  const id = query.get("tg_user") || query.get("tgId") || query.get("tgId".toLowerCase());
  if (!id) return null;
  return {
    id: Number(id) || id,
    first_name: query.get("first_name") || query.get("name") || "Гость",
    last_name: query.get("last_name") || "",
    username: query.get("username") || "guest",
    photo_url: query.get("photo_url") || "/static/img/default-avatar.png"
  };
};

const user = initUserFromTG() || initUserFromParams() || { id: null, first_name: "Гость", username: "guest", photo_url: "/static/img/default-avatar.png" };
const USER_ID = user.id;
const API_HEADERS = {
  "Content-Type": "application/json",
  "X-TG-ID": USER_ID   // обязательно
};


console.log("Detected user:", user);

/* -------------------------
   Helper utilities
   ------------------------- */
function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
}

function isActiveStatus(s) {
  return String(s).toLowerCase() === "active";
}


/* -------------------------
   Theme & Tabs
   ------------------------- */
const THEME_KEY = "themePreference";
function applyTheme(theme) { document.body.setAttribute("data-theme", theme === "dark" ? "dark" : "light"); }
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) { applyTheme(saved); return; }
  const tgScheme = tg?.colorScheme;
  if (tgScheme) { applyTheme(tgScheme); return; }
  const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(systemDark ? 'dark' : 'light');
}
function createThemeToggle() {
  const header = document.querySelector('.app-header'); if (!header) return;
  if ($('#themeToggleBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'themeToggleBtn';
  btn.className = 'ml-3 p-2 rounded-full transition';
  btn.style.fontSize = '18px';
  btn.title = 'Переключить тему';
  btn.innerText = '🌓';
  btn.addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next); localStorage.setItem(THEME_KEY, next);
  });
  const nav = header.querySelector('#tabs'); if (nav) nav.insertAdjacentElement('afterend', btn); else header.appendChild(btn);
}

function initTabs() {
  document.querySelectorAll('#tabs button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#tabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const tab = b.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      const target = document.getElementById(tab); if (target) target.classList.add('active');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* -------------------------
   Welcome / Profile UI
   ------------------------- */
function initWelcome() {
  const name = user.first_name || 'Гость';
  const avatar = user.photo_url || '/static/img/default-avatar.png';
  const welcomeEl = $('#welcome') || $('#welcomeName');
  const avatarEl = $('#welcomeAvatar') || $('#userAvatar');
  if (welcomeEl) welcomeEl.innerText = `Привет, ${name}!`;
  if ($('#welcomeName')) $('#welcomeName').innerText = `Привет, ${name}!`;
  if (avatarEl) avatarEl.src = avatar;
  if ($('#userName')) $('#userName').innerText = `${user.first_name || 'Гость'} ${user.last_name || ''}`.trim();
  if ($('#userUsername')) $('#userUsername').innerText = user.username ? "@" + user.username : "@guest";
}

/* -------------------------
   Models (library)
   ------------------------- */
async function loadModels() {
  const wrap = $('#models'); if (!wrap) return;
  try {
    const res = await fetch('/api/models', { headers: API_HEADERS });
    const arr = await res.json();
    wrap.innerHTML = '';
    if (!Array.isArray(arr) || arr.length === 0) { wrap.innerHTML = '<div class="text-gray-500">Нет моделей</div>'; return; }
    arr.forEach(m => {
      const div = document.createElement('div');
      div.className = 'model flex items-center gap-3 bg-transparent p-2 rounded';
      div.innerHTML = `
        <div style="width:80px;height:80px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-right:8px;overflow:hidden;">
          ${m.image ? `<img src="${escapeHtml(m.image)}" style="width:100%;height:100%;object-fit:cover;">` : `<div class="text-sm text-gray-500">Нет фото</div>`}
        </div>
        <div style="flex:1">
          <div class="text-sm font-medium">${escapeHtml(m.title)}</div>
          <div class="text-xs text-gray-500 mt-1"><a href="${escapeHtml(m.file)}" target="_blank" class="text-blue-600 underline">Скачать</a></div>
        </div>
      `;
      wrap.appendChild(div);
    });
  } catch (e) {
    console.error("loadModels error", e);
    wrap.innerHTML = `<div class="text-sm text-red-500">Ошибка загрузки моделей</div>`;
  }
}

function initSubmitForm() {
  const form = $('#submitForm'); if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!USER_ID) { alert('Нужна авторизация Telegram для загрузки модели'); return; }
    const fd = new FormData(form);
    fd.append('tg_user', USER_ID);
    try {
      const res = await fetch('/api/models/upload', { method: 'POST', body: fd, headers: API_HEADERS });
      const j = await res.json();
      $('#submitResult').innerText = j.success ? j.message : (j.error || j.detail || 'Ошибка');
      if (j.success) form.reset();
      await loadModels();
      if (userIsAdmin) await loadPending();
    } catch (err) {
      console.error('submit error', err);
      $('#submitResult').innerText = 'Ошибка загрузки';
    }
  });
}

/* -------------------------
   Calendar & slots
   ------------------------- */
const calendarWrap = document.getElementById('calendar');
let selectedDayOffset = null;
function renderCalendar() {
  if (!calendarWrap) return;
  calendarWrap.innerHTML = '';
  for (let i=0;i<14;i++){
    const d = new Date(); d.setDate(d.getDate() + i);
    const dayBtn = document.createElement('div');
    dayBtn.className = 'day cursor-pointer inline-block px-3 py-2 rounded-md text-center bg-gray-800 text-white m-1';
    dayBtn.innerHTML = `<div>${d.toLocaleDateString()}</div><div class="text-xs">${d.toLocaleDateString(undefined,{weekday:'short'})}</div>`;
    dayBtn.addEventListener('click', () => {
      if (selectedDayOffset === i) {
        selectedDayOffset = null; dayBtn.classList.remove('selected');
        const existing = dayBtn.nextElementSibling;
        if (existing && existing.classList.contains('slots-block')) { existing.classList.remove('show'); setTimeout(()=>existing.remove(),400); }
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
  slotsContainer.innerHTML = '<div class="text-gray-500 text-sm">Загрузка слотов...</div>';
  try {
    const res = await fetch(`/api/slots/${offset}`, { headers: API_HEADERS });
    const arr = await res.json();
    const slotWrap = document.createElement('div');
    slotWrap.className = 'flex flex-wrap justify-center gap-3 mt-2';
    arr.forEach(slot => {
      const btn = document.createElement('button');
      const occupied = slot.occupied;
      btn.className = `slot-button px-4 py-2 rounded-lg font-medium ${ occupied ? 'bg-red-600 text-white cursor-not-allowed opacity-80' : 'bg-gray-700 hover:bg-gray-600 text-white' }`;
      btn.innerText = new Date(slot.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      btn.disabled = !!occupied;
      if (!occupied) btn.addEventListener('click', () => bookSlot(slot));
      slotWrap.appendChild(btn);
    });
    const selectedDay = document.querySelector('.day.selected');
    if (selectedDay) {
      const existing = selectedDay.nextElementSibling;
      if (existing && existing.classList.contains('slots-block')) { existing.classList.remove('show'); setTimeout(()=>existing.remove(),400); }
      const block = document.createElement('div'); block.className='slots-block w-full text-center mt-3 mb-5'; block.appendChild(slotWrap);
      selectedDay.insertAdjacentElement('afterend', block);
      setTimeout(()=>block.classList.add('show'),50);
    } else {
      slotsContainer.innerHTML = '';
      slotsContainer.appendChild(slotWrap);
    }
  } catch (e) {
    console.error("loadSlots error", e);
    slotsContainer.innerHTML = '<div class="text-red-500">Ошибка загрузки слотов</div>';
  }
}

async function bookSlot(slot) {
  if (!USER_ID) { alert('Авторизуйтесь через Telegram для бронирования'); return; }
  if (!confirm('Забронировать ' + new Date(slot.start).toLocaleString() + '?')) return;
  try {
    const payload = {
      start: slot.start,
      end: slot.end,
      tg_user: USER_ID,
      username: user.username || undefined,
      first_name: user.first_name || undefined,
      nickname: user.nickname || undefined
    };
    const res = await fetch('/api/book', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, API_HEADERS),
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      alert('✅ Забронировано');
      if (selectedDayOffset !== null) loadSlots(selectedDayOffset);
      loadMyBookings();
      if (userIsAdmin) loadAdminBookings();
    } else {
      const text = await res.text();
      alert('❌ Ошибка бронирования: ' + text);
    }
  } catch (e) {
    console.error('book error', e);
    alert('Ошибка бронирования');
  }
}


/* -------------------------
   My bookings (profile)
   ------------------------- */
async function loadMyBookings() {
  const wrap = document.getElementById('myBookings');
  if (!wrap) return;
  if (!USER_ID) {
    wrap.innerHTML = '<div class="text-gray-500">Войдите через Telegram чтобы видеть брони</div>';
    return;
  }

  try {
    const res = await fetch(`/api/bookings?tg_user=${USER_ID}`, { headers: API_HEADERS });
    if (!res.ok) {
      wrap.innerHTML = '<div class="text-red-500">Ошибка загрузки</div>';
      return;
    }
    const arr = await res.json();
    wrap.innerHTML = '';
    if (!Array.isArray(arr) || arr.length === 0) {
      wrap.innerHTML = '<p class="text-gray-500">У вас нет бронирований.</p>';
      return;
    }

    // Фильтруем и показываем только активные брони
    const activeBookings = arr.filter(b => String(b.status).toLowerCase() === "active");


    if (activeBookings.length === 0) {
      wrap.innerHTML = '<p class="text-gray-500">У вас нет активных бронирований.</p>';
      return;
    }

    activeBookings.forEach(b => {
      const el = document.createElement('div');
      el.className = 'flex justify-between items-center p-3 bg-gray-700 rounded-lg';
      const left = document.createElement('div');
      left.innerHTML = `<p>${escapeHtml(b.title || 'Бронирование')}</p>
                        <p class="text-sm text-gray-300">${new Date(b.start).toLocaleString()} — ${new Date(b.end).toLocaleString()}</p>`;
      const right = document.createElement('div');

      const btn = document.createElement('button');
      btn.className = 'text-red-400 hover:text-red-600 font-semibold';
      btn.innerText = 'Отменить';
      btn.addEventListener('click', () => cancelBooking(b.id));
      right.appendChild(btn);

      el.appendChild(left);
      el.appendChild(right);
      wrap.appendChild(el);
    });

  } catch (e) {
    console.error("loadMyBookings error", e);
    wrap.innerHTML = '<div class="text-red-500">Ошибка</div>';
  }
}



/* cancel booking (client) */
async function cancelBooking(bookingId) {
  if (!USER_ID) return alert("Нет TG_ID");
  if (!confirm("Отменить бронирование?")) return;
  try {
    const res = await fetch('/api/book/cancel', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type':'application/json' }, API_HEADERS),
      body: JSON.stringify({ booking_id: bookingId, tg_user: USER_ID })
    });
    const j = await res.json();
    if (res.ok && j.ok) {
      alert('Бронирование отменено');
      loadMyBookings();
      if (selectedDayOffset !== null) loadSlots(selectedDayOffset);
      if (userIsAdmin) loadAdminBookings();
    } else {
      alert('Ошибка: ' + (j.error || j.detail || JSON.stringify(j)));
    }
  } catch (e) {
    console.error('cancelBooking error', e);
    alert('Ошибка отмены брони');
  }
}

/* -------------------------
   Admin area
   ------------------------- */
let userIsAdmin = false;

async function checkAdminAndInit() {
  if (!USER_ID) return;
  try {
    const res = await fetch(`/api/user_is_admin/${USER_ID}`, { headers: API_HEADERS });
    if (!res.ok) { console.warn('user_is_admin failed'); return; }
    const j = await res.json();
    userIsAdmin = !!j.is_admin;
    const adminTabBtn = $('#adminTab');
    const adminPanel = $('#admin');
    if (userIsAdmin) {
      if (adminTabBtn) adminTabBtn.style.display = '';
      if (adminPanel) adminPanel.style.display = '';
      // load admin data
      await loadAdminBookings();
      await loadPending();
      await loadUsersStats();
    } else {
      if (adminTabBtn) adminTabBtn.style.display = 'none';
      if (adminPanel) adminPanel.style.display = 'none';
    }
  } catch (e) {
    console.error('checkAdmin error', e);
  }
}

async function loadAdminBookings() {
  try {
    const res = await fetch('/api/admin/bookings', { headers: API_HEADERS });
    if (!res.ok) return;
    const arr = await res.json();
    const wrap = document.getElementById('adminBookings');
    if (!wrap) return;
    wrap.innerHTML = '';

    // Фильтруем активные бронирования
    const activeBookings = arr.filter(b => isActiveStatus(b.status));

    if (!activeBookings.length) {
      wrap.innerHTML = `<p class="text-gray-500">Активных бронирований пока нет.</p>`;
      return;
    }

    activeBookings.forEach(b => {
      const el = document.createElement('div');
      el.className = 'flex justify-between items-center p-3 bg-gray-700 rounded-lg';
      el.innerHTML = `
        <div>
          <p class="font-medium">${escapeHtml(b.title || 'Бронирование')}</p>
          <p class="text-sm text-gray-300">
            ${new Date(b.start).toLocaleString()} — ${new Date(b.end).toLocaleString()}<br>
            <span class="text-gray-400">Пользователь: ${escapeHtml(b.user_name || 'неизвестно')} (${escapeHtml(String(b.tg_user))})</span>
          </p>
        </div>
      `;
      const btn = document.createElement('button');
      btn.className = 'text-red-400 hover:text-red-600 font-semibold';
      btn.innerText = 'Отменить';
      btn.addEventListener('click', () => adminCancelBooking(b.id));
      el.appendChild(btn);
      wrap.appendChild(el);
    });
  } catch (e) {
    console.error('loadAdminBookings error', e);
  }
}


async function adminCancelBooking(id) {
  if (!confirm("Отменить бронирование?")) return;
  try {
    const res = await fetch('/api/cancel_booking/' + id, { method: 'POST', headers: API_HEADERS });
    if (res.ok) { alert('Бронирование отменено'); loadAdminBookings(); if (selectedDayOffset !== null) loadSlots(selectedDayOffset); loadMyBookings(); }
    else {
      const j = await res.json().catch(()=>null);
      alert('Ошибка: ' + (j?.detail || j?.message || 'unknown'));
    }
  } catch (e) {
    console.error('adminCancelBooking error', e);
    alert('Ошибка');
  }
}

/* Pending models (admin) */
async function loadPending() {
  const wrap = document.getElementById('pending'); if (!wrap) return;
  try {
    const res = await fetch('/api/pending_models', { headers: API_HEADERS });
    if (!res.ok) { wrap.innerHTML = '<div class="text-gray-500">Нет доступа</div>'; return; }
    const arr = await res.json();
    wrap.innerHTML = '';
    if (!arr.length) { wrap.innerHTML = '<p class="text-gray-500">Нет моделей на модерации.</p>'; return; }
    arr.forEach(m => {
      const el = document.createElement('div'); el.className = 'p-3 bg-gray-700 rounded-lg flex items-center gap-3';
      el.innerHTML = `
        <div style="width:80px;height:80px;overflow:hidden;border-radius:8px;background:#111">${m.image ? `<img src="${escapeHtml(m.image)}" style="width:100%;height:100%;object-fit:cover;">` : 'No image'}</div>
        <div style="flex:1">
          <div class="font-medium">${escapeHtml(m.title)}</div>
          <div class="text-sm text-gray-400">От: ${escapeHtml(String(m.submitter))}</div>
        </div>
      `;
      const actions = document.createElement('div'); actions.className='flex flex-col gap-2';
      const approveBtn = document.createElement('button'); approveBtn.className='btn-primary px-3 py-1'; approveBtn.innerText='Одобрить';
      approveBtn.addEventListener('click', () => approveModel(m.id));
      const rejectBtn = document.createElement('button'); rejectBtn.className='text-red-400 px-3 py-1'; rejectBtn.innerText='Отклонить';
      rejectBtn.addEventListener('click', () => rejectModel(m.id));
      actions.appendChild(approveBtn); actions.appendChild(rejectBtn);
      el.appendChild(actions);
      wrap.appendChild(el);
    });
  } catch (e) {
    console.error('loadPending error', e);
  }
}

async function approveModel(pendingId) {
  try {
    const res = await fetch('/api/admin/approve_model', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, API_HEADERS), body: JSON.stringify({ pending_id: pendingId })});
    if (res.ok) { alert('Одобрено'); loadPending(); loadModels(); }
    else { alert('Ошибка'); }
  } catch (e) { console.error('approve error', e); alert('Ошибка'); }
}

async function rejectModel(pendingId) {
  try {
    const res = await fetch('/api/admin/reject_model', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, API_HEADERS), body: JSON.stringify({ pending_id: pendingId })});
    if (res.ok) { alert('Отклонено'); loadPending(); }
    else { alert('Ошибка'); }
  } catch (e) { console.error('reject error', e); alert('Ошибка'); }
}

/* Users stats (admin) */
async function loadUsersStats() {
  try {
    const res = await fetch('/api/users', { headers: API_HEADERS });
    if (!res.ok) return;
    const arr = await res.json();
    const wrap = document.getElementById('usersStats'); if (!wrap) return;
    wrap.innerHTML = '';
    arr.forEach(u => {
      const el = document.createElement('div'); el.className = 'p-2 bg-gray-800 rounded-lg';
      el.innerHTML = `
        <p class="font-medium">${escapeHtml(u.first_name || 'Гость')}</p>
        <p class="text-xs text-gray-400">@${escapeHtml(u.username || 'guest')}</p>
        <p class="text-xs text-gray-400">Броней: ${escapeHtml(String(u.booking_count || 0))}</p>
      `;
      wrap.appendChild(el);
    });
  } catch (e) { console.error('loadUsersStats error', e); }
}

/* Bookings by date (admin helper) */
async function loadBookingsByDate() {
  const date = document.getElementById("search-date").value;
  if (!date) { alert("Выберите дату"); return; }
  try {
    const resp = await fetch(`/api/bookings/by_date?date=${encodeURIComponent(date)}`, { headers: API_HEADERS });
    if (!resp.ok) { alert('Ошибка'); return; }
    const data = await resp.json();
    const table = document.getElementById("date-table"); table.innerHTML = "";
    if (!Array.isArray(data) || !data.length) {
      table.innerHTML = `<tr><td colspan="4" class="p-2 text-center text-gray-500">Нет бронирований на эту дату</td></tr>`;
      return;
    }
    data.forEach(b => {
      const row = document.createElement('tr');
      row.innerHTML = `<td class="p-2">${escapeHtml(String(b.id))}</td><td class="p-2">${escapeHtml(String(b.tg_user))}</td><td class="p-2">${escapeHtml(new Date(b.start).toLocaleString())}</td><td class="p-2">${escapeHtml(new Date(b.end).toLocaleString())}</td>`;
      table.appendChild(row);
    });
  } catch (e) {
    console.error('loadBookingsByDate error', e);
    alert('Ошибка');
  }
}

/* -------------------------
   Initialization
   ------------------------- */
function bindHeaderActions() { createThemeToggle(); }

async function initAll() {
  initTheme(); createThemeToggle(); initTabs(); initWelcome(); bindHeaderActions();
  await loadModels(); initSubmitForm(); renderCalendar();
  await loadMyBookings();
  await checkAdminAndInit();
  // Polling updates
  setInterval(()=>{ if (selectedDayOffset !== null) loadSlots(selectedDayOffset); loadMyBookings(); if (userIsAdmin) loadAdminBookings(); }, 30000);
}

/* Expose some functions globally required by inline onclicks (if any) */
window.loadBookingsByDate = loadBookingsByDate;
window.approveModel = approveModel;
window.rejectModel = rejectModel;
window.adminCancelBooking = adminCancelBooking;
window.loadSlots = loadSlots;

/* Start */
document.addEventListener('DOMContentLoaded', () => {
  initAll().catch(e => console.error('init error', e));
});
