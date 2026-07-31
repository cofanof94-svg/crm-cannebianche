const { test } = require('node:test');
const assert = require('node:assert');
const { upsertSnapshot, upsertCumulativi } = require('../src/import/carica');

function fakeDb() {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return []; } };
}

test('upsertSnapshot usa MERGE su codpratica e passa tutti i parametri', async () => {
  const db = fakeDb();
  await upsertSnapshot(db, { codpratica: 62152, pmsCustomerId: 81304, stato: 'Cancellata', validoCumulativi: false, impExtra: 42 });
  const { text, params } = db.calls[0];
  assert.match(text, /MERGE booking_snapshot/);
  assert.match(text, /ON t\.codpratica = s\.codpratica/);
  assert.strictEqual(params.codpratica, 62152);
  assert.strictEqual(params.validoCumulativi, false);
});

test('upsertCumulativi usa MERGE su pms_customer_id', async () => {
  const db = fakeDb();
  await upsertCumulativi(db, 47186, { nSoggiorni: 13, ltv: 69075, ultimaSource: 'DIRETTI' });
  const { text, params } = db.calls[0];
  assert.match(text, /MERGE customer_cumulativi/);
  assert.strictEqual(params.pmsCustomerId, 47186);
  assert.strictEqual(params.nSoggiorni, 13);
  assert.strictEqual(params.ltv, 69075);
});
