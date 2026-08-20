const { test } = require('node:test');
const assert = require('node:assert');
const { aggregaCumulativi } = require('../src/stats');

// Un day use non è un soggiorno, ma i suoi soldi sono stati incassati.
// Prima del 18/08/2026 la scheda diceva "5 soggiorni" mentre il badge in card
// diceva "4ª volta": due risposte diverse sullo stesso ospite.

const sogg = (dtarrivo, dtpartenza, notti, arrangiamento, extra) => ({ dtarrivo, dtpartenza, notti, arrangiamento, extra });

test('il day use non conta fra i soggiorni, ma i suoi soldi sì', () => {
  const s = aggregaCumulativi([
    sogg('2026-08-17', '2026-08-24', 7, 2210, 410),
    sogg('2026-08-18', '2026-08-18', 0, 0, 90),   // day use: 90 € veri
    sogg('2025-08-02', '2025-08-09', 7, 2240, 380),
  ]);
  assert.strictEqual(s.nSoggiorni, 2, 'due soggiorni, non tre');
  assert.strictEqual(s.nDayUse, 1);
  assert.strictEqual(s.ltv, 5330, 'i 90 € del day use restano nel valore storico');
  assert.strictEqual(s.nottiTotali, 14);
});

test('le medie si dividono per i soggiorni veri', () => {
  const s = aggregaCumulativi([
    sogg('2026-08-17', '2026-08-24', 7, 900, 100),
    sogg('2026-08-18', '2026-08-18', 0, 0, 0),
  ]);
  // 1000 € su UN soggiorno, non su due: dividere per due direbbe che questo
  // ospite spende la metà di quanto spende davvero.
  assert.strictEqual(s.spesaMediaSoggiorno, 1000);
});

test('chi è venuto solo in day use: zero soggiorni, ma la spesa si vede', () => {
  const s = aggregaCumulativi([
    sogg('2026-05-30', '2026-05-30', 0, 0, 130),
    sogg('2026-06-27', '2026-06-27', 0, 0, 180),
  ]);
  assert.strictEqual(s.nSoggiorni, 0);
  assert.strictEqual(s.nDayUse, 2);
  assert.strictEqual(s.ltv, 310);
  assert.strictEqual(s.spesaMediaSoggiorno, 0, 'nessuna divisione per zero');
});

test('le date comprendono i day use: sono comunque visite', () => {
  // La scheda le chiama "prima visita" e "ultima visita", non "primo soggiorno".
  const s = aggregaCumulativi([
    sogg('2025-08-02', '2025-08-09', 7, 2240, 380),
    sogg('2026-08-18', '2026-08-18', 0, 0, 90),
  ]);
  assert.strictEqual(s.primaVisita, '2025-08-02');
  assert.strictEqual(s.ultimaVisita, '2026-08-18');
});

// --- Pratiche senza date: fuori da tutti i conteggi (decisione del 18/08/2026)
// Sono pratiche archiviate vecchie, dati sporchi. Contarle come soggiorni
// gonfiava lo storico dell'ospite; contarle come day use gli attribuiva giornate
// che non ha mai fatto. Il badge "Nª volta" e la dashboard le escludevano già:
// così la scheda smette di essere l'unica a contarle.

test('una pratica senza date non è né un soggiorno né un day use', () => {
  // Il database manda `null`, non `undefined`, e `Number(null)` fa ZERO: senza
  // il controllo sul valore grezzo queste righe finivano fra i day use.
  for (const notti of [null, undefined, '', '   ']) {
    const s = aggregaCumulativi([{ dtarrivo: null, dtpartenza: null, notti, arrangiamento: 300, extra: 20 }]);
    const q = JSON.stringify(notti);
    assert.strictEqual(s.nSoggiorni, 0, `notti=${q} non è un soggiorno`);
    assert.strictEqual(s.nDayUse, 0, `notti=${q} non è un day use`);
    assert.strictEqual(s.nSenzaDate, 1, `notti=${q} va contata fra quelle senza date`);
  }
});

test('i soldi di una pratica senza date restano nel valore storico', () => {
  // Se in quella pratica c'è un importo, qualcuno l'ha pagato: il valore storico
  // è la somma di ciò che è entrato, non di ciò che sappiamo classificare.
  const s = aggregaCumulativi([{ dtarrivo: null, dtpartenza: null, notti: null, arrangiamento: 300, extra: 20 }]);
  assert.strictEqual(s.ltv, 320);
  assert.strictEqual(s.totArrangiamenti, 300);
  assert.strictEqual(s.totExtra, 20);
  // Zero soggiorni: la media non deve dividere per zero né inventare un numero.
  assert.strictEqual(s.spesaMediaSoggiorno, 0);
});

test('lo zero DICHIARATO resta un day use', () => {
  // La regola non è "senza date allora fuori": notti = 0 scritto è un day use,
  // e va contato come tale anche se le date non ci sono.
  const s = aggregaCumulativi([{ dtarrivo: null, dtpartenza: null, notti: 0, arrangiamento: 0, extra: 45 }]);
  assert.strictEqual(s.nSoggiorni, 0);
  assert.strictEqual(s.nDayUse, 1);
  assert.strictEqual(s.nSenzaDate, 0);
});

test('le categorie insieme, e nessuna riga persa per strada', () => {
  const righe = [
    sogg('2026-01-01', '2026-01-05', 4, 400, 50),   // soggiorno
    sogg('2026-02-01', '2026-02-01', 0, 0, 40),     // day use
    { dtarrivo: null, dtpartenza: null, notti: null, arrangiamento: 300, extra: 20 }, // sconosciuta
    sogg('2026-03-01', '2026-03-03', 2, 200, 10),   // soggiorno
    // Il voucher regalo mancava dalla fixture, e così l'invariante qui sotto
    // restava verde mentre in esercizio una riga finiva in nessuna categoria:
    // `classifica` ha quattro esiti, l'aggregato ne esponeva tre.
    sogg('2026-04-01', '2027-04-01', 365, 500, 0),  // voucher
  ];
  const s = aggregaCumulativi(righe);
  assert.strictEqual(s.nSoggiorni, 2);
  assert.strictEqual(s.nDayUse, 1);
  assert.strictEqual(s.nSenzaDate, 1);
  assert.strictEqual(s.nVoucher, 1);
  assert.strictEqual(
    s.nSoggiorni + s.nDayUse + s.nSenzaDate + s.nVoucher, righe.length,
    'una riga è finita in nessuna categoria'
  );
  // I soldi di tutte: il voucher è stato pagato davvero.
  assert.strictEqual(s.ltv, 400 + 50 + 40 + 300 + 20 + 200 + 10 + 500);
  // Le medie si dividono per i due soggiorni veri.
  assert.strictEqual(s.spesaMediaSoggiorno, s.ltv / 2);
});

test('elenco vuoto: tutto a zero, nessun errore', () => {
  const s = aggregaCumulativi([]);
  assert.strictEqual(s.nSoggiorni, 0);
  assert.strictEqual(s.ltv, 0);
  assert.strictEqual(s.primaVisita, null);
});

// --- Voucher regalo — allineato il 20/08/2026 --------------------------------
// Il gestionale registra il voucher come una prenotazione lunga un anno, perché
// quella è la sua validità. Il badge "Nª volta" lo escludeva dal 13/08, la
// scheda no: lo stesso ospite aveva 3 soggiorni di là e 2 di qua. E il voucher
// si portava dietro le sue 365 notti, quindi la media diceva 124,7 notti a
// soggiorno in un albergo dove la stagione dura meno di duecento giorni.

const VOUCHER = { dtarrivo: '2026-01-15', dtpartenza: '2027-01-15', notti: 365, arrangiamento: 300, extra: 0 };

test('un voucher regalo non è un soggiorno, e non porta notti', () => {
  const s = aggregaCumulativi([
    sogg('2025-06-10', '2025-06-14', 4, 800, 120),
    sogg('2026-07-01', '2026-07-06', 5, 950, 200),
    VOUCHER,
  ]);
  assert.strictEqual(s.nSoggiorni, 2);
  assert.strictEqual(s.nottiTotali, 9, 'le 365 notti del voucher non si sommano');
  // I soldi restano: è stato pagato davvero, come per i day use.
  assert.strictEqual(s.ltv, 2370);
});

test('il voucher si riconosce anche senza il campo notti', () => {
  const { notti, ...senzaNotti } = VOUCHER;
  const s = aggregaCumulativi([senzaNotti]);
  assert.strictEqual(s.nSoggiorni, 0, 'la lunghezza si ricava dalle date');
  assert.strictEqual(s.ltv, 300);
});

test('un soggiorno lungo ma sotto il limite resta un soggiorno', () => {
  // Il taglio serve a togliere i voucher, non i soggiorni lunghi: qui la
  // stagione dura meno di duecento giorni, e i voucher stanno tutti sui 365.
  const s = aggregaCumulativi([sogg('2026-01-01', '2026-07-01', 181, 100, 0)]);
  assert.strictEqual(s.nSoggiorni, 1);
  assert.strictEqual(s.nottiTotali, 181);
});

test('il limite delle 200 notti è lo STESSO numero nei tre punti in cui è scritto', () => {
  // Sta in tre file: qui, e dentro il SQL di analytics e di clienti, dove non si
  // può importare. Se un domani si cambia in un punto solo, la scheda e il badge
  // tornano a dare numeri diversi sullo stesso ospite — che è il difetto che
  // questa correzione ha chiuso.
  const fs = require('fs');
  const path = require('path');
  const leggi = (f, re) => {
    const m = fs.readFileSync(path.join(__dirname, '..', f), 'utf8').match(re);
    assert.ok(m, `limite non trovato in ${f}`);
    return Number(m[1]);
  };
  const valori = {
    'src/stats.js': leggi('src/stats.js', /const NOTTI_MAX_SOGGIORNO = (\d+);/),
    'src/pms/analytics.js': leggi('src/pms/analytics.js', /const NOTTI_MAX = (\d+);/),
    'src/pms/clienti.js': leggi('src/pms/clienti.js', /const NOTTI_MAX_SOGGIORNO = (\d+);/),
  };
  const distinti = [...new Set(Object.values(valori))];
  assert.strictEqual(distinti.length, 1, `i limiti divergono: ${JSON.stringify(valori)}`);
});

// --- Date sporche: partenza prima dell'arrivo -------------------------------
// Trovato dal collaudo a piu' revisori del 20/08/2026. Il taglio a 200 notti
// controllava solo il limite alto: una riga con la partenza PRIMA dell'arrivo
// passava per soggiorno e le sue notti negative si sommavano al totale, che
// quindi CALAVA. Il badge "Nª volta" (SQL: `notti BETWEEN 1 AND 200`) l'ha
// sempre esclusa: la stessa pratica aveva due risposte diverse.
test('partenza prima dell\'arrivo: non e\' un soggiorno e non toglie notti', () => {
  const righe = [
    sogg('2026-01-01', '2026-01-05', 4, 400, 0),    // soggiorno vero
    sogg('2026-02-10', '2026-02-07', -3, 100, 0),   // date invertite
  ];
  const s = aggregaCumulativi(righe);
  assert.strictEqual(s.nSoggiorni, 1);
  assert.strictEqual(s.nSenzaDate, 1, 'la riga sporca sta fra le sconosciute');
  assert.strictEqual(s.nottiTotali, 4, 'le notti non devono mai calare');
  assert.strictEqual(s.ltv, 500, 'i soldi restano: sono stati incassati');
});

test('le notti negative non arrivano nemmeno dal solo campo notti', () => {
  // La strada dell'import passa il campo `notti` senza `dtpartenza`.
  const s = aggregaCumulativi([{ dtarrivo: '2026-02-10', notti: -3, arrangiamento: 0, extra: 0 }]);
  assert.strictEqual(s.nSoggiorni, 0);
  assert.strictEqual(s.nDayUse, 0);
  assert.strictEqual(s.nSenzaDate, 1);
  assert.strictEqual(s.nottiTotali, 0);
});

test('una data illeggibile non diventa un soggiorno', () => {
  const s = aggregaCumulativi([{ dtarrivo: '2026-13-45', dtpartenza: '2026-14-99', notti: null, arrangiamento: 0, extra: 0 }]);
  assert.strictEqual(s.nSoggiorni, 0);
  assert.strictEqual(s.nSenzaDate, 1);
});
