const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, { cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...opts });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let currentUser = null;
let vistaPrecedente = 'arrivi'; // per il link "Torna a…" nella scheda ospite

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
  const hash = (location.hash || '#home').slice(1);
  // Scheda ospite: #cliente/<CodCli>
  if (hash.startsWith('cliente/')) {
    $('#topbar-title').textContent = 'Scheda ospite';
    document.querySelectorAll('.view').forEach((el) => { el.hidden = true; });
    document.querySelectorAll('.sidebar a').forEach((a) => a.classList.remove('active'));
    const backLabel = { arrivi: 'Torna agli arrivi', incasa: 'Torna ai clienti in casa', ricerca: 'Torna alla ricerca', utenti: 'Torna agli utenti', home: 'Torna alla home' };
    const dest = backLabel[vistaPrecedente] ? vistaPrecedente : 'arrivi';
    const back = $('#cli-back');
    back.setAttribute('href', `#${dest}`);
    back.textContent = `‹ ${backLabel[dest]}`;
    $('#view-cliente').hidden = false;
    loadCliente(hash.split('/')[1]);
    return;
  }
  const view = hash;
  const known = ['home', 'arrivi', 'incasa', 'ricerca', 'utenti'];
  let v = known.includes(view) ? view : 'home';
  // Utenti è riservato agli admin: reindirizza gli altri alla home
  if (v === 'utenti' && !(currentUser && currentUser.role === 'admin')) {
    location.hash = '#home';
    return;
  }
  const titoli = { home: 'Home', arrivi: 'Arrivi', incasa: 'In casa', ricerca: 'Ricerca', utenti: 'Utenti' };
  $('#topbar-title').textContent = titoli[v] || 'Home';
  document.querySelectorAll('.view').forEach((el) => { el.hidden = true; });
  document.querySelectorAll('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.nav === v));
  $(`#view-${v}`).hidden = false;
  vistaPrecedente = v;
  if (v === 'home') loadHome();
  else if (v === 'arrivi') initArrivi();
  else if (v === 'incasa') initInCasa();
  else if (v === 'ricerca') initRicerca();
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
  const tab = $('#arrivi-cards');
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
  const cards = $('#arrivi-cards');
  const msg = $('#arrivi-msg');
  const stato = $('#arrivi-stato');
  const lista = arriviAll.filter((a) => matchRicerca(a, $('#arrivi-search').value));
  if (lista.length === 0) {
    cards.hidden = true; msg.hidden = false;
    msg.textContent = arriviAll.length === 0 ? 'Nessun arrivo per questa data.' : 'Nessun risultato per la ricerca.';
    stato.textContent = `${arriviAll.length} ${arriviAll.length === 1 ? 'arrivo' : 'arrivi'}`;
    return;
  }
  stato.textContent = lista.length === arriviAll.length
    ? `${arriviAll.length} ${arriviAll.length === 1 ? 'arrivo' : 'arrivi'}`
    : `${lista.length} di ${arriviAll.length}`;
  cards.innerHTML = lista.map(schedaArrivo).join('');
  msg.hidden = true; cards.hidden = false;
}

const dash = '<span class="dash">—</span>';
function cell(v) { return v ? esc(v) : dash; }
const euro = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
function fmtData(d) { return d ? d.split('-').reverse().join('/') : '—'; }

function chipCamere(camere) {
  if (!camere) return dash;
  return camere.split(',').map((c) => `<span class="room">${esc(c.trim())}</span>`).join('');
}

// Lista occupanti camera (camera a sinistra del nome, nome cliccabile → scheda ospite).
function renderOspiti(ospiti) {
  if (!ospiti || !ospiti.length) return '';
  return `<div class="ospiti">${ospiti.map((o) => `<div class="ospite-row">${o.camera ? `<span class="room">${esc(o.camera)}</span>` : ''}${o.codCli
    ? `<a class="ospite-link" href="#cliente/${o.codCli}">${esc(o.nominativo || '—')}</a>`
    : `<span class="ospite-x">${esc(o.nominativo || '—')}</span>`}</div>`).join('')}</div>`;
}

// Come renderOspiti ma mostra TUTTE le camere della prenotazione (a.camere),
// incluse quelle senza occupanti ancora assegnati.
function renderOspitiConCamere(a) {
  const ospiti = a.ospiti || [];
  const rooms = [];
  (a.camere ? a.camere.split(',').map((c) => c.trim()).filter(Boolean) : []).forEach((c) => { if (!rooms.includes(c)) rooms.push(c); });
  ospiti.forEach((o) => { const c = o.camera ? String(o.camera) : ''; if (c && !rooms.includes(c)) rooms.push(c); });
  if (!rooms.length) return renderOspiti(ospiti) || `<span class="tile-v">${dash}</span>`;
  const rows = rooms.map((cam) => {
    const occ = ospiti.filter((o) => String(o.camera || '') === cam);
    if (occ.length) {
      return occ.map((o) => `<div class="ospite-row"><span class="room">${esc(cam)}</span>${o.codCli
        ? `<a class="ospite-link" href="#cliente/${o.codCli}">${esc(o.nominativo || '—')}</a>`
        : `<span class="ospite-x">${esc(o.nominativo || '—')}</span>`}</div>`).join('');
    }
    return `<div class="ospite-row"><span class="room">${esc(cam)}</span><span class="ospite-x">nessun ospite assegnato</span></div>`;
  }).join('');
  return `<div class="ospiti">${rows}</div>`;
}

// Scheda prenotazione condivisa da Arrivi e Clienti in casa.
function scheda(a, pill) {
  const tratt = [a.trattamento, a.tariffa].filter(Boolean).map(esc).join(' / ') || '—';
  const nottiLine = a.notti != null ? `<br><span class="tile-sub">${a.notti} ${a.notti === 1 ? 'notte' : 'notti'}</span>` : '';
  const tot = a.importo != null ? euro(a.importo) : dash;
  const note = a.note ? `<div class="bcard-note"><b>Note</b>${esc(a.note)}</div>` : '';
  const ospitiHtml = renderOspitiConCamere(a);
  return `
    <article class="bcard">
      <header class="bcard-head">
        <div class="bcard-prat"><span>Pratica</span><strong>${esc(a.codpratica)}</strong></div>
        <div class="bcard-created"><span>Data creazione</span><strong>${fmtData(a.dtPrenota)}</strong></div>
        <div class="bcard-name"><span class="bcard-name-l">Referente</span><span class="bcard-name-v">${a.nominativo ? (a.codCliente ? `<a class="cli-link" href="#cliente/${a.codCliente}">${esc(a.nominativo)}</a>` : esc(a.nominativo)) : '(senza nominativo)'}</span></div>
        <div class="bcard-pills">${pill}</div>
      </header>
      <div class="bcard-body">
        <div class="tile"><span class="tile-l">Arrivo → Partenza</span><span class="tile-v">${fmtData(a.dtarrivo)} → ${fmtData(a.dtpartenza)}${nottiLine}</span></div>
        <div class="tile"><span class="tile-l">Ospiti in camera</span>${ospitiHtml}
          <div class="tratt-blocco"><span class="tile-l">Trattamento / Tariffa</span><div class="tratt-row"><span class="chip">${tratt}</span><span class="tratt-tot">${tot}</span></div></div>
        </div>
      </div>
      ${note}
    </article>`;
}

function schedaArrivo(a) {
  const pill = a.inCasa
    ? '<span class="pill pill-incasa">In casa</span>'
    : '<span class="pill pill-atteso">Atteso</span>';
  return scheda(a, pill);
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
  const tab = $('#incasa-cards');
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
  const cards = $('#incasa-cards');
  const msg = $('#incasa-msg');
  const stato = $('#incasa-stato');
  const quando = incasaData ? dataEstesa(incasaData) : '';
  const lista = incasaAll.filter((a) => matchRicerca(a, $('#incasa-search').value));
  if (lista.length === 0) {
    cards.hidden = true; msg.hidden = false;
    msg.textContent = incasaAll.length === 0 ? 'Nessun cliente in casa.' : 'Nessun risultato per la ricerca.';
    stato.textContent = quando;
    return;
  }
  stato.textContent = lista.length === incasaAll.length
    ? `${incasaAll.length} clienti · ${quando}`
    : `${lista.length} di ${incasaAll.length} · ${quando}`;
  cards.innerHTML = lista.map(schedaInCasa).join('');
  msg.hidden = true; cards.hidden = false;
}

function statoPill(s) {
  if (s === 'checkout') return '<span class="pill pill-checkout">Check-out effettuato</span>';
  if (s === 'partenza') return '<span class="pill pill-partenza">In partenza</span>';
  return '<span class="pill pill-incasa">In casa</span>';
}

function schedaInCasa(a) {
  return scheda(a, statoPill(a.statoPartenza));
}

// --- Ricerca ospiti (pagina) ---
let ricercaInit = false;
let ricercaTimer = null;
function initRicerca() {
  if (!ricercaInit) {
    $('#ricerca-input').addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(ricercaTimer);
      ricercaTimer = setTimeout(() => loadRicerca(q), 250);
    });
    ricercaInit = true;
  }
  $('#ricerca-input').focus();
}

async function loadRicerca(q) {
  const list = $('#ricerca-list');
  const msg = $('#ricerca-msg');
  if (q.length < 2) { list.hidden = true; msg.hidden = false; msg.textContent = 'Digita almeno 2 caratteri per cercare.'; return; }
  msg.hidden = false; msg.textContent = 'Ricerca…'; list.hidden = true;
  const { status, body } = await api(`/api/clienti?q=${encodeURIComponent(q)}`);
  if (status !== 200) { msg.textContent = 'Errore nella ricerca.'; return; }
  const r = body.risultati || [];
  if (!r.length) { list.hidden = true; msg.hidden = false; msg.textContent = 'Nessun ospite trovato.'; return; }
  list.innerHTML = r.map(cardRicerca).join('');
  msg.hidden = true; list.hidden = false;
}

function cardRicerca(c) {
  const sub = [c.citta, c.telefono, c.cellulare, c.email].filter(Boolean).join(' · ');
  const iniziale = ((c.nominativo || '?')[0] || '?').toUpperCase();
  const incasa = c.cameraInCasa
    ? `<span class="ric-incasa"><span class="pill pill-incasa">In casa</span>${chipCamere(c.cameraInCasa)}</span>`
    : '';
  return `<a class="ric-item" href="#cliente/${c.codCli}">
    <span class="ric-av">${esc(iniziale)}</span>
    <span class="ric-txt"><strong>${esc(c.nominativo || '(senza nominativo)')}</strong><span>${esc(sub)}</span></span>
    ${incasa}
    <span class="ric-go">›</span>
  </a>`;
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

// --- Scheda ospite 360° ---
let clienteCorrente = null;

async function loadCliente(codCli) {
  const body = $('#cliente-body');
  const msg = $('#cliente-msg');
  body.hidden = true; msg.hidden = false; msg.textContent = 'Caricamento…';
  const { status, body: d } = await api(`/api/clienti/${encodeURIComponent(codCli)}`);
  if (status === 404 || status === 400) { msg.textContent = 'Ospite non trovato.'; return; }
  if (status !== 200) { msg.textContent = 'Errore nel leggere l\'ospite dal PMS.'; return; }
  clienteCorrente = codCli;
  const a = d.anagrafica;
  const s = d.statistiche;
  $('#cli-nome').textContent = a.nominativo || '(senza nominativo)';
  $('#cli-avatar').textContent = ((a.cognome || a.nome || '?')[0] || '?').toUpperCase();
  const luogo = [a.citta, a.nazione].filter(Boolean).join(' · ');
  $('#cli-contatti').textContent = [a.telefono, a.cellulare, a.email, luogo].filter(Boolean).join('   ·   ') || '—';
  $('#cli-vip').hidden = !a.vip;
  $('#cli-nsogg').textContent = s.nSoggiorni;
  $('#cli-arr').textContent = euro(s.totArrangiamenti || 0);
  $('#cli-extra').textContent = euro(s.totExtra || 0);
  $('#cli-visite').textContent = `${fmtData(s.primaVisita)} → ${fmtData(s.ultimaVisita)}`;
  const an = $('#cli-anagnote');
  if (a.note) { an.hidden = false; an.innerHTML = `<b>Note anagrafica (PMS)</b>${esc(a.note)}`; } else an.hidden = true;
  $('#cli-soggiorni').innerHTML = (d.soggiorni || []).map(rigaSoggiorno).join('')
    || '<tr><td colspan="7" class="cell-muted">Nessun soggiorno registrato.</td></tr>';
  const c = a.consensi;
  const cons = (ok, label) => `<div class="cons-box ${ok ? 'si' : 'no'}"><span class="cons-l">${label}</span><span class="cons-v">${ok ? 'Sì' : 'No'}</span></div>`;
  $('#cli-consensi').innerHTML = cons(c.marketing, 'Marketing') + cons(c.telefonate, 'Telefonate in camera') + cons(c.conservazione, 'Conservazione') + cons(c.cessione, 'Cessione');
  await caricaNote(codCli);
  msg.hidden = true; body.hidden = false;
}

function statoSoggPill(stato) {
  if (stato === 'In casa') return 'pill-incasa';
  if (stato === 'Concluso') return 'pill-checkout';
  if (stato === 'Partito') return 'pill-partenza';
  return 'pill-atteso';
}

// Storico: per ogni camera → arrangiamento/extra + occupanti di quella camera.
function renderCamereStorico(x) {
  if (x.camereDett && x.camereDett.length) {
    return x.camereDett.map((c) => {
      const nomi = (x.ospiti || []).filter((o) => o.camera === c.camera).map((o) => (o.codCli
        ? `<a class="ospite-link" href="#cliente/${o.codCli}">${esc(o.nominativo || '—')}</a>`
        : `<span class="ospite-x">${esc(o.nominativo || '—')}</span>`)).join('');
      return `<div class="sogg-cam">
        <div class="sogg-cam-top"><span class="room">${esc(c.camera)}</span><span class="sogg-ae">${euro((c.arrangiamento || 0) + (c.extra || 0))}</span></div>
        <div class="sogg-cam-osp">${nomi}</div>
      </div>`;
    }).join('');
  }
  return renderOspiti(x.ospiti) || (x.camere ? chipCamere(x.camere) : dash);
}

function rigaSoggiorno(x) {
  const ae = `<div>Arrangiamenti ${euro(x.arrangiamento || 0)}</div><div class="sogg-extra">Extra ${euro(x.extra || 0)}</div>`;
  return `<tr>
    <td class="cell-num">${esc(x.codpratica)}</td>
    <td class="cell-muted">${fmtData(x.dtarrivo)}</td>
    <td class="cell-muted">${fmtData(x.dtpartenza)}</td>
    <td class="cell-muted">${x.notti != null ? esc(x.notti) : '—'}</td>
    <td>${renderCamereStorico(x)}</td>
    <td class="cell-num sogg-ae-col">${x.importo != null ? ae : dash}</td>
    <td><span class="pill ${statoSoggPill(x.stato)}">${esc(x.stato)}</span></td>
  </tr>`;
}

async function caricaNote(codCli) {
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/note`);
  const note = body.note || [];
  $('#cli-note').innerHTML = note.map((n) => `
    <li data-nota="${n.id}">
      <div class="nota-testo">${esc(n.testo)}</div>
      <div class="nota-meta">
        <span>${esc(n.autore || '?')} · ${new Date(n.created_at).toLocaleString('it-IT')}</span>
        <span class="nota-az">
          <button class="btn-icon" data-edit-nota="${n.id}">Modifica</button>
          <button class="btn-icon danger" data-del-nota="${n.id}">Elimina</button>
        </span>
      </div>
    </li>`).join('') || '<li class="nota-vuota">Nessuna nota. Aggiungine una qui sopra.</li>';
}

$('#nota-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const testo = f.testo.value.trim();
  if (!testo || !clienteCorrente) return;
  const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/note`, {
    method: 'POST', body: JSON.stringify({ testo }),
  });
  if (status === 201) { f.reset(); caricaNote(clienteCorrente); }
});

$('#cli-note').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del-nota]');
  const edit = e.target.closest('[data-edit-nota]');
  if (del) {
    await api(`/api/note/${del.dataset.delNota}`, { method: 'DELETE' });
    caricaNote(clienteCorrente);
  } else if (edit) {
    const li = edit.closest('[data-nota]');
    const nuovo = prompt('Modifica nota:', li.querySelector('.nota-testo').textContent);
    if (nuovo != null && nuovo.trim()) {
      await api(`/api/note/${edit.dataset.editNota}`, { method: 'PATCH', body: JSON.stringify({ testo: nuovo.trim() }) });
      caricaNote(clienteCorrente);
    }
  }
});

refresh();
