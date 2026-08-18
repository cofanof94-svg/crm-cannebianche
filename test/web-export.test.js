const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// web/export.js è uno script da browser: per le funzioni PURE si estrae il
// sorgente e lo si valuta, come già si fa per web/app.js. Qui la rete di
// sicurezza serve soprattutto a una cosa: che le ALLERGIE non finiscano mai
// mescolate alle preferenze, e che il CSV non si spezzi su un testo con
// virgolette o punto e virgola (le note dell'hotel ne sono piene).
const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'export.js'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

function estraiDa(src, nome) {
  const inizio = src.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovata`);
  const fine = src.indexOf('\n}', inizio);
  return src.slice(inizio, fine + 2);
}
function estraiConstDa(src, nome) {
  const riga = src.split('\n').find((l) => l.startsWith(`const ${nome} =`));
  assert.ok(riga, `const ${nome} non trovata`);
  return riga;
}
// Blocco `const NOME = { ... };` su più righe (le tabelle di colonne/viste).
function estraiOggetto(src, nome) {
  const inizio = src.indexOf(`const ${nome} = {`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovato`);
  const fine = src.indexOf('\n};', inizio);
  return src.slice(inizio, fine + 3);
}

// Ambiente minimo: le funzioni dell'export usano esc e fmtData di app.js — si
// prendono quelli veri, non copie, così il test verifica il comportamento reale.
const AMBIENTE = [
  estraiConstDa(APP, 'esc'),
  estraiDa(APP, 'fmtData'),
  estraiOggetto(SRC, 'COLONNE_EXPORT'),
  estraiOggetto(SRC, 'VISTE_EXPORT'),
  estraiDa(SRC, 'testoVisite'),
  estraiDa(SRC, 'attenzioniDi'),
  estraiDa(SRC, 'accorcia'),
  estraiDa(SRC, 'rigaExport'),
  estraiDa(SRC, 'ordinaPerCamera'),
  estraiConstDa(SRC, 'daEsportare'),
  estraiDa(SRC, 'costruisciExport'),
  estraiConstDa(SRC, 'INIZIO_FORMULA'), // usata da campoCsv
  estraiDa(SRC, 'campoCsv'),
  estraiDa(SRC, 'toCsv'),
  estraiDa(SRC, 'tabellaStampa'),
].join('\n');

// eslint-disable-next-line no-new-func
const E = new Function(`${AMBIENTE}
  return { COLONNE_EXPORT, VISTE_EXPORT, testoVisite, attenzioniDi, accorcia, rigaExport, ordinaPerCamera, daEsportare, costruisciExport, campoCsv, toCsv, tabellaStampa };`)();

const arrivo = {
  codpratica: 70104,
  nominativo: 'PAGLIUSO ROBERT RALPH',
  camere: '109, 218',
  storico: { n: 3, ultima: '2025-08-08' },
  dtarrivo: '2026-08-10',
  dtpartenza: '2026-08-14',
  notti: 4,
  trattamento: 'B&B',
  note: 'Camera alta, lontano ascensore.',
  ospiti: [{ nominativo: 'PAGLIUSO ROSEMARIE' }, { nominativo: 'PAGLIUSO NATALIA' }],
  snapshot: {
    vip: { descrizione: 'BOLLICINE + FRUTTA FRESCA' },
    // Ogni allergia con il nome di chi la ha (decisione del 12/08, D2).
    intolleranze: [
      { testo: 'Arachidi', chi: 'PAGLIUSO ROBERT RALPH' },
      { testo: 'Lattosio', chi: 'PAGLIUSO ROSEMARIE' },
    ],
    preferenzeTop: [{ testo: 'Coca-Cola Zero' }, { testo: 'Cuscino rigido' }],
    reclami: { aperti: 1, totali: 2, apertiDettaglio: [{ testo: 'Ritardo nella pulizia camera', reparto: 'Rooms', categoria: 'Pulizia' }] },
    compleanni: [{ data: '2026-08-12', nome: 'PAGLIUSO NATALIA' }],
    indesiderato: false,
    notaPersonale: { sintesi: 'CEO settore Fashion', testo: 'CEO settore Fashion. Cena presto, mai dopo le 21.', troncata: true },
  },
};

test('export: la preferenza personale porta il nome, quella di nucleo no', () => {
  // Il foglio va in cucina o in camera: "caffè decaffeinato" senza dire per chi,
  // su una prenotazione da quattro persone, non si può servire. Stesso criterio
  // delle allergie. Le preferenze di nucleo sono di tutti e restano nude.
  const r = E.rigaExport({
    ...arrivo,
    snapshot: {
      ...arrivo.snapshot,
      preferenzeTop: [
        { testo: 'Coca-Cola Zero', reparto: 'F&B', ambito: 'nucleo', chi: null },
        { testo: 'Caffè decaffeinato', reparto: 'F&B', ambito: 'personale', chi: 'PAGLIUSO ROSEMARIE' },
      ],
    },
  });
  assert.strictEqual(r.preferenze, 'Coca-Cola Zero · PAGLIUSO ROSEMARIE: Caffè decaffeinato');
});

test('rigaExport: allergie e preferenze restano in campi DIVERSI', () => {
  const r = E.rigaExport(arrivo);
  // Una per riga: sul foglio che va in cucina un elenco su una riga sola non si legge.
  assert.strictEqual(r.allergie, 'Arachidi — PAGLIUSO ROBERT RALPH\nLattosio — PAGLIUSO ROSEMARIE');
  assert.strictEqual(r.preferenze, 'Coca-Cola Zero · Cuscino rigido');
  assert.doesNotMatch(r.preferenze, /Arachidi/); // mai mescolate
  assert.doesNotMatch(r.allergie, /Coca/);
});

test('rigaExport: dati operativi sì, dati economici no', () => {
  const r = E.rigaExport({ ...arrivo, importo: 4200, extra: 380, tariffa: 'DIRETTO' });
  assert.strictEqual(r.camere, '109, 218');
  assert.strictEqual(r.arrivo, '10/08/2026');
  assert.strictEqual(r.vip, 'BOLLICINE + FRUTTA FRESCA');
  assert.strictEqual(r.inCamera, 'PAGLIUSO ROSEMARIE, PAGLIUSO NATALIA');
  assert.strictEqual(r.trattamento, 'B&B');
  // niente importi, extra o tariffa nel foglio che gira per i reparti
  assert.strictEqual(JSON.stringify(r).includes('4200'), false);
  assert.strictEqual(JSON.stringify(r).includes('DIRETTO'), false);
});

test('attenzioniDi: del reclamo si legge il TESTO e il reparto, non il numero', () => {
  const a = E.attenzioniDi(arrivo);
  assert.ok(a.some((x) => /Reclamo aperto: \[Rooms\/Pulizia\] Ritardo nella pulizia camera/.test(x)));
  assert.ok(a.some((x) => /Compleanno 12\/08\/2026 PAGLIUSO NATALIA/.test(x)));
  const b = E.attenzioniDi({ snapshot: { indesiderato: true, reclami: { aperti: 0 } }, statoPartenza: 'partenza' });
  assert.deepStrictEqual(b, ['Ospite indesiderato', 'Parte oggi']);
  assert.deepStrictEqual(E.attenzioniDi({}), []); // nessun allarme inventato
});

test('attenzioniDi: più reclami aperti → i primi due, poi il conteggio', () => {
  const tre = E.attenzioniDi({ snapshot: { reclami: { aperti: 3, totali: 3, apertiDettaglio: [
    { testo: 'Rumore', reparto: 'Rooms', categoria: 'Rumore' },
    { testo: 'Conto extra', reparto: 'F&B', categoria: 'Conto' },
    { testo: 'Wi-Fi', reparto: null, categoria: null }, // vecchio, non classificato
  ] } } });
  assert.strictEqual(tre[0], 'Reclamo aperto: [Rooms/Rumore] Rumore | [F&B/Conto] Conto extra (+1)');
  // un reclamo non classificato non deve mostrare parentesi vuote
  const vecchio = E.attenzioniDi({ snapshot: { reclami: { aperti: 1, totali: 1, apertiDettaglio: [{ testo: 'Wi-Fi assente', reparto: null, categoria: null }] } } });
  assert.strictEqual(vecchio[0], 'Reclamo aperto: Wi-Fi assente');
  // Aperti ma senza testo (dato incompleto): si ripiega sul numero, non si tace.
  const senzaTesto = E.attenzioniDi({ snapshot: { reclami: { aperti: 2, totali: 2 } } });
  assert.strictEqual(senzaTesto[0], 'Reclamo aperto (2)');
});

test('testoVisite: di ritorno con numero, o prima volta', () => {
  // storico.n conta i soggiorni CONCLUSI: quello in corso è l'(n+1)-esimo.
  assert.strictEqual(E.testoVisite({ n: 3, ultima: '2025-08-08' }), '4ª volta · ultima 08/2025');
  assert.strictEqual(E.testoVisite({ n: 1, ultima: null }), '2ª volta');
  assert.strictEqual(E.testoVisite({ n: 0 }), 'Prima volta in hotel');
  assert.strictEqual(E.testoVisite(null), 'Prima volta in hotel');
});

test('foglio: camere una per riga, e le seconde righe sotto ospite e soggiorno', () => {
  const r = E.rigaExport(arrivo);
  assert.strictEqual(E.COLONNE_EXPORT.camera.valore(r), '109\n218');
  assert.strictEqual(E.COLONNE_EXPORT.ospite.valore(r), 'PAGLIUSO ROBERT RALPH');
  assert.strictEqual(E.COLONNE_EXPORT.ospite.valoreSotto(r), '4ª volta · ultima 08/2025');
  assert.strictEqual(E.COLONNE_EXPORT.soggiorno.valore(r), '10/08/2026 → 14/08/2026');
  assert.strictEqual(E.COLONNE_EXPORT.soggiorno.valoreSotto(r), '4 notti');
  assert.strictEqual(E.COLONNE_EXPORT.soggiorno.valoreSotto(E.rigaExport({ ...arrivo, notti: 1 })), '1 notte');
  // nel CSV le stesse informazioni restano su una riga e in campi separati
  assert.strictEqual(E.COLONNE_EXPORT.camereCsv.valore(r), '109, 218');
  assert.strictEqual(E.COLONNE_EXPORT.visite.valore(r), '4ª volta · ultima 08/2025');
});

test('tabellaStampa: la seconda riga esce come span attenuato, con escape', () => {
  const html = E.tabellaStampa(E.costruisciExport([arrivo]), ['ospite', 'soggiorno']);
  assert.match(html, /<span class="st-sotto">4ª volta · ultima 08\/2025<\/span>/);
  assert.match(html, /<span class="st-sotto">4 notti<\/span>/);
  const cattivo = E.tabellaStampa(E.costruisciExport([{ ...arrivo, storico: null, nominativo: 'x' }]), ['ospite']);
  assert.match(cattivo, /Prima volta in hotel/);
});

test('accorcia: taglia a parola intera, lascia intatto ciò che ci sta', () => {
  assert.strictEqual(E.accorcia('Camera alta.', 180), 'Camera alta.');
  assert.strictEqual(E.accorcia(null, 180), '');
  const lungo = E.accorcia('a'.repeat(30) + ' ' + 'b'.repeat(30), 40);
  assert.ok(lungo.endsWith('…'));
  assert.ok(lungo.length <= 41);
  assert.strictEqual(E.accorcia('riga uno\nriga due', 180), 'riga uno riga due'); // a capo appiattiti
});

test('ordinaPerCamera: ordine da rack, non alfabetico', () => {
  const r = E.ordinaPerCamera([{ camere: '218' }, { camere: '109' }, { camere: '—' }, { camere: '9' }]);
  assert.deepStrictEqual(r.map((x) => x.camere), ['9', '109', '218', '—']);
});

test('foglio reparti: se festeggiano in due si leggono entrambe le date', () => {
  // Il foglio va in cucina e in sala: sapere che sono due cambia quante torte
  // si preparano. Sui dati veri capita in 41 prenotazioni su 1.482.
  const due = E.attenzioniDi({ snapshot: { compleanni: [
    { data: '2026-07-03', nome: 'KELLY JENNIFER' },
    { data: '2026-07-08', nome: 'KELLY-DRAKE ROWYNN' },
  ] } });
  assert.strictEqual(due[0], 'Compleanni 03/07/2026 KELLY JENNIFER · 08/07/2026 KELLY-DRAKE ROWYNN');
  const uno = E.attenzioniDi({ snapshot: { compleanni: [{ data: '2026-07-03', nome: 'KELLY JENNIFER' }] } });
  assert.strictEqual(uno[0], 'Compleanno 03/07/2026 KELLY JENNIFER');
  assert.deepStrictEqual(E.attenzioniDi({ snapshot: { compleanni: [] } }), []);
});

test('foglio reparti: stessa data, una volta sola — come in card', () => {
  // Caso vero (pratica 47381): nonna e nipote, entrambe il 3 luglio. Sul foglio
  // la data ripetuta due volte di fila sembrerebbe un errore di stampa.
  const a = E.attenzioniDi({ snapshot: { compleanni: [
    { data: '2024-07-03', nome: 'KELLY JENNIFER' },
    { data: '2024-07-03', nome: 'KELLY-DRAKE ROWYNN' },
  ] } });
  assert.strictEqual(a[0], 'Compleanni 03/07/2024 KELLY JENNIFER, KELLY-DRAKE ROWYNN');
});

// --- Chi non va sul foglio dei reparti ----------------------------------------

test('chi ha già fatto il check-out non finisce nel foglio', () => {
  // Alla reception serve ancora (conti da chiudere, pratiche da ritrovare), ma
  // per cucina, housekeeping e SPA è una persona che non c'è più: un nome in
  // più da leggere per poi scoprire che non c'è niente da fare.
  const righe = E.costruisciExport([
    { ...arrivo, camere: '104', statoPartenza: 'incasa' },
    { ...arrivo, camere: '106', statoPartenza: 'checkout' },
    { ...arrivo, camere: '108', statoPartenza: 'partenza' },
    { ...arrivo, camere: '', statoPartenza: 'dayuse' },
  ]);
  assert.deepStrictEqual(righe.map((r) => r.camere), ['104', '108', 'DAY USE']);
});

test('chi parte oggi ma è ancora in camera resta sul foglio', () => {
  // Fino al check-out va servito: toglierlo vorrebbe dire non preparargli la
  // colazione la mattina della partenza.
  const righe = E.costruisciExport([{ ...arrivo, camere: '108', statoPartenza: 'partenza' }]);
  assert.strictEqual(righe.length, 1);
  assert.ok(righe[0].attenzioni.includes('Parte oggi'));
});

test("negli Arrivi non c'è stato di partenza: non si esclude nessuno", () => {
  // Le righe degli arrivi non portano statoPartenza (è un concetto di "In
  // casa"): il filtro non deve svuotare il foglio degli arrivi.
  const righe = E.costruisciExport([{ ...arrivo, camere: '109' }, { ...arrivo, camere: '110' }]);
  assert.strictEqual(righe.length, 2);
});

test('daEsportare non tocca la lista che riceve', () => {
  const orig = [{ statoPartenza: 'checkout' }, { statoPartenza: 'incasa' }];
  E.daEsportare(orig);
  assert.strictEqual(orig.length, 2);
  assert.deepStrictEqual(E.daEsportare(null), []);
});

// --- Ospiti del giorno (day use) ---------------------------------------------
// La modalità di soggiorno sta nella colonna Camera. La colonna Attenzioni resta
// per ciò che richiede davvero attenzione: allergie, reclami, indesiderati.

const giornata = {
  nominativo: 'MENGA DANIELA',
  camere: '',
  statoPartenza: 'dayuse',
  dtarrivo: '2026-08-13',
  dtpartenza: '2026-08-13',
  notti: 0,
  snapshot: {},
};

test('day use: si legge nella colonna Camera, non fra le attenzioni', () => {
  const r = E.rigaExport(giornata);
  assert.strictEqual(r.camere, 'DAY USE');
  assert.strictEqual(E.COLONNE_EXPORT.camera.valore(r), 'DAY USE');
  assert.strictEqual(E.COLONNE_EXPORT.camereCsv.valore(r), 'DAY USE'); // filtrabile in Excel
  assert.deepStrictEqual(r.attenzioni, []);
  assert.deepStrictEqual(E.attenzioniDi(giornata), []);
});

test('day use: se una camera c\'è davvero, non si perde', () => {
  // Uso diurno con camera assegnata: il numero serve a chi deve pulirla.
  const r = E.rigaExport({ ...giornata, camere: '304' });
  assert.strictEqual(r.camere, 'DAY USE · 304');
  assert.strictEqual(E.COLONNE_EXPORT.camera.valore(r), 'DAY USE\n304');
});

test('day use: un ospite in camera continua a mostrare solo il numero', () => {
  const r = E.rigaExport(arrivo);
  assert.strictEqual(r.camere, '109, 218');
  assert.doesNotMatch(JSON.stringify(r), /DAY USE/);
});

test('day use: sempre in coda alla lista, dopo tutte le camere', () => {
  const righe = E.costruisciExport([
    giornata,
    { ...arrivo, camere: '218' },
    { ...arrivo, camere: '' }, // prenotazione senza camera assegnata: non è day use
    { ...giornata, nominativo: 'ALTRO ESTERNO' },
    { ...arrivo, camere: '109' },
  ]);
  assert.deepStrictEqual(righe.map((r) => r.camere), ['109', '218', '—', 'DAY USE', 'DAY USE']);
});

test('tabellaStampa: il day use marca la riga ma non la colora come un allarme', () => {
  const html = E.tabellaStampa(E.costruisciExport([giornata, arrivo]), ['camera', 'allergie']);
  assert.match(html, /<tr class="st-riga-dayuse">/);
  assert.match(html, /<td class="st-camera">DAY USE<\/td>/);
  // La riga del day use non deve prendere l'evidenziazione delle allergie.
  assert.doesNotMatch(html, /st-riga-allergia st-riga-dayuse/);
});

test('toCsv: intestazioni, separatore ; e BOM per Excel', () => {
  const righe = E.costruisciExport([arrivo]);
  const csv = E.toCsv(righe, ['camereCsv', 'ospiteCsv', 'allergie', 'preferenze']);
  const linee = csv.split('\r\n');
  assert.ok(csv.startsWith('﻿'), 'senza BOM Excel sbaglia gli accenti');
  assert.strictEqual(linee[0], '﻿Camera;Ospite;Allergie;Preferenze');
  // Con il ';' come separatore la virgola è un carattere qualunque: niente
  // virgolette inutili attorno a "Arachidi, Lattosio". E niente a capo: quelli
  // stanno solo sul foglio.
  // Le allergie ora contengono un a capo: il campo viene quotato, e l'a capo
  // interno non spezza la riga del CSV, che si chiude con \r\n.
  assert.strictEqual(linee[1], '109, 218;PAGLIUSO ROBERT RALPH;"Arachidi — PAGLIUSO ROBERT RALPH\nLattosio — PAGLIUSO ROSEMARIE";Coca-Cola Zero · Cuscino rigido');
});

test('CSV: un valore che inizia per = non diventa una formula in Excel', () => {
  // Le note arrivano dal PMS, cioè da testo che scrive chiunque. Excel valuta come
  // formula qualunque cella che inizi per = + - @: basta una nota scritta così.
  // L'apostrofo davanti dice a Excel "questo è testo" e nella cella non si vede.
  for (const cattivo of ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '=cmd|\' /C calc\'!A0']) {
    const out = E.campoCsv(cattivo);
    assert.ok(out.startsWith("'"), `non neutralizzato: ${cattivo}`);
    assert.ok(out.includes(cattivo.replace(/"/g, '""')) || out.includes(cattivo), 'il testo originale si perde');
  }
  // Il testo normale non viene toccato: nessun apostrofo di troppo nel foglio.
  for (const buono of ['Celiachia', 'Camera 101', '2 notti', 'Sig.ra Rossi']) {
    assert.strictEqual(E.campoCsv(buono), buono);
  }
  // Un valore pericoloso che contiene anche il separatore resta comunque quotato.
  assert.strictEqual(E.campoCsv('=A1;B2'), '"\'=A1;B2"');
});

test('toCsv: virgolette e punto e virgola nel testo non spezzano la riga', () => {
  const riga = E.rigaExport({ ...arrivo, note: 'Dice: "niente pesce"; allergica', snapshot: { ...arrivo.snapshot } });
  const csv = E.toCsv([riga], ['notePms']);
  const corpo = csv.split('\r\n')[1];
  assert.strictEqual(corpo, '"Dice: ""niente pesce""; allergica"');
  assert.strictEqual(corpo.split(';').length > 1, true); // il ; sta dentro le virgolette
});

test('tabellaStampa: la riga con allergie è marcata e il valore evidenziato', () => {
  const righe = E.costruisciExport([arrivo, { ...arrivo, camere: '300', snapshot: { intolleranze: [] } }]);
  const html = E.tabellaStampa(righe, ['camera', 'allergie']);
  assert.match(html, /<tr class="st-riga-allergia">/);
  assert.match(html, /<td class="st-allergie"><b>⚠ Arachidi — PAGLIUSO ROBERT RALPH\nLattosio — PAGLIUSO ROSEMARIE<\/b><\/td>/);
  assert.strictEqual((html.match(/st-riga-allergia/g) || []).length, 1); // solo chi ne ha
});

test('tabellaStampa: il testo dell\'ospite passa per l\'escape', () => {
  const righe = E.costruisciExport([{ ...arrivo, nominativo: '<img src=x onerror=alert(1)>', snapshot: {} }]);
  const html = E.tabellaStampa(righe, ['ospite']);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('vista generale: colonne attese, e nessun campo economico', () => {
  const { foglio, csv } = E.VISTE_EXPORT.generale;
  ['camera', 'ospite', 'soggiorno', 'vip', 'allergie', 'attenzioni', 'preferenze', 'notaOspite'].forEach((k) => {
    assert.ok(foglio.includes(k), `manca la colonna ${k} sul foglio`);
  });
  ['camereCsv', 'ospiteCsv', 'visite', 'arrivo', 'partenza', 'notti', 'allergie', 'pratica'].forEach((k) => {
    assert.ok(csv.includes(k), `manca la colonna ${k} nel CSV`);
  });
  // Nel CSV niente colonne con a capo dentro: là si filtra e si ordina.
  csv.forEach((k) => assert.ok(!E.COLONNE_EXPORT[k].valoreSotto, `${k} non va bene nel CSV`));
  [foglio, csv].forEach((c) => {
    assert.ok(c.indexOf('allergie') < c.indexOf('preferenze'), 'le allergie vengono prima delle preferenze');
    ['importo', 'extra', 'tariffa'].forEach((k) => assert.ok(!c.includes(k), `${k} non deve uscire`));
    c.forEach((k) => assert.ok(E.COLONNE_EXPORT[k], `colonna ${k} non definita`));
  });
  // La pratica serve a ritrovare la prenotazione nel gestionale: utile in Excel,
  // rumore su un foglio appeso in reparto.
  assert.ok(!foglio.includes('pratica'));
});

test('nota personale: sintesi sul foglio, testo intero nel CSV', () => {
  const r = E.rigaExport(arrivo);
  assert.strictEqual(E.COLONNE_EXPORT.notaOspite.valore(r), 'CEO settore Fashion');
  assert.match(E.COLONNE_EXPORT.notaOspiteIntera.valore(r), /Cena presto/);
  // resta separata dalle preferenze: sono due cose diverse
  assert.doesNotMatch(r.preferenze, /Fashion/);
  const senza = E.rigaExport({ ...arrivo, snapshot: {} });
  assert.strictEqual(senza.notaOspite, '');
  assert.strictEqual(senza.notaOspiteIntera, '');
});

test('colonna soggiorno: senza notti niente seconda riga', () => {
  const senzaNotti = E.rigaExport({ ...arrivo, notti: null });
  assert.strictEqual(E.COLONNE_EXPORT.soggiorno.valore(senzaNotti), '10/08/2026 → 14/08/2026');
  assert.strictEqual(E.COLONNE_EXPORT.soggiorno.valoreSotto(senzaNotti), '');
});

test('foglio reparti: i day use non si sommano ai soggiorni', () => {
  // Un cliente della SPA che ha dormito qui una volta e' al secondo soggiorno,
  // non all'ottavo: le due cose vanno dette separate anche sul foglio.
  // "day use" e non "in giornata": e' il nome usato nelle card e nella colonna
  // Camera dello stesso foglio.
  assert.strictEqual(E.testoVisite({ n: 1, ultima: '2025-08-10', visite: 6 }),
    '2ª volta · ultima 08/2025 · 6 day use');
  assert.strictEqual(E.testoVisite({ n: 0, visite: 3 }), '3 day use');
  assert.strictEqual(E.testoVisite({ n: 0, visite: 1 }), '1 day use');
  assert.strictEqual(E.testoVisite(null), 'Prima volta in hotel');
  assert.strictEqual(E.testoVisite({ n: 2, ultima: '2024-06-30' }), '3ª volta · ultima 06/2024');
});
