const { test } = require('node:test');
const assert = require('node:assert');
const { listIntolleranze, createIntolleranza, deleteIntolleranza } = require('../src/crm/intolleranze');

function fakeDb(recordset = []) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('listIntolleranze filtra per cliente e ordina', async () => {
  const db = fakeDb([{ id: 1, testo: 'Celiachia', autore: 'admin' }]);
  const r = await listIntolleranze(db, 47186);
  assert.strictEqual(r[0].testo, 'Celiachia');
  assert.match(db.calls[0].text, /FROM customer_intolerances/);
  assert.match(db.calls[0].text, /IN \(47186\)/);
});

test('createIntolleranza passa i parametri e restituisce l\'id', async () => {
  const db = fakeDb([{ id: 7 }]);
  const r = await createIntolleranza(db, { pmsCustomerId: 47186, autoreUserId: 1, testo: 'Frutta a guscio' });
  assert.strictEqual(r.id, 7);
  assert.match(db.calls[0].text, /INSERT INTO customer_intolerances/);
  assert.strictEqual(db.calls[0].params.testo, 'Frutta a guscio');
  assert.strictEqual(db.calls[0].params.autoreUserId, 1);
});

test('deleteIntolleranza: true se una riga toccata, false altrimenti', async () => {
  assert.strictEqual(await deleteIntolleranza(fakeDb([{ id: 3 }]), 3), true);
  assert.strictEqual(await deleteIntolleranza(fakeDb([]), 999), false);
});
