const { test } = require('node:test');
const assert = require('node:assert');
const { getArriviByData, getInCasaByData, getRiepilogoGiorno } = require('../src/pms/prenotazioni');

// Mock SQL-aware: separa la query arrivi/incasa dalle query dell'importo pianificato
// (TipoPre / PianificazioneSogg / fallback).
function fakePms({ righe = [], tipopre = [], pian = [] } = {}) {
  return {
    calls: [],
    async query(text, params) {
      this.calls.push({ text, params });
      if (/FROM TipoPre WHERE codpratica IN/.test(text)) return tipopre;
      if (/FROM PianificazioneSogg/.test(text)) return pian;
      if (/FROM Prenota p WHERE p\.codpratica IN/.test(text)) return []; // fallback Alberg
      return righe; // query arrivi/incasa/riepilogo
    },
  };
}

test('getArriviByData mappa le righe e calcola l\'importo pianificato (base × notti)', async () => {
  const pms = fakePms({
    righe: [{ codpratica: 60176, codCliente: 47186, cognome: 'HILTON', nome: '', camere: '211', tipologie: 'SUP',
      paxAdulti: 2, paxBambini: 0, dtpartenza: '2026-07-11', notti: 5, oraArrivo: '__.__', inCasa: 'N',
      trattamento: 'Mezza Pensione', note: '  ', extra: 150 }],
    tipopre: [{ codpratica: 60176, id: 1, base: 240, di: '2026-07-06', df: '2026-07-11', qta: 1 }],
    pian: [],
  });
  const [a] = await getArriviByData(pms, '2026-07-06');
  assert.strictEqual(a.codpratica, 60176);
  assert.strictEqual(a.codCliente, 47186);
  assert.strictEqual(a.nominativo, 'HILTON');
  assert.strictEqual(a.tipologie, 'SUP');
  assert.strictEqual(a.oraArrivo, null);
  assert.strictEqual(a.inCasa, false);
  assert.strictEqual(a.note, null);
  assert.strictEqual(a.importo, 1200);   // 240 × 5 notti
  assert.strictEqual(a.extra, 150);
});

test('getArriviByData: la pianificazione di soggiorno sovrascrive la tariffa base', async () => {
  const pms = fakePms({
    righe: [{ codpratica: 2, cognome: 'ROSSI', nome: 'MARIO', camere: '201', dtpartenza: '2026-07-10', notti: 4, inCasa: 'N', trattamento: 'BB' }],
    tipopre: [{ codpratica: 2, id: 1, base: 500, di: '2026-07-06', df: '2026-07-10', qta: 1 }],
    pian: [{ codpratica: 2, id: 1, GG: 2, impoEur: 600 }], // dalla notte 2 → 600
  });
  const [a] = await getArriviByData(pms, '2026-07-06');
  assert.strictEqual(a.importo, 2300); // 500 (notte 1) + 600 × 3 (notti 2-4)
});

test('getArriviByData: nominativo assente -> null', async () => {
  const pms = fakePms({ righe: [{ codpratica: 1, cognome: '', nome: '', camere: '202', dtpartenza: '2026-07-10', notti: 4, oraArrivo: '', inCasa: 'S', note: null }] });
  const [a] = await getArriviByData(pms, '2026-07-06');
  assert.strictEqual(a.nominativo, null);
  assert.strictEqual(a.inCasa, true);
});

test('getInCasaByData mappa le righe (con dtarrivo) e importo pianificato', async () => {
  const pms = fakePms({
    righe: [{ codpratica: 5, cognome: 'VERDI', nome: 'LUIGI', camere: '104', dtarrivo: '2026-04-20', dtpartenza: '2026-04-25', notti: 5,
      oraArrivo: '', inCasa: 'S', statoPartenza: 'incasa', trattamento: 'BB', tariffa: 'X', extra: 0, note: null }],
    tipopre: [{ codpratica: 5, id: 1, base: 100, di: '2026-04-20', df: '2026-04-25', qta: 1 }],
  });
  const [c] = await getInCasaByData(pms, '2026-04-22');
  assert.strictEqual(c.nominativo, 'VERDI LUIGI');
  assert.strictEqual(c.dtarrivo, '2026-04-20');
  assert.strictEqual(c.statoPartenza, 'incasa');
  assert.strictEqual(c.importo, 500); // 100 × 5
});

test('getRiepilogoGiorno restituisce i tre conteggi', async () => {
  const pms = fakePms({ righe: [{ arrivi: 8, partenze: 3, presenti: 21 }] });
  const r = await getRiepilogoGiorno(pms, '2026-07-06');
  assert.deepStrictEqual(r, { arrivi: 8, partenze: 3, presenti: 21 });
});

test('getRiepilogoGiorno: nessuna riga -> zeri', async () => {
  const pms = fakePms({ righe: [] });
  const r = await getRiepilogoGiorno(pms, '2026-07-06');
  assert.deepStrictEqual(r, { arrivi: 0, partenze: 0, presenti: 0 });
});

// Il check-out di una prenotazione si decide sulle righe di Alberg, che sono una
// per OCCUPANTE. La domanda "questa prenotazione e' uscita?" ha una sola risposta
// giusta (decisione di Mik del 13/08/2026): SI' solo se sono chiuse tutte le
// righe. Il test guarda il SQL perche' e' li' che vive la regola: la vecchia
// versione usava SELECT TOP 1 senza ORDER BY e su una prenotazione con righe
// discordi la risposta la sceglieva il piano di esecuzione del database.
test('lo stato di uscita non dipende da quale riga del conto risponde', async () => {
  const pms = fakePms({ righe: [] });
  await getInCasaByData(pms, '2026-08-13');
  const sql = pms.calls[0].text;

  assert.doesNotMatch(sql, /TOP 1\s+al\.flgpar/i, 'la riga non si sceglie a caso');
  // Uscita = esistono righe E non ne esiste nessuna ancora aperta.
  assert.match(sql, /EXISTS \(SELECT 1 FROM Alberg al WHERE al\.codpratica = p\.codpratica\)/i);
  assert.match(sql, /NOT EXISTS[\s\S]*NOT IN \('O', 'D'\)/i);
});

test('una prenotazione senza righe di conto non risulta uscita', async () => {
  const pms = fakePms({ righe: [] });
  await getInCasaByData(pms, '2026-08-13');
  // Senza il controllo di esistenza, "nessuna riga aperta" sarebbe vero anche
  // quando di righe non ce n'e' nessuna, e la prenotazione sparirebbe in fondo
  // alla lista senza che nessuno abbia fatto il check-out.
  const sql = pms.calls[0].text;
  const posEsiste = sql.search(/WHEN EXISTS \(SELECT 1 FROM Alberg/i);
  const posNonEsiste = sql.search(/AND NOT EXISTS \(SELECT 1 FROM Alberg/i);
  assert.ok(posEsiste > -1 && posNonEsiste > posEsiste, 'le due condizioni vanno insieme, in questo ordine');
});

// Gli ospiti del giorno entrano nella lista "In casa" ma non negli Arrivi: il
// gestionale li marca 'P' (partiti) fin dalla prenotazione perche' non
// pernottano, quindi la vecchia condizione flgincasa='S' li escludeva tutti.
test('la lista in casa comprende gli ospiti del giorno, non solo chi ha fatto check-in', async () => {
  const pms = fakePms({ righe: [] });
  await getInCasaByData(pms, '2026-08-14');
  const sql = pms.calls[0].text;

  assert.match(sql, /CAST\(p\.dtarrivo AS date\) = CAST\(p\.dtpartenza AS date\) THEN 'dayuse'/i);
  // La condizione sul check-in non e' piu' l'unica via d'ingresso.
  assert.doesNotMatch(sql, /WHERE p\.DataEliminazione IS NULL AND p\.flgincasa = 'S'/i);
  assert.match(sql, /p\.flgincasa = 'S'\s*\n\s*OR \(/i);
});

test('una pratica di un giorno di chi e\' gia\' in albergo non produce una seconda card', async () => {
  const pms = fakePms({ righe: [] });
  await getInCasaByData(pms, '2026-08-14');
  // Sono scritture contabili (l'extra addebitato a parte): senza questa
  // esclusione lo stesso ospite comparirebbe due volte nella stessa lista.
  assert.match(pms.calls[0].text, /NOT EXISTS \(\s*SELECT 1 FROM Prenota p2[\s\S]*p2\.codclinterm = p\.codclinterm/i);
  // "Gia' in albergo" deve voler dire check-in fatto. I voucher regalo sono
  // registrati come prenotazioni lunghe un anno: senza questa condizione
  // coprirebbero qualunque data e cancellerebbero l'ospite dalla lista.
  // Successo davvero il 13/08/2026 con la pratica 59349 (20/12/25 -> 20/12/26).
  assert.match(pms.calls[0].text, /SELECT 1 FROM Prenota p2[\s\S]{0,200}p2\.flgincasa = 'S'/i);
});

test('gli arrivi restano solo di chi prende una camera', async () => {
  const pms = fakePms({ righe: [] });
  await getArriviByData(pms, '2026-08-14');
  // La pagina Arrivi prepara camera, orario e check-in: un ospite del giorno
  // non ne ha nessuno, e sommarlo falserebbe il riquadro "Arrivi oggi".
  assert.doesNotMatch(pms.calls[0].text, /dayuse/i);
});
