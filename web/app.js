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
  $('#welcome').textContent = `${currentUser.username} (${currentUser.role})`;
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
  document.querySelectorAll('.view').forEach((el) => { el.hidden = true; });
  document.querySelectorAll('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.nav === v));
  $(`#view-${v}`).hidden = false;
  if (v === 'home') loadHome();
  else if (v === 'arrivi') initArrivi();
  else if (v === 'utenti') { if (currentUser && currentUser.role === 'admin') loadUsers(); }
}
window.addEventListener('hashchange', route);

// --- Home ---
async function loadHome() {
  $('#home-error').textContent = '';
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
  const stato = $('#arrivi-stato');
  tab.hidden = true;
  stato.textContent = 'Caricamento…';
  const { status, body } = await api(`/api/arrivi?data=${encodeURIComponent(data)}`);
  if (status !== 200) { stato.textContent = 'Errore nel leggere gli arrivi dal PMS.'; return; }
  const arrivi = body.arrivi || [];
  if (arrivi.length === 0) { stato.textContent = 'Nessun arrivo per questa data.'; return; }
  stato.textContent = `${arrivi.length} arrivi`;
  $('#arrivi-body').innerHTML = arrivi.map((a) => `
    <tr>
      <td>${a.nominativo ? esc(a.nominativo) : '<em>(senza nominativo)</em>'}</td>
      <td>${a.camere ? esc(a.camere) : '—'}</td>
      <td>${a.paxAdulti}${a.paxBambini ? '+' + a.paxBambini : ''}</td>
      <td>${a.notti}</td>
      <td>${esc(a.dtpartenza)}</td>
      <td>${a.oraArrivo ? esc(a.oraArrivo) : '—'}</td>
      <td>${a.inCasa ? '<span class="badge badge-incasa">In casa</span>' : '<span class="badge badge-atteso">Atteso</span>'}</td>
      <td>${a.provenienza ? esc(a.provenienza) : '—'}</td>
      <td>${a.trattamento ? esc(a.trattamento) : '—'}</td>
      <td>${a.note ? esc(a.note) : ''}</td>
    </tr>`).join('');
  tab.hidden = false;
}

// --- Utenti (admin) ---
async function loadUsers() {
  const { body } = await api('/api/admin/users');
  $('#user-list').innerHTML = (body.users || [])
    .map((u) => `<li>${esc(u.username)} — ${esc(u.role)} ${u.attivo ? '' : '(disattivato)'}</li>`)
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
