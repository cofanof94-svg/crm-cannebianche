const { test } = require('node:test');
const assert = require('node:assert');
const c = require('../src/crm/complaint');

function fakeDb(recordset = []) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('listComplaints filtra per cliente e ordina gli aperti per primi', async () => {
  const db = fakeDb([{ id: 1, testo: 'x', stato: 'aperto', autore: 'admin' }]);
  const r = await c.listComplaints(db, 47186);
  assert.strictEqual(r[0].autore, 'admin');
  assert.match(db.calls[0].text, /IN \(47186\)/);
  assert.match(db.calls[0].text, /FROM customer_complaints/);
  assert.match(db.calls[0].text, /stato = 'aperto'/);
});

test('createComplaint inserisce con stato aperto', async () => {
  const db = fakeDb([{ id: 5 }]);
  const r = await c.createComplaint(db, { pmsCustomerId: 47186, autoreUserId: 1, testo: 'reclamo' });
  assert.strictEqual(r.id, 5);
  assert.strictEqual(db.calls[0].params.testo, 'reclamo');
  assert.match(db.calls[0].text, /'aperto'/);
});

test('setComplaintStato aggiorna stato e resolved_at', async () => {
  const db = fakeDb([{ id: 5 }]);
  assert.strictEqual(await c.setComplaintStato(db, 5, 'risolto'), true);
  assert.strictEqual(db.calls[0].params.stato, 'risolto');
  assert.match(db.calls[0].text, /resolved_at = CASE WHEN @stato = 'risolto'/);
});

test('updateComplaintTesto/deleteComplaint true solo se riga toccata', async () => {
  assert.strictEqual(await c.updateComplaintTesto(fakeDb([{ id: 5 }]), 5, 'nuovo'), true);
  assert.strictEqual(await c.updateComplaintTesto(fakeDb([]), 999, 'x'), false);
  assert.strictEqual(await c.deleteComplaint(fakeDb([{ id: 5 }]), 5), true);
  assert.strictEqual(await c.deleteComplaint(fakeDb([]), 999), false);
});
