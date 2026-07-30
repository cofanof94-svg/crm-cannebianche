const { test } = require('node:test');
const assert = require('node:assert');
const { listPreferenze, createPreferenza, deletePreferenza, REPARTI, CATEGORIE } = require('../src/crm/preferenze');

function fakeDb(recordset = []) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('liste chiuse esposte dal modulo', () => {
  assert.deepStrictEqual(REPARTI, ['Rooms', 'F&B', 'SPA', 'Front office']);
  assert.deepStrictEqual(CATEGORIE, ['F&B', 'Camera', 'Persona', 'Occasioni', 'Generale']);
});

test('createPreferenza passa reparto/categoria/testo', async () => {
  const db = fakeDb([{ id: 5 }]);
  const r = await createPreferenza(db, { pmsCustomerId: 1, autoreUserId: 2, reparto: 'F&B', categoria: 'F&B', testo: 'Amarone' });
  assert.strictEqual(r.id, 5);
  assert.match(db.calls[0].text, /INSERT INTO customer_preferences/);
  assert.strictEqual(db.calls[0].params.reparto, 'F&B');
  assert.strictEqual(db.calls[0].params.testo, 'Amarone');
});

test('listPreferenze filtra per cliente; delete true/false', async () => {
  const db = fakeDb([{ id: 1, reparto: 'SPA', categoria: 'Persona', testo: 'Massaggio' }]);
  const r = await listPreferenze(db, 47186);
  assert.strictEqual(r[0].reparto, 'SPA');
  assert.strictEqual(db.calls[0].params.pmsCustomerId, 47186);
  assert.strictEqual(await deletePreferenza(fakeDb([{ id: 1 }]), 1), true);
  assert.strictEqual(await deletePreferenza(fakeDb([]), 9), false);
});
