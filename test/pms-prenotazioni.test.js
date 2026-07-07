const { test } = require('node:test');
const assert = require('node:assert');
const { getArriviByData, getRiepilogoGiorno } = require('../src/pms/prenotazioni');

function fakePms(recordset) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('getArriviByData mappa e normalizza le righe', async () => {
  const pms = fakePms([{
    codpratica: 60176, cognome: 'HILTON', nome: '', camere: '211',
    paxAdulti: 2, paxBambini: 0, dtpartenza: '2026-07-11', notti: 5,
    oraArrivo: '__.__', inCasa: 'N', provenienza: 'Booking.com', trattamento: 'Mezza Pensione', note: '  ',
  }]);
  const [a] = await getArriviByData(pms, '2026-07-06');
  assert.strictEqual(a.codpratica, 60176);
  assert.strictEqual(a.nominativo, 'HILTON');       // nome vuoto ignorato
  assert.strictEqual(a.camere, '211');
  assert.strictEqual(a.oraArrivo, null);            // '__.__' -> null
  assert.strictEqual(a.inCasa, false);              // 'N' -> false
  assert.strictEqual(a.note, null);                 // solo spazi -> null
  assert.strictEqual(pms.calls[0].params.data, '2026-07-06');
});

test('getArriviByData: nominativo assente -> null', async () => {
  const pms = fakePms([{ codpratica: 1, cognome: '', nome: '', camere: '202',
    paxAdulti: 2, paxBambini: 0, dtpartenza: '2026-07-10', notti: 4, oraArrivo: '', inCasa: 'S',
    provenienza: null, trattamento: null, note: null }]);
  const [a] = await getArriviByData(pms, '2026-07-06');
  assert.strictEqual(a.nominativo, null);
  assert.strictEqual(a.inCasa, true);
});

test('getRiepilogoGiorno restituisce i tre conteggi', async () => {
  const pms = fakePms([{ arrivi: 8, partenze: 3, presenti: 21 }]);
  const r = await getRiepilogoGiorno(pms, '2026-07-06');
  assert.deepStrictEqual(r, { arrivi: 8, partenze: 3, presenti: 21 });
  assert.strictEqual(pms.calls[0].params.data, '2026-07-06');
});

test('getRiepilogoGiorno: nessuna riga -> zeri', async () => {
  const pms = fakePms([]);
  const r = await getRiepilogoGiorno(pms, '2026-07-06');
  assert.deepStrictEqual(r, { arrivi: 0, partenze: 0, presenti: 0 });
});
