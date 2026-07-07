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
  const known = ['home', 'arrivi', 'incasa', 'utenti'];
  let v = known.includes(view) ? view : 'home';
  // Utenti è riservato agli admin: reindirizza gli altri alla home
  if (v === 'utenti' && !(currentUser && currentUser.role === 'admin')) {
    location.hash = '#home';
    return;
  }
  const titoli = { home: 'Home', arrivi: 'Arrivi', incasa: 'In casa', utenti: 'Utenti' };
  $('#topbar-title').textContent = titoli[v] || 'Home';
  document.querySelectorAll('.view').forEach((el) => { el.hidden = true; });
  document.querySelectorAll('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.nav === v));
  $(`#view-${v}`).hidden = false;
  if (v === 'home') loadHome();
  else if (v === 'arrivi') initArrivi();
  else if (v === 'incasa') initInCasa();
  else if (v === 'utenti') { if (currentUser && currentUser.role === 'admin') loadUsers(); }
}
window.addEventListener('hashchange', route);

// --- Home ---
function dataEstesa(iso) {
  const d = iso ? new Date(iso + 'T00:00:00') : new Date();
  const s = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function loadHome() {
  $('#home-error').textContent = '';
  const { status, body } = await api('/api/dashboard');
  if (status !== 200) { $('#home-error').textContent = 'Impossibile leggere i dati dal PMS.'; return; }
  $('#home-date').textContent = dataEstesa(body.data);
  $('#kpi-arrivi').textContent = body.arrivi;
  $('#kpi-partenze').textContent = body.partenze;
  $('#kpi-presenti').textContent = body.presenti;
}

// Ricerca unica: numero camera, numero prenotazione (codpratica) o cliente.
function matchRicerca(a, term) {
  const t = (term || '').trim().toLowerCase();
  if (!t) return true;
  return String(a.codpratica).includes(t)
    || (a.camere || '').toLowerCase().includes(t)
    || (a.nominativo || '').toLowerCase().includes(t);
}

// --- Arrivi ---
let arriviInit = false;
let arriviAll = [];
function initArrivi() {
  if (!arriviInit) {
    $('#arrivi-data').addEventListener('change', loadArrivi);
    $('#arrivi-search').addEventListener('input', renderArrivi);
    arriviInit = true;
  }
  loadArrivi();
}

async function loadArrivi() {
  const input = $('#arrivi-data');
  const tab = $('#arrivi-tab');
  const msg = $('#arrivi-msg');
  const stato = $('#arrivi-stato');
  tab.hidden = true; msg.hidden = false; msg.textContent = 'Caricamento…'; stato.textContent = '';
  const q = input.value ? `?data=${encodeURIComponent(input.value)}` : '';
  const { status, body } = await api(`/api/arrivi${q}`);
  if (status !== 200) { msg.textContent = 'Errore nel leggere gli arrivi dal PMS.'; return; }
  if (!input.value && body.data) input.value = body.data; // data di lavoro dal server
  arriviAll = body.arrivi || [];
  renderArrivi();
}

function renderArrivi() {
  const tab = $('#arrivi-tab');
  const msg = $('#arrivi-msg');
  const stato = $('#arrivi-stato');
  const lista = arriviAll.filter((a) => matchRicerca(a, $('#arrivi-search').value));
  if (lista.length === 0) {
    tab.hidden = true; msg.hidden = false;
    msg.textContent = arriviAll.length === 0 ? 'Nessun arrivo per questa data.' : 'Nessun risultato per la ricerca.';
    stato.textContent = `${arriviAll.length} ${arriviAll.length === 1 ? 'arrivo' : 'arrivi'}`;
    return;
  }
  stato.textContent = lista.length === arriviAll.length
    ? `${arriviAll.length} ${arriviAll.length === 1 ? 'arrivo' : 'arrivi'}`
    : `${lista.length} di ${arriviAll.length}`;
  $('#arrivi-body').innerHTML = lista.map(rigaArrivo).join('');
  msg.hidden = true; tab.hidden = false;
}

const dash = '<span class="dash">—</span>';
function cell(v) { return v ? esc(v) : dash; }
const euro = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

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
  const noteRow = a.note
    ? `<tr class="note-row"><td colspan="11"><span class="note-label">Note</span>${esc(a.note)}</td></tr>`
    : '';
  return `
    <tr class="arr-row${a.note ? ' has-note' : ''}">
      <td class="prat">${esc(a.codpratica)}</td>
      <td class="cell-name">${a.nominativo ? esc(a.nominativo) : '<span class="dash">(senza nominativo)</span>'}</td>
      <td>${chipCamere(a.camere)}</td>
      <td class="cell-muted">${pax}</td>
      <td class="cell-muted">${a.notti}</td>
      <td class="cell-muted">${cell(partenza)}</td>
      <td class="cell-muted">${cell(a.oraArrivo)}</td>
      <td>${stato}</td>
      <td class="cell-muted">${cell(a.trattamento)}</td>
      <td class="cell-muted">${cell(a.tariffa)}</td>
      <td class="cell-num">${a.importo != null ? euro(a.importo) : dash}</td>
    </tr>${noteRow}`;
}

// --- Clienti in casa (sempre alla data di lavoro del PMS: nessun selettore data) ---
let incasaInited = false;
let incasaAll = [];
let incasaData = null;
function initInCasa() {
  if (!incasaInited) {
    $('#incasa-search').addEventListener('input', renderInCasa);
    incasaInited = true;
  }
  loadInCasa();
}

async function loadInCasa() {
  const tab = $('#incasa-tab');
  const msg = $('#incasa-msg');
  const stato = $('#incasa-stato');
  tab.hidden = true; msg.hidden = false; msg.textContent = 'Caricamento…'; stato.textContent = '';
  const { status, body } = await api('/api/incasa');
  if (status !== 200) { msg.textContent = 'Errore nel leggere i dati dal PMS.'; return; }
  incasaAll = body.clienti || [];
  incasaData = body.data || null;
  renderInCasa();
}

function renderInCasa() {
  const tab = $('#incasa-tab');
  const msg = $('#incasa-msg');
  const stato = $('#incasa-stato');
  const quando = incasaData ? dataEstesa(incasaData) : '';
  const lista = incasaAll.filter((a) => matchRicerca(a, $('#incasa-search').value));
  if (lista.length === 0) {
    tab.hidden = true; msg.hidden = false;
    msg.textContent = incasaAll.length === 0 ? 'Nessun cliente in casa.' : 'Nessun risultato per la ricerca.';
    stato.textContent = quando;
    return;
  }
  stato.textContent = lista.length === incasaAll.length
    ? `${incasaAll.length} clienti · ${quando}`
    : `${lista.length} di ${incasaAll.length} · ${quando}`;
  $('#incasa-body').innerHTML = lista.map(rigaInCasa).join('');
  msg.hidden = true; tab.hidden = false;
}

function statoPill(s) {
  if (s === 'checkout') return '<span class="pill pill-checkout">Check-out effettuato</span>';
  if (s === 'partenza') return '<span class="pill pill-partenza">In partenza</span>';
  return '<span class="pill pill-incasa">In casa</span>';
}

function rigaInCasa(a) {
  const pax = a.paxBambini ? `${a.paxAdulti}+${a.paxBambini}` : `${a.paxAdulti}`;
  const arrivo = a.dtarrivo ? a.dtarrivo.split('-').reverse().join('/') : null;
  const partenza = a.dtpartenza ? a.dtpartenza.split('-').reverse().join('/') : null;
  const noteRow = a.note
    ? `<tr class="note-row"><td colspan="11"><span class="note-label">Note</span>${esc(a.note)}</td></tr>`
    : '';
  return `
    <tr class="arr-row${a.note ? ' has-note' : ''}">
      <td class="prat">${esc(a.codpratica)}</td>
      <td class="cell-name">${a.nominativo ? esc(a.nominativo) : '<span class="dash">(senza nominativo)</span>'}</td>
      <td>${chipCamere(a.camere)}</td>
      <td class="cell-muted">${pax}</td>
      <td class="cell-muted">${cell(arrivo)}</td>
      <td class="cell-muted">${cell(partenza)}</td>
      <td class="cell-muted">${a.notti}</td>
      <td>${statoPill(a.statoPartenza)}</td>
      <td class="cell-muted">${cell(a.trattamento)}</td>
      <td class="cell-muted">${cell(a.tariffa)}</td>
      <td class="cell-num">${a.importo != null ? euro(a.importo) : dash}</td>
    </tr>${noteRow}`;
}

// --- Utenti (admin) ---
let usersCache = [];
let editingId = null;

async function loadUsers() {
  const { body } = await api('/api/admin/users');
  usersCache = body.users || [];
  $('#user-list').innerHTML = usersCache.map((u) => `
    <tr>
      <td class="cell-name">${esc(u.username)}</td>
      <td>${cell(u.nome)}</td>
      <td>${cell(u.cognome)}</td>
      <td class="cell-muted">${cell(u.email)}</td>
      <td><span class="role-tag">${esc(u.role)}</span></td>
      <td>${u.attivo ? '<span class="pill pill-incasa">Attivo</span>' : '<span class="pill pill-atteso">Disattivato</span>'}</td>
      <td class="row-actions">
        <button class="btn-icon" data-edit="${u.id}">Modifica</button>
        <button class="btn-icon danger" data-del="${u.id}">Elimina</button>
      </td>
    </tr>`).join('');
}

function openUserDialog(user) {
  editingId = user ? user.id : null;
  const f = $('#user-form');
  f.reset();
  $('#user-form-error').textContent = '';
  $('#user-dialog-title').textContent = user ? 'Modifica utente' : 'Nuovo utente';
  $('#attivo-wrap').hidden = !user;
  if (user) {
    f.username.value = user.username || '';
    f.role.value = user.role || 'reception';
    f.nome.value = user.nome || '';
    f.cognome.value = user.cognome || '';
    f.email.value = user.email || '';
    f.attivo.checked = !!user.attivo;
    f.password.placeholder = 'lascia vuoto per non cambiarla';
    f.password.required = false;
  } else {
    f.password.placeholder = '';
    f.password.required = true;
  }
  $('#user-dialog').showModal();
}

async function salvaUtente(e) {
  e.preventDefault();
  const f = e.target;
  const orNull = (v) => { const s = v.trim(); return s === '' ? null : s; };
  const payload = {
    username: f.username.value.trim(),
    role: f.role.value,
    nome: orNull(f.nome.value),
    cognome: orNull(f.cognome.value),
    email: orNull(f.email.value),
  };
  if (f.password.value) payload.password = f.password.value;
  let res;
  if (editingId) {
    payload.attivo = f.attivo.checked;
    res = await api(`/api/admin/users/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  } else {
    res = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
  }
  if (res.status === 200 || res.status === 201) { $('#user-dialog').close(); loadUsers(); }
  else $('#user-form-error').textContent = res.body.error || 'Errore nel salvataggio';
}

async function eliminaUtente(id) {
  const res = await api(`/api/admin/users/${id}`, { method: 'DELETE' });
  if (res.status === 200) loadUsers();
  else alert(res.body.error || 'Impossibile eliminare l\'utente');
}

$('#btn-nuovo-utente').addEventListener('click', () => openUserDialog(null));
$('#user-cancel').addEventListener('click', () => $('#user-dialog').close());
$('#user-form').addEventListener('submit', salvaUtente);
$('#user-list').addEventListener('click', (e) => {
  const ed = e.target.closest('[data-edit]');
  const dl = e.target.closest('[data-del]');
  if (ed) { const u = usersCache.find((x) => x.id === Number(ed.dataset.edit)); if (u) openUserDialog(u); }
  else if (dl) eliminaUtente(Number(dl.dataset.del));
});

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

refresh();
