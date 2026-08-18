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

test('senza date né notti la riga vale come soggiorno', () => {
  // Un campo vuoto non è uno zero: buttare via un soggiorno per un dato che
  // manca sarebbe peggio che contarne uno di troppo.
  const s = aggregaCumulativi([{ arrangiamento: 855, extra: 40 }]);
  assert.strictEqual(s.nSoggiorni, 1);
  assert.strictEqual(s.nDayUse, 0);
});

test('una pratica senza date arriva dal database come null, e vale un soggiorno', () => {
  // Il test qui sopra passava anche quando il difetto c'era, perché non passava
  // affatto il campo `notti`: da JavaScript diventa `undefined`, cioè "non è un
  // numero". Ma il database manda `null`, e `Number(null)` fa ZERO: la riga
  // veniva contata come DAY USE, il contrario della regola. Nell'archivio
  // dell'hotel le pratiche senza date non sono poche, quindi il caso è vero.
  for (const notti of [null, '', '   ']) {
    const s = aggregaCumulativi([{ dtarrivo: null, dtpartenza: null, notti, arrangiamento: 300, extra: 20 }]);
    assert.strictEqual(s.nSoggiorni, 1, `notti=${JSON.stringify(notti)} dovrebbe valere un soggiorno`);
    assert.strictEqual(s.nDayUse, 0, `notti=${JSON.stringify(notti)} non è un day use`);
    // I soldi ci sono in entrambi i casi: quello non cambia mai.
    assert.strictEqual(s.ltv, 320);
  }
});

test('lo zero vero resta un day use', () => {
  // La correzione non deve rendere soggiorno tutto ciò che non ha le date:
  // notti = 0 dichiarato è un day use, e va contato come tale.
  const s = aggregaCumulativi([{ dtarrivo: null, dtpartenza: null, notti: 0, arrangiamento: 0, extra: 45 }]);
  assert.strictEqual(s.nSoggiorni, 0);
  assert.strictEqual(s.nDayUse, 1);
});

test('elenco vuoto: tutto a zero, nessun errore', () => {
  const s = aggregaCumulativi([]);
  assert.strictEqual(s.nSoggiorni, 0);
  assert.strictEqual(s.ltv, 0);
  assert.strictEqual(s.primaVisita, null);
});
