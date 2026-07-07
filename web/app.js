const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, { cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...opts });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let currentUser = null;

// --- sessione / bootstrap ---
async function refresh() {
  const { status, body } = await api('/api/me');
  if (status !== 200) { showLogin(); return; }
  currentUser = body.user;
  $('#login-view').hidden = true;
  $('#app').hidden = false;
  $('#welcome').textContent = currentUser.username;
  $('#avatar').textContent = (currentUser.username[0] || '?').toUpperCase();
  $('#nav-utenti').hidden = currentUser.role !== 'admin';
  if (!location.hash) location.hash = '#home';
  route();
}

function showLogin() {
  currentUser = null;
  $('#app').hidden = true;
  $('#login-view').hidden = false;
}

// --- router hash ---
function route() {
  const view = (location.hash || '#home').slice(1);
  const known = ['home', 'arrivi', 'utenti'];
  let v = known.includes(view) ? view : 'home';
  // Utenti è riservato agli admin: reindirizza gli altri alla home
  if (v === 'utenti' && !(currentUser && currentUser.role === 'admin')) {
    location.hash = '#home';
    return;
  }
  const titoli = { home: 'Home', arrivi: 'Arrivi', utenti: 'Utenti' };
  $('#topbar-title').textContent = titoli[v] || 'Home';
  document.querySelectorAll('.view').forEach((el) => { el.hidden = true; });
  document.querySelectorAll('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.nav === v));
  $(`#view-${v}`).hidden = false;
  if (v === 'home') loadHome();
  else if (v === 'arrivi') initArrivi();
  else if (v === 'utenti') { if (currentUser && currentUser.role === 'admin') loadUsers(); }
}
window.addEventListener('hashchange', route);

// --- Home ---
function dataEstesa() {
  const s = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function loadHome() {
  $('#home-error').textContent = '';
  $('#home-date').textContent = dataEstesa();
  const { status, body } = await api('/api/dashboard');
  if (status !== 200) { $('#home-error').textContent = 'Impossibile leggere i dati dal PMS.'; return; }
  $('#kpi-arrivi').textContent = body.arrivi;
  $('#kpi-partenze').textContent = body.partenze;
  $('#kpi-presenti').textContent = body.presenti;
}

// --- Arrivi ---
let arriviInit = false;
function initArrivi() {
  if (!arriviInit) {
    const input = $('#arrivi-data');
    input.value = new Date().toISOString().slice(0, 10);
    input.addEventListener('change', loadArrivi);
    arriviInit = true;
  }
  loadArrivi();
}

async function loadArrivi() {
  const data = $('#arrivi-data').value || new Date().toISOString().slice(0, 10);
  const tab = $('#arrivi-tab');
  const msg = $('#arrivi-msg');
  const stato = $('#arrivi-stato');
  tab.hidden = true; msg.hidden = false; msg.textContent = 'Caricamento…'; stato.textContent = '';
  const { status, body } = await api(`/api/arrivi?data=${encodeURIComponent(data)}`);
  if (status !== 200) { msg.textContent = 'Errore nel leggere gli arrivi dal PMS.'; return; }
  const arrivi = body.arrivi || [];
  if (arrivi.length === 0) { msg.textContent = 'Nessun arrivo per questa data.'; stato.textContent = '0 arrivi'; return; }
  stato.textContent = `${arrivi.length} ${arrivi.length === 1 ? 'arrivo' : 'arrivi'}`;
  $('#arrivi-body').innerHTML = arrivi.map(rigaArrivo).join('');
  msg.hidden = true; tab.hidden = false;
}

const dash = '<span class="dash">—</span>';
function cell(v) { return v ? esc(v) : dash; }

function chipCamere(camere) {
  if (!camere) return dash;
  return camere.split(',').map((c) => `<span class="room">${esc(c.trim())}</span>`).join('');
}

function rigaArrivo(a) {
  const pax = a.paxBambini ? `${a.paxAdulti}+${a.paxBambini}` : `${a.paxAdulti}`;
  const stato = a.inCasa
    ? '<span class="pill pill-incasa">In casa</span>'
    : '<span class="pill pill-atteso">Atteso</span>';
  const partenza = a.dtpartenza ? a.dtpartenza.split('-').reverse().join('/') : null;
  return `
    <tr>
      <td class="cell-name">${a.nominativo ? esc(a.nominativo) : '<span class="dash">(senza nominativo)</span>'}</td>
      <td>${chipCamere(a.camere)}</td>
      <td class="cell-muted">${pax}</td>
      <td class="cell-muted">${a.notti}</td>
      <td class="cell-muted">${cell(partenza)}</td>
      <td class="cell-muted">${cell(a.oraArrivo)}</td>
      <td>${stato}</td>
      <td class="cell-muted">${cell(a.provenienza)}</td>
      <td class="cell-muted">${cell(a.trattamento)}</td>
      <td class="cell-note">${a.note ? esc(a.note) : ''}</td>
    </tr>`;
}

// --- Utenti (admin) ---
async function loadUsers() {
  const { body } = await api('/api/admin/users');
  $('#user-list').innerHTML = (body.users || [])
    .map((u) => `<li>
      <span class="u-name">${esc(u.username)}</span>
      <span class="role-tag ${u.attivo ? '' : 'off'}">${esc(u.role)}${u.attivo ? '' : ' · off'}</span>
    </li>`)
    .join('');
}

// --- eventi login/logout/crea utente ---
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const { status } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: f.username.value, password: f.password.value }),
  });
  if (status === 200) { f.reset(); $('#login-error').textContent = ''; refresh(); }
  else $('#login-error').textContent = 'Credenziali non valide';
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  showLogin();
});

$('#new-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const { status } = await api('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username: f.username.value, password: f.password.value, role: f.role.value }),
  });
  if (status === 201) { f.reset(); $('#new-user-error').textContent = ''; loadUsers(); }
  else $('#new-user-error').textContent = 'Errore nella creazione utente';
});

refresh();
