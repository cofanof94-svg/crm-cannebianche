const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, { cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  // 403 = permesso mancante. L'interfaccia nasconde già i comandi che l'utente non
  // può usare, quindi se un 403 arriva qui vuol dire che qualcosa è sfuggito: si
  // dice a schermo il motivo, invece di lasciare un pulsante che non fa niente.
  if (res.status === 403 && body && body.error) avviso(body.error);
  return { status: res.status, body };
}

// --- Avviso in sovrimpressione ---------------------------------------------
// Sparisce da solo. Serve per le cose che non appartengono a nessun riquadro in
// particolare, tipo un permesso negato mentre si sta lavorando su una scheda.
let avvisoTimer = null;
function avviso(testo) {
  let el = $('#avviso');
  if (!el) {
    el = document.createElement('div');
    el.id = 'avviso';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = testo;
  el.classList.add('visibile');
  clearTimeout(avvisoTimer);
  avvisoTimer = setTimeout(() => el.classList.remove('visibile'), 6000);
}

// --- Permessi dell'utente collegato -----------------------------------------
// L'interfaccia non ragiona mai per ruolo ("è admin?") ma per permesso ("può
// scrivere?"): il giorno che i ruoli cambiano, o che ne arriva uno di reparto,
// qui non si tocca niente. La lista arriva già risolta da /api/me.
function puo(permesso) {
  return !!(currentUser && Array.isArray(currentUser.permessi) && currentUser.permessi.includes(permesso));
}

// Il server non manda l'elenco dei permessi? Non è un ruolo senza diritti: è una
// versione del server più vecchia di questi file. Succede se si copiano i file e
// non si riavvia node, e senza un avviso sembrerebbe che l'applicazione abbia
// perso metà delle funzioni — a tutti insieme, il giorno del rilascio.
// Si resta prudenti (nessun permesso), ma si dice cos'è davvero.
const permessiIgnoti = () => !currentUser || !Array.isArray(currentUser.permessi);

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
  $('#nav-utenti').hidden = !puo('gestisci-utenti');
  $('#nav-analytics').hidden = !puo('vedi-analytics');
  // Un attributo sul body e i comandi che scrivono spariscono via CSS, anche da
  // quello che verrà disegnato dopo: nessun render deve ricordarsi di chiedere.
  document.body.classList.toggle('sola-lettura', !puo('scrivi'));
  const badge = $('#ruolo-badge');
  badge.hidden = puo('scrivi');
  badge.classList.toggle('ruolo-badge-guasto', permessiIgnoti());
  if (permessiIgnoti()) {
    badge.textContent = 'Server da riavviare';
    badge.title = "L'applicazione è più recente del server: i permessi non arrivano, quindi per prudenza è tutto in sola lettura.";
    avviso('Il server è più vecchio dei file dell\'applicazione: riavvialo per rientrare in possesso delle funzioni. Fino ad allora si può solo consultare.');
  } else {
    badge.textContent = 'Sola lettura';
    badge.title = 'Il tuo profilo consente di consultare, non di modificare.';
  }
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
  // Ogni sezione si apre dall'inizio. Da quando la barra laterale resta
  // ancorata si può cambiare pagina restando a metà di una lista lunga: senza
  // questo, la sezione nuova si aprirebbe già scrollata, in un punto qualunque.
  if (hash !== cameFrom) window.scrollTo(0, 0);
  // Scheda ospite: #cliente/<CodCli>
  if (hash.startsWith('cliente/')) {
    // Senza un codice valido la scheda restava ferma su "Carico…" per sempre: la
    // richiesta finiva sulla rotta di ricerca, che risponde 200 con un elenco
    // vuoto, e il render andava in errore su un'anagrafica che non c'era.
    const cod = Number(hash.split('/')[1]);
    if (!Number.isInteger(cod) || cod <= 0) {
      avviso('Scheda ospite non valida.');
      location.hash = `#${vistaPrecedente || 'arrivi'}`;
      return;
    }
    $('#topbar-title').textContent = 'Scheda ospite';
    document.querySelectorAll('.view').forEach((el) => { el.hidden = true; });
    document.querySelectorAll('.sidebar a').forEach((a) => a.classList.remove('active'));
    const backLabel = { arrivi: 'Torna agli arrivi', incasa: 'Torna ai clienti in casa', ricerca: 'Torna alla ricerca', utenti: 'Torna agli utenti', home: 'Torna alla home' };
    const dest = backLabel[vistaPrecedente] ? vistaPrecedente : 'arrivi';
    const back = $('#cli-back');
    back.setAttribute('href', `#${dest}`);
    back.textContent = `‹ ${backLabel[dest]}`;
    $('#view-cliente').hidden = false;
    loadCliente(cod);
    return;
  }
  // Le altre viste accettano un parametro dopo la barra: oggi solo
  // #incasa/<chip>, per aprire "In casa" con un filtro già attivo.
  const [view, param] = hash.split('/');
  const known = ['home', 'arrivi', 'incasa', 'ricerca', 'duplicati', 'analytics', 'utenti'];
  let v = known.includes(view) ? view : 'home';
  // Sezioni riservate: chi non ha il permesso viene rimandato alla home, anche
  // arrivandoci da URL diretto. Il backend rifiuta comunque le chiamate, questo
  // serve a non mostrare una pagina vuota e piena di errori.
  const permessoDellaVista = { utenti: 'gestisci-utenti', analytics: 'vedi-analytics' };
  if (permessoDellaVista[v] && !puo(permessoDellaVista[v])) {
    avviso('Sezione riservata: il tuo profilo non vi ha accesso.');
    location.hash = '#home';
    return;
  }
  const titoli = { home: 'Home', arrivi: 'Arrivi', incasa: 'In casa', ricerca: 'Ricerca', duplicati: 'Duplicati', analytics: 'Analytics', utenti: 'Utenti' };
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
  // analytics.js è caricato dopo app.js: alla primissima route può non esserci
  // ancora, e ci pensa lui a richiamarsi (stessa forma dell'aggancio di export.js).
  else if (v === 'analytics') { if (typeof initAnalytics === 'function') initAnalytics(); }
  else if (v === 'utenti') loadUsers();
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
      const prop = e.target.closest('[data-add-prop], [data-ign-prop]');
      if (prop) { gestisciProposta(prop, renderArrivi); return; }
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
    if (status === 503) { riabilita(); box.innerHTML = briefMsg(motivoAiNonDisponibile(body)); return; }
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

// Il 503 dell'AI non ha una causa sola: chiave assente, credito esaurito, servizio
// giù. Il server sa quale ed è l'unico a saperlo, quindi si mostra il suo messaggio.
// La frase fissa resta solo per le versioni del server che non lo mandano.
function motivoAiNonDisponibile(body) {
  const m = body && body.error ? String(body.error).trim() : '';
  return m || 'AI non configurata: manca la chiave ANTHROPIC_API_KEY o l\'SDK.';
}

// Un salvataggio che fallisce deve dirlo. Questi form non avevano ramo `else`: se
// la chiamata non andava a buon fine non succedeva NIENTE — campo pieno, nessun
// messaggio, nessuna riga nuova. Sulle intolleranze significa credere di aver
// registrato un'allergia che non c'è, ed è il motivo per cui questa funzione esiste.
// Il testo resta nel campo apposta: si riprova senza riscrivere tutto.
function erroreSalvataggio(status, body, cosa) {
  if (status === 403) return; // il perché lo ha già detto api()
  const dett = body && body.error ? ` ${String(body.error)}` : '';
  avviso(`Non è stato possibile salvare ${cosa}.${dett} Il testo è rimasto nel campo: puoi riprovare.`);
}

function briefMsg(t) { return `<div class="brief-card"><div class="ai-msg">${esc(t)}</div></div>`; }

// Da dove viene il dato: un ruolo letto su Treccani e uno letto su LinkedIn non
// hanno lo stesso peso, e chi legge deve saperlo a colpo d'occhio.
const ESITI_BRIEF = {
  pubblica: { txt: 'Personaggio pubblico', cls: 'brief-esito-pub', tit: 'Riconosciuto su fonti pubbliche autorevoli' },
  professionale: { txt: 'Profilo professionale', cls: 'brief-esito-pro', tit: 'Nessun rilievo pubblico: ruolo e azienda da profilo professionale (es. LinkedIn), con identità confermata da un secondo riscontro' },
  incerta: { txt: 'Identità da confermare', cls: 'brief-esito-inc', tit: 'Profilo plausibile ma non confermato (omonimia possibile): verificare prima di usarlo' },
};

function renderBriefResult(b, cli) {
  const fonti = (b.fonti || [])
    .map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.titolo || f.url)}</a></li>`)
    .join('');
  const nFonti = (b.fonti || []).length;
  // "Fonti" solo se il briefing poggia davvero su quei link. Quando l'AI risponde
  // da quello che già sa, restano i risultati della ricerca: utili per verificare,
  // ma chiamarli fonti sarebbe una garanzia che nessuno ha dato.
  const etichettaFonti = b.fontiCitate
    ? `Fonti (${nFonti})`
    : `Risultati della ricerca (${nFonti}) — non citati dall'AI`;
  const fontiBlock = fonti
    ? `<details class="brief-fonti"><summary>${esc(etichettaFonti)}</summary><ul>${fonti}</ul></details>`
    : '';
  const e = ESITI_BRIEF[b.identificazione];
  const esito = e ? `<span class="brief-esito ${e.cls}" title="${esc(e.tit)}">${esc(e.txt)}</span>` : '';
  // Nel profilo va solo ciò che è stato identificato con certezza: un'identità
  // incerta resta a schermo, con le sue fonti, ma non si scrive in anagrafica.
  const salvato = cli && aiGiaFatto(chiaveSalvaBrief(cli));
  const salva = b.salvabile && cli
    ? `<button type="button" class="brief-save${salvato ? ' brief-save-done' : ''}" data-save-cli="${esc(cli)}"${salvato
      ? ' disabled title="Già aggiunto alle Note personali del profilo">✓ Salvato nel profilo'
      : ' title="Aggiungi alle Note personali del profilo">💾 Salva nel profilo'}</button>`
    : '';
  const avviso = b.identificazione === 'incerta'
    ? '<div class="brief-avviso">Apri la fonte e verifica che sia la persona giusta: finché l\'identità non è certa non si salva nel profilo.</div>'
    : '';
  return `<div class="brief-card">
    ${esito}
    <div class="brief-testo">${esc(b.testo || '')}</div>
    ${avviso}
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
    // Zero risultati, ma l'indicatore diceva ancora "5 arrivi": sembrava che i
    // cinque fossero lì e la pagina non li mostrasse. Con un filtro attivo si
    // conta come sempre, "0 di 5".
    stato.textContent = arriviAll.length === 0
      ? '0 arrivi'
      : `0 di ${arriviAll.length}`;
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
// Ogni allergia porta il nome di chi la ha: la prenotazione è di più persone, e
// "Glutine" da solo non dice a chi va preparato il piatto senza. Se il nome manca
// (dato vecchio, anagrafica sparita) si mostra comunque l'allergia: meglio un
// allarme senza nome che nessun allarme.
function vocaAllergia(v) {
  const testo = typeof v === 'string' ? v : (v && v.testo) || '';
  const chi = typeof v === 'string' ? '' : (v && v.chi) || '';
  return { testo: String(testo).trim(), chi: String(chi).trim() };
}

function flagAllergie(s, classe) {
  const voci = ((s && s.intolleranze) || []).map(vocaAllergia).filter((v) => v.testo);
  if (!voci.length) return '';
  const testo = voci.map((v) => (v.chi ? `${v.testo} — ${v.chi}` : v.testo)).join('; ');
  // Il titolo tiene la distinzione precisa (allergia ≠ intolleranza) senza
  // allungare l'etichetta: in card serve la parola che fa alzare la guardia.
  return `<span class="${esc(classe)} flag-safety" title="Allergie / intolleranze — dato di sicurezza">`
    + `<span class="flag-lbl">⚠ Allergie:</span>${esc(testo)}</span>`;
}

// --- Possibili allergie lette nelle note PMS ---
// Sono PROPOSTE: il CRM non scrive niente da solo in un dato di sicurezza.
// L'operatore vede la frase da cui nasce la proposta, sceglie a chi attribuirla
// e conferma. Scartate → spariscono finché resta su questa pagina.
// La chiave porta l'ambito perché lo stesso termine si può proporre in due
// posti diversi: su una prenotazione (Arrivi, In casa) e sulla scheda di una
// persona, dove un numero di pratica non esiste.
const proposteScartate = new Set();
const chiaveProposta = (x, termine) => (x && x.codpratica != null
  ? `pratica:${x.codpratica}|${String(termine).toLowerCase()}`
  : `cliente:${x && x.codCliente}|${String(termine).toLowerCase()}`);

// Chi può essere il destinatario: il referente e gli occupanti con un codice.
// La nota è della pratica, quindi la persona la sceglie chi sa leggerla.
function personeDellaPrenotazione(x) {
  const out = [];
  if (Number.isInteger(x.codCliente)) out.push({ codCli: x.codCliente, nome: x.nominativo || `#${x.codCliente}` });
  for (const o of x.ospiti || []) {
    if (!Number.isInteger(o.codCli) || o.codCli === x.codCliente) continue;
    out.push({ codCli: o.codCli, nome: o.nominativo || `#${o.codCli}` });
  }
  return out;
}

// Una riga di proposta. Le due fonti si comportano in modo diverso proprio dove
// conta: quella che viene dall'anagrafica della persona porta il nome già
// scritto (non c'è niente da scegliere, e non c'è modo di sbagliare persona),
// quella che viene dalla nota della prenotazione chiede all'operatore di dire a
// chi va attribuita, perché la nota riguarda la pratica e non un ospite solo.
function rigaProposta(p, opzioni, chiave) {
  const daAnagrafica = p.fonte === 'anagrafica' && Number.isInteger(p.codCli);
  const chi = daAnagrafica
    ? `<span class="prop-chi-certo">👤 ${esc(p.nome || `#${p.codCli}`)}</span>
       <input type="hidden" class="prop-chi" value="${p.codCli}">`
    : `<select class="prop-chi" title="A chi attribuire l'allergia">${opzioni}</select>`;
  const fonte = daAnagrafica
    ? '<span class="prop-fonte prop-fonte-certa" title="Scritta sull\'anagrafica di questa persona: l\'attribuzione è certa">dalla sua anagrafica</span>'
    : '<span class="prop-fonte" title="Scritta nella nota della prenotazione, che riguarda tutta la pratica: scegli tu a chi attribuirla">dalla prenotazione</span>';
  return `
    <div class="prop-riga" data-prop-termine="${esc(p.termine)}" data-prop-chiave="${esc(chiave)}">
      <span class="prop-termine">⚠ ${esc(p.termine)}</span>
      <span class="prop-frase" title="${esc(p.frase)}">«${esc(p.frase)}»</span>
      ${chi}${fonte}
      <button type="button" class="btn-icon prop-ok" data-add-prop>Aggiungi</button>
      <button type="button" class="btn-icon prop-no" data-ign-prop>Ignora</button>
    </div>`;
}

function proposteAllergie(x) {
  const proposte = ((x.snapshot && x.snapshot.allergieProposte) || [])
    .filter((p) => p && p.termine && !proposteScartate.has(chiaveProposta(x, p.termine)));
  if (!proposte.length) return '';
  const persone = personeDellaPrenotazione(x);
  // Le proposte dalla nota hanno bisogno di qualcuno a cui attribuirle; quelle
  // dall'anagrafica no, perché il nome ce l'hanno già.
  const utili = persone.length ? proposte : proposte.filter((p) => p.fonte === 'anagrafica' && Number.isInteger(p.codCli));
  if (!utili.length) return '';
  const opzioni = persone.map((p) => `<option value="${p.codCli}">${esc(p.nome)}</option>`).join('');
  return `<div class="prop-box">
    <div class="prop-testa">🔎 Possibili allergie
      <span class="info info-wide" data-tip="Trovate cercando parole come allergia, intolleranza o celiachia nei testi del gestionale. Sono proposte: nulla viene salvato finché non premi Aggiungi. Quelle che vengono dall'anagrafica di una persona portano già il suo nome; quelle che vengono dalla nota della prenotazione riguardano la pratica, quindi l'ospite lo scegli tu.">i</span></div>
    ${utili.map((p) => rigaProposta(p, opzioni, chiaveProposta(x, p.termine))).join('')}</div>`;
}

// Stesso riquadro sulla scheda ospite. Qui la persona è una sola, quindi non
// c'è nessuna tendina: quello che cambia fra le due fonti è quanto puoi fidarti,
// e va detto. Le annotazioni di anagrafica sono sue per costruzione; le note di
// prenotazione riguardano una pratica che può avere più occupanti, quindi la
// riga porta con sé la pratica e le date per farti giudicare.
function proposteAllergieScheda(codCli, proposte) {
  const utili = (proposte || [])
    .filter((p) => p && p.termine && !proposteScartate.has(chiaveProposta({ codCliente: codCli }, p.termine)));
  if (!utili.length) return '';
  const righe = utili.map((p) => {
    const daAnagrafica = p.fonte === 'anagrafica';
    const fonte = daAnagrafica
      ? '<span class="prop-fonte prop-fonte-certa" title="Scritta sull\'anagrafica di questa persona: l\'attribuzione è certa">dalla sua anagrafica</span>'
      : `<span class="prop-fonte" title="Scritta nella nota di una prenotazione, che può riguardare più occupanti: verifica che sia sua">dalla prenotazione${p.codpratica ? ` ${esc(p.codpratica)}` : ''}${p.dtarrivo ? ` · ${fmtData(p.dtarrivo)}` : ''}</span>`;
    return `
    <div class="prop-riga" data-prop-termine="${esc(p.termine)}" data-prop-chiave="${esc(chiaveProposta({ codCliente: codCli }, p.termine))}">
      <span class="prop-termine">⚠ ${esc(p.termine)}</span>
      <span class="prop-frase" title="${esc(p.frase)}">«${esc(p.frase)}»</span>
      ${fonte}
      <input type="hidden" class="prop-chi" value="${p.codCli}">
      <button type="button" class="btn-icon prop-ok" data-add-prop>Aggiungi</button>
      <button type="button" class="btn-icon prop-no" data-ign-prop>Ignora</button>
    </div>`;
  }).join('');
  return `<div class="prop-box">
    <div class="prop-testa">🔎 Possibili allergie
      <span class="info info-wide" data-tip="Trovate nei testi del gestionale: le annotazioni di anagrafica, che stanno sulla singola persona, e le note delle sue prenotazioni, che riguardano la pratica e possono parlare di un altro occupante. Ogni riga dice da dove viene. Nulla viene salvato finché non premi Aggiungi.">i</span></div>
    ${righe}</div>`;
}

// Un'allergia appena salvata compare subito nelle card già a video: si aggiorna
// la copia in memoria invece di rileggere tutta la pagina dal server, così non
// si perdono il filtro e la ricerca attivi e non c'è attesa.
// Si tocca ogni prenotazione che coinvolge quel cliente — come referente o come
// occupante — perché la banda allergie della card è del soggiorno, non del solo
// intestatario.
function aggiungiAllergiaNelleCard(codCli, termine) {
  const chiave = String(termine).trim().toLowerCase();
  for (const lista of [arriviAll, incasaAll]) {
    for (const x of lista || []) {
      const s = x.snapshot;
      if (!s) continue;
      const referente = x.codCliente === codCli;
      const occupante = (x.ospiti || []).find((o) => o.codCli === codCli);
      if (!referente && !occupante) continue;
      // Il nome va messo subito, come lo metterebbe il server al prossimo
      // caricamento: senza, l'allergia appena aggiunta sarebbe l'unica anonima.
      const chi = referente ? x.nominativo : (occupante && occupante.nominativo) || '';
      s.intolleranze = s.intolleranze || [];
      const gia = s.intolleranze.some((v) => {
        const t = typeof v === 'string' ? v : (v && v.testo) || '';
        const c = typeof v === 'string' ? '' : (v && v.chi) || '';
        return String(t).trim().toLowerCase() === chiave && String(c).trim() === String(chi).trim();
      });
      if (!gia) s.intolleranze.push({ testo: termine, chi: chi || null });
    }
  }
  ricalcolaAlert();
}

// L'allergia appena aggiunta può far entrare la prenotazione fra gli "Alert":
// il contatore del chip si ricalcola con LA STESSA regola che filtra le card
// (presa dai chip, non riscritta: due copie divergerebbero).
function ricalcolaAlert() {
  const predArrivi = BRIEF_CHIPS.find((c) => c.key === 'alert').pred;
  const predInCasa = INCASA_CHIPS.find((c) => c.key === 'alert').pred;
  if (arriviBriefing) arriviBriefing.alert = arriviAll.filter(predArrivi).length;
  if (incasaBriefing) incasaBriefing.alert = incasaAll.filter(predInCasa).length;
}

// Conferma o scarto di una proposta. `contenitore` è la card da ridisegnare.
async function gestisciProposta(btn, ricarica) {
  const riga = btn.closest('[data-prop-termine]');
  if (!riga) return;
  const termine = riga.dataset.propTermine;
  // La chiave la scrive chi disegna la riga: qui non si sa se veniamo da una
  // prenotazione o dalla scheda di una persona, e ricalcolarla a mano è il modo
  // di farla divergere.
  const chiave = riga.dataset.propChiave;
  if (btn.hasAttribute('data-ign-prop')) { proposteScartate.add(chiave); ricarica(); return; }
  const codCli = Number(riga.querySelector('.prop-chi').value);
  if (!Number.isInteger(codCli)) return;
  riga.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  const { status } = await api(`/api/clienti/${encodeURIComponent(codCli)}/intolleranze`, {
    method: 'POST', body: JSON.stringify({ testo: termine }),
  });
  if (status !== 201) {
    riga.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    riga.querySelector('.prop-frase').textContent = 'Errore nel salvataggio, riprova.';
    return;
  }
  // Salvata: non si ripropone (e alla prossima lettura la scarta già il server).
  proposteScartate.add(chiave);
  aggiungiAllergiaNelleCard(codCli, termine);
  ricarica();
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
      ${proposteAllergie(a)}
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
  // "Oggi in hotel" e non "In casa": questo elenco comprende anche chi parte oggi,
  // quindi dà un numero più alto del riquadro "Restano stanotte" della Home, che
  // conta le camere occupate la notte. Sono due domande diverse, e i nomi lo dicono.
  { key: 'all', label: 'Oggi in hotel', field: 'presenti', pred: () => true },
  // "Partono oggi" = ancora in camera con partenza odierna + chi ha già fatto il
  // check-out. È il filtro che apre la Home cliccando su "Partenze oggi".
  { key: 'partenze', label: 'Partono oggi', field: 'partonoOggi', pred: (c) => c.statoPartenza === 'partenza' || c.statoPartenza === 'checkout' },
  { key: 'vip', label: 'VIP', field: 'vip', pred: (c) => !!(c.snapshot && c.snapshot.vip) },
  { key: 'alert', label: 'Alert', field: 'alert', pred: (c) => !!(c.snapshot && ((c.snapshot.intolleranze && c.snapshot.intolleranze.length) || c.snapshot.indesiderato)) },
  { key: 'ricorrenze', label: 'Ricorrenze', field: 'ricorrenze', pred: (c) => !!(c.snapshot && c.snapshot.compleanno) },
  { key: 'reclami', label: 'Reclami', field: 'reclami', pred: (c) => !!(c.snapshot && c.snapshot.reclami && c.snapshot.reclami.totali > 0) },
  { key: 'usciti', label: 'Usciti', field: 'usciti', pred: (c) => c.statoPartenza === 'checkout' },
  // Ospiti del giorno: esterni di SPA, piscina e serate. Stanno in fondo alla
  // lista perché non hanno camera, e hanno un chip per tirarli fuori quando
  // servono davvero — la sera di una festa sono la lista della cucina.
  { key: 'dayuse', label: 'Day use', field: 'dayUse', pred: (c) => c.statoPartenza === 'dayuse' },
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
    // Conferma/scarto delle allergie proposte dalle note.
    $('#incasa-cards').addEventListener('click', (e) => {
      const prop = e.target.closest('[data-add-prop], [data-ign-prop]');
      if (prop) gestisciProposta(prop, renderInCasa);
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
    // Vedi renderArrivi: con un filtro che non seleziona nulla il totale da solo
    // fa credere che i presenti siano lì e non vengano mostrati.
    stato.textContent = incasaAll.length === 0
      ? '0 presenti'
      : `0 di ${incasaAll.length}`;
    return;
  }
  stato.textContent = lista.length === incasaAll.length
    ? `${presenti} ${presenti === 1 ? 'presente' : 'presenti'}`
    : `${lista.length} di ${incasaAll.length}`;
  cards.innerHTML = lista.map(schedaInCasa).join('');
  msg.hidden = true; cards.hidden = false;
}

// Oltre questa soglia la fila di pallini sfonderebbe la card: si passa alla
// barra. Diciassette perché il soggiorno lungo qui è di due settimane: la
// barra deve restare l'eccezione, non il modo normale di leggere la card.
const MAX_PALLINI = 17;

// Il disegno dell'avanzamento. `notte` comprende la notte IN CORSO, che stasera
// non è ancora stata dormita: viene quindi disegnata come anello e non come
// pallino pieno. Senza questa distinzione l'ultima notte di chi resta e il
// soggiorno chiuso di chi parte oggi risultavano identici (tutti i pallini
// pieni), pur essendo due situazioni opposte per la reception.
function progressoSoggiorno(av, concluso) {
  const fine = concluso ? ' ic-prog-fine' : '';
  if (av.notti > MAX_PALLINI) {
    // Soggiorni lunghi: stessa informazione, ingombro costante.
    const fatte = concluso ? av.notte : av.notte - 1;
    const quota = (n) => `${Math.round((n / av.notti) * 100)}%`;
    return `<span class="ic-bar${fine}" title="Notte ${av.notte} di ${av.notti}">`
      + `<i class="ic-bar-fatte" style="width:${quota(fatte)}"></i>`
      + `<i class="ic-bar-corso" style="width:${concluso ? '0%' : quota(1)}"></i></span>`;
  }
  const dots = Array.from({ length: av.notti }, (_, i) => {
    if (i < av.notte - 1) return '<i class="ic-dot on"></i>';
    if (i > av.notte - 1) return '<i class="ic-dot"></i>';
    return concluso ? '<i class="ic-dot on"></i>' : '<i class="ic-dot corso"></i>';
  }).join('');
  return `<span class="ic-prog${fine}">${dots}</span>`;
}

// "Domani" solo se la partenza è davvero il giorno dopo la data di lavoro:
// se i dati dicessero altro si torna alla data esplicita.
function parteDomani(c, data) {
  if (!c.dtpartenza || !data) return false;
  const g = (iso) => new Date(`${iso}T00:00:00Z`).getTime();
  return g(c.dtpartenza) - g(data) === 86400000;
}

// Avanzamento del soggiorno: pallini (o barra) + testo parlante ("Notte 3 di 7").
function renderAvanzamento(c, data) {
  const av = c.avanzamento;
  // L'ospite del giorno non ha un soggiorno da far avanzare: si dice cosa è,
  // non "quando parte" — parte in giornata per definizione.
  if (c.statoPartenza === 'dayuse') {
    const pax = Number(c.paxAdulti || 0) + Number(c.paxBambini || 0);
    return `<span>In hotel per la giornata${pax ? ` · ${pax} ${pax === 1 ? 'persona' : 'persone'}` : ''}</span>`;
  }
  if (c.statoPartenza === 'checkout') {
    const n = c.notti != null ? ` · ${c.notti} ${c.notti === 1 ? 'notte' : 'notti'}` : '';
    return `<span>Soggiorno concluso${n}</span>`;
  }
  if (!av) return `<span>Parte il ${fmtData(c.dtpartenza)}</span>`;
  // Chi parte oggi ha finito: nessuna notte in corso e colore spento.
  if (c.statoPartenza === 'partenza') {
    return progressoSoggiorno(av, true)
      + `<span>${av.notti} ${av.notti === 1 ? 'notte' : 'notti'} · <b>parte oggi</b></span>`;
  }
  // L'ultima sera è quella in cui si fa ancora in tempo a rimediare a qualcosa:
  // va detta, non lasciata dedurre da "Notte 2 di 2".
  const testo = av.ultimaNotte && parteDomani(c, data)
    ? '<b>Ultima notte</b> · parte domani'
    : `Notte ${av.notte} di ${av.notti} · parte ${fmtData(c.dtpartenza)}`;
  return progressoSoggiorno(av, false) + `<span>${testo}</span>`;
}

// "Ospite di ritorno". `storico.n` sono i soggiorni GIÀ CONCLUSI: quello in corso
// è quindi l'(n+1)-esimo. Chi non è mai stato qui non ha badge.
function badgeStorico(s) {
  if (!s) return '';
  const out = [];
  if (s.n) {
    const ultima = s.ultima ? ` · ultima ${fmtData(s.ultima)}` : '';
    const tip = `${s.n} ${s.n === 1 ? 'soggiorno concluso' : 'soggiorni conclusi'} in hotel`;
    out.push(`<span class="ic-ritorno" title="${tip}">${s.n + 1}ª volta${ultima}</span>`);
  }
  // Le giornate (SPA, piscina, cene) stanno in un badge a parte e non si
  // sommano ai soggiorni: chi ha dormito qui una volta e poi è tornato sei
  // volte per la SPA è al secondo soggiorno, non all'ottavo. Ma il fatto che
  // lo vediamo spesso è un'informazione che serve, non da nascondere.
  if (s.visite) {
    const tip = `${s.visite} ${s.visite === 1 ? 'visita' : 'visite'} in giornata (SPA, piscina, ristorante)`;
    out.push(`<span class="ic-visite" title="${tip}">${s.visite} in giornata</span>`);
  }
  return out.join('');
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
  const dayUse = c.statoPartenza === 'dayuse';
  const accento = s && s.indesiderato ? ' ic-danger' : (s && s.vip ? ' ic-vip' : '');
  const nome = c.nominativo
    ? linkCliente(c.codCliente, c.nominativo, { classe: 'ic-name' })
    : '<span class="ic-name">(senza nominativo)</span>';
  // Un ospite del giorno non ha camera: il trattino al posto del numero
  // sembrerebbe un dato mancante invece di una camera che non esiste.
  const camere = dayUse ? '' : (c.camere
    ? c.camere.split(',').map((x) => `<span class="ic-room">${esc(x.trim())}</span>`).join('')
    : '<span class="ic-room ic-room-vuota">—</span>');
  const tipologie = c.tipologie
    ? c.tipologie.split(',').map((t) => `<span class="ic-tipo">${esc(t.trim())}</span>`).join('')
    : '';
  const pill = dayUse
    ? '<span class="pill pill-dayuse">Day use</span>'
    : (uscito
      ? '<span class="pill pill-checkout">Check-out effettuato</span>'
      : (c.statoPartenza === 'partenza' ? '<span class="pill pill-partenza">Parte oggi</span>' : ''));

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
    <article class="ic${accento}${uscito ? ' ic-out' : ''}${dayUse ? ' ic-dayuse' : ''}">
      <div class="ic-head">
        ${camere}${tipologie}
        ${nome}
        ${badgeVip(s && s.vip)}
        <span class="ic-spacer"></span>
        ${pill}
      </div>
      <div class="ic-stay">${renderAvanzamento(c, incasaData)}${badgeStorico(c.storico)}</div>
      ${flagBlock}
      ${notaBlock}
      ${prefBlock}
      ${proposteAllergie(c)}
      ${renderOspitiInCasa(c)}
      <div class="ic-op">
        ${tratt ? `<span><i>Trattamento</i><b>${tratt}</b></span>` : ''}
        ${c.extra ? `<span><i>Extra</i><b>${euro(c.extra)}</b></span>` : ''}
        ${dayUse ? '' : `<span><i>Soggiorno</i><b>${c.importo != null ? euro(c.importo) : '—'}</b></span>`}
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
let ruoliCache = []; // { nome, etichetta, descrizione, permessi }

const ruoloDi = (nome) => ruoliCache.find((r) => r.nome === nome);
const etichettaRuolo = (nome) => (ruoloDi(nome) || {}).etichetta || nome;

// L'elenco dei ruoli arriva dal server, non è scritto qui: un ruolo aggiunto in
// auth/permessi.js compare nel menu senza toccare il frontend. È anche il motivo
// per cui la descrizione la scrive chi definisce il ruolo, non chi disegna il form.
async function caricaRuoli() {
  if (ruoliCache.length) return;
  const { status, body } = await api('/api/admin/ruoli');
  if (status === 200) ruoliCache = body.ruoli || [];
  const sel = $('#user-form').role;
  sel.innerHTML = ruoliCache.map((r) => `<option value="${esc(r.nome)}">${esc(r.etichetta)}</option>`).join('');
}

function mostraDescrizioneRuolo() {
  const r = ruoloDi($('#user-form').role.value);
  $('#ruolo-descrizione').textContent = r ? r.descrizione : '';
}

async function loadUsers() {
  $('#user-list').innerHTML = `<tr><td colspan="6">${loaderHTML('Carico gli utenti…')}</td></tr>`;
  await caricaRuoli();
  const { body } = await api('/api/admin/users');
  usersCache = body.users || [];
  $('#user-list').innerHTML = usersCache.map((u) => `
    <tr>
      <td class="cell-name">${esc(u.username)}</td>
      <td>${cell(u.nome)}</td>
      <td>${cell(u.cognome)}</td>
      <td class="cell-muted">${cell(u.email)}</td>
      <td><span class="role-tag${ruoloDi(u.role) ? '' : ' role-tag-ignoto'}" title="${esc(ruoloDi(u.role) ? ruoloDi(u.role).descrizione : 'Ruolo non più previsto: l\'utente può solo consultare finché non gliene assegni uno valido.')}">${esc(etichettaRuolo(u.role))}</span></td>
      <td>${u.attivo ? '<span class="pill pill-attivo">Attivo</span>' : '<span class="pill pill-disattivato">Disattivato</span>'}</td>
      <td class="row-actions">
        <button class="btn-icon" data-edit="${u.id}">Modifica</button>
        <button class="btn-icon danger" data-del="${u.id}">Elimina</button>
      </td>
    </tr>`).join('');
}

async function openUserDialog(user) {
  editingId = user ? user.id : null;
  await caricaRuoli(); // senza le opzioni il menu sarebbe vuoto
  const f = $('#user-form');
  f.reset();
  $('#user-form-error').textContent = '';
  $('#user-dialog-title').textContent = user ? 'Modifica utente' : 'Nuovo utente';
  $('#attivo-wrap').hidden = !user;
  if (user) {
    f.username.value = user.username || '';
    // Un ruolo non più previsto non si può riselezionare: il menu resta sul primo
    // valore valido, così salvando si assegna un ruolo vero invece di riscrivere
    // quello vecchio.
    f.role.value = ruoloDi(user.role) ? user.role : (ruoliCache[0] || {}).nome || '';
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
  mostraDescrizioneRuolo();
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
// La descrizione del ruolo segue il menu: chi assegna un permesso deve vedere
// cosa sta dando, non ricordarselo.
$('#user-form').role.addEventListener('change', mostraDescrizioneRuolo);
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
  // Senza valore questo riquadro mostra direttamente il form di inserimento: a chi
  // non può scrivere si dice invece che il dato non c'è. Nascondere il form con il
  // CSS lascerebbe un buco bianco, che sembra un guasto.
  if (!puo('scrivi')) {
    box.innerHTML = val
      ? `<div class="nota-testo lingua-valore">${esc(val)}</div>`
      : '<div class="nota-vuota">Nessuna lingua preferita registrata.</div>';
    return;
  }
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
  const { status, body } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/profilo`, {
    method: 'PUT', body: JSON.stringify({ lingua }),
  });
  // Ricarica dal server = conferma: si torna in vista col valore che c'è davvero.
  if (status === 200) { await caricaLingua(clienteCorrente); return; }
  // Il pulsante che torna cliccabile, da solo, non spiega niente.
  if (btn) { btn.disabled = false; btn.textContent = 'Salva'; }
  erroreSalvataggio(status, body, 'la lingua preferita');
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
  // Come per la lingua: senza nota il riquadro è un form. In sola lettura si
  // mostra il testo, o il fatto che non ce n'è.
  if (!puo('scrivi')) {
    const meta = [d.autore, d.data ? new Date(d.data).toLocaleString('it-IT') : null].filter(Boolean).join(' · ');
    box.innerHTML = haNota
      ? `<div class="nota-testo notepers-testo">${esc(d.testo)}</div><div class="nota-meta"><span>${esc(meta)}</span></div>`
      : '<div class="nota-vuota">Nessuna nota personale registrata.</div>';
    return;
  }
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
  const { status, body } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/note-personali`, {
    method: 'PUT', body: JSON.stringify({ testo, mode: 'set' }),
  });
  if (status === 200) { await caricaLingua(clienteCorrente); return; } // ricarica dal server = conferma
  if (btn) { btn.disabled = false; btn.textContent = 'Salva'; }
  erroreSalvataggio(status, body, 'la nota personale');
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
    if (status === 503) { riabilita(); msg.textContent = motivoAiNonDisponibile(body); return; }
    if (status !== 200) { riabilita(); msg.textContent = 'Errore durante la generazione.'; return; }
    // Ricerca fatta: anche "nessuna informazione" è una risposta, rifarla darebbe lo stesso esito.
    fatto();
    if (!body.pubblico) { msg.textContent = 'Nessuna informazione pubblica rilevante per questo ospite.'; return; }
    // Identità non confermata: le note personali SONO il profilo, quindi non ci
    // scrivo dentro un'ipotesi. Mostro i link e decide chi legge.
    if (!body.salvabile) {
      const link = (body.fonti || []).slice(0, 6)
        .map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.titolo || f.url)}</a>`)
        .join(' · ');
      msg.innerHTML = '<span class="notepers-incerta">⚠ Trovato un profilo compatibile, ma l\'identità non è confermata (possibile omonimia): non lo inserisco da solo. Apri la fonte e, se è la persona giusta, scrivilo a mano.</span>'
        + (link ? `<span class="notepers-fonti">${link}</span>` : '');
      return;
    }
    const ta = $('#cli-note-personali');
    const attuale = ta.value.trim();
    ta.value = attuale ? `${attuale}\n\n${body.testo}` : body.testo;
    const fonti = (body.fonti || []).map((f) => f.titolo || f.url).slice(0, 6);
    const origine = body.identificazione === 'professionale' ? 'da profilo professionale' : 'da fonti pubbliche';
    msg.innerHTML = `<span class="notepers-ok">✓ Generato ${esc(origine)}. Rivedi e premi Salva.</span>${fonti.length ? `<span class="notepers-fonti">Fonti: ${fonti.map(esc).join(' · ')}</span>` : ''}`;
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
  const { status, body } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/preferenze`, {
    method: 'POST', body: JSON.stringify({ reparto, categoria, testo }),
  });
  if (status === 201) { f.reset(); caricaPreferenze(clienteCorrente); }
  else erroreSalvataggio(status, body, 'la preferenza');
});

$('#cli-preferenze').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del-pref]');
  if (del) { await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/preferenze/${del.dataset.delPref}`, { method: 'DELETE' }); caricaPreferenze(clienteCorrente); return; }
  const opt = e.target.closest('[data-set-ambito]');
  if (opt) {
    const li = opt.closest('[data-pref]');
    // Clic sulla voce già attiva: non è un cambio, non si chiama il server.
    if (!li || opt.classList.contains('scope-on')) return;
    await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/preferenze/${li.dataset.pref}`, { method: 'PATCH', body: JSON.stringify({ ambito: opt.dataset.setAmbito }) });
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
    if (status === 503) { renderSuggerimenti(motivoAiNonDisponibile(body)); riabilita(); return; }
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
      // `origine: 'ai'` è l'unico punto in cui il server può sapere che questa
      // preferenza nasce da un suggerimento: da qui in poi la riga è identica a
      // una scritta a mano, ed è quello che finora rendeva impossibile dire
      // quanto l'AI venga davvero usata.
      await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/preferenze`, { method: 'POST', body: JSON.stringify({ reparto: s.reparto, categoria: s.categoria, testo: s.testo, ambito: 'nucleo', origine: 'ai' }) });
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
// Da quanto si conoscono: "insieme 10 volte · ultima ago 2026". Il 94% delle
// righe porta la relazione predefinita "Altro", quindi l'etichetta da sola non
// dice niente; questa riga sì. Chi non è agganciato a un'anagrafica del
// gestionale (scritto a mano) non ha soggiorni da contare e non mostra nulla:
// meglio il silenzio di uno zero che sembrerebbe un giudizio.
// Oltre i tre anni il grigio diventa un avviso: non per sconsigliare, per far
// notare che quella compagnia potrebbe non esserci più.
const TRE_ANNI = 3 * 365 * 86400000;
function frequentazioneNucleo(m) {
  const n = m.insieme;
  if (!n) return '';
  const volte = `insieme ${n} ${n === 1 ? 'volta' : 'volte'}`;
  if (!m.ultimaInsieme) return `<span class="nucleo-freq">${volte}</span>`;
  const d = new Date(`${m.ultimaInsieme}T00:00:00`);
  const mese = d.toLocaleDateString('it-IT', { month: 'short', year: 'numeric' });
  const lontana = Date.now() - d.getTime() > TRE_ANNI;
  return `<span class="nucleo-freq${lontana ? ' nucleo-freq-vecchia' : ''}"`
    + ` title="Ultimo soggiorno fatto insieme: ${esc(fmtData(m.ultimaInsieme))}">${volte} · ultima ${esc(mese)}</span>`;
}

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
        ${frequentazioneNucleo(m)}
        ${m.nota ? `<span class="cell-muted">— ${esc(m.nota)}</span>` : ''}
      </div>
      <span class="nucleo-az">
        <button type="button" class="btn-icon" data-edit-nucleo="${m.id}" title="Modifica">✎</button>
        <button type="button" class="btn-icon danger" data-del-nucleo="${m.id}" title="Elimina">🗑</button>
      </span>
    </li>`;
  // L'invito ad aggiungere ha senso solo per chi può farlo: al form sotto, in sola
  // lettura, manderebbe a cercare qualcosa che non c'è.
  }).join('') || `<li class="nota-vuota">Nessun componente.${puo('scrivi') ? ' Aggiungine uno qui sopra.' : ''}</li>`;
}

$('#nucleo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!clienteCorrente) return;
  const tipoRelazione = f.tipoRelazione.value;
  const nome = f.nome.value.trim(), cognome = f.cognome.value.trim(), nota = f.nota.value.trim();
  if (!tipoRelazione || (!nome && !cognome)) return;
  const { status, body } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/nucleo`, {
    method: 'POST', body: JSON.stringify({ tipoRelazione, nome, cognome, nota }),
  });
  if (status === 201) { f.reset(); caricaNucleo(clienteCorrente); }
  else erroreSalvataggio(status, body, 'il componente del nucleo');
});

$('#cli-nucleo').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit-nucleo]');
  if (edit) { nucleoEditId = Number(edit.dataset.editNucleo); caricaNucleo(clienteCorrente); return; }
  const cancel = e.target.closest('[data-cancel-nucleo]');
  if (cancel) { nucleoEditId = null; caricaNucleo(clienteCorrente); return; }
  const del = e.target.closest('[data-del-nucleo]');
  if (del) {
    if (nucleoEditId === Number(del.dataset.delNucleo)) nucleoEditId = null;
    await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/nucleo/${del.dataset.delNucleo}`, { method: 'DELETE' });
    caricaNucleo(clienteCorrente); return;
  }
  const save = e.target.closest('[data-save-nucleo]');
  if (save) {
    const li = save.closest('[data-nucleo]');
    const payload = {};
    li.querySelectorAll('[data-field]').forEach((el) => { payload[el.dataset.field] = el.value.trim(); });
    save.disabled = true; save.textContent = 'Salvataggio…';
    const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/nucleo/${save.dataset.saveNucleo}`, { method: 'PATCH', body: JSON.stringify(payload) });
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

// Codici del gruppo attualmente a video: servono al confronto in sola vista, che
// si apre dal banner e non ha altro modo di sapere chi sta guardando.
let mergeCorrente = [];

function renderMergeBanner(codCli, merge) {
  const el = $('#cli-merge-banner');
  mergeCorrente = (merge && merge.membri) || [];
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
  // I dati delle singole anagrafiche, dopo la fusione, non si vedono più da
  // nessuna parte: la scheda mostra l'insieme. Serve un modo per riaprirli, se non
  // altro per accorgersi che due codici hanno mail o codice fiscale diversi.
  // È una lettura, quindi resta disponibile anche a chi non può modificare.
  const confronta = '<button type="button" class="btn btn-sm merge-vedi" data-vedi-anagrafiche title="Vedi i dati delle singole anagrafiche, uno accanto all\'altro">Confronta anagrafiche</button>';
  el.innerHTML = `<span class="merge-ico">⛓</span><div><b>Scheda fusa</b> — dati aggregati su ${merge.membri.length} anagrafiche.<div class="merge-chips">${rows}${confronta}</div></div>`;
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

// Sola vista: il confronto aperto da una scheda GIÀ fusa. Non c'è niente da
// confermare — serve a vedere i dati delle singole anagrafiche, che la fusione
// aggrega e quindi nasconde. È l'unico modo per accorgersi che due codici hanno
// email o codice fiscale diversi dopo che sono stati uniti.
let mergeSolaLettura = false;

async function apriConfronto(ids, opts = {}) {
  mergeSolaLettura = !!opts.soloVista;
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
  const head = d.anagrafiche.map((a) => {
    const codice = linkCliente(a.codCli, `#${a.codCli}`, { nuovaScheda: true, titolo: `Apri l'anagrafica #${a.codCli} in una nuova scheda` });
    // In sola vista il principale è già deciso: niente radio da scegliere.
    const scelta = mergeSolaLettura
      ? `<span class="merge-princ">${codice}</span>`
      : `<label class="merge-princ"><input type="radio" name="princ" value="${a.codCli}" ${a.codCli === princ ? 'checked' : ''}/> ${codice}</label>`;
    return `<th class="${a.codCli === princ ? 'merge-princ-col' : ''}">${scelta}
      ${a.codCli === princ ? '<span class="merge-badge">principale</span>' : ''}</th>`;
  }).join('');
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
  const elenco = [...conflSet].map((c) => LABEL_CAMPO[c] || c).join(', ');
  const avviso = !conflSet.size ? ''
    : mergeSolaLettura
      // Su un gruppo già fuso il conflitto non blocca niente: è un'informazione, e
      // la via d'uscita non è "non confermare" ma scollegare dal banner.
      ? `<div class="merge-avviso">⚠ Queste anagrafiche hanno dati diversi (${esc(elenco)}). Se non fossero la stessa persona, si scollegano dal banner della scheda.</div>`
      : `<div class="merge-avviso">⚠ Dati in conflitto (${esc(elenco)}): assicurati che sia la stessa persona e scegli il principale prima di confermare.</div>`;
  const codaInfo = mergeCoda ? `<span class="merge-coda">Gruppo ${mergeCoda.idx + 1} di ${mergeCoda.gruppi.length}</span>` : '';
  const azioni = mergeSolaLettura
    ? '<button type="button" class="btn btn-primary" id="merge-annulla">Chiudi</button>'
    : mergeCoda
      ? '<button type="button" class="btn btn-ghost" id="merge-annulla">Annulla tutto</button><button type="button" class="btn" id="merge-salta">Salta</button><button type="button" class="btn btn-primary" id="merge-conferma">Conferma unione</button>'
      : '<button type="button" class="btn btn-ghost" id="merge-annulla">Annulla</button><button type="button" class="btn btn-primary" id="merge-conferma">Conferma unione</button>';
  const titolo = mergeSolaLettura ? 'Anagrafiche di questa scheda' : 'Confronta e unisci anagrafiche';
  const sottotitolo = mergeSolaLettura
    ? 'Sono le anagrafiche unite in questa scheda. Quello che vedi nella scheda è il loro <b>insieme</b>: qui invece i dati di ciascuna, uno accanto all\'altro.'
    : 'Scegli l\'anagrafica <b>principale</b>; le altre verranno collegate. Verranno aggregati soggiorni, consumi F&amp;B/SPA, preferenze, intolleranze, reclami e note. Operazione <b>reversibile</b>.';
  $('#merge-dialog-body').innerHTML = `<div class="merge-body">
    <div class="merge-head"><span class="modal-title">${esc(titolo)}</span>${codaInfo}</div>
    <p class="merge-sub">${sottotitolo}</p>
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
  if (e.target.closest('[data-vedi-anagrafiche]')) {
    if (mergeCorrente && mergeCorrente.length > 1) apriConfronto(mergeCorrente, { soloVista: true });
    return;
  }
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
  // Le proposte lette nelle annotazioni del gestionale stanno SOTTO l'elenco:
  // prima quello che è registrato davvero, poi quello che si potrebbe aggiungere.
  // Solo per chi può scrivere: a un utente in sola lettura mostreremmo due
  // pulsanti che non funzionano.
  const box = $('#cli-intol-proposte');
  if (box) box.innerHTML = puo('scrivi') ? proposteAllergieScheda(codCli, body.proposte) : '';
}

$('#intol-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const testo = f.testo.value.trim();
  if (!testo || !clienteCorrente) return;
  const { status, body } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/intolleranze`, {
    method: 'POST', body: JSON.stringify({ testo }),
  });
  if (status === 201) { f.reset(); caricaIntolleranze(clienteCorrente); }
  else erroreSalvataggio(status, body, 'l\'allergia');
});

$('#cli-intolleranze').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del-intol]');
  if (del) {
    await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/intolleranze/${del.dataset.delIntol}`, { method: 'DELETE' });
    caricaIntolleranze(clienteCorrente);
  }
});

// Conferma/scarto delle proposte lette in anagrafica: stessa funzione delle card
// di Arrivi e In casa, così il comportamento resta uno solo.
$('#cli-intol-proposte').addEventListener('click', (e) => {
  const prop = e.target.closest('[data-add-prop], [data-ign-prop]');
  if (prop) gestisciProposta(prop, () => caricaIntolleranze(clienteCorrente));
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
  const { status, body } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/complaints`, {
    method: 'POST', body: JSON.stringify({ testo, periodo, reparto, categoria }),
  });
  if (status === 201) {
    f.reset();
    // reset() svuota anche le select: vanno riportate al placeholder
    popolaSelect(f.reparto, REPARTI, 'Reparto');
    popolaSelect(f.categoria, CATEGORIE_COMPLAINT, 'Categoria');
    caricaComplaints(clienteCorrente);
  } else erroreSalvataggio(status, body, 'il reclamo');
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
  const { status, body } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/complaints/${classeId}`, {
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
    await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/complaints/${del.dataset.delCompl}`, { method: 'DELETE' });
    caricaComplaints(clienteCorrente);
  } else if (toggle) {
    const li = toggle.closest('[data-compl]');
    // Risolvere passa dalla maschera del follow-up; riaprire no: lì non c'è
    // niente da raccontare, e il follow-up già scritto resta dov'è.
    if (toggle.dataset.stato === 'risolto') {
      await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/complaints/${toggle.dataset.toggleCompl}`, { method: 'PATCH', body: JSON.stringify({ stato: 'aperto' }) });
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
    await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/complaints/${edit.dataset.editCompl}`, { method: 'PATCH', body: JSON.stringify(patch) });
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
  const { status, body } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/complaints/${followUpId}`, {
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
