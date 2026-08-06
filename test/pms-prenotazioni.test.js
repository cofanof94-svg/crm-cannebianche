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
