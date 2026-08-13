// Export operativo per i reparti — Arrivi e In casa.
//
// PERCHÉ QUI E NON IN app.js: questa è la parte destinata a crescere (viste per
// F&B, Housekeeping, SPA, Concierge). Tenerla separata significa che aggiungere
// un reparto domani vuol dire aggiungere una voce in VISTE_EXPORT, non rimettere
// mano alle pagine.
//
// DA DOVE ARRIVANO I DATI: dalle liste già caricate dalle pagine (arriviAll,
// incasaAll). Nessuna query nuova, nessun endpoint nuovo: si esporta esattamente
// ciò che il CRM ha già in mano e che l'operatore vede a schermo.
//
// REGOLA DI PROGETTO: allergie e preferenze NON sono la stessa cosa. Una
// Coca-Cola Zero gradita e un'allergia alle arachidi non possono avere lo stesso
// peso: le allergie stanno in una colonna propria, in rosso, prima delle
// preferenze, e nel foglio stampato non si perdono mai nel corpo del testo.

const $$ = (sel) => [...document.querySelectorAll(sel)];

// --- Colonne disponibili -----------------------------------------------------
// Ogni colonna sa come si chiama e come si estrae. Le viste scelgono quali usare.
const COLONNE_EXPORT = {
  // Colonne del FOGLIO. `valoreSotto` è una seconda riga attenuata sotto al
  // valore: dice qualcosa in più senza costare una colonna.
  camera: { etichetta: 'Camera', valore: (r) => r.camereRighe, classe: 'st-camera' },
  ospite: { etichetta: 'Ospite', valore: (r) => r.ospite, valoreSotto: (r) => r.visite, classe: 'st-ospite' },
  // Le tre informazioni sul periodo in una colonna sola: su A4 ogni colonna in
  // meno è spazio che va al testo. Nel CSV restano separate, perché lì servono
  // per ordinare e filtrare.
  soggiorno: {
    etichetta: 'Soggiorno',
    valore: (r) => `${r.arrivo} → ${r.partenza}`,
    valoreSotto: (r) => (r.notti != null ? `${r.notti} ${r.notti === 1 ? 'notte' : 'notti'}` : ''),
    classe: 'st-sogg',
  },
  inCamera: { etichetta: 'In camera', valore: (r) => r.inCamera },
  // Colonne del CSV: una riga per cella, niente a capo.
  camereCsv: { etichetta: 'Camera', valore: (r) => r.camere },
  ospiteCsv: { etichetta: 'Ospite', valore: (r) => r.ospite },
  visite: { etichetta: 'Visite', valore: (r) => r.visite },
  arrivo: { etichetta: 'Arrivo', valore: (r) => r.arrivo },
  partenza: { etichetta: 'Partenza', valore: (r) => r.partenza },
  notti: { etichetta: 'Notti', valore: (r) => (r.notti == null ? '' : String(r.notti)) },
  vip: { etichetta: 'VIP', valore: (r) => r.vip },
  allergie: { etichetta: 'Allergie', valore: (r) => r.allergie, classe: 'st-allergie' },
  attenzioni: { etichetta: 'Attenzioni', valore: (r) => r.attenzioni.join(' · '), classe: 'st-attenzioni' },
  preferenze: { etichetta: 'Preferenze', valore: (r) => r.preferenze },
  // Nota personale dell'anagrafica (chi è l'ospite): sul foglio la sintesi, nel
  // CSV il testo intero. È la stessa nota della scheda, non una copia.
  notaOspite: { etichetta: 'Nota ospite', valore: (r) => r.notaOspite, classe: 'st-nota' },
  notaOspiteIntera: { etichetta: 'Nota ospite', valore: (r) => r.notaOspiteIntera },
  trattamento: { etichetta: 'Trattamento', valore: (r) => r.trattamento },
  notePms: { etichetta: 'Note prenotazione', valore: (r) => r.notePms, classe: 'st-note' },
  pratica: { etichetta: 'Pratica', valore: (r) => String(r.pratica || '') },
};

// --- Viste -------------------------------------------------------------------
// V1: una sola vista, generica, come chiesto. I reparti si aggiungono qui.
// Foglio e CSV hanno liste separate: sono due mezzi diversi, non lo stesso
// contenuto in due formati. Sul foglio conta la leggibilità a colpo d'occhio,
// nel CSV la completezza (pratica, date separate, testi interi).
const VISTE_EXPORT = {
  generale: {
    nome: 'Vista generale',
    foglio: ['camera', 'ospite', 'inCamera', 'soggiorno', 'vip', 'allergie', 'attenzioni', 'preferenze', 'notaOspite', 'trattamento', 'notePms'],
    csv: ['camereCsv', 'ospiteCsv', 'visite', 'inCamera', 'arrivo', 'partenza', 'notti', 'vip', 'allergie', 'attenzioni', 'preferenze', 'notaOspiteIntera', 'trattamento', 'notePms', 'pratica'],
  },
};

// Fuori dall'export, di proposito: importi, tariffe ed extra. Non servono a
// nessun reparto per servire meglio un ospite e non devono girare su carta.

// --- Costruzione delle righe (pura: nessun DOM, testabile) -------------------
// "Quante volte è già stato qui": storico.n conta i soggiorni CONCLUSI, quindi
// quello in corso è l'(n+1)-esimo. Serve a chi accoglie: si tratta diversamente
// chi torna per la quarta volta da chi entra per la prima.
// Le giornate (SPA, piscina, cene per esterni) non sono soggiorni e non si
// sommano: chi ha dormito qui una volta e poi è tornato sei volte per la SPA è
// al secondo soggiorno. Ma va detto anche al reparto che lo vede spesso.
function testoVisite(storico) {
  const giornate = storico && storico.visite
    ? `${storico.visite} ${storico.visite === 1 ? 'visita' : 'visite'} in giornata`
    : '';
  if (!storico || !storico.n) return giornate || 'Prima volta in hotel';
  const mese = storico.ultima ? ` · ultima ${storico.ultima.slice(0, 7).split('-').reverse().join('/')}` : '';
  return `${storico.n + 1}ª volta${mese}${giornate ? ` · ${giornate}` : ''}`;
}

function attenzioniDi(x) {
  const s = x.snapshot || {};
  const out = [];
  if (s.indesiderato) out.push('Ospite indesiderato');
  if (s.reclami && s.reclami.aperti) {
    // Il testo del reclamo, non il numero: il reparto deve sapere cosa è successo.
    // Reparto e categoria davanti, quando ci sono: è l'informazione che permette
    // di girare il foglio a chi se ne deve occupare.
    const testi = (s.reclami.apertiDettaglio || []).map((c) => {
      const dove = [c.reparto, c.categoria].filter(Boolean).join('/');
      return `${dove ? `[${dove}] ` : ''}${accorcia(c.testo, 90)}`;
    });
    if (!testi.length) out.push(`Reclamo aperto (${s.reclami.aperti})`);
    else out.push(`Reclamo aperto: ${testi.slice(0, 2).join(' | ')}${testi.length > 2 ? ` (+${testi.length - 2})` : ''}`);
  }
  if (s.compleanno) out.push(`Compleanno ${fmtData(s.compleanno.data)}${s.compleanno.nome ? ' — ' + s.compleanno.nome : ''}`);
  if (x.statoPartenza === 'partenza') out.push('Parte oggi');
  if (x.statoPartenza === 'checkout') out.push('Check-out effettuato');
  // Sul foglio dei reparti va detto: chi legge vede una riga senza camera e
  // senza notti, e deve capire che è un esterno in giornata, non un dato
  // mancante. Per la cucina è la stessa cosa di un ospite in camera.
  if (x.statoPartenza === 'dayuse') out.push('Day use');
  return out;
}

// Le note della prenotazione sono spesso lunghissime (anche 2.000 caratteri):
// nel foglio si taglia, nel CSV resta tutto (là lo spazio non è un problema).
function accorcia(testo, max) {
  const piatto = String(testo == null ? '' : testo).replace(/\s+/g, ' ').trim();
  if (!max || piatto.length <= max) return piatto;
  const taglio = piatto.slice(0, max);
  const spazio = taglio.lastIndexOf(' ');
  return `${(spazio > 20 ? taglio.slice(0, spazio) : taglio).trim()}…`;
}

function rigaExport(x, opts = {}) {
  const s = x.snapshot || {};
  const camere = x.camere || '—';
  return {
    camere,
    // Sul foglio una camera per riga: la colonna si stringe e lo spazio va alle
    // note, che sono la parte che serve leggere davvero.
    camereRighe: camere.split(',').map((c) => c.trim()).filter(Boolean).join('\n') || '—',
    ospite: x.nominativo || '(senza nominativo)',
    visite: testoVisite(x.storico),
    inCamera: (x.ospiti || []).map((o) => o.nominativo).filter(Boolean).join(', '),
    arrivo: fmtData(x.dtarrivo),
    partenza: fmtData(x.dtpartenza),
    notti: x.notti,
    vip: s.vip ? (s.vip.descrizione || 'VIP') : '',
    // Con il nome di chi le ha: è il foglio che va in cucina, e "Glutine" da solo
    // non dice a quale commensale va preparato il piatto senza (decisione D2).
    // Una per riga, così restano leggibili anche quando sono più d'una.
    allergie: (s.intolleranze || [])
      .map((v) => (typeof v === 'string' ? { testo: v, chi: '' } : (v || {})))
      .filter((v) => String(v.testo || '').trim())
      .map((v) => (v.chi ? `${String(v.testo).trim()} — ${String(v.chi).trim()}` : String(v.testo).trim()))
      .join('\n'),
    attenzioni: attenzioniDi(x),
    preferenze: (s.preferenzeTop || []).map((p) => p.testo).join(' · '),
    notaOspite: s.notaPersonale ? s.notaPersonale.sintesi : '',
    notaOspiteIntera: s.notaPersonale ? (s.notaPersonale.testo || s.notaPersonale.sintesi) : '',
    trattamento: x.trattamento || '',
    notePms: accorcia(x.note, opts.noteMax),
    pratica: x.codpratica,
  };
}

// Ordine da reparto: per numero di camera, come il rack della reception.
function ordinaPerCamera(righe) {
  const n = (r) => {
    const primo = parseInt(String(r.camere || '').split(',')[0].trim(), 10);
    return Number.isInteger(primo) ? primo : Number.MAX_SAFE_INTEGER;
  };
  return righe.slice().sort((a, b) => n(a) - n(b) || String(a.camere).localeCompare(String(b.camere)));
}

function costruisciExport(lista, opts = {}) {
  return ordinaPerCamera((lista || []).map((x) => rigaExport(x, opts)));
}

// --- CSV ---------------------------------------------------------------------
// Separatore ';' e BOM: è ciò che apre correttamente in Excel italiano con un
// doppio clic. Con la virgola, Excel mette tutta la riga in una cella sola.
// Un valore che comincia per = + - @ (o per un tab, che Excel tratta allo stesso
// modo) viene interpretato come FORMULA appena si apre il file. Le note arrivano
// dal PMS, cioè da testo che scrive chiunque: basta una nota che inizia con "="
// perché Excel provi a eseguirla. Si antepone un apostrofo, che Excel riconosce
// come "questo è testo" e non mostra nella cella.
const INIZIO_FORMULA = /^[=+\-@\t\r]/;

function campoCsv(v) {
  let s = String(v == null ? '' : v);
  if (INIZIO_FORMULA.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(righe, colonne) {
  const testata = colonne.map((k) => campoCsv(COLONNE_EXPORT[k].etichetta)).join(';');
  const corpo = righe.map((r) => colonne.map((k) => campoCsv(COLONNE_EXPORT[k].valore(r))).join(';'));
  return `﻿${[testata, ...corpo].join('\r\n')}\r\n`;
}

function scaricaFile(nome, contenuto, tipo) {
  const blob = new Blob([contenuto], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Foglio stampabile -------------------------------------------------------
// Niente libreria PDF: il foglio si stampa dal browser, e "Salva come PDF" è una
// voce della stessa finestra di stampa. Zero dipendenze e pieno controllo su
// cosa deve saltare all'occhio.
function tabellaStampa(righe, colonne) {
  const testata = colonne.map((k) => `<th class="${COLONNE_EXPORT[k].classe || ''}">${esc(COLONNE_EXPORT[k].etichetta)}</th>`).join('');
  const corpo = righe.map((r) => {
    const celle = colonne.map((k) => {
      const c = COLONNE_EXPORT[k];
      const v = c.valore(r);
      // L'allergia non è un testo come gli altri: se c'è, si vede da lontano.
      if (k === 'allergie' && v) return `<td class="st-allergie"><b>⚠ ${esc(v)}</b></td>`;
      const sotto = c.valoreSotto ? c.valoreSotto(r) : '';
      return `<td class="${c.classe || ''}">${esc(v)}${sotto ? `<span class="st-sotto">${esc(sotto)}</span>` : ''}</td>`;
    }).join('');
    return `<tr${r.allergie ? ' class="st-riga-allergia"' : ''}>${celle}</tr>`;
  }).join('');
  return `<table class="st-tab"><thead><tr>${testata}</tr></thead><tbody>${corpo}</tbody></table>`;
}

function fogliostampabile(righe, meta) {
  const quando = new Date().toLocaleString('it-IT');
  const conAllergie = righe.filter((r) => r.allergie).length;
  return `
    <div class="st-head">
      <div>
        <div class="st-titolo">${esc(meta.titolo)}</div>
        <div class="st-sub">${esc(meta.sottotitolo)}</div>
      </div>
      <div class="st-meta">
        <div>Holiday Canne Bianche · CRM</div>
        <div>Stampato il ${esc(quando)}</div>
      </div>
    </div>
    <div class="st-riepilogo">${righe.length} ${righe.length === 1 ? 'prenotazione' : 'prenotazioni'}${conAllergie ? ` · <b class="st-allergie">${conAllergie} con allergie o intolleranze</b>` : ''}</div>
    ${righe.length ? tabellaStampa(righe, meta.colonne) : '<p>Nessun ospite per questa selezione.</p>'}
    <div class="st-piede">Documento interno. Contiene dati personali degli ospiti: non lasciarlo in aree accessibili al pubblico.</div>`;
}

// --- Finestra di export ------------------------------------------------------
const exportDati = { arrivi: null, incasa: null }; // liste già caricate dalle pagine

// Le pagine ci passano quello che hanno appena caricato: così l'export segue la
// data che l'operatore sta guardando, non "oggi" per forza.
function registraDatiExport(tipo, lista, data) {
  if (tipo !== 'arrivi' && tipo !== 'incasa') return;
  exportDati[tipo] = { lista: lista || [], data };
}

function apriExport(popolazioneIniziale) {
  const d = $('#export-dialog');
  if (!d) return;
  $$('#export-dialog [name=popolazione]').forEach((r) => { r.checked = r.value === popolazioneIniziale; });
  $('#export-msg').textContent = '';
  aggiornaAnteprimaExport();
  d.showModal();
}

function popolazioneScelta() {
  const r = $$('#export-dialog [name=popolazione]').find((x) => x.checked);
  return r ? r.value : 'arrivi';
}

function formatoScelto() {
  const r = $$('#export-dialog [name=formato]').find((x) => x.checked);
  return r ? r.value : 'foglio';
}

// Lista da esportare: se la pagina corrispondente non è mai stata aperta, la si
// chiede al server (stessi endpoint delle pagine, nessuna query nuova).
async function listaDaEsportare(popolazione) {
  if (popolazione === 'incasa') {
    if (exportDati.incasa) return exportDati.incasa;
    const { status, body } = await api('/api/incasa');
    if (status !== 200) return null;
    exportDati.incasa = { lista: body.clienti || [], data: body.data };
    return exportDati.incasa;
  }
  if (exportDati.arrivi) return exportDati.arrivi;
  const { status, body } = await api('/api/arrivi');
  if (status !== 200) return null;
  exportDati.arrivi = { lista: body.arrivi || [], data: body.data };
  return exportDati.arrivi;
}

function aggiornaAnteprimaExport() {
  const p = popolazioneScelta();
  const d = exportDati[p];
  const n = d ? d.lista.length : null;
  $('#export-anteprima').textContent = n == null
    ? 'I dati verranno letti al momento dell\'export.'
    : `${n} ${n === 1 ? 'prenotazione' : 'prenotazioni'} · ${p === 'incasa' ? 'in casa al' : 'in arrivo il'} ${fmtData(d.data)}`;
}

function metaExport(popolazione, data, formato) {
  const vista = VISTE_EXPORT.generale;
  return {
    titolo: popolazione === 'incasa' ? 'Ospiti in casa' : 'Ospiti in arrivo',
    sottotitolo: `${vista.nome} · ${popolazione === 'incasa' ? 'situazione al' : 'arrivi del'} ${fmtData(data)}`,
    colonne: formato === 'csv' ? vista.csv : vista.foglio,
    nomeFile: `${popolazione === 'incasa' ? 'in-casa' : 'arrivi'}-${data || 'oggi'}`,
  };
}

async function eseguiExport() {
  const popolazione = popolazioneScelta();
  const formato = formatoScelto();
  const btn = $('#export-conferma');
  btn.disabled = true;
  $('#export-msg').innerHTML = loaderHTML('Preparo l\'export…');
  const dati = await listaDaEsportare(popolazione);
  btn.disabled = false;
  if (!dati) { $('#export-msg').textContent = 'Non riesco a leggere i dati da esportare.'; return; }
  const meta = metaExport(popolazione, dati.data, formato);
  $('#export-msg').textContent = '';

  if (formato === 'csv') {
    const righe = costruisciExport(dati.lista); // testi interi nel CSV
    scaricaFile(`${meta.nomeFile}.csv`, toCsv(righe, meta.colonne), 'text/csv;charset=utf-8');
    $('#export-dialog').close();
    return;
  }
  const righe = costruisciExport(dati.lista, { noteMax: 180 });
  $('#stampa-box').innerHTML = fogliostampabile(righe, meta);
  document.body.classList.add('in-stampa');
  $('#export-dialog').close();
  // Il ripristino va agganciato prima di stampare: alcune stampe sono sincrone.
  const ripristina = () => { document.body.classList.remove('in-stampa'); window.removeEventListener('afterprint', ripristina); };
  window.addEventListener('afterprint', ripristina);
  window.print();
  setTimeout(ripristina, 1000); // rete di sicurezza se afterprint non arriva
}

$('#btn-export-arrivi').addEventListener('click', () => apriExport('arrivi'));
$('#btn-export-incasa').addEventListener('click', () => apriExport('incasa'));
$('#export-annulla').addEventListener('click', () => $('#export-dialog').close());
$('#export-dialog').addEventListener('change', (e) => { if (e.target.name === 'popolazione') aggiornaAnteprimaExport(); });
$('#export-form').addEventListener('submit', async (e) => { e.preventDefault(); await eseguiExport(); });
