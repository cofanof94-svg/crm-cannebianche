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
  const known = ['home', 'arrivi', 'incasa', 'ricerca', 'duplicati', 'utenti'];
  let v = known.includes(view) ? view : 'home';
  // Utenti è riservato agli admin: reindirizza gli altri alla home
  if (v === 'utenti' && !(currentUser && currentUser.role === 'admin')) {
    location.hash = '#home';
    return;
  }
  const titoli = { home: 'Home', arrivi: 'Arrivi', incasa: 'In casa', ricerca: 'Ricerca', duplicati: 'Duplicati', utenti: 'Utenti' };
  $('#topbar-title').textContent = titoli[v] || 'Home';
  document.querySelectorAll('.view').forEach((el) => { el.hidden = true; });
  document.querySelectorAll('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.nav === v));
  $(`#view-${v}`).hidden = false;
  vistaPrecedente = v;
  if (v === 'home') loadHome();
  else if (v === 'arrivi') initArrivi();
  else if (v === 'incasa') initInCasa();
  else if (v === 'ricerca') initRicerca();
  else if (v === 'duplicati') loadDuplicatiPage();
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
let arriviBriefing = null;
let arriviData = null;
let filtroBriefing = 'all';

// Chip dell'Arrival Briefing: etichetta, campo del conteggio e predicato di filtro
// sullo snapshot dell'arrivo. "Mostrare prima le informazioni giuste".
const BRIEF_CHIPS = [
  { key: 'all', label: 'Arrivi', field: 'arrivi', pred: () => true },
  { key: 'vip', label: 'VIP', field: 'vip', pred: (a) => !!(a.snapshot && a.snapshot.vip) },
  { key: 'compleanni', label: 'Compleanni', field: 'compleanni', pred: (a) => !!(a.snapshot && a.snapshot.compleanno) },
  { key: 'reclami', label: 'Reclami', field: 'reclami', pred: (a) => !!(a.snapshot && a.snapshot.reclami && a.snapshot.reclami.totali > 0) },
  { key: 'alert', label: 'Alert', field: 'alert', pred: (a) => !!(a.snapshot && ((a.snapshot.intolleranze && a.snapshot.intolleranze.length) || a.snapshot.indesiderato)) },
];

function initArrivi() {
  if (!arriviInit) {
    $('#arrivi-data').addEventListener('change', loadArrivi);
    $('#arrivi-search').addEventListener('input', renderArrivi);
    $('#arrivi-prev').addEventListener('click', () => shiftArriviData(-1));
    $('#arrivi-next').addEventListener('click', () => shiftArriviData(1));
    $('#arrivi-oggi').addEventListener('click', () => { $('#arrivi-data').value = ''; loadArrivi(); });
    // Filtro dai chip del briefing (toggle: riclic sullo stesso chip torna a "tutti").
    $('#arrivi-briefing').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-brief]');
      if (!chip) return;
      const key = chip.dataset.brief;
      filtroBriefing = (filtroBriefing === key || key === 'all') ? 'all' : key;
      renderArrivi();
    });
    // Guest Briefing AI (on-demand) dai pulsanti nelle card.
    $('#arrivi-cards').addEventListener('click', (e) => {
      const salva = e.target.closest('[data-save-cli]');
      if (salva) { salvaBriefingNelProfilo(salva); return; }
      const btn = e.target.closest('[data-brief-cli]');
      if (btn) eseguiBriefing(btn);
    });
    arriviInit = true;
  }
  loadArrivi();
}

const briefingTesti = {}; // cache cli → briefing (per il "Salva nel profilo")

async function eseguiBriefing(btn) {
  const cli = btn.dataset.briefCli;
  const box = btn.closest('.arr-card').querySelector('.arr-brief-result');
  btn.disabled = true;
  box.hidden = false;
  box.innerHTML = '<div class="ai-msg ai-loading"><span class="spinner"></span>Ricerca su fonti pubbliche in corso…</div>';
  try {
    const { status, body } = await api(`/api/clienti/${encodeURIComponent(cli)}/briefing`, { method: 'POST', body: JSON.stringify({}) });
    btn.disabled = false;
    if (status === 503) { box.innerHTML = briefMsg('AI non configurata: manca la chiave ANTHROPIC_API_KEY o l\'SDK.'); return; }
    if (status !== 200) { box.innerHTML = briefMsg('Errore durante la generazione del briefing.'); return; }
    briefingTesti[cli] = body;
    box.innerHTML = renderBriefResult(body, cli);
  } catch {
    btn.disabled = false;
    box.innerHTML = briefMsg('Errore di rete durante la generazione del briefing.');
  }
}

async function salvaBriefingNelProfilo(btn) {
  const cli = btn.dataset.saveCli;
  const b = briefingTesti[cli];
  if (!b || !b.testo) return;
  btn.disabled = true;
  const { status } = await api(`/api/clienti/${encodeURIComponent(cli)}/note-personali`, {
    method: 'PUT', body: JSON.stringify({ testo: b.testo, mode: 'append' }),
  });
  btn.disabled = false;
  btn.textContent = status === 200 ? '✓ Salvato nel profilo' : 'Errore nel salvataggio';
  if (status === 200) btn.classList.add('brief-save-done');
}

function briefMsg(t) { return `<div class="brief-card"><div class="ai-msg">${esc(t)}</div></div>`; }

function renderBriefResult(b, cli) {
  const fonti = (b.fonti || [])
    .map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.titolo || f.url)}</a></li>`)
    .join('');
  const fontiBlock = fonti ? `<div class="brief-fonti"><span class="brief-fonti-l">Fonti</span><ul>${fonti}</ul></div>` : '';
  // Salvataggio nel profilo solo se l'ospite è stato riconosciuto (pubblico).
  const salva = b.pubblico && cli
    ? `<button type="button" class="brief-save" data-save-cli="${esc(cli)}" title="Aggiungi alle Note personali del profilo">💾 Salva nel profilo</button>`
    : '';
  return `<div class="brief-card">
    <div class="brief-testo">${esc(b.testo || '')}</div>
    ${fontiBlock}
    ${salva}
    <div class="brief-disclaimer">⚠ Generato dall'AI su fonti pubbliche — verificare prima dell'uso.</div>
  </div>`;
}

function shiftArriviData(giorni) {
  const input = $('#arrivi-data');
  const base = input.value ? new Date(input.value + 'T00:00:00') : new Date();
  base.setDate(base.getDate() + giorni);
  input.value = base.toISOString().slice(0, 10);
  loadArrivi();
}

async function loadArrivi() {
  const input = $('#arrivi-data');
  const tab = $('#arrivi-cards');
  const msg = $('#arrivi-msg');
  tab.hidden = true; msg.hidden = false; msg.textContent = 'Caricamento…';
  $('#arrivi-briefing').hidden = true; $('#arrivi-stato').textContent = '';
  filtroBriefing = 'all';
  const q = input.value ? `?data=${encodeURIComponent(input.value)}` : '';
  const { status, body } = await api(`/api/arrivi${q}`);
  if (status !== 200) { msg.textContent = 'Errore nel leggere gli arrivi dal PMS.'; return; }
  if (!input.value && body.data) input.value = body.data; // data di lavoro dal server
  arriviAll = body.arrivi || [];
  arriviBriefing = body.briefing || null;
  arriviData = body.data || input.value || null;
  renderArrivi();
}

function renderBriefing() {
  const bar = $('#arrivi-briefing');
  const b = arriviBriefing;
  if (!b) { bar.hidden = true; return; }
  const chips = BRIEF_CHIPS.map((c) => {
    const n = b[c.field] || 0;
    const spento = c.key !== 'all' && n === 0 ? ' brief-chip-off' : '';
    const attivo = filtroBriefing === c.key ? ' brief-chip-on' : '';
    return `<button type="button" class="brief-chip brief-${c.key}${attivo}${spento}" data-brief="${c.key}">
      <span class="brief-n">${n}</span><span class="brief-l">${c.label}</span></button>`;
  }).join('');
  bar.innerHTML = `<div class="briefing-inner">
    <span class="briefing-date">${esc(dataEstesa(arriviData))}</span>
    <div class="briefing-chips">${chips}</div>
  </div>`;
  bar.hidden = false;
}

function renderArrivi() {
  const cards = $('#arrivi-cards');
  const msg = $('#arrivi-msg');
  const stato = $('#arrivi-stato');
  renderBriefing();
  const chip = BRIEF_CHIPS.find((c) => c.key === filtroBriefing) || BRIEF_CHIPS[0];
  const lista = arriviAll
    .filter((a) => matchRicerca(a, $('#arrivi-search').value))
    .filter(chip.pred);
  if (lista.length === 0) {
    cards.hidden = true; msg.hidden = false;
    msg.textContent = arriviAll.length === 0 ? 'Nessun arrivo per questa data.' : 'Nessun risultato per il filtro.';
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

// Badge VIP compatto per le card (l'indesiderato ha priorità come warning).
function badgeVip(v) {
  if (!v) return '';
  if (v.indesiderato) return `<span class="pill pill-warning" title="${esc(v.descrizione)}">⚠ Ospite indesiderato</span>`;
  const cl = (v.descrizione && v.descrizione !== v.cod) ? `<span class="vip-class">${esc(v.descrizione)}</span>` : '';
  return `<span class="pill pill-vip" title="Classificazione VIP: ${esc(v.descrizione)} (${esc(v.cod)})">★ VIP</span>${cl}`;
}

// Banda snapshot: le informazioni per l'accoglienza, in evidenza. Vuota → non renderizza.
function snapshotBand(s) {
  if (!s) return '';
  const flags = [];
  if (s.indesiderato) flags.push('<span class="arr-flag flag-danger">⚠ Ospite indesiderato</span>');
  if (s.compleanno) {
    const chi = s.compleanno.nome ? ` · ${esc(s.compleanno.nome)}` : '';
    flags.push(`<span class="arr-flag flag-birthday">🎂 Compleanno ${fmtData(s.compleanno.data)}${chi}</span>`);
  }
  if (s.intolleranze && s.intolleranze.length) {
    flags.push(`<span class="arr-flag flag-safety" title="Allergie / intolleranze — sicurezza">⚠ ${s.intolleranze.map(esc).join(', ')}</span>`);
  }
  if (s.reclami && s.reclami.totali) {
    const ap = s.reclami.aperti ? `${s.reclami.aperti} aperti / ` : '';
    flags.push(`<span class="arr-flag flag-warning">⚑ Reclami: ${ap}${s.reclami.totali}</span>`);
  }
  const prefs = (s.preferenzeTop || [])
    .map((p) => `<span class="arr-pref" title="${esc(p.reparto || '')}${p.categoria ? ' / ' + esc(p.categoria) : ''}">${esc(p.testo)}</span>`)
    .join('');
  const prefBlock = prefs ? `<div class="arr-prefs"><span class="arr-lbl">Preferenze</span>${prefs}</div>` : '';
  if (!flags.length && !prefBlock) return '';
  const flagBlock = flags.length ? `<div class="arr-flags">${flags.join('')}</div>` : '';
  return `<div class="arr-snap">${flagBlock}${prefBlock}</div>`;
}

// Occupanti in camera con l'eventuale relazione col referente (dallo snapshot).
function renderOspitiArrivo(a) {
  const rel = (a.snapshot && a.snapshot.relazioni) || {};
  const ospiti = a.ospiti || [];
  const rooms = [];
  (a.camere ? a.camere.split(',').map((c) => c.trim()).filter(Boolean) : []).forEach((c) => { if (!rooms.includes(c)) rooms.push(c); });
  ospiti.forEach((o) => { const c = o.camera ? String(o.camera) : ''; if (c && !rooms.includes(c)) rooms.push(c); });
  const nomeOspite = (o) => {
    // Mostro la relazione solo se significativa: 'Altro' è il default dell'auto-popolamento → rumore.
    const relOsp = rel[o.codCli];
    const r = relOsp && relOsp.toLowerCase() !== 'altro' ? `<span class="arr-rel">${esc(relOsp)}</span>` : '';
    const nome = o.codCli
      ? `<a class="ospite-link" href="#cliente/${o.codCli}">${esc(o.nominativo || '—')}</a>`
      : `<span class="ospite-x">${esc(o.nominativo || '—')}</span>`;
    return `${nome}${r}`;
  };
  if (!rooms.length) {
    if (!ospiti.length) return '';
    return `<div class="ospiti">${ospiti.map((o) => `<div class="ospite-row">${nomeOspite(o)}</div>`).join('')}</div>`;
  }
  const rows = rooms.map((cam) => {
    const occ = ospiti.filter((o) => String(o.camera || '') === cam);
    if (occ.length) return occ.map((o) => `<div class="ospite-row"><span class="room">${esc(cam)}</span>${nomeOspite(o)}</div>`).join('');
    return `<div class="ospite-row"><span class="room">${esc(cam)}</span><span class="ospite-x">nessun ospite assegnato</span></div>`;
  }).join('');
  return `<div class="ospiti">${rows}</div>`;
}

// Card arrivo ridisegnata: in alto ciò che serve all'accoglienza (referente, VIP,
// snapshot); i dati operativi PMS e le Note sono collassati/attenuati.
function schedaArrivo(a) {
  const s = a.snapshot || null;
  const pill = a.inCasa ? '<span class="pill pill-incasa">In casa</span>' : '<span class="pill pill-atteso">Atteso</span>';
  const nome = a.nominativo
    ? (a.codCliente ? `<a class="arr-name-link" href="#cliente/${a.codCliente}">${esc(a.nominativo)}</a>` : esc(a.nominativo))
    : '(senza nominativo)';
  const ora = a.oraArrivo ? `<span class="arr-ora">🕒 ${esc(a.oraArrivo)}</span>` : '';
  const notti = a.notti != null ? ` · ${a.notti} ${a.notti === 1 ? 'notte' : 'notti'}` : '';
  const camere = a.camere ? a.camere.split(',').map((c) => `<span class="room">${esc(c.trim())}</span>`).join('') : '';
  const tipologie = a.tipologie ? a.tipologie.split(',').map((t) => `<span class="tipo-chip">${esc(t.trim())}</span>`).join('') : '';
  const tratt = [a.trattamento, a.tariffa].filter(Boolean).map(esc).join(' / ') || '—';
  const tot = a.importo != null ? euro(a.importo) : '—';
  const ospiti = renderOspitiArrivo(a);
  const accento = s && s.indesiderato ? ' arr-card-danger' : (s && s.vip ? ' arr-card-vip' : '');
  const briefBtn = a.codCliente
    ? `<button type="button" class="arr-brief-btn${s && s.vip ? ' arr-brief-vip' : ''}" data-brief-cli="${a.codCliente}" title="Cerca informazioni pubbliche su questo ospite">✨ Briefing AI</button>`
    : '';
  const note = a.note
    ? `<details class="arr-note"><summary>Note PMS</summary><div class="arr-note-body">${esc(a.note)}</div></details>`
    : '';
  return `
    <article class="arr-card${accento}">
      <header class="arr-head">
        <div class="arr-title">
          <span class="arr-name">${nome}</span>
          ${badgeVip(s && s.vip)}
        </div>
        <div class="arr-meta">${ora}${pill}${briefBtn}</div>
      </header>
      ${snapshotBand(s)}
      <div class="arr-brief-result" hidden></div>
      <div class="arr-stay">
        <span class="arr-rooms">${camere || '<span class="dash">—</span>'}${tipologie}</span>
        <span class="arr-dates">${fmtData(a.dtarrivo)} → ${fmtData(a.dtpartenza)}${notti}</span>
      </div>
      ${ospiti ? `<div class="arr-ospiti">${ospiti}</div>` : ''}
      <div class="arr-op">
        <span class="arr-op-imp"><i>Importo soggiorno</i> ${tot}</span>
        ${a.extra ? `<span class="arr-op-imp"><i>Extra</i> ${euro(a.extra)}</span>` : ''}
        <span><i>Trattamento</i> ${tratt}</span>
        <span><i>Pratica</i> ${esc(a.codpratica)}</span>
        <span><i>Creata</i> ${fmtData(a.dtPrenota)}</span>
      </div>
      ${note}
    </article>`;
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

// Badge VIP: "★ VIP" + classificazione (letta da TabVip); badge rosso di avviso
// per gli ospiti indesiderati. Solo informativo.
function renderVip(v) {
  const el = $('#cli-vip');
  if (!v) { el.innerHTML = ''; return; }
  if (v.indesiderato) {
    el.innerHTML = `<span class="pill pill-warning" title="${esc(v.descrizione)}">⚠ Ospite indesiderato</span>`;
    return;
  }
  const classe = (v.descrizione && v.descrizione !== v.cod)
    ? ` <span class="vip-class">${esc(v.descrizione)}</span>` : '';
  el.innerHTML = `<span class="pill pill-vip" title="Classificazione VIP: ${esc(v.descrizione)} (${esc(v.cod)})">★ VIP</span>${classe}`;
}

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
  $('#cli-contatti').innerHTML = [
    contattoCard('Email', a.email, a.email ? `mailto:${a.email}` : null),
    contattoCard('Telefono', a.telefono, a.telefono ? `tel:${a.telefono}` : null),
    contattoCard('Cellulare', a.cellulare, a.cellulare ? `tel:${a.cellulare}` : null),
    contattoCard('Provenienza', [a.citta, a.nazione].filter(Boolean).join(', ')),
  ].filter(Boolean).join('') || '<div class="cc cc-empty">Nessun contatto</div>';
  renderVip(a.vip);
  $('#cli-nsogg').textContent = s.nSoggiorni;
  $('#cli-notti').textContent = s.nottiTotali != null ? s.nottiTotali : '–';
  $('#cli-ltv').textContent = euro(s.ltv || 0);
  $('#cli-ltv-media').textContent = s.nSoggiorni ? `media ${euro(s.spesaMediaSoggiorno || 0)}/soggiorno` : '';
  $('#cli-arr').textContent = euro(s.totArrangiamenti || 0);
  $('#cli-arr-media').textContent = s.nSoggiorni ? `media ${euro(s.spesaMediaRooms || 0)}` : '';
  $('#cli-extra').textContent = euro(s.totExtra || 0);
  $('#cli-extra-media').textContent = s.nSoggiorni ? `media ${euro(s.spesaMediaServizi || 0)}` : '';
  $('#cli-source').textContent = s.ultimaSource || '—';
  $('#cli-mercato').textContent = s.ultimoMercato || '—';
  $('#cli-prima').textContent = fmtData(s.primaVisita);
  $('#cli-ultima').textContent = fmtData(s.ultimaVisita);
  const anBox = $('#cli-anagnote-box');
  const noteNucleo = (d.noteNucleo || []).map((n) => `<div class="an-nucleo">👪 <b>${esc(n.nominativo)}</b> — ${esc(n.nota)}</div>`).join('');
  if (a.note || noteNucleo) {
    anBox.hidden = false;
    $('#cli-anagnote').innerHTML = (a.note ? `<div>${esc(a.note)}</div>` : '') + noteNucleo;
  } else { anBox.hidden = true; }
  clienteNSogg = (d.soggiorni || []).length;
  renderMergeBanner(codCli, d.merge);
  $('#cli-soggiorni').innerHTML = (d.soggiorni || []).map(rigaSoggiorno).join('')
    || '<tr><td colspan="7" class="cell-muted">Nessun soggiorno registrato.</td></tr>';
  const c = a.consensi;
  const cons = (ok, label) => `<div class="cons-box ${ok ? 'si' : 'no'}"><span class="cons-l">${label}</span><span class="cons-v">${ok ? 'Sì' : 'No'}</span></div>`;
  $('#cli-consensi').innerHTML = cons(c.marketing, 'Marketing') + cons(c.telefonate, 'Telefonate in camera') + cons(c.conservazione, 'Conservazione') + cons(c.cessione, 'Cessione');
  popolaSelect($('#pref-form').reparto, REPARTI, 'Reparto');
  popolaSelect($('#pref-form').categoria, CATEGORIE, 'Categoria');
  popolaSelect($('#nucleo-form').tipoRelazione, RELAZIONI, 'Relazione');
  suggerimentiCorrenti = []; suggerimentiMostrati = []; $('#cli-suggerimenti').innerHTML = ''; // azzera proposte AL cambio cliente
  resetAiButton(); // pulsante "Suggerisci AI" di nuovo disponibile all'apertura della scheda
  nucleoEditId = null; // esci da eventuale edit-mode del nucleo
  // Sezioni CRM indipendenti (endpoint e nodi DOM distinti): caricate in parallelo.
  await Promise.all([
    caricaGusti(codCli), caricaSpa(codCli), caricaDuplicati(codCli), caricaLingua(codCli), caricaIntolleranze(codCli),
    caricaPreferenze(codCli), caricaNucleo(codCli), caricaComplaints(codCli),
  ]);
  msg.hidden = true; body.hidden = false;
}

function statoSoggPill(stato) {
  if (stato === 'In casa') return 'pill-incasa';
  if (stato === 'Concluso') return 'pill-checkout';
  if (stato === 'Partito') return 'pill-partenza';
  if (stato === 'Eliminata') return 'pill-eliminata';
  if (stato === 'Pianificata') return 'pill-pianificata';
  if (stato === 'No-show') return 'pill-noshow';
  return 'pill-atteso';
}

// Mini-card di un dato di contatto (Email, Telefono, …). Vuoto → nessuna card.
function contattoCard(label, value, href) {
  if (!value) return '';
  const inner = href ? `<a href="${esc(href)}">${esc(value)}</a>` : esc(value);
  return `<div class="cc"><span class="cc-l">${esc(label)}</span><span class="cc-v">${inner}</span></div>`;
}

// Storico prenotazioni: una riga per pratica con le info principali.
// Stati "in corso/futuri": se il maturato è ancora 0 ma c'è la tariffa pianificata,
// mostriamo quest'ultima nella colonna Arrangiamenti (lo stato già segnala che è in
// corso). LTV/cumulativi restano sul maturato reale.
const STATI_PREVISTO = ['In casa', 'Confermato', 'Pianificata'];
function rigaSoggiorno(x) {
  const arr = x.arrangiamento || 0;
  const ext = x.extra || 0;
  const usaPrevisto = arr + ext === 0 && (x.pianificato || 0) > 0 && STATI_PREVISTO.includes(x.stato);
  const arrShown = usaPrevisto ? x.pianificato : arr;
  return `<tr>
    <td class="cell-num">${esc(x.codpratica)}</td>
    <td class="cell-muted">${fmtData(x.dtarrivo)} <span class="periodo-sep">→</span> ${fmtData(x.dtpartenza)}</td>
    <td class="cell-num">${x.notti != null ? esc(x.notti) : '—'}</td>
    <td>${x.camere ? chipCamere(x.camere) : dash}</td>
    <td class="cell-num">${euro(arrShown)}</td>
    <td class="cell-num sogg-extra">${euro(ext)}</td>
    <td><span class="pill ${statoSoggPill(x.stato)}">${esc(x.stato)}</span></td>
  </tr>`;
}

// Liste chiuse (allineate ai CHECK del DB e alla validazione API)
const REPARTI = ['Rooms', 'F&B', 'SPA', 'Front office'];
const CATEGORIE = ['F&B', 'Camera', 'Persona', 'Occasioni', 'Generale'];
const RELAZIONI = ['Coniuge', 'Figlio-a', 'Genitore', 'Amico-a', 'Assistente', 'Altro'];
function popolaSelect(sel, valori, placeholder) {
  sel.innerHTML = `<option value="" disabled selected>${placeholder}</option>` +
    valori.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

// --- Profilo 1:1 (lingua preferita + note personali) ---
async function caricaLingua(codCli) {
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/profilo`);
  $('#cli-lingua').value = (body.profilo && body.profilo.lingua) || '';
  $('#cli-note-personali').value = (body.profilo && body.profilo.note_personali) || '';
  $('#notepers-ai-msg').textContent = '';
}

$('#lingua-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!clienteCorrente) return;
  const lingua = $('#cli-lingua').value.trim();
  const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/profilo`, {
    method: 'PUT', body: JSON.stringify({ lingua }),
  });
  if (status === 200) { const b = $('#lingua-form').querySelector('button'); const t = b.textContent; b.textContent = 'Salvato ✓'; setTimeout(() => { b.textContent = t; }, 1200); }
});

// --- Note personali (salvataggio manuale + generazione AI) ---
$('#notepers-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!clienteCorrente) return;
  const testo = $('#cli-note-personali').value.trim();
  const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/note-personali`, {
    method: 'PUT', body: JSON.stringify({ testo, mode: 'set' }),
  });
  if (status === 200) { const b = $('#notepers-form').querySelector('button[type=submit]'); const t = b.textContent; b.textContent = 'Salvato ✓'; setTimeout(() => { b.textContent = t; }, 1200); }
});

$('#btn-notepers-ai').addEventListener('click', async () => {
  if (!clienteCorrente) return;
  const btn = $('#btn-notepers-ai');
  const msg = $('#notepers-ai-msg');
  btn.disabled = true;
  msg.innerHTML = '<span class="ai-msg ai-loading"><span class="spinner"></span>Ricerca su fonti pubbliche in corso…</span>';
  try {
    const { status, body } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/briefing`, { method: 'POST', body: JSON.stringify({}) });
    btn.disabled = false;
    if (status === 503) { msg.textContent = 'AI non configurata.'; return; }
    if (status !== 200) { msg.textContent = 'Errore durante la generazione.'; return; }
    if (!body.pubblico) { msg.textContent = 'Nessuna informazione pubblica rilevante per questo ospite.'; return; }
    // Compila la textarea (la reception rivede e salva). Non sovrascrive senza avviso.
    const attuale = $('#cli-note-personali').value.trim();
    $('#cli-note-personali').value = attuale ? `${attuale}\n\n${body.testo}` : body.testo;
    const fonti = (body.fonti || []).map((f) => f.titolo || f.url).slice(0, 6);
    msg.innerHTML = `<span class="notepers-ok">✓ Generato da fonti pubbliche. Rivedi e premi Salva.</span>${fonti.length ? `<span class="notepers-fonti">Fonti: ${fonti.map(esc).join(' · ')}</span>` : ''}`;
  } catch {
    btn.disabled = false;
    msg.textContent = 'Errore di rete durante la generazione.';
  }
});

// --- Preferenze (reparto + categoria + testo + ambito) ---
async function caricaPreferenze(codCli) {
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/preferenze`);
  const pref = body.preferenze || [];
  const cond = body.condivise || [];
  const proprie = pref.map((p) => {
    const amb = p.ambito || 'nucleo';
    return `
    <li data-pref="${p.id}">
      <div class="nota-testo"><span class="pref-tag">${esc(p.reparto)} · ${esc(p.categoria)}</span>${esc(p.testo)}
        <button type="button" class="badge-scope scope-toggle scope-${esc(amb)}" data-toggle-ambito="${p.id}" data-ambito="${esc(amb)}" title="Ambito: ${amb === 'nucleo' ? 'condivisa dal nucleo' : 'personale'} — clic per cambiare">${esc(amb)}</button></div>
      <div class="nota-meta">
        <span>${esc(p.autore || '?')} · ${new Date(p.created_at).toLocaleString('it-IT')}</span>
        <span class="nota-az"><button class="btn-icon danger" data-del-pref="${p.id}">Elimina</button></span>
      </div>
    </li>`;
  }).join('') || '<li class="nota-vuota">Nessuna preferenza registrata.</li>';
  // Preferenze 'nucleo' di altri membri del nucleo: sola lettura, con provenienza.
  const condivise = cond.length ? `<li class="pref-cond-head">👪 Condivise dal nucleo <span class="cell-muted">(sola lettura, si modificano sulla scheda del proprietario)</span></li>` + cond.map((p) => `
    <li class="pref-condivisa">
      <div class="nota-testo"><span class="pref-tag">${esc(p.reparto)} · ${esc(p.categoria)}</span>${esc(p.testo)}</div>
      <div class="nota-meta"><span>👪 dal nucleo · ${esc(p.proprietario || '?')}</span></div>
    </li>`).join('') : '';
  $('#cli-preferenze').innerHTML = proprie + condivise;
}

$('#pref-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!clienteCorrente) return;
  const reparto = f.reparto.value, categoria = f.categoria.value, testo = f.testo.value.trim();
  if (!reparto || !categoria || !testo) return;
  const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/preferenze`, {
    method: 'POST', body: JSON.stringify({ reparto, categoria, testo }),
  });
  if (status === 201) { f.reset(); caricaPreferenze(clienteCorrente); }
});

$('#cli-preferenze').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del-pref]');
  if (del) { await api(`/api/preferenze/${del.dataset.delPref}`, { method: 'DELETE' }); caricaPreferenze(clienteCorrente); return; }
  const tog = e.target.closest('[data-toggle-ambito]');
  if (tog) {
    const nuovo = tog.dataset.ambito === 'nucleo' ? 'personale' : 'nucleo';
    await api(`/api/preferenze/${tog.dataset.toggleAmbito}`, { method: 'PATCH', body: JSON.stringify({ ambito: nuovo }) });
    caricaPreferenze(clienteCorrente);
  }
});

// --- Suggerimenti AI (Fase 3 C): proposte on-demand, l'operatore conferma ---
let suggerimentiCorrenti = [];
let suggerimentiMostrati = []; // testi già proposti in questa sessione (dedup lato AI)
let aiEseguito = false;        // "Suggerisci AI" già lanciato su QUESTA scheda → pulsante disabilitato
const AI_BTN_LABEL = '✨ Suggerisci preferenze (AI)';

// Riabilita il pulsante AI (chiamato all'apertura/cambio scheda).
function resetAiButton() {
  aiEseguito = false;
  const btn = $('#btn-suggerisci');
  btn.disabled = false;
  btn.textContent = AI_BTN_LABEL;
  btn.removeAttribute('title');
}
function renderSuggerimenti(msg) {
  const box = $('#cli-suggerimenti');
  if (typeof msg === 'string') { box.innerHTML = `<div class="ai-msg">${esc(msg)}</div>`; return; }
  if (!suggerimentiCorrenti.length) { box.innerHTML = '<div class="ai-msg">Non sono state trovate nuove preferenze da suggerire.</div>'; return; }
  const righe = suggerimentiCorrenti.map((s, i) => {
    const af = s.affidabilita || 'media';
    const afClass = 'aff-' + af.replace(/\s+/g, '-');
    const fonteMot = [s.fonte, s.motivo].filter(Boolean).map(esc).join(' — ');
    const safety = s.tipo === 'intolleranza' ? '<span class="ai-tag ai-intolleranza">Intolleranza · sicurezza</span> ' : '';
    return `<li class="ai-item">
      <label><input type="checkbox" data-sugg="${i}" checked />
        <span class="ai-testo">${safety}${esc(s.testo)}</span>
        <span class="ai-conf ${afClass}">${esc(af)}</span>
      </label>
      ${fonteMot ? `<span class="ai-motivo">${fonteMot}</span>` : ''}
    </li>`;
  }).join('');
  box.innerHTML = `<ul class="ai-list">${righe}</ul>
    <div class="ai-actions">
      <button type="button" id="btn-salva-sugg" class="btn btn-primary">Salva selezionati</button>
      <button type="button" id="btn-scarta-sugg" class="btn">Scarta</button>
    </div>`;
}

$('#btn-suggerisci').addEventListener('click', async () => {
  if (!clienteCorrente || aiEseguito) return; // già eseguito su questa scheda → no doppie chiamate
  const btn = $('#btn-suggerisci');
  btn.disabled = true; btn.textContent = 'Analisi in corso…';
  suggerimentiCorrenti = [];
  $('#cli-suggerimenti').innerHTML = '<div class="ai-msg ai-loading"><span class="spinner"></span>L\'AI sta analizzando lo storico del cliente e generando nuove preferenze…</div>';
  // errore/non configurato → si può riprovare (riabilito); esecuzione OK → resta disabilitato.
  const riabilita = () => { btn.disabled = false; btn.textContent = AI_BTN_LABEL; };
  try {
    const { status, body } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/suggerimenti`, {
      method: 'POST', body: JSON.stringify({ giaMostrate: suggerimentiMostrati }),
    });
    if (status === 503) { renderSuggerimenti('AI non configurata: manca la chiave ANTHROPIC_API_KEY o l\'SDK.'); riabilita(); return; }
    if (status !== 200) { renderSuggerimenti('Errore durante la generazione dei suggerimenti.'); riabilita(); return; }
    suggerimentiCorrenti = body.suggerimenti || [];
    // memorizzo i testi proposti così una nuova richiesta non li ripropone
    suggerimentiMostrati.push(...suggerimentiCorrenti.map((s) => s.testo));
    renderSuggerimenti();
    aiEseguito = true; // eseguito → resta disabilitato per tutta la permanenza sulla scheda
    btn.textContent = '✨ Già suggerito su questa scheda';
    btn.title = 'Riapri la scheda per rigenerare i suggerimenti';
  } catch { renderSuggerimenti('Errore di rete durante la generazione.'); riabilita(); }
});

$('#cli-suggerimenti').addEventListener('click', async (e) => {
  if (e.target.closest('#btn-scarta-sugg')) { suggerimentiCorrenti = []; $('#cli-suggerimenti').innerHTML = ''; return; }
  if (!e.target.closest('#btn-salva-sugg')) return;
  const scelti = [...$('#cli-suggerimenti').querySelectorAll('[data-sugg]:checked')].map((c) => suggerimentiCorrenti[Number(c.dataset.sugg)]);
  if (!scelti.length) { suggerimentiCorrenti = []; $('#cli-suggerimenti').innerHTML = ''; return; }
  const btn = $('#btn-salva-sugg'); btn.disabled = true; btn.textContent = 'Salvataggio…';
  let salvaPref = false, salvaIntol = false;
  for (const s of scelti) {
    if (s.tipo === 'intolleranza') {
      await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/intolleranze`, { method: 'POST', body: JSON.stringify({ testo: s.testo }) });
      salvaIntol = true;
    } else {
      // Ambito non deciso dall'AI: default 'nucleo' (di gruppo). L'operatore lo toggla se serve.
      await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/preferenze`, { method: 'POST', body: JSON.stringify({ reparto: s.reparto, categoria: s.categoria, testo: s.testo, ambito: 'nucleo' }) });
      salvaPref = true;
    }
  }
  suggerimentiCorrenti = []; $('#cli-suggerimenti').innerHTML = '';
  if (salvaPref) caricaPreferenze(clienteCorrente);
  if (salvaIntol) caricaIntolleranze(clienteCorrente);
});

// --- Nucleo di viaggio / accompagnatori ---
// Righe in SOLA LETTURA (= dato salvato). La matita ✎ entra in edit-mode; con
// Salva il dato viene persistito e la riga torna alla vista pulita (ricaricata dal
// server → conferma del salvataggio). I membri precompilati portano il badge "auto".
let nucleoEditId = null;
async function caricaNucleo(codCli) {
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/nucleo`);
  const membri = body.nucleo || [];
  $('#cli-nucleo').innerHTML = membri.map((m) => {
    const auto = m.pms_occupant_id ? '<span class="nucleo-auto" title="Precompilato automaticamente dalle prenotazioni">auto</span>' : '';
    if (m.id === nucleoEditId) {
      const opts = RELAZIONI.map((r) => `<option${r === m.tipo_relazione ? ' selected' : ''}>${esc(r)}</option>`).join('');
      return `<li class="nucleo-item nucleo-editing" data-nucleo="${m.id}">
        <select class="nucleo-rel" data-field="tipoRelazione">${opts}</select>
        <input class="nucleo-in" data-field="nome" value="${esc(m.nome || '')}" placeholder="Nome" autocomplete="off" />
        <input class="nucleo-in" data-field="cognome" value="${esc(m.cognome || '')}" placeholder="Cognome" autocomplete="off" />
        <input class="nucleo-in nucleo-nota" data-field="nota" value="${esc(m.nota || '')}" placeholder="Nota" autocomplete="off" />
        <button type="button" class="btn btn-sm btn-primary" data-save-nucleo="${m.id}">Salva</button>
        <button type="button" class="btn btn-sm" data-cancel-nucleo="${m.id}">Annulla</button>
      </li>`;
    }
    const nomeCompl = [m.nome, m.cognome].filter(Boolean).join(' ') || '—';
    return `<li class="nucleo-item" data-nucleo="${m.id}">
      <div class="nucleo-view">
        <span class="pref-tag">${esc(m.tipo_relazione)}</span>
        <span class="nucleo-nome">${esc(nomeCompl)}</span>
        ${m.nota ? `<span class="cell-muted">— ${esc(m.nota)}</span>` : ''}
        ${auto}
      </div>
      <span class="nucleo-az">
        <button type="button" class="btn-icon" data-edit-nucleo="${m.id}" title="Modifica">✎</button>
        <button type="button" class="btn-icon danger" data-del-nucleo="${m.id}" title="Elimina">🗑</button>
      </span>
    </li>`;
  }).join('') || '<li class="nota-vuota">Nessun componente. Aggiungine uno qui sopra.</li>';
}

$('#nucleo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!clienteCorrente) return;
  const tipoRelazione = f.tipoRelazione.value;
  const nome = f.nome.value.trim(), cognome = f.cognome.value.trim(), nota = f.nota.value.trim();
  if (!tipoRelazione || (!nome && !cognome)) return;
  const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/nucleo`, {
    method: 'POST', body: JSON.stringify({ tipoRelazione, nome, cognome, nota }),
  });
  if (status === 201) { f.reset(); caricaNucleo(clienteCorrente); }
});

$('#cli-nucleo').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit-nucleo]');
  if (edit) { nucleoEditId = Number(edit.dataset.editNucleo); caricaNucleo(clienteCorrente); return; }
  const cancel = e.target.closest('[data-cancel-nucleo]');
  if (cancel) { nucleoEditId = null; caricaNucleo(clienteCorrente); return; }
  const del = e.target.closest('[data-del-nucleo]');
  if (del) {
    if (nucleoEditId === Number(del.dataset.delNucleo)) nucleoEditId = null;
    await api(`/api/nucleo/${del.dataset.delNucleo}`, { method: 'DELETE' });
    caricaNucleo(clienteCorrente); return;
  }
  const save = e.target.closest('[data-save-nucleo]');
  if (save) {
    const li = save.closest('[data-nucleo]');
    const payload = {};
    li.querySelectorAll('[data-field]').forEach((el) => { payload[el.dataset.field] = el.value.trim(); });
    save.disabled = true; save.textContent = 'Salvataggio…';
    const { status } = await api(`/api/nucleo/${save.dataset.saveNucleo}`, { method: 'PATCH', body: JSON.stringify(payload) });
    if (status === 200) { nucleoEditId = null; caricaNucleo(clienteCorrente); } // ricarica dal server = conferma
    else { save.disabled = false; save.textContent = 'Errore'; }
  }
});

// --- Gusti F&B (consumi ristorante/bar aggregati dal PMS) ---
async function caricaGusti(codCli) {
  const el = $('#cli-gusti');
  el.innerHTML = '<div class="nota-vuota">Caricamento consumi…</div>';
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/gusti`);
  const g = (body && body.gusti) || { items: [] };
  if (!g.items || !g.items.length) { el.innerHTML = '<div class="nota-vuota">Nessun consumo F&B registrato.</div>'; return; }
  const gruppi = ['Vini', 'Bevande', 'Cibo', 'Altro'].map((m) => {
    const its = g.items.filter((i) => i.categoria === m).slice(0, 6);
    if (!its.length) return '';
    const chips = its.map((i) => `<span class="gusto"><b>${i.volte}×</b> ${esc(i.nome)}</span>`).join('');
    return `<div class="gusti-grp"><span class="gusti-cat">${m}</span><div class="gusti-chips">${chips}</div></div>`;
  }).join('');
  el.innerHTML = `<div class="gusti-head">${g.totConsumi} consumi · ${g.totVoci} voci diverse (i più frequenti)</div>${gruppi}`;
}

// --- Trattamenti SPA (consumi benessere aggregati dagli extra) ---
async function caricaSpa(codCli) {
  const el = $('#cli-spa');
  el.innerHTML = '<div class="nota-vuota">Caricamento trattamenti…</div>';
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/spa`);
  const s = (body && body.spa) || { items: [] };
  if (!s.items || !s.items.length) { el.innerHTML = '<div class="nota-vuota">Nessun trattamento SPA registrato.</div>'; return; }
  const gruppi = ['Trattamento', 'Prodotto', 'Altro'].map((m) => {
    const its = s.items.filter((i) => i.categoria === m).slice(0, 8);
    if (!its.length) return '';
    const chips = its.map((i) => `<span class="gusto"><b>${i.volte}×</b> ${esc(i.nome)}</span>`).join('');
    return `<div class="gusti-grp"><span class="gusti-cat">${m === 'Trattamento' ? 'Trattamenti' : m === 'Prodotto' ? 'Prodotti' : m}</span><div class="gusti-chips">${chips}</div></div>`;
  }).join('');
  el.innerHTML = `<div class="gusti-head">${s.totConsumi} trattamenti/prodotti · ${s.totVoci} voci diverse (i più frequenti)</div>${gruppi}`;
}

// --- Fusione anagrafiche duplicate ---
let clienteNSogg = 0;      // n. soggiorni del cliente corrente (per scegliere il principale)
let duplicatiCorrenti = []; // candidati mostrati nel box

function renderMergeBanner(codCli, merge) {
  const el = $('#cli-merge-banner');
  if (!merge || !merge.membri || merge.membri.length < 2) { el.hidden = true; el.innerHTML = ''; return; }
  const rows = (merge.anagrafiche || []).map((x) => {
    const isPrinc = x.codCli === merge.canonicalId;
    const nome = x.codCli === codCli ? `<b>${esc(x.nominativo || ('#' + x.codCli))}</b>` : `<a href="#cliente/${x.codCli}">${esc(x.nominativo || ('#' + x.codCli))}</a>`;
    const scollega = isPrinc ? '' : ` <button class="btn-icon danger" data-unmerge="${x.codCli}" title="Scollega dal gruppo">×</button>`;
    return `<span class="merge-chip">${nome} <span class="cell-muted">#${x.codCli}${isPrinc ? ' · principale' : ''}</span>${scollega}</span>`;
  }).join(' ');
  el.hidden = false;
  el.innerHTML = `<span class="merge-ico">⛓</span><div><b>Scheda fusa</b> — dati aggregati su ${merge.membri.length} anagrafiche.<div class="merge-chips">${rows}</div></div>`;
}

async function caricaDuplicati(codCli) {
  const el = $('#cli-duplicati');
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/duplicati`);
  duplicatiCorrenti = (body && body.candidati) || [];
  if (!duplicatiCorrenti.length) { el.hidden = true; el.innerHTML = ''; return; }
  const righe = duplicatiCorrenti.map((c) => `<li class="dup-item">
      <span class="dup-match ${c.match === 'CF' ? 'm-cf' : 'm-an'}">${c.match === 'CF' ? 'stesso CF' : 'stesso nome+nascita'}</span>
      <span class="dup-nome">${esc(c.nominativo || ('#' + c.codCli))}</span>
      <span class="cell-muted">#${c.codCli}${c.dtNascita ? ' · ' + fmtData(c.dtNascita) : ''} · ${c.nPrenotazioni} pren.</span>
      <button type="button" class="btn btn-sm" data-merge="${c.codCli}">Unisci</button>
    </li>`).join('');
  el.hidden = false;
  el.innerHTML = `<div class="dup-head">⚠️ Possibili duplicati di questo ospite <span class="info" data-tip="Anagrafiche che sembrano la stessa persona (stesso codice fiscale, o stesso cognome+nome+data di nascita). Unendole, la scheda aggrega soggiorni, consumi e note. Reversibile.">i</span></div><ul class="dup-list">${righe}</ul>`;
}

// Unisci: il principale è chi ha più prenotazioni (default), l'altro diventa membro.
$('#cli-duplicati').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-merge]');
  if (!btn || !clienteCorrente) return;
  const cand = duplicatiCorrenti.find((c) => c.codCli === Number(btn.dataset.merge));
  if (!cand) return;
  const candPrincipale = cand.nPrenotazioni > clienteNSogg;
  const canonicalId = candPrincipale ? cand.codCli : clienteCorrente;
  const memberId = candPrincipale ? clienteCorrente : cand.codCli;
  btn.disabled = true;
  const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/merge`, {
    method: 'POST', body: JSON.stringify({ memberId, canonicalId }),
  });
  if (status === 201) loadCliente(clienteCorrente); // ricarica: aggregazione aggiornata
  else btn.disabled = false;
});

$('#cli-merge-banner').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-unmerge]');
  if (!btn || !clienteCorrente) return;
  await api(`/api/merge/${encodeURIComponent(btn.dataset.unmerge)}`, { method: 'DELETE' });
  loadCliente(clienteCorrente);
});

// --- Pagina "Gestione duplicati" ---
let duplicatiGruppi = [];
async function loadDuplicatiPage() {
  const msg = $('#duplicati-msg'); const wrap = $('#duplicati-wrap');
  msg.hidden = false; msg.textContent = 'Caricamento…'; wrap.hidden = true;
  const { status, body } = await api('/api/duplicati');
  if (status !== 200) { msg.textContent = 'Errore nel caricamento dei duplicati.'; return; }
  duplicatiGruppi = body.gruppi || [];
  renderDuplicatiPage();
}
function renderDuplicatiPage() {
  const sel = document.querySelector('input[name="dupf"]:checked');
  const f = sel ? sel.value : 'tutti';
  const lista = duplicatiGruppi.filter((g) => f === 'tutti' || g.tipo === f);
  $('#dup-count').textContent = `${lista.length} gruppi`;
  const msg = $('#duplicati-msg'); const wrap = $('#duplicati-wrap');
  if (!lista.length) { msg.hidden = false; msg.textContent = 'Nessun gruppo di duplicati.'; wrap.hidden = true; return; }
  msg.hidden = true; wrap.hidden = false;
  $('#duplicati-tbody').innerHTML = lista.map((g) => {
    const codici = g.membri.map((id) => `<a href="#cliente/${id}">#${id}</a>`).join(', ');
    const crit = g.tipo === 'CF' ? 'stesso CF' : 'stesso nome+nascita';
    const fusi = g.fusiCount ? ` <span class="cell-muted">(${g.fusiCount} già fusi)</span>` : '';
    return `<tr>
      <td>${esc(g.nominativo || '—')}</td>
      <td><span class="dup-match ${g.tipo === 'CF' ? 'm-cf' : 'm-an'}">${crit}</span></td>
      <td>${codici}${fusi}</td>
      <td class="num">${g.n}</td>
      <td><a class="btn btn-sm" href="#cliente/${g.membri[0]}">Apri e unisci</a></td>
    </tr>`;
  }).join('');
}
document.querySelectorAll('input[name="dupf"]').forEach((r) => r.addEventListener('change', renderDuplicatiPage));

// --- Intolleranze / allergie (dato di sicurezza) ---
async function caricaIntolleranze(codCli) {
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/intolleranze`);
  const intol = body.intolleranze || [];
  $('#cli-intolleranze').innerHTML = intol.map((i) => `
    <li data-intol="${i.id}">
      <div class="nota-testo">${esc(i.testo)}</div>
      <div class="nota-meta">
        <span>${esc(i.autore || '?')} · ${new Date(i.created_at).toLocaleString('it-IT')}</span>
        <span class="nota-az">
          <button class="btn-icon danger" data-del-intol="${i.id}">Elimina</button>
        </span>
      </div>
    </li>`).join('') || '<li class="nota-vuota">Nessuna intolleranza registrata.</li>';
}

$('#intol-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const testo = f.testo.value.trim();
  if (!testo || !clienteCorrente) return;
  const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/intolleranze`, {
    method: 'POST', body: JSON.stringify({ testo }),
  });
  if (status === 201) { f.reset(); caricaIntolleranze(clienteCorrente); }
});

$('#cli-intolleranze').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del-intol]');
  if (del) {
    await api(`/api/intolleranze/${del.dataset.delIntol}`, { method: 'DELETE' });
    caricaIntolleranze(clienteCorrente);
  }
});

// --- Complaints ---
async function caricaComplaints(codCli) {
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/complaints`);
  const compl = body.complaints || [];
  $('#cli-complaints').innerHTML = compl.map((c) => {
    const risolto = c.stato === 'risolto';
    return `
    <li data-compl="${c.id}" data-periodo="${esc(c.periodo || '')}" class="${risolto ? 'compl-risolto' : ''}">
      <div class="compl-top">
        <span class="pill ${risolto ? 'pill-checkout' : 'pill-atteso'}">${risolto ? 'Risolto' : 'Aperto'}</span>
        ${c.periodo ? `<span class="pref-tag">${esc(c.periodo)}</span>` : ''}
        <span class="compl-testo nota-testo">${esc(c.testo)}</span>
      </div>
      <div class="nota-meta">
        <span>${esc(c.autore || '?')} · ${new Date(c.created_at).toLocaleString('it-IT')}${risolto && c.resolved_at ? ' · risolto ' + new Date(c.resolved_at).toLocaleString('it-IT') : ''}</span>
        <span class="nota-az">
          <button class="btn-icon" data-toggle-compl="${c.id}" data-stato="${c.stato}">${risolto ? 'Riapri' : 'Risolvi'}</button>
          <button class="btn-icon" data-edit-compl="${c.id}">Modifica</button>
          <button class="btn-icon danger" data-del-compl="${c.id}">Elimina</button>
        </span>
      </div>
    </li>`;
  }).join('') || '<li class="nota-vuota">Nessun complaint.</li>';
}

$('#compl-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const testo = f.testo.value.trim();
  const periodo = f.periodo.value.trim();
  if (!testo || !clienteCorrente) return;
  const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/complaints`, {
    method: 'POST', body: JSON.stringify({ testo, periodo }),
  });
  if (status === 201) { f.reset(); caricaComplaints(clienteCorrente); }
});

$('#cli-complaints').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del-compl]');
  const edit = e.target.closest('[data-edit-compl]');
  const toggle = e.target.closest('[data-toggle-compl]');
  if (del) {
    await api(`/api/complaints/${del.dataset.delCompl}`, { method: 'DELETE' });
    caricaComplaints(clienteCorrente);
  } else if (toggle) {
    const nuovoStato = toggle.dataset.stato === 'risolto' ? 'aperto' : 'risolto';
    await api(`/api/complaints/${toggle.dataset.toggleCompl}`, { method: 'PATCH', body: JSON.stringify({ stato: nuovoStato }) });
    caricaComplaints(clienteCorrente);
  } else if (edit) {
    const li = edit.closest('[data-compl]');
    const nuovo = prompt('Modifica complaint:', li.querySelector('.compl-testo').textContent);
    if (nuovo == null || !nuovo.trim()) return;
    const nuovoPeriodo = prompt('Periodo (es. ago 2025), lascia vuoto per nessuno:', li.dataset.periodo || '');
    if (nuovoPeriodo == null) return;
    await api(`/api/complaints/${edit.dataset.editCompl}`, { method: 'PATCH', body: JSON.stringify({ testo: nuovo.trim(), periodo: nuovoPeriodo.trim() }) });
    caricaComplaints(clienteCorrente);
  }
});

refresh();
