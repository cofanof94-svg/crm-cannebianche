const { test } = require('node:test');
const assert = require('node:assert');
const { getProfilo, upsertLingua } = require('../src/crm/profilo');

function fakeDb(recordset = []) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('getProfilo restituisce la riga o null', async () => {
  assert.deepStrictEqual(await getProfilo(fakeDb([{ pms_customer_id: 1, lingua: 'IT' }]), 1), { pms_customer_id: 1, lingua: 'IT' });
  assert.strictEqual(await getProfilo(fakeDb([]), 1), null);
});

test('upsertLingua usa MERGE e passa i parametri', async () => {
  const db = fakeDb([]);
  await upsertLingua(db, { pmsCustomerId: 47186, lingua: 'EN', autoreUserId: 1 });
  assert.match(db.calls[0].text, /MERGE customer_profile/);
  assert.strictEqual(db.calls[0].params.lingua, 'EN');
  assert.strictEqual(db.calls[0].params.pmsCustomerId, 47186);
});
