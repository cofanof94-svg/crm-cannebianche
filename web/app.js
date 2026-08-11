const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, { cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...opts });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// --- Indicatori di caricamento (uno solo per tutta l'app) ---
// Ogni punto in cui si attende una risposta mostra lo stesso spinner, così
// l'attesa non si confonde mai con "non c'è niente".
const loaderHTML = (testo = 'Caricamento…') => `<span class="caricamento"><span class="spinner"></span>${esc(testo)}</span>`;

// Riquadro di stato a tutta larghezza (aree .state delle pagine).
function mostraLoader(el, testo) {
  if (!el) return;
  el.hidden = false;
  el.innerHTML = loaderHTML(testo);
}

// Riga di attesa dentro un elenco o una card già a video.
function loaderRiga(testo = 'Caricamento…') {
  return `<li class="nota-vuota">${loaderHTML(testo)}</li>`;
}

// --- Pulsanti di generazione AI (una regola sola per tutta l'app) ---
// Una generazione riuscita non si ripete finché l'operatore resta sulla stessa
// anagrafica/pagina: il pulsante resta disabilitato e dice perché, così non lo si
// clicca due volte (ogni clic è una chiamata al modello, con attesa e costo).
// Gli ERRORI non contano come esecuzione: lì si deve poter riprovare subito.
// Il registro è per chiave, non per nodo DOM: un pulsante ricostruito da un
// re-render (filtro sugli arrivi, riapertura del riquadro note) ritrova il suo stato.
const aiEseguiti = new Set();
const aiGiaFatto = (chiave) => aiEseguiti.has(chiave);
const aiSegnaFatto = (chiave) => aiEseguiti.add(chiave);

// Azzera un ambito: 'scheda' al cambio anagrafica, 'arrivi' rientrando nella pagina.
function aiAzzera(ambito) {
  for (const k of [...aiEseguiti]) if (k.startsWith(`${ambito}:`)) aiEseguiti.delete(k);
}

// Applica lo stato "già generato" a un pulsante (o lo lascia intatto se non lo è).
function aiApplicaStato(btn, chiave, etichetta, titolo) {
  if (!btn || !aiGiaFatto(chiave)) return false;
  btn.disabled = true;
  if (etichetta) btn.textContent = etichetta;
  btn.title = titolo;
  return true;
}

// --- Riferimenti a un cliente ---
// Regola dell'app: ovunque compaia il nome di un cliente si deve poter aprire la
// sua anagrafica. Un unico helper, così nessun elenco se ne dimentica.
// Senza codice non c'è scheda da aprire (es. un accompagnatore scritto a mano nel
// nucleo, mai registrato nel PMS): resta testo, senza fingere un link morto.
// nuovaScheda: apre in un'altra scheda del browser, per non perdere il contesto
// (usato nella modale di confronto, dove si sta prendendo una decisione).
function linkCliente(codCli, testo, opts = {}) {
  const etichetta = esc(testo == null || testo === '' ? `#${codCli}` : testo);
  const classi = ['cli-ref', opts.classe].filter(Boolean).join(' ');
  // Attenzione: Number(null) e Number('') valgono 0, che passerebbe per un codice
  // valido e produrrebbe un link a #cliente/0. Si scartano prima della conversione.
  const id = (codCli == null || codCli === '') ? NaN : Number(codCli);
  if (!Number.isInteger(id) || id <= 0) {
    return opts.classe ? `<span class="${esc(opts.classe)}">${etichetta}</span>` : etichetta;
  }
  const extra = opts.nuovaScheda ? ' target="_blank" rel="noopener"' : '';
  return `<a class="${esc(classi)}" href="#cliente/${id}"${extra} title="${esc(opts.titolo || `Apri l'anagrafica #${id}`)}">${etichetta}</a>`;
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
let hashRoutePrec = ''; // hash precedente, per capire da dove si arriva
function route() {
  const hash = (location.hash || '#home').slice(1);
  const cameFrom = hashRoutePrec;
  hashRoutePrec = hash;
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
  // Le altre viste accettano un parametro dopo la barra: oggi solo
  // #incasa/<chip>, per aprire "In casa" con un filtro già attivo.
  const [view, param] = hash.split('/');
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
  // Rientro negli Arrivi: reset a oggi, tranne quando si torna da una scheda ospite
  // (in quel caso si conserva la data che si stava consultando).
  else if (v === 'arrivi') initArrivi(!cameFrom.startsWith('cliente/'));
  else if (v === 'incasa') initInCasa(!cameFrom.startsWith('cliente/'), param);
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
  // I tre numeri non restano su '–' senza spiegazione: durante l'attesa girano.
  ['#kpi-arrivi', '#kpi-partenze', '#kpi-presenti'].forEach((sel) => { $(sel).innerHTML = '<span class="spinner"></span>'; });
  $('#home-date').textContent = '';
  const { status, body } = await api('/api/dashboard');
  if (status !== 200) {
    ['#kpi-arrivi', '#kpi-partenze', '#kpi-presenti'].forEach((sel) => { $(sel).textContent = '–'; });
    $('#home-error').textContent = 'Impossibile leggere i dati dal PMS.';
    return;
  }
  $('#home-date').textContent = dataEstesa(body.data);
  $('#kpi-arrivi').textContent = body.arrivi;
  $('#kpi-partenze').textContent = body.partenze;
  $('#kpi-presenti').textContent = body.presenti;
}

// Ricerca condivisa da Arrivi e In casa: numero di pratica, camera, referente o
// occupante. La pratica è l'unico identificativo davvero univoco di una
// prenotazione (i nominativi si ripetono, le camere cambiano nel soggiorno).
function matchPrenotazione(x, term) {
  const t = (term || '').trim().toLowerCase();
  if (!t) return true;
  return String(x.codpratica || '').includes(t)
    || (x.camere || '').toLowerCase().includes(t)
    || (x.nominativo || '').toLowerCase().includes(t)
    || (x.ospiti || []).some((o) => (o.nominativo || '').toLowerCase().includes(t));
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

function initArrivi(resetOggi) {
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
  // Rientrando nella pagina i pulsanti "Briefing AI" tornano disponibili: la
  // regola vale finché si resta sugli arrivi (cambiare data non è uscire).
  aiAzzera('arrivi');
  // Reset a oggi: azzero la data → loadArrivi usa la data di lavoro (oggi).
  if (resetOggi) $('#arrivi-data').value = '';
  loadArrivi();
}

const briefingTesti = {}; // cache cli → briefing (per il "Salva nel profilo" e per i re-render)
const chiaveBrief = (cli) => `arrivi:brief:${cli}`;
const chiaveSalvaBrief = (cli) => `arrivi:salva:${cli}`;
const BRIEF_FATTO_TIT = 'Briefing già generato: esci e rientra negli arrivi per rifarlo';

async function eseguiBriefing(btn) {
  const cli = btn.dataset.briefCli;
  if (aiGiaFatto(chiaveBrief(cli))) return; // già generato su questa pagina
  const box = btn.closest('.arr-card').querySelector('.arr-brief-result');
  btn.disabled = true;
  box.hidden = false;
  box.innerHTML = '<div class="ai-msg ai-loading"><span class="spinner"></span>Ricerca su fonti pubbliche in corso…</div>';
  // Errore o AI non configurata → si deve poter riprovare: il pulsante torna attivo.
  const riabilita = () => { btn.disabled = false; };
  try {
    const { status, body } = await api(`/api/clienti/${encodeURIComponent(cli)}/briefing`, { method: 'POST', body: JSON.stringify({}) });
    if (status === 503) { riabilita(); box.innerHTML = briefMsg('AI non configurata: manca la chiave ANTHROPIC_API_KEY o l\'SDK.'); return; }
    if (status !== 200) { riabilita(); box.innerHTML = briefMsg('Errore durante la generazione del briefing.'); return; }
    briefingTesti[cli] = body;
    box.innerHTML = renderBriefResult(body, cli);
    aiSegnaFatto(chiaveBrief(cli)); // riuscito → niente seconda generazione su questa pagina
    aiApplicaStato(btn, chiaveBrief(cli), '✨ Briefing già generato', BRIEF_FATTO_TIT);
  } catch {
    riabilita();
    box.innerHTML = briefMsg('Errore di rete durante la generazione del briefing.');
  }
}

async function salvaBriefingNelProfilo(btn) {
  const cli = btn.dataset.saveCli;
  const b = briefingTesti[cli];
  if (!b || !b.testo || aiGiaFatto(chiaveSalvaBrief(cli))) return; // un secondo clic accodava la nota due volte
  btn.disabled = true;
  const { status, body } = await api(`/api/clienti/${encodeURIComponent(cli)}/note-personali`, {
    method: 'PUT', body: JSON.stringify({ testo: b.testo, mode: 'append' }),
  });
  if (status !== 200) { btn.disabled = false; btn.textContent = 'Errore nel salvataggio'; return; }
  aiSegnaFatto(chiaveSalvaBrief(cli));
  btn.textContent = '✓ Salvato nel profilo';
  btn.title = 'Già aggiunto alle Note personali del profilo';
  btn.classList.add('brief-save-done');
  // La nota è salvata nell'anagrafica: la card la mostra subito, senza ricaricare.
  // (In casa e la scheda ospite rileggono dal server quando le si apre.)
  aggiornaNotaNelleCard(Number(cli), body.nota || null);
}

// Allinea la nota nelle card già a video dopo un salvataggio (stesso cliente su
// più prenotazioni = più card). La nota resta una sola: qui si aggiorna la copia
// mostrata, non se ne crea un'altra.
function aggiornaNotaNelleCard(codCli, nota) {
  if (!Number.isInteger(codCli)) return;
  let toccate = 0;
  for (const a of arriviAll) {
    if (a.codCliente !== codCli || !a.snapshot) continue;
    a.snapshot.notaPersonale = nota;
    toccate += 1;
  }
  if (toccate) renderArrivi();
}

function briefMsg(t) { return `<div class="brief-card"><div class="ai-msg">${esc(t)}</div></div>`; }

function renderBriefResult(b, cli) {
  const fonti = (b.fonti || [])
    .map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.titolo || f.url)}</a></li>`)
    .join('');
  const nFonti = (b.fonti || []).length;
  const fontiBlock = fonti
    ? `<details class="brief-fonti"><summary>Fonti (${nFonti})</summary><ul>${fonti}</ul></details>`
    : '';
  // Salvataggio nel profilo solo se l'ospite è stato riconosciuto (pubblico).
  const salvato = cli && aiGiaFatto(chiaveSalvaBrief(cli));
  const salva = b.pubblico && cli
    ? `<button type="button" class="brief-save${salvato ? ' brief-save-done' : ''}" data-save-cli="${esc(cli)}"${salvato
      ? ' disabled title="Già aggiunto alle Note personali del profilo">✓ Salvato nel profilo'
      : ' title="Aggiungi alle Note personali del profilo">💾 Salva nel profilo'}</button>`
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
  // Calcolo interamente in UTC: parsare 'YYYY-MM-DD' come ora locale e poi
  // usare toISOString (UTC) sfasava di un giorno nei fusi con offset positivo,
  // facendo sembrare inerte il pulsante "giorno successivo".
  const iso = input.value || new Date().toISOString().slice(0, 10);
  const [y, m, d] = iso.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + giorni);
  input.value = base.toISOString().slice(0, 10);
  loadArrivi();
}

async function loadArrivi() {
  const input = $('#arrivi-data');
  const tab = $('#arrivi-cards');
  const msg = $('#arrivi-msg');
  tab.hidden = true; mostraLoader(msg, 'Carico gli arrivi…');
  $('#arrivi-briefing').hidden = true; $('#arrivi-stato').textContent = '';
  filtroBriefing = 'all';
  const q = input.value ? `?data=${encodeURIComponent(input.value)}` : '';
  const { status, body } = await api(`/api/arrivi${q}`);
  if (status !== 200) { msg.textContent = 'Errore nel leggere gli arrivi dal PMS.'; return; }
  if (!input.value && body.data) input.value = body.data; // data di lavoro dal server
  arriviAll = body.arrivi || [];
  arriviBriefing = body.briefing || null;
  arriviData = body.data || input.value || null;
  // L'export lavora sulla lista appena caricata: segue la data che stai guardando.
  if (typeof registraDatiExport === 'function') registraDatiExport('arrivi', arriviAll, arriviData);
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
    .filter((a) => matchPrenotazione(a, $('#arrivi-search').value))
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

// Badge VIP compatto per le card (l'indesiderato ha priorità come warning).
function badgeVip(v) {
  if (!v) return '';
  if (v.indesiderato) return `<span class="pill pill-warning" title="${esc(v.descrizione)}">⚠ Ospite indesiderato</span>`;
  const cl = (v.descrizione && v.descrizione !== v.cod) ? `<span class="vip-class">${esc(v.descrizione)}</span>` : '';
  return `<span class="pill pill-vip" title="Classificazione VIP: ${esc(v.descrizione)} (${esc(v.cod)})">★ VIP</span>${cl}`;
}

// Allergie/intolleranze nelle card. Senza etichetta "Noci" da solo sembra una
// preferenza: la parola davanti è ciò che rende l'alert leggibile in un colpo
// d'occhio. Fonte unica: le intolleranze dell'anagrafica, già nello snapshot —
// qui non si aggiunge né si copia nulla. Campo vuoto → nessun alert (non un
// alert vuoto). classe: 'arr-flag' negli Arrivi, 'flag' In casa.
function flagAllergie(s, classe) {
  const voci = ((s && s.intolleranze) || []).filter((x) => String(x || '').trim());
  if (!voci.length) return '';
  // Il titolo tiene la distinzione precisa (allergia ≠ intolleranza) senza
  // allungare l'etichetta: in card serve la parola che fa alzare la guardia.
  return `<span class="${esc(classe)} flag-safety" title="Allergie / intolleranze — dato di sicurezza">`
    + `<span class="flag-lbl">⚠ Allergie:</span>${esc(voci.join(', '))}</span>`;
}

// Reclami nelle card. "Reclami: 1 aperti / 2" dice che c'è un problema ma non
// quale: chi accoglie l'ospite deve poterlo leggere senza aprire la scheda.
// Si mostra il testo di quelli APERTI (i risolti restano un conteggio: sono
// storia, e il loro testo qui sarebbe rumore).
function flagReclami(s, classe) {
  const r = s && s.reclami;
  if (!r || !r.totali) return '';
  const dett = (r.apertiDettaglio || []).filter((c) => c && c.testo);
  const perEsteso = (c) => [c.reparto, c.categoria].filter(Boolean).join(' · ');
  if (r.aperti && dett.length) {
    const primo = dett[0];
    const altri = r.aperti - 1;
    // Il reparto davanti al testo: dice a chi gira il problema, in due parole.
    const dove = perEsteso(primo) ? `<span class="flag-lbl">${esc(perEsteso(primo))}</span>` : '';
    const etichetta = `⚑ Reclamo aperto: ${dove}${esc(anteprimaNota(primo.testo, 70))}${altri > 0 ? ` <span class="flag-piu">+${altri}</span>` : ''}`;
    const titolo = dett.map((c) => (perEsteso(c) ? `${perEsteso(c)} — ${c.testo}` : c.testo)).join(' · ');
    return `<span class="${esc(classe)} flag-warning" title="${esc(titolo)}">${etichetta}</span>`;
  }
  // Aperti senza testo (dato incompleto) o solo reclami chiusi: resta il numero.
  const testo = r.aperti ? `⚑ Reclami: ${r.aperti} ${r.aperti === 1 ? 'aperto' : 'aperti'} / ${r.totali}` : `⚑ Reclami passati: ${r.totali}`;
  return `<span class="${esc(classe)} flag-warning">${testo}</span>`;
}

// Nota personale in versione da card (Arrivi e In casa usano lo stesso pezzo).
// È la STESSA nota dell'anagrafica, solo accorciata: si modifica solo da lì.
// prefisso: 'arr' o 'ic', per restare nello stile della pagina che la ospita.
function rigaNotaPersonale(s, prefisso) {
  const n = s && s.notaPersonale;
  if (!n || !n.sintesi) return '';
  const tip = n.troncata && n.testo ? n.testo : 'Nota personale (dall\'anagrafica)';
  return `<div class="${prefisso}-nota"><span class="${prefisso}-lbl">Nota</span>`
    + `<span class="nota-sint" title="${esc(tip)}">${esc(n.sintesi)}${n.troncata ? ' <span class="nota-piu">…</span>' : ''}</span></div>`;
}

// Banda snapshot: le informazioni per l'accoglienza, in evidenza. Vuota → non renderizza.
function snapshotBand(s) {
  if (!s) return '';
  const flags = [];
  if (s.indesiderato) flags.push('<span class="arr-flag flag-danger">⚠ Ospite indesiderato</span>');
  if (s.compleanno) {
    const chi = s.compleanno.nome ? ` · ${linkCliente(s.compleanno.codCli, s.compleanno.nome)}` : '';
    flags.push(`<span class="arr-flag flag-birthday">🎂 Compleanno ${fmtData(s.compleanno.data)}${chi}</span>`);
  }
  const allergie = flagAllergie(s, 'arr-flag');
  if (allergie) flags.push(allergie);
  const reclami = flagReclami(s, 'arr-flag');
  if (reclami) flags.push(reclami);
  const prefs = (s.preferenzeTop || [])
    .map((p) => `<span class="arr-pref" title="${esc(p.reparto || '')}${p.categoria ? ' / ' + esc(p.categoria) : ''}">${esc(p.testo)}</span>`)
    .join('');
  const prefBlock = prefs ? `<div class="arr-prefs"><span class="arr-lbl">Preferenze</span>${prefs}</div>` : '';
  const notaBlock = rigaNotaPersonale(s, 'arr');
  if (!flags.length && !prefBlock && !notaBlock) return '';
  const flagBlock = flags.length ? `<div class="arr-flags">${flags.join('')}</div>` : '';
  return `<div class="arr-snap">${flagBlock}${notaBlock}${prefBlock}</div>`;
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
      ? linkCliente(o.codCli, o.nominativo || '—', { classe: 'ospite-link' })
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
    ? linkCliente(a.codCliente, a.nominativo, { classe: 'arr-name-link' })
    : '(senza nominativo)';
  const ora = a.oraArrivo ? `<span class="arr-ora">🕒 ${esc(a.oraArrivo)}</span>` : '';
  const notti = a.notti != null ? ` · ${a.notti} ${a.notti === 1 ? 'notte' : 'notti'}` : '';
  const camere = a.camere ? a.camere.split(',').map((c) => `<span class="room">${esc(c.trim())}</span>`).join('') : '';
  const tipologie = a.tipologie ? a.tipologie.split(',').map((t) => `<span class="tipo-chip">${esc(t.trim())}</span>`).join('') : '';
  const tratt = [a.trattamento, a.tariffa].filter(Boolean).map(esc).join(' / ') || '—';
  const tot = a.importo != null ? euro(a.importo) : '—';
  const ospiti = renderOspitiArrivo(a);
  const accento = s && s.indesiderato ? ' arr-card-danger' : (s && s.vip ? ' arr-card-vip' : '');
  // Un briefing già generato resta generato: filtri e ricerca ricostruiscono le
  // card, ma il pulsante torna disabilitato e il testo riappare dalla cache.
  const briefFatto = !!a.codCliente && aiGiaFatto(chiaveBrief(a.codCliente));
  const briefBtn = a.codCliente
    ? `<button type="button" class="arr-brief-btn${s && s.vip ? ' arr-brief-vip' : ''}" data-brief-cli="${a.codCliente}"${briefFatto
      ? ` disabled title="${esc(BRIEF_FATTO_TIT)}">✨ Briefing già generato`
      : ' title="Cerca informazioni pubbliche su questo ospite">✨ Briefing AI'}</button>`
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
      ${briefFatto && briefingTesti[a.codCliente]
    ? `<div class="arr-brief-result">${renderBriefResult(briefingTesti[a.codCliente], a.codCliente)}</div>`
    : '<div class="arr-brief-result" hidden></div>'}
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
// La pagina risponde a "chi c'è, dove, quanto resta e a chi devo stare attento":
// la camera è l'ancora visiva, la data di arrivo lascia il posto all'avanzamento
// del soggiorno, e tutto il resto (alert, preferenze, storico) compare solo se c'è.
let incasaInited = false;
let incasaAll = [];
let incasaData = null;
let incasaBriefing = null;
let filtroInCasa = 'all';

// Chip filtranti: pochi e operativi. Gli "usciti" (check-out fatto) restano in
// fondo alla lista, ma hanno un chip per isolarli quando servono.
const INCASA_CHIPS = [
  { key: 'all', label: 'In casa', field: 'presenti', pred: () => true },
  // "Partono oggi" = ancora in camera con partenza odierna + chi ha già fatto il
  // check-out. È il filtro che apre la Home cliccando su "Partenze oggi".
  { key: 'partenze', label: 'Partono oggi', field: 'partonoOggi', pred: (c) => c.statoPartenza === 'partenza' || c.statoPartenza === 'checkout' },
  { key: 'vip', label: 'VIP', field: 'vip', pred: (c) => !!(c.snapshot && c.snapshot.vip) },
  { key: 'alert', label: 'Alert', field: 'alert', pred: (c) => !!(c.snapshot && ((c.snapshot.intolleranze && c.snapshot.intolleranze.length) || c.snapshot.indesiderato)) },
  { key: 'ricorrenze', label: 'Ricorrenze', field: 'ricorrenze', pred: (c) => !!(c.snapshot && c.snapshot.compleanno) },
  { key: 'reclami', label: 'Reclami', field: 'reclami', pred: (c) => !!(c.snapshot && c.snapshot.reclami && c.snapshot.reclami.totali > 0) },
  { key: 'usciti', label: 'Usciti', field: 'usciti', pred: (c) => c.statoPartenza === 'checkout' },
];

// resetFiltri: rientrando nella pagina si riparte dalla lista completa. Fa
// eccezione il ritorno da una scheda ospite, dove si conserva quello che si
// stava consultando (stessa regola degli Arrivi).
// filtroIniziale: chip da attivare all'ingresso, dall'hash #incasa/<chip>
// (la Home ci porta su #incasa/partenze).
function initInCasa(resetFiltri, filtroIniziale) {
  if (!incasaInited) {
    $('#incasa-search').addEventListener('input', renderInCasa);
    $('#incasa-briefing').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-incasa]');
      if (!chip) return;
      const key = chip.dataset.incasa;
      filtroInCasa = (filtroInCasa === key || key === 'all') ? 'all' : key;
      renderInCasa();
    });
    incasaInited = true;
  }
  const richiesto = INCASA_CHIPS.some((c) => c.key === filtroIniziale) ? filtroIniziale : null;
  if (richiesto || resetFiltri) {
    filtroInCasa = richiesto || 'all';
    $('#incasa-search').value = '';
  }
  loadInCasa();
}

async function loadInCasa() {
  const tab = $('#incasa-cards');
  const msg = $('#incasa-msg');
  const stato = $('#incasa-stato');
  tab.hidden = true; mostraLoader(msg, 'Carico i clienti in casa…'); stato.textContent = '';
  const { status, body } = await api('/api/incasa');
  if (status !== 200) { msg.textContent = 'Errore nel leggere i dati dal PMS.'; return; }
  incasaAll = body.clienti || [];
  incasaData = body.data || null;
  incasaBriefing = body.briefing || null;
  if (typeof registraDatiExport === 'function') registraDatiExport('incasa', incasaAll, incasaData);
  renderInCasa();
}

function renderBriefingInCasa() {
  const bar = $('#incasa-briefing');
  const b = incasaBriefing;
  if (!b) { bar.hidden = true; return; }
  const chips = INCASA_CHIPS.map((c) => {
    const n = b[c.field] || 0;
    if (c.key === 'usciti' && n === 0) return ''; // il chip "Usciti" compare solo se ce ne sono
    const spento = c.key !== 'all' && n === 0 ? ' brief-chip-off' : '';
    const attivo = filtroInCasa === c.key ? ' brief-chip-on' : '';
    return `<button type="button" class="brief-chip brief-${c.key}${attivo}${spento}" data-incasa="${c.key}">
      <span class="brief-n">${n}</span><span class="brief-l">${c.label}</span></button>`;
  }).join('');
  bar.innerHTML = `<div class="briefing-inner">
    <span class="briefing-date">${esc(dataEstesa(incasaData))}</span>
    <div class="briefing-chips">${chips}</div>
  </div>`;
  bar.hidden = false;
}

function renderInCasa() {
  const cards = $('#incasa-cards');
  const msg = $('#incasa-msg');
  const stato = $('#incasa-stato');
  renderBriefingInCasa();
  const chip = INCASA_CHIPS.find((c) => c.key === filtroInCasa) || INCASA_CHIPS[0];
  // Senza filtro esplicito i check-out restano in lista (in fondo, attenuati).
  const lista = incasaAll
    .filter((c) => matchPrenotazione(c, $('#incasa-search').value))
    .filter(chip.pred);
  const presenti = incasaBriefing ? incasaBriefing.presenti : incasaAll.length;
  if (lista.length === 0) {
    cards.hidden = true; msg.hidden = false;
    msg.textContent = incasaAll.length === 0 ? 'Nessun cliente in casa.' : 'Nessun risultato per il filtro.';
    stato.textContent = `${presenti} ${presenti === 1 ? 'presente' : 'presenti'}`;
    return;
  }
  stato.textContent = lista.length === incasaAll.length
    ? `${presenti} ${presenti === 1 ? 'presente' : 'presenti'}`
    : `${lista.length} di ${incasaAll.length}`;
  cards.innerHTML = lista.map(schedaInCasa).join('');
  msg.hidden = true; cards.hidden = false;
}

// Avanzamento del soggiorno: pallini + testo parlante ("Notte 3 di 7").
function renderAvanzamento(c) {
  const av = c.avanzamento;
  if (c.statoPartenza === 'checkout') {
    const n = c.notti != null ? ` · ${c.notti} ${c.notti === 1 ? 'notte' : 'notti'}` : '';
    return `<span>Soggiorno concluso${n}</span>`;
  }
  if (!av) return `<span>Parte il ${fmtData(c.dtpartenza)}</span>`;
  // Pallini solo per soggiorni brevi: oltre le 14 notti diventano rumore.
  const dots = av.notti <= 14
    ? `<span class="ic-prog">${Array.from({ length: av.notti }, (_, i) => `<i class="ic-dot${i < av.notte ? ' on' : ''}"></i>`).join('')}</span>`
    : '';
  const testo = av.ultimaNotte && c.statoPartenza === 'partenza'
    ? 'Ultima notte · <b>parte oggi</b>'
    : `Notte ${av.notte} di ${av.notti} · parte ${fmtData(c.dtpartenza)}`;
  return `${dots}<span>${testo}</span>`;
}

// "Ospite di ritorno". `storico.n` sono i soggiorni GIÀ CONCLUSI: quello in corso
// è quindi l'(n+1)-esimo. Chi non è mai stato qui non ha badge.
function badgeStorico(s) {
  if (!s || !s.n) return '';
  const ultima = s.ultima ? ` · ultima ${fmtData(s.ultima)}` : '';
  const tip = `${s.n} ${s.n === 1 ? 'soggiorno concluso' : 'soggiorni conclusi'} in hotel`;
  return `<span class="ic-ritorno" title="${tip}">${s.n + 1}ª volta${ultima}</span>`;
}

// Occupanti in camera, in riga compatta con l'eventuale relazione col referente.
function renderOspitiInCasa(c) {
  const rel = (c.snapshot && c.snapshot.relazioni) || {};
  const ospiti = (c.ospiti || []).filter((o) => o.codCli !== c.codCliente);
  if (!ospiti.length) return '';
  const voci = ospiti.map((o) => {
    const r = rel[o.codCli];
    const relTxt = r && r.toLowerCase() !== 'altro' ? ` <span class="ic-rel">${esc(r)}</span>` : '';
    const nome = linkCliente(o.codCli, o.nominativo || '—');
    return `<span>${nome}${relTxt}</span>`;
  }).join('');
  return `<div class="ic-ospiti">👤 ${voci}</div>`;
}

function schedaInCasa(c) {
  const s = c.snapshot || null;
  const uscito = c.statoPartenza === 'checkout';
  const accento = s && s.indesiderato ? ' ic-danger' : (s && s.vip ? ' ic-vip' : '');
  const nome = c.nominativo
    ? linkCliente(c.codCliente, c.nominativo, { classe: 'ic-name' })
    : '<span class="ic-name">(senza nominativo)</span>';
  const camere = c.camere
    ? c.camere.split(',').map((x) => `<span class="ic-room">${esc(x.trim())}</span>`).join('')
    : '<span class="ic-room ic-room-vuota">—</span>';
  const tipologie = c.tipologie
    ? c.tipologie.split(',').map((t) => `<span class="ic-tipo">${esc(t.trim())}</span>`).join('')
    : '';
  const pill = uscito
    ? '<span class="pill pill-checkout">Check-out effettuato</span>'
    : (c.statoPartenza === 'partenza' ? '<span class="pill pill-partenza">Parte oggi</span>' : '');

  const flags = [];
  if (s && s.indesiderato) flags.push('<span class="flag flag-danger">⚠ Ospite indesiderato</span>');
  const allergie = flagAllergie(s, 'flag');
  if (allergie) flags.push(allergie);
  if (s && s.compleanno) {
    const chi = s.compleanno.nome ? ` · ${linkCliente(s.compleanno.codCli, s.compleanno.nome)}` : '';
    flags.push(`<span class="flag flag-birthday">🎂 Compleanno ${fmtData(s.compleanno.data)}${chi}</span>`);
  }
  const reclamiFlag = flagReclami(s, 'flag');
  if (reclamiFlag) flags.push(reclamiFlag);
  const flagBlock = flags.length ? `<div class="ic-flags">${flags.join('')}</div>` : '';

  const prefs = ((s && s.preferenzeTop) || [])
    .map((p) => `<span class="pref" title="${esc(p.reparto || '')}${p.categoria ? ' / ' + esc(p.categoria) : ''}">${esc(p.testo)}</span>`)
    .join('');
  const prefBlock = prefs ? `<div class="ic-prefs"><span class="ic-lbl">Preferenze</span>${prefs}</div>` : '';
  const notaBlock = rigaNotaPersonale(s, 'ic');

  const tratt = [c.trattamento, c.tariffa].filter(Boolean).map(esc).join(' / ');
  const note = c.note
    ? `<details class="ic-note"><summary>Note PMS <span class="note-prev">${esc(anteprimaNota(c.note))}</span></summary>
         <div class="note-body">${esc(c.note)}</div></details>`
    : '';

  return `
    <article class="ic${accento}${uscito ? ' ic-out' : ''}">
      <div class="ic-head">
        ${camere}${tipologie}
        ${nome}
        ${badgeVip(s && s.vip)}
        <span class="ic-spacer"></span>
        ${pill}
      </div>
      <div class="ic-stay">${renderAvanzamento(c)}${badgeStorico(c.storico)}</div>
      ${flagBlock}
      ${notaBlock}
      ${prefBlock}
      ${renderOspitiInCasa(c)}
      <div class="ic-op">
        ${tratt ? `<span><i>Trattamento</i><b>${tratt}</b></span>` : ''}
        ${c.extra ? `<span><i>Extra</i><b>${euro(c.extra)}</b></span>` : ''}
        <span><i>Soggiorno</i><b>${c.importo != null ? euro(c.importo) : '—'}</b></span>
        <span><i>Pratica</i><b>${esc(c.codpratica)}</b></span>
      </div>
      ${note}
    </article>`;
}

// Anteprima di una riga per le note PMS (oggi lunghe anche 2.000 caratteri):
// si appiattiscono gli a capo e si taglia, il testo pieno resta nel dettaglio.
function anteprimaNota(t, max = 90) {
  const piatto = String(t).replace(/\s+/g, ' ').trim();
  return piatto.length > max ? `${piatto.slice(0, max)}…` : piatto;
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
  mostraLoader(msg, 'Ricerca in corso…'); list.hidden = true;
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
  $('#user-list').innerHTML = `<tr><td colspan="6">${loaderHTML('Carico gli utenti…')}</td></tr>`;
  const { body } = await api('/api/admin/users');
  usersCache = body.users || [];
  $('#user-list').innerHTML = usersCache.map((u) => `
    <tr>
      <td class="cell-name">${esc(u.username)}</td>
      <td>${cell(u.nome)}</td>
      <td>${cell(u.cognome)}</td>
      <td class="cell-muted">${cell(u.email)}</td>
      <td><span class="role-tag">${esc(u.role)}</span></td>
      <td>${u.attivo ? '<span class="pill pill-attivo">Attivo</span>' : '<span class="pill pill-disattivato">Disattivato</span>'}</td>
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
  // L'accesso passa dal DB: senza attesa visibile un login lento sembra ignorato.
  const btn = f.querySelector('button[type="submit"]');
  const testo = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>Accesso…`; }
  $('#login-error').textContent = '';
  const { status } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: f.username.value, password: f.password.value }),
  });
  if (btn) { btn.disabled = false; btn.textContent = testo; }
  if (status === 200) { f.reset(); $('#login-error').textContent = ''; refresh(); }
  else $('#login-error').textContent = status === 401 ? 'Credenziali non valide' : 'Errore di collegamento al server.';
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
  body.hidden = true; mostraLoader(msg, 'Carico la scheda ospite…');
  const { status, body: d } = await api(`/api/clienti/${encodeURIComponent(codCli)}`);
  if (status === 404 || status === 400) { msg.textContent = 'Ospite non trovato.'; return; }
  if (status !== 200) { msg.textContent = 'Errore nel leggere l\'ospite dal PMS.'; return; }
  clienteCorrente = codCli;
  const a = d.anagrafica;
  const s = d.statistiche;
  $('#cli-nome').textContent = a.nominativo || '(senza nominativo)';
  $('#cli-avatar').textContent = ((a.cognome || a.nome || '?')[0] || '?').toUpperCase();
  // Data di nascita: dato del gestionale, in sola lettura (si modifica nel PMS,
  // così non ci sono due valori in giro che possono divergere).
  $('#cli-contatti').innerHTML = [
    contattoCard('Data di nascita', a.dtNascita ? fmtData(a.dtNascita) : null),
    contattoCard('Email', a.email, a.email ? `mailto:${a.email}` : null),
    contattoCard('Telefono', a.telefono, a.telefono ? `tel:${a.telefono}` : null),
    contattoCard('Cellulare', a.cellulare, a.cellulare ? `tel:${a.cellulare}` : null),
    contattoCard('Provenienza', [a.citta, a.nazione].filter(Boolean).join(', ')),
  ].filter(Boolean).join('') || '<div class="cc cc-empty">Nessun dato di contatto</div>';
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
  const noteNucleo = (d.noteNucleo || []).map((n) => `<div class="an-nucleo">👪 <b>${linkCliente(n.codCli, n.nominativo)}</b> — ${esc(n.nota)}</div>`).join('');
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
  popolaSelect($('#compl-form').reparto, REPARTI, 'Reparto');
  popolaSelect($('#compl-form').categoria, CATEGORIE_COMPLAINT, 'Categoria');
  popolaSelect($('#nucleo-form').tipoRelazione, RELAZIONI, 'Relazione');
  suggerimentiCorrenti = []; suggerimentiMostrati = []; $('#cli-suggerimenti').innerHTML = ''; // azzera proposte AL cambio cliente
  aiAzzera('scheda'); // aprire una scheda rende di nuovo disponibili i pulsanti AI (suggerimenti, note personali)
  resetAiButton();
  nucleoEditId = null; // esci da eventuale edit-mode del nucleo
  // Sezioni CRM indipendenti (endpoint e nodi DOM distinti): caricate in parallelo.
  await Promise.all([
    caricaGusti(codCli), caricaSpa(codCli), caricaDuplicati(codCli), caricaLingua(codCli), caricaIntolleranze(codCli),
    caricaPreferenze(codCli), caricaNucleo(codCli), caricaComplaints(codCli),
  ]);
  msg.hidden = true; body.hidden = false;
}

// Colore dello stato nello storico soggiorni. 'Partito' è un soggiorno finito,
// non una partenza da gestire: va col grigio dei conclusi, non con l'arancione
// di "Parte oggi".
function statoSoggPill(stato) {
  if (stato === 'In casa') return 'pill-incasa';
  if (stato === 'Concluso' || stato === 'Partito') return 'pill-checkout';
  if (stato === 'Eliminata') return 'pill-eliminata';
  if (stato === 'Pianificata') return 'pill-pianificata';
  if (stato === 'No-show') return 'pill-noshow';
  return 'pill-atteso'; // 'Confermato': arriva oggi
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
function rigaSoggiorno(x) {
  // Importo unico dal backend (BUG-006): pianificato per le correnti, maturato per le concluse.
  const importo = x.importo || 0;
  const ext = x.extra || 0;
  return `<tr>
    <td class="cell-num">${esc(x.codpratica)}</td>
    <td class="cell-muted">${fmtData(x.dtarrivo)} <span class="periodo-sep">→</span> ${fmtData(x.dtpartenza)}</td>
    <td class="cell-num">${x.notti != null ? esc(x.notti) : '—'}</td>
    <td>${x.camere ? chipCamere(x.camere) : dash}</td>
    <td class="cell-num">${euro(importo)}</td>
    <td class="cell-num sogg-extra">${euro(ext)}</td>
    <td><span class="pill ${statoSoggPill(x.stato)}">${esc(x.stato)}</span></td>
  </tr>`;
}

// --- Scorciatoia: Prima/Ultima visita → Storico prenotazioni ---
// Le due date sono un riassunto dello storico, quindi portano allo storico:
// stessa pagina, sezione aperta se era chiusa, e un lampo breve per far vedere
// dove si è atterrati (uno scroll che finisce e basta lascia spaesati).
function vaiAlloStorico() {
  const box = $('#cli-storico-box');
  if (!box) return;
  box.open = true;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  box.classList.remove('sez-lampo');
  void box.offsetWidth; // forza il ricalcolo: così il lampo riparte anche al 2º clic
  box.classList.add('sez-lampo');
}

$('#view-cliente').addEventListener('click', (e) => {
  if (e.target.closest('[data-vai-storico]')) vaiAlloStorico();
});
// Le righe sono pulsanti (role=button): da tastiera devono rispondere come tali.
$('#view-cliente').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (!e.target.closest('[data-vai-storico]')) return;
  e.preventDefault(); // lo spazio altrimenti scrolla la pagina
  vaiAlloStorico();
});

// Liste chiuse (allineate ai CHECK del DB e alla validazione API)
const REPARTI = ['Rooms', 'F&B', 'SPA', 'Front office'];
const CATEGORIE = ['F&B', 'Camera', 'Persona', 'Occasioni', 'Generale'];
const RELAZIONI = ['Coniuge', 'Figlio-a', 'Genitore', 'Amico-a', 'Assistente', 'Altro'];
// I complaint condividono i REPARTI con le preferenze (è la dimensione con cui
// si segregano i dati), ma hanno categorie proprie: una preferenza dice cosa
// gradisce l'ospite, un reclamo cosa non ha funzionato.
const CATEGORIE_COMPLAINT = ['Pulizia', 'Manutenzione', 'Rumore', 'Servizio', 'Cibo e bevande', 'Attesa', 'Conto', 'Altro'];
function popolaSelect(sel, valori, placeholder) {
  sel.innerHTML = `<option value="" disabled selected>${placeholder}</option>` +
    valori.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

// --- Profilo 1:1 (lingua preferita + note personali) ---
// Le due sezioni stanno sulla stessa riga di DB (customer_profile), quindi una
// sola chiamata le carica entrambe.
async function caricaLingua(codCli) {
  $('#notepers-box').innerHTML = loaderHTML('Carico le note personali…');
  $('#lingua-box').innerHTML = loaderHTML('Carico la lingua…');
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/profilo`);
  linguaData = (body.profilo && body.profilo.lingua) || null;
  linguaEdit = false;
  renderLingua();
  notePersData = {
    testo: (body.profilo && body.profilo.note_personali) || null,
    autore: (body.profilo && body.profilo.note_autore) || null,
    data: (body.profilo && body.profilo.note_updated_at) || null,
  };
  notePersEdit = false;
  renderNotePersonali();
}

// --- Lingua preferita: stesse due viste delle Note personali ---
// Prima era una casella sempre aperta con "Salva" sempre acceso: non si capiva
// se il valore fosse quello salvato o quello che stavi scrivendo. Ora il valore
// salvato è testo, e per cambiarlo si passa da ✎ — come ovunque nella scheda.
let linguaEdit = false;
let linguaData = null;

function renderLingua() {
  const box = $('#lingua-box');
  if (!box) return;
  const val = (linguaData || '').trim();
  if (val && !linguaEdit) {
    // Niente riga "chi/quando": customer_profile tiene un solo updated_at per
    // tutta la riga, che può essere quello delle note. Meglio nulla che una data sbagliata.
    box.innerHTML = `
      <div class="nota-testo lingua-valore">${esc(val)}</div>
      <div class="nota-meta">
        <span></span>
        <span class="nota-az">
          <button type="button" class="btn-icon" data-edit-lingua title="Modifica">✎ Modifica</button>
          <button type="button" class="btn-icon danger" data-del-lingua title="Elimina">Elimina</button>
        </span>
      </div>`;
    return;
  }
  box.innerHTML = `
    <form id="lingua-form" class="lingua-form">
      <input id="cli-lingua" name="lingua" placeholder="Es. IT, EN, DE…" autocomplete="off" maxlength="40" value="${esc(val)}" />
      <button type="submit" class="btn btn-primary">Salva</button>
      ${val ? '<button type="button" id="btn-lingua-annulla" class="btn btn-ghost">Annulla</button>' : ''}
    </form>`;
}

async function salvaLingua(lingua) {
  if (!clienteCorrente) return;
  const btn = $('#lingua-form') && $('#lingua-form').querySelector('button[type=submit]');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/profilo`, {
    method: 'PUT', body: JSON.stringify({ lingua }),
  });
  // Ricarica dal server = conferma: si torna in vista col valore che c'è davvero.
  if (status === 200) { await caricaLingua(clienteCorrente); }
  else if (btn) { btn.disabled = false; btn.textContent = 'Salva'; }
}

// Il form viene ricostruito a ogni render: gli ascoltatori stanno sul contenitore.
$('#lingua-box').addEventListener('submit', async (e) => {
  e.preventDefault();
  await salvaLingua($('#cli-lingua').value.trim());
});

$('#lingua-box').addEventListener('click', async (e) => {
  if (e.target.closest('[data-edit-lingua]')) { linguaEdit = true; renderLingua(); $('#cli-lingua').focus(); return; }
  if (e.target.closest('#btn-lingua-annulla')) { linguaEdit = false; renderLingua(); return; }
  if (e.target.closest('[data-del-lingua]')) { await salvaLingua(''); }
});

// --- Note personali: vista (nota salvata + Modifica/Elimina, stile allergie) /
//     edit (textarea + Genera con AI + Salva + Annulla). Dopo il salvataggio si
//     torna in vista → la nota "salvata" è evidente.
let notePersEdit = false;
let notePersData = { testo: null, autore: null, data: null };
const CHIAVE_AI_NOTEPERS = 'scheda:notepers';
const NOTEPERS_AI_TIT = 'Già generato su questa anagrafica: riapri la scheda per rifarlo';

function renderNotePersonali() {
  const box = $('#notepers-box');
  if (!box) return;
  const d = notePersData;
  const haNota = d.testo && d.testo.trim();
  if (haNota && !notePersEdit) {
    const meta = [d.autore, d.data ? new Date(d.data).toLocaleString('it-IT') : null].filter(Boolean).join(' · ');
    box.innerHTML = `
      <div class="nota-testo notepers-testo">${esc(d.testo)}</div>
      <div class="nota-meta">
        <span>${esc(meta)}</span>
        <span class="nota-az">
          <button type="button" class="btn-icon" data-edit-notepers title="Modifica">✎ Modifica</button>
          <button type="button" class="btn-icon danger" data-del-notepers title="Elimina">Elimina</button>
        </span>
      </div>`;
    return;
  }
  // Se l'AI è già stata usata su questa anagrafica il pulsante resta spento anche
  // qui, dove il riquadro viene ricostruito ogni volta che si rientra in modifica.
  const aiFatto = aiGiaFatto(CHIAVE_AI_NOTEPERS);
  box.innerHTML = `
    <textarea id="cli-note-personali" class="notepers-text" rows="3" placeholder="Es. Direttore Generale LUISS; membro CdA Pirelli. Rivolgersi come 'Dottore'.">${esc(d.testo || '')}</textarea>
    <div class="notepers-bar">
      <button type="button" id="btn-notepers-ai" class="btn btn-ai"${aiFatto
    ? ` disabled title="${esc(NOTEPERS_AI_TIT)}">✨ Già generato`
    : '>✨ Genera con AI'}</button>
      <button type="button" id="btn-notepers-salva" class="btn btn-primary">Salva</button>
      ${haNota ? '<button type="button" id="btn-notepers-annulla" class="btn btn-ghost">Annulla</button>' : ''}
    </div>
    <div id="notepers-ai-msg" class="notepers-ai-msg"></div>`;
}

async function salvaNotePers(testo) {
  if (!clienteCorrente) return;
  const btn = $('#btn-notepers-salva');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/note-personali`, {
    method: 'PUT', body: JSON.stringify({ testo, mode: 'set' }),
  });
  if (status === 200) { await caricaLingua(clienteCorrente); } // ricarica dal server = conferma (torna in vista)
  else if (btn) { btn.disabled = false; btn.textContent = 'Salva'; }
}

async function generaNotePers() {
  if (!clienteCorrente || aiGiaFatto(CHIAVE_AI_NOTEPERS)) return; // già generato su questa scheda
  const btn = $('#btn-notepers-ai');
  const msg = $('#notepers-ai-msg');
  btn.disabled = true;
  msg.innerHTML = '<span class="ai-msg ai-loading"><span class="spinner"></span>Ricerca su fonti pubbliche in corso…</span>';
  // Errore o AI non configurata → riprovabile subito; una risposta valida no.
  const riabilita = () => { btn.disabled = false; };
  const fatto = () => {
    aiSegnaFatto(CHIAVE_AI_NOTEPERS);
    aiApplicaStato(btn, CHIAVE_AI_NOTEPERS, '✨ Già generato', NOTEPERS_AI_TIT);
  };
  try {
    const { status, body } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/briefing`, { method: 'POST', body: JSON.stringify({}) });
    if (status === 503) { riabilita(); msg.textContent = 'AI non configurata.'; return; }
    if (status !== 200) { riabilita(); msg.textContent = 'Errore durante la generazione.'; return; }
    // Ricerca fatta: anche "nessuna informazione" è una risposta, rifarla darebbe lo stesso esito.
    fatto();
    if (!body.pubblico) { msg.textContent = 'Nessuna informazione pubblica rilevante per questo ospite.'; return; }
    const ta = $('#cli-note-personali');
    const attuale = ta.value.trim();
    ta.value = attuale ? `${attuale}\n\n${body.testo}` : body.testo;
    const fonti = (body.fonti || []).map((f) => f.titolo || f.url).slice(0, 6);
    msg.innerHTML = `<span class="notepers-ok">✓ Generato da fonti pubbliche. Rivedi e premi Salva.</span>${fonti.length ? `<span class="notepers-fonti">Fonti: ${fonti.map(esc).join(' · ')}</span>` : ''}`;
  } catch {
    btn.disabled = false;
    msg.textContent = 'Errore di rete durante la generazione.';
  }
}

$('#notepers-box').addEventListener('click', async (e) => {
  if (e.target.closest('[data-edit-notepers]')) { notePersEdit = true; renderNotePersonali(); return; }
  if (e.target.closest('#btn-notepers-annulla')) { notePersEdit = false; renderNotePersonali(); return; }
  if (e.target.closest('[data-del-notepers]')) { await salvaNotePers(''); return; }
  if (e.target.closest('#btn-notepers-salva')) { await salvaNotePers(($('#cli-note-personali').value || '').trim()); return; }
  if (e.target.closest('#btn-notepers-ai')) { await generaNotePers(); return; }
});

// --- Preferenze (reparto + categoria + testo + ambito) ---
// L'ambito era una pastiglia sola che cambiava valore al clic: chi non lo sapeva
// già non poteva indovinarlo. Ora si vedono ENTRAMBE le scelte, con quella attiva
// accesa — si legge lo stato e si capisce che si può cambiare, senza spiegazioni.
const AMBITI_PREF = ['personale', 'nucleo'];

function interruttoreAmbito(ambito) {
  const opzioni = AMBITI_PREF.map((v) => {
    const attiva = v === ambito;
    const tit = attiva
      ? `Questa preferenza è ${v === 'nucleo' ? 'condivisa con il nucleo' : 'solo di questo cliente'}`
      : `Rendila ${v === 'nucleo' ? 'del nucleo (visibile a chi viaggia con lui)' : 'personale (solo questo cliente)'}`;
    return `<button type="button" class="scope-opt${attiva ? ` scope-on scope-on-${v}` : ''}"`
      + ` data-set-ambito="${v}" aria-pressed="${attiva}" title="${esc(tit)}">${v}</button>`;
  }).join('');
  return `<span class="scope-seg" role="group" aria-label="Ambito della preferenza">${opzioni}</span>`;
}

async function caricaPreferenze(codCli) {
  $('#cli-preferenze').innerHTML = loaderRiga('Carico le preferenze…');
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/preferenze`);
  const pref = body.preferenze || [];
  const cond = body.condivise || [];
  // Tag in cima e testo sotto: reparto, categoria e ambito sono tutti "che tipo
  // di preferenza è", quindi stanno insieme invece di pendere in fondo alla frase.
  const proprie = pref.map((p) => `
    <li data-pref="${p.id}">
      <div class="pref-head">
        <span class="pref-tag">${esc(p.reparto)} · ${esc(p.categoria)}</span>
        ${interruttoreAmbito(p.ambito || 'nucleo')}
      </div>
      <div class="nota-testo">${esc(p.testo)}</div>
      <div class="nota-meta">
        <span>${esc(p.autore || '?')} · ${new Date(p.created_at).toLocaleString('it-IT')}</span>
        <span class="nota-az"><button class="btn-icon danger" data-del-pref="${p.id}">Elimina</button></span>
      </div>
    </li>`).join('') || '<li class="nota-vuota">Nessuna preferenza registrata.</li>';
  // Preferenze 'nucleo' di altri membri del nucleo: sola lettura (si cambiano
  // sulla scheda di chi le possiede), quindi pastiglia ferma, non interruttore.
  const condivise = cond.length ? `<li class="pref-cond-head">👪 Condivise dal nucleo <span class="cell-muted">(sola lettura)</span>`
    + `<span class="info info-wide" data-tip="Preferenze di nucleo create sulla scheda di un altro cliente: qui si leggono soltanto. Per cambiarne l'ambito, correggerle o toglierle, apri la sua anagrafica dal nome cliccabile sotto la preferenza — è lì che la preferenza vive.">i</span></li>` + cond.map((p) => `
    <li class="pref-condivisa">
      <div class="pref-head">
        <span class="pref-tag">${esc(p.reparto)} · ${esc(p.categoria)}</span>
        <span class="badge-scope scope-nucleo" title="Preferenza del nucleo: arriva dalla scheda di un altro membro">nucleo</span>
      </div>
      <div class="nota-testo">${esc(p.testo)}</div>
      <div class="nota-meta"><span>👪 dal nucleo · ${linkCliente(p.pms_customer_id, p.proprietario || '?', { titolo: 'Apri la scheda di chi possiede questa preferenza' })}</span></div>
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
  const opt = e.target.closest('[data-set-ambito]');
  if (opt) {
    const li = opt.closest('[data-pref]');
    // Clic sulla voce già attiva: non è un cambio, non si chiama il server.
    if (!li || opt.classList.contains('scope-on')) return;
    await api(`/api/preferenze/${li.dataset.pref}`, { method: 'PATCH', body: JSON.stringify({ ambito: opt.dataset.setAmbito }) });
    caricaPreferenze(clienteCorrente);
  }
});

// --- Suggerimenti AI (Fase 3 C): proposte on-demand, l'operatore conferma ---
let suggerimentiCorrenti = [];
let suggerimentiMostrati = []; // testi già proposti in questa sessione (dedup lato AI)
const CHIAVE_AI_SUGG = 'scheda:suggerimenti';
const AI_BTN_LABEL = '✨ Suggerisci preferenze (AI)';
const SUGG_FATTO_TIT = 'Riapri la scheda per rigenerare i suggerimenti';

// Questo pulsante è un nodo fisso della pagina (non lo ricostruisce nessun
// render): all'apertura di una scheda va riportato a mano allo stato iniziale.
function resetAiButton() {
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
  if (!clienteCorrente || aiGiaFatto(CHIAVE_AI_SUGG)) return; // già eseguito su questa scheda → no doppie chiamate
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
    // eseguito → resta disabilitato per tutta la permanenza sulla scheda
    aiSegnaFatto(CHIAVE_AI_SUGG);
    aiApplicaStato(btn, CHIAVE_AI_SUGG, '✨ Già suggerito su questa scheda', SUGG_FATTO_TIT);
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
// server → conferma del salvataggio). Come i membri siano stati aggiunti (a mano
// o dalle prenotazioni) non cambia nulla per chi li legge: nessun badge in riga,
// la spiegazione sta nella (i) della sezione.
let nucleoEditId = null;
async function caricaNucleo(codCli) {
  $('#cli-nucleo').innerHTML = loaderRiga('Carico il nucleo di viaggio…');
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/nucleo`);
  const membri = body.nucleo || [];
  $('#cli-nucleo').innerHTML = membri.map((m) => {
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
        ${linkCliente(m.pms_occupant_id, nomeCompl, { classe: 'nucleo-nome' })}
        ${m.nota ? `<span class="cell-muted">— ${esc(m.nota)}</span>` : ''}
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
  el.innerHTML = `<div class="nota-vuota">${loaderHTML('Carico i consumi F&B…')}</div>`;
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
  el.innerHTML = `<div class="nota-vuota">${loaderHTML('Carico i trattamenti SPA…')}</div>`;
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
    // L'anagrafica che si sta già guardando non è un link: è dove sei.
    const nome = x.codCli === codCli
      ? `<b>${esc(x.nominativo || `#${x.codCli}`)}</b>`
      : linkCliente(x.codCli, x.nominativo);
    const scollega = isPrinc ? '' : ` <button class="btn-icon danger" data-unmerge="${x.codCli}" title="Scollega dal gruppo">×</button>`;
    return `<span class="merge-chip">${nome} <span class="cell-muted">#${x.codCli}${isPrinc ? ' · principale' : ''}</span>${scollega}</span>`;
  }).join(' ');
  el.hidden = false;
  el.innerHTML = `<span class="merge-ico">⛓</span><div><b>Scheda fusa</b> — dati aggregati su ${merge.membri.length} anagrafiche.<div class="merge-chips">${rows}</div></div>`;
}

async function caricaDuplicati(codCli) {
  const el = $('#cli-duplicati');
  el.hidden = false;
  el.innerHTML = loaderHTML('Cerco possibili duplicati…');
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/duplicati`);
  duplicatiCorrenti = (body && body.candidati) || [];
  if (!duplicatiCorrenti.length) { el.hidden = true; el.innerHTML = ''; return; }
  const righe = duplicatiCorrenti.map((c) => `<li class="dup-item">
      <span class="dup-match ${c.match === 'CF' ? 'm-cf' : 'm-an'}">${c.match === 'CF' ? 'stesso CF' : 'stesso nome+nascita'}</span>
      ${linkCliente(c.codCli, c.nominativo, { classe: 'dup-nome' })}
      <span class="cell-muted">#${c.codCli}${c.dtNascita ? ' · ' + fmtData(c.dtNascita) : ''} · ${c.nPrenotazioni} pren.</span>
      <button type="button" class="btn btn-sm" data-merge="${c.codCli}">Confronta e unisci…</button>
    </li>`).join('');
  el.hidden = false;
  el.innerHTML = `<div class="dup-head">⚠️ Possibili duplicati di questo ospite <span class="info" data-tip="Anagrafiche che sembrano la stessa persona (stesso codice fiscale, o stesso cognome+nome+data di nascita). Unendole, la scheda aggrega soggiorni, consumi e note. Reversibile.">i</span></div><ul class="dup-list">${righe}</ul>`;
}

// "Confronta e unisci…" dal box scheda: apre la schermata di confronto (niente merge immediato).
$('#cli-duplicati').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-merge]');
  if (!btn || !clienteCorrente) return;
  const cand = Number(btn.dataset.merge);
  mergeCoda = null;
  mergeOnDone = () => loadCliente(clienteCorrente);
  apriConfronto([clienteCorrente, cand]);
});

// ===== Merge guidato: schermata di confronto (modale) =====
let mergeData = null;        // { anagrafiche, conflitti, suggerito }
let mergePrincipale = null;  // codCli scelto come principale
let mergeOnDone = null;      // callback dopo conferma (modalità singola)
let mergeCoda = null;        // { gruppi:[[ids]...], idx } per la coda di revisione

const CAMPI_MERGE = [
  ['nominativo', 'Nominativo', null],
  ['dtNascita', 'Data di nascita', fmtData],
  ['codiceFiscale', 'Codice fiscale', null],
  ['citta', 'Città', null],
  ['email', 'Email', null],
  ['telefono', 'Telefono', null],
  ['cellulare', 'Cellulare', null],
  ['vip', 'VIP', (v) => (v && v.descrizione ? v.descrizione : '')],
  ['nPrenotazioni', 'N. prenotazioni', null],
];
const LABEL_CAMPO = { codiceFiscale: 'codice fiscale', email: 'email', telefono: 'telefono', cellulare: 'cellulare', citta: 'città', dtNascita: 'data di nascita' };

async function apriConfronto(ids) {
  const first = ids[0];
  // La modale si apre subito con lo spinner: il confronto interroga il PMS su
  // più anagrafiche e senza questo il clic sembrerebbe non aver fatto nulla.
  $('#merge-dialog-body').innerHTML = `<div class="merge-body"><div class="modal-title">Confronto</div><p>${loaderHTML('Carico le anagrafiche da confrontare…')}</p></div>`;
  if (!$('#merge-dialog').open) $('#merge-dialog').showModal();
  const { status, body } = await api(`/api/clienti/${encodeURIComponent(first)}/confronto?ids=${encodeURIComponent(ids.join(','))}`);
  if (status !== 200) { $('#merge-dialog-body').innerHTML = `<div class="merge-body"><div class="modal-title">Confronto</div><p class="error">Impossibile aprire il confronto.</p><div class="modal-actions"><button type="button" class="btn btn-ghost" id="merge-annulla">Chiudi</button></div></div>`; if (!$('#merge-dialog').open) $('#merge-dialog').showModal(); return; }
  mergeData = body;
  mergePrincipale = body.suggerito;
  renderMerge();
  if (!$('#merge-dialog').open) $('#merge-dialog').showModal();
}

function renderMerge() {
  const d = mergeData;
  const princ = mergePrincipale;
  const conflSet = new Set((d.conflitti || []).map((c) => c.campo));
  const cell = (v, fmt) => { const x = fmt ? fmt(v) : v; return (x == null || x === '') ? '<span class="dash">—</span>' : esc(String(x)); };
  // Il codice in intestazione apre l'anagrafica in una NUOVA scheda: si può
  // controllare un profilo senza perdere il confronto in corso.
  const head = d.anagrafiche.map((a) => `<th class="${a.codCli === princ ? 'merge-princ-col' : ''}">
      <label class="merge-princ"><input type="radio" name="princ" value="${a.codCli}" ${a.codCli === princ ? 'checked' : ''}/> ${linkCliente(a.codCli, `#${a.codCli}`, { nuovaScheda: true, titolo: `Apri l'anagrafica #${a.codCli} in una nuova scheda` })}</label>
      ${a.codCli === princ ? '<span class="merge-badge">principale</span>' : ''}</th>`).join('');
  const rows = CAMPI_MERGE.map(([k, label, fmt]) => {
    const conf = conflSet.has(k);
    const tds = d.anagrafiche.map((a) => {
      // Anche il nominativo apre la scheda, in una nuova scheda del browser.
      const val = k === 'nominativo' && a.nominativo
        ? linkCliente(a.codCli, a.nominativo, { nuovaScheda: true, titolo: `Apri l'anagrafica di ${a.nominativo} in una nuova scheda` })
        : cell(a[k], fmt);
      return `<td class="${a.codCli === princ ? 'merge-princ-col' : ''}${conf ? ' merge-conf-cell' : ''}">${val}</td>`;
    }).join('');
    return `<tr><td class="merge-lbl">${esc(label)}${conf ? ' <span class="merge-warn" title="Dati diversi tra le anagrafiche">⚠</span>' : ''}</td>${tds}</tr>`;
  }).join('');
  const avviso = conflSet.size
    ? `<div class="merge-avviso">⚠ Dati in conflitto (${[...conflSet].map((c) => LABEL_CAMPO[c] || c).join(', ')}): assicurati che sia la stessa persona e scegli il principale prima di confermare.</div>`
    : '';
  const codaInfo = mergeCoda ? `<span class="merge-coda">Gruppo ${mergeCoda.idx + 1} di ${mergeCoda.gruppi.length}</span>` : '';
  const azioni = mergeCoda
    ? '<button type="button" class="btn btn-ghost" id="merge-annulla">Annulla tutto</button><button type="button" class="btn" id="merge-salta">Salta</button><button type="button" class="btn btn-primary" id="merge-conferma">Conferma unione</button>'
    : '<button type="button" class="btn btn-ghost" id="merge-annulla">Annulla</button><button type="button" class="btn btn-primary" id="merge-conferma">Conferma unione</button>';
  $('#merge-dialog-body').innerHTML = `<div class="merge-body">
    <div class="merge-head"><span class="modal-title">Confronta e unisci anagrafiche</span>${codaInfo}</div>
    <p class="merge-sub">Scegli l'anagrafica <b>principale</b>; le altre verranno collegate. Verranno aggregati soggiorni, consumi F&amp;B/SPA, preferenze, intolleranze, reclami e note. Operazione <b>reversibile</b>.</p>
    ${avviso}
    <div class="merge-tab-wrap"><table class="merge-tab"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="modal-actions">${azioni}</div>
  </div>`;
}

async function confermaMerge() {
  // Una POST per ogni membro da collegare: con più anagrafiche l'attesa si sente.
  const btn = $('#merge-conferma');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>Unione in corso…`; }
  const membri = mergeData.anagrafiche.map((a) => a.codCli).filter((id) => id !== mergePrincipale);
  for (const m of membri) {
    await api(`/api/clienti/${encodeURIComponent(mergePrincipale)}/merge`, {
      method: 'POST', body: JSON.stringify({ memberId: m, canonicalId: mergePrincipale }),
    });
  }
  avanzaMerge(true);
}

function avanzaMerge(fatto) {
  if (mergeCoda) {
    mergeCoda.idx += 1;
    if (mergeCoda.idx < mergeCoda.gruppi.length) { apriConfronto(mergeCoda.gruppi[mergeCoda.idx]); return; }
    mergeCoda = null; $('#merge-dialog').close(); loadDuplicatiPage(); return;
  }
  $('#merge-dialog').close();
  if (fatto && mergeOnDone) mergeOnDone();
}

$('#merge-dialog-body').addEventListener('change', (e) => {
  const r = e.target.closest('input[name="princ"]');
  if (r) { mergePrincipale = Number(r.value); renderMerge(); }
});
$('#merge-dialog-body').addEventListener('click', (e) => {
  if (e.target.closest('#merge-conferma')) { confermaMerge(); return; }
  if (e.target.closest('#merge-salta')) { avanzaMerge(false); return; }
  if (e.target.closest('#merge-annulla')) {
    const inCoda = !!mergeCoda; mergeCoda = null; $('#merge-dialog').close();
    if (inCoda) loadDuplicatiPage();
  }
});

$('#cli-merge-banner').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-unmerge]');
  if (!btn || !clienteCorrente) return;
  await api(`/api/merge/${encodeURIComponent(btn.dataset.unmerge)}`, { method: 'DELETE' });
  loadCliente(clienteCorrente);
});

// --- Pagina "Gestione duplicati" ---
let duplicatiGruppi = [];   // solo quelli su cui manca una decisione
let duplicatiGestiti = 0;   // già associati: fuori dalla coda, gestiti dalla scheda ospite
async function loadDuplicatiPage() {
  const msg = $('#duplicati-msg'); const wrap = $('#duplicati-wrap');
  mostraLoader(msg, 'Cerco i possibili duplicati…'); wrap.hidden = true;
  const { status, body } = await api('/api/duplicati');
  if (status !== 200) { msg.textContent = 'Errore nel caricamento dei duplicati.'; return; }
  duplicatiGruppi = body.gruppi || [];
  duplicatiGestiti = body.gestiti || 0;
  renderDuplicatiPage();
}
const senzaAccenti = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function renderDuplicatiPage() {
  const sel = document.querySelector('input[name="dupf"]:checked');
  const f = sel ? sel.value : 'tutti';
  const q = senzaAccenti(($('#dup-search') && $('#dup-search').value) || '').trim();
  const lista = duplicatiGruppi.filter((g) => (f === 'tutti' || g.tipo === f)
    && (!q || senzaAccenti(g.nominativo).includes(q) || g.membri.some((id) => String(id).includes(q))));
  $('#dup-count').textContent = `${lista.length} ${lista.length === 1 ? 'gruppo da gestire' : 'gruppi da gestire'}`;
  // I gruppi già associati non spariscono nel nulla: se ne dichiara il numero,
  // così è chiaro che la coda si è accorciata perché il lavoro è stato fatto.
  const gest = $('#dup-gestiti');
  if (gest) {
    gest.hidden = !duplicatiGestiti;
    gest.textContent = duplicatiGestiti
      ? `· ${duplicatiGestiti} ${duplicatiGestiti === 1 ? 'gruppo già associato' : 'gruppi già associati'}, dalle schede ospite`
      : '';
  }
  const msg = $('#duplicati-msg'); const wrap = $('#duplicati-wrap');
  if (!lista.length) {
    msg.hidden = false;
    msg.textContent = duplicatiGruppi.length
      ? 'Nessun risultato per il filtro.'
      : 'Nessun duplicato da gestire: tutti i gruppi rilevati sono già stati associati.';
    wrap.hidden = true;
    return;
  }
  msg.hidden = true; wrap.hidden = false;
  $('#duplicati-tbody').innerHTML = lista.map((g) => {
    const codici = g.membri.map((id) => linkCliente(id, `#${id}`)).join(', ');
    const crit = g.tipo === 'CF' ? 'stesso CF' : 'stesso nome+nascita';
    const fusi = g.fusiCount ? ` <span class="cell-muted">(${g.fusiCount} già fusi)</span>` : '';
    const membriAttr = g.membri.join(',');
    // La riga è un GRUPPO, non una persona: il nome apre la prima anagrafica
    // (da lì il box "Possibili duplicati" porta alle altre), i codici aprono
    // ciascuno la propria.
    const nomeGruppo = linkCliente(g.membri[0], g.nominativo || '—', {
      titolo: `Apri l'anagrafica #${g.membri[0]} — il gruppo ne contiene ${g.n}`,
    });
    return `<tr>
      <td class="dup-check"><input type="checkbox" class="dup-row" data-membri="${membriAttr}" /></td>
      <td>${nomeGruppo}</td>
      <td><span class="dup-match ${g.tipo === 'CF' ? 'm-cf' : 'm-an'}">${crit}</span></td>
      <td>${codici}${fusi}</td>
      <td class="num">${g.n}</td>
      <td><button type="button" class="btn btn-sm" data-confronta="${membriAttr}">Confronta e unisci…</button></td>
    </tr>`;
  }).join('');
  const selall = $('#dup-selall'); if (selall) { selall.checked = false; selall.indeterminate = false; }
  aggiornaDupSelezione();
}
document.querySelectorAll('input[name="dupf"]').forEach((r) => r.addEventListener('change', renderDuplicatiPage));
$('#dup-search').addEventListener('input', renderDuplicatiPage);

// Multi-selezione + coda di revisione nella pagina Duplicati.
function idsSelezionati() {
  return [...document.querySelectorAll('.dup-row:checked')].map((c) => c.dataset.membri.split(',').map(Number).filter(Number.isInteger));
}
function aggiornaDupSelezione() {
  const n = document.querySelectorAll('.dup-row:checked').length;
  const tot = document.querySelectorAll('.dup-row').length;
  $('#dup-actions').hidden = n === 0;
  $('#dup-sel-count').textContent = `${n} ${n === 1 ? 'gruppo selezionato' : 'gruppi selezionati'}`;
  const selall = $('#dup-selall'); if (selall) { selall.checked = n > 0 && n === tot; selall.indeterminate = n > 0 && n < tot; }
}
$('#dup-selall').addEventListener('change', (e) => {
  document.querySelectorAll('.dup-row').forEach((c) => { c.checked = e.target.checked; });
  aggiornaDupSelezione();
});
$('#duplicati-tbody').addEventListener('change', (e) => { if (e.target.closest('.dup-row')) aggiornaDupSelezione(); });
$('#duplicati-tbody').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-confronta]');
  if (!btn) return;
  const ids = btn.dataset.confronta.split(',').map(Number).filter(Number.isInteger);
  mergeCoda = null;
  mergeOnDone = () => loadDuplicatiPage();
  apriConfronto(ids);
});
$('#dup-rivedi').addEventListener('click', () => {
  const gruppi = idsSelezionati();
  if (!gruppi.length) return;
  mergeOnDone = null;
  mergeCoda = { gruppi, idx: 0 };
  apriConfronto(gruppi[0]);
});

// --- Intolleranze / allergie (dato di sicurezza) ---
async function caricaIntolleranze(codCli) {
  $('#cli-intolleranze').innerHTML = loaderRiga('Carico intolleranze e allergie…');
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
  $('#cli-complaints').innerHTML = loaderRiga('Carico i complaints…');
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/complaints`);
  const compl = body.complaints || [];
  $('#cli-complaints').innerHTML = compl.map((c) => {
    const risolto = c.stato === 'risolto';
    // Il follow-up si mostra sempre se c'è: su un complaint riaperto racconta
    // cosa era già stato tentato. I reclami chiusi prima di questa funzione non
    // ce l'hanno — è normale, non è un dato mancante da recuperare.
    const followUp = c.follow_up
      ? `<div class="compl-fu"><span class="compl-fu-lbl">Follow-up</span><span class="compl-fu-testo">${esc(c.follow_up)}</span></div>`
      : '';
    // Reparto e categoria in testa alla riga, come sulle preferenze. Chi non li
    // ha (inserito prima che esistessero) mostra un tag da riempire, cliccabile.
    const classe = c.reparto || c.categoria
      ? `<button type="button" class="pref-tag tag-classe" data-classe-compl="${c.id}" title="Cambia reparto e categoria">${esc([c.reparto, c.categoria].filter(Boolean).join(' · '))}</button>`
      : `<button type="button" class="pref-tag tag-classe tag-vuoto" data-classe-compl="${c.id}" title="Assegna reparto e categoria">da classificare</button>`;
    return `
    <li data-compl="${c.id}" data-periodo="${esc(c.periodo || '')}" data-followup="${esc(c.follow_up || '')}"
        data-reparto="${esc(c.reparto || '')}" data-categoria="${esc(c.categoria || '')}" class="${risolto ? 'compl-risolto' : ''}">
      <div class="compl-tags">
        <span class="pill ${risolto ? 'pill-risolto' : 'pill-aperto'}">${risolto ? 'Risolto' : 'Aperto'}</span>
        ${classe}
        ${c.periodo ? `<span class="pref-tag">${esc(c.periodo)}</span>` : ''}
      </div>
      <div class="compl-top">
        <span class="compl-testo nota-testo">${esc(c.testo)}</span>
      </div>
      ${followUp}
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
  const reparto = f.reparto.value, categoria = f.categoria.value;
  if (!testo || !reparto || !categoria || !clienteCorrente) return;
  const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/complaints`, {
    method: 'POST', body: JSON.stringify({ testo, periodo, reparto, categoria }),
  });
  if (status === 201) {
    f.reset();
    // reset() svuota anche le select: vanno riportate al placeholder
    popolaSelect(f.reparto, REPARTI, 'Reparto');
    popolaSelect(f.categoria, CATEGORIE_COMPLAINT, 'Categoria');
    caricaComplaints(clienteCorrente);
  }
});

// --- Classificazione di un complaint (reparto + categoria) ---
let classeId = null;

function apriClasse(id, testoCompl, reparto, categoria) {
  classeId = id;
  $('#classe-quale').textContent = testoCompl || '';
  popolaSelect($('#classe-reparto'), REPARTI, 'Reparto');
  popolaSelect($('#classe-categoria'), CATEGORIE_COMPLAINT, 'Categoria');
  if (reparto) $('#classe-reparto').value = reparto;
  if (categoria) $('#classe-categoria').value = categoria;
  $('#classe-msg').textContent = '';
  $('#classe-dialog').showModal();
}

$('#classe-annulla').addEventListener('click', () => { classeId = null; $('#classe-dialog').close(); });

$('#classe-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reparto = $('#classe-reparto').value, categoria = $('#classe-categoria').value;
  if (!reparto || !categoria || !classeId) return;
  const btn = $('#classe-conferma');
  btn.disabled = true; btn.textContent = 'Salvataggio…';
  const { status, body } = await api(`/api/complaints/${classeId}`, {
    method: 'PATCH', body: JSON.stringify({ reparto, categoria }),
  });
  btn.disabled = false; btn.textContent = 'Salva';
  if (status !== 200) { $('#classe-msg').textContent = (body && body.error) || 'Errore nel salvataggio.'; return; }
  classeId = null;
  $('#classe-dialog').close();
  caricaComplaints(clienteCorrente);
});

$('#cli-complaints').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del-compl]');
  const edit = e.target.closest('[data-edit-compl]');
  const toggle = e.target.closest('[data-toggle-compl]');
  const classe = e.target.closest('[data-classe-compl]');
  if (classe) {
    const li = classe.closest('[data-compl]');
    apriClasse(classe.dataset.classeCompl, li.querySelector('.compl-testo').textContent, li.dataset.reparto, li.dataset.categoria);
    return;
  }
  if (del) {
    await api(`/api/complaints/${del.dataset.delCompl}`, { method: 'DELETE' });
    caricaComplaints(clienteCorrente);
  } else if (toggle) {
    const li = toggle.closest('[data-compl]');
    // Risolvere passa dalla maschera del follow-up; riaprire no: lì non c'è
    // niente da raccontare, e il follow-up già scritto resta dov'è.
    if (toggle.dataset.stato === 'risolto') {
      await api(`/api/complaints/${toggle.dataset.toggleCompl}`, { method: 'PATCH', body: JSON.stringify({ stato: 'aperto' }) });
      caricaComplaints(clienteCorrente);
      return;
    }
    apriFollowUp(toggle.dataset.toggleCompl, li.querySelector('.compl-testo').textContent, li.dataset.followup || '');
  } else if (edit) {
    const li = edit.closest('[data-compl]');
    const nuovo = prompt('Modifica complaint:', li.querySelector('.compl-testo').textContent);
    if (nuovo == null || !nuovo.trim()) return;
    const nuovoPeriodo = prompt('Periodo (es. ago 2025), lascia vuoto per nessuno:', li.dataset.periodo || '');
    if (nuovoPeriodo == null) return;
    const patch = { testo: nuovo.trim(), periodo: nuovoPeriodo.trim() };
    // Il follow-up si corregge solo se c'è già: su un complaint ancora aperto
    // non lo si chiede qui, lo si scrive risolvendo.
    if (li.dataset.followup) {
      const nuovoFu = prompt('Follow-up (cosa è stato fatto):', li.dataset.followup);
      if (nuovoFu == null) return;
      if (nuovoFu.trim()) patch.followUp = nuovoFu.trim();
    }
    await api(`/api/complaints/${edit.dataset.editCompl}`, { method: 'PATCH', body: JSON.stringify(patch) });
    caricaComplaints(clienteCorrente);
  }
});

// --- Risoluzione guidata: stato + follow-up in un colpo solo ---
// Il complaint diventa "Risolto" solo se la PATCH va a buon fine, quindi non
// esiste il caso "risolto ma senza follow-up" (la regola è anche lato server).
let followUpId = null;

function apriFollowUp(id, testoCompl, precedente) {
  followUpId = id;
  $('#followup-quale').textContent = testoCompl || '';
  const ta = $('#followup-testo');
  // Se il reclamo era già stato risolto e poi riaperto, si riparte da quel testo.
  ta.value = precedente || '';
  $('#followup-msg').textContent = '';
  aggiornaFollowUpBtn();
  $('#followup-dialog').showModal();
  ta.focus();
}

function aggiornaFollowUpBtn() {
  $('#followup-conferma').disabled = !$('#followup-testo').value.trim();
}

$('#followup-testo').addEventListener('input', aggiornaFollowUpBtn);
$('#followup-annulla').addEventListener('click', () => { followUpId = null; $('#followup-dialog').close(); });

$('#followup-form').addEventListener('submit', async (e) => {
  e.preventDefault(); // la chiusura la decide l'esito della chiamata, non il form
  const testo = $('#followup-testo').value.trim();
  if (!testo || !followUpId) return;
  const btn = $('#followup-conferma');
  btn.disabled = true; btn.textContent = 'Salvataggio…';
  const { status, body } = await api(`/api/complaints/${followUpId}`, {
    method: 'PATCH', body: JSON.stringify({ stato: 'risolto', followUp: testo }),
  });
  btn.textContent = 'Conferma e risolvi';
  if (status !== 200) {
    $('#followup-msg').textContent = (body && body.error) || 'Errore nel salvataggio.';
    btn.disabled = false;
    return;
  }
  followUpId = null;
  $('#followup-dialog').close();
  caricaComplaints(clienteCorrente);
});

refresh();
