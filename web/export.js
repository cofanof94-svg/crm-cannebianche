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
  camera: { etichetta: 'Camera', valore: (r) => r.camere, classe: 'st-camera' },
  ospite: { etichetta: 'Ospite', valore: (r) => r.ospite, classe: 'st-ospite' },
  inCamera: { etichetta: 'In camera', valore: (r) => r.inCamera },
  arrivo: { etichetta: 'Arrivo', valore: (r) => r.arrivo },
  partenza: { etichetta: 'Partenza', valore: (r) => r.partenza },
  notti: { etichetta: 'Notti', valore: (r) => (r.notti == null ? '' : String(r.notti)) },
  vip: { etichetta: 'VIP', valore: (r) => r.vip },
  allergie: { etichetta: 'Allergie', valore: (r) => r.allergie, classe: 'st-allergie' },
  attenzioni: { etichetta: 'Attenzioni', valore: (r) => r.attenzioni.join(' · '), classe: 'st-attenzioni' },
  preferenze: { etichetta: 'Preferenze', valore: (r) => r.preferenze },
  trattamento: { etichetta: 'Trattamento', valore: (r) => r.trattamento },
  notePms: { etichetta: 'Note prenotazione', valore: (r) => r.notePms, classe: 'st-note' },
  pratica: { etichetta: 'Pratica', valore: (r) => String(r.pratica || '') },
};

// --- Viste -------------------------------------------------------------------
// V1: una sola vista, generica, come chiesto. I reparti si aggiungono qui.
const VISTE_EXPORT = {
  generale: {
    nome: 'Vista generale',
    colonne: ['camera', 'ospite', 'inCamera', 'arrivo', 'partenza', 'notti', 'vip', 'allergie', 'attenzioni', 'preferenze', 'trattamento', 'notePms'],
    // Il numero di pratica serve a ritrovare la prenotazione nel gestionale: utile
    // nel foglio di calcolo, rumore inutile su un foglio da appendere in reparto.
    colonneCsv: ['pratica'],
  },
};

// Fuori dall'export, di proposito: importi, tariffe ed extra. Non servono a
// nessun reparto per servire meglio un ospite e non devono girare su carta.

// --- Costruzione delle righe (pura: nessun DOM, testabile) -------------------
function attenzioniDi(x) {
  const s = x.snapshot || {};
  const out = [];
  if (s.indesiderato) out.push('Ospite indesiderato');
  if (s.reclami && s.reclami.aperti) out.push(`Reclamo aperto (${s.reclami.aperti})`);
  if (s.compleanno) out.push(`Compleanno ${fmtData(s.compleanno.data)}${s.compleanno.nome ? ' — ' + s.compleanno.nome : ''}`);
  if (x.statoPartenza === 'partenza') out.push('Parte oggi');
  if (x.statoPartenza === 'checkout') out.push('Check-out effettuato');
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
  return {
    camere: x.camere || '—',
    ospite: x.nominativo || '(senza nominativo)',
    inCamera: (x.ospiti || []).map((o) => o.nominativo).filter(Boolean).join(', '),
    arrivo: fmtData(x.dtarrivo),
    partenza: fmtData(x.dtpartenza),
    notti: x.notti,
    vip: s.vip ? (s.vip.descrizione || 'VIP') : '',
    allergie: (s.intolleranze || []).join(', '),
    attenzioni: attenzioniDi(x),
    preferenze: (s.preferenzeTop || []).map((p) => p.testo).join(' · '),
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
function campoCsv(v) {
  const s = String(v == null ? '' : v);
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
      return `<td class="${c.classe || ''}">${esc(v)}</td>`;
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

function metaExport(popolazione, data) {
  const vista = VISTE_EXPORT.generale;
  return {
    titolo: popolazione === 'incasa' ? 'Ospiti in casa' : 'Ospiti in arrivo',
    sottotitolo: `${vista.nome} · ${popolazione === 'incasa' ? 'situazione al' : 'arrivi del'} ${fmtData(data)}`,
    colonne: vista.colonne,
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
  const meta = metaExport(popolazione, dati.data);
  $('#export-msg').textContent = '';

  if (formato === 'csv') {
    const colonne = [...meta.colonne, ...VISTE_EXPORT.generale.colonneCsv];
    const righe = costruisciExport(dati.lista); // note intere nel CSV
    scaricaFile(`${meta.nomeFile}.csv`, toCsv(righe, colonne), 'text/csv;charset=utf-8');
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
