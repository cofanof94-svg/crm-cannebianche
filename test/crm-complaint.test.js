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

test('setComplaintStato: risolvere scrive il follow-up nello stesso UPDATE', async () => {
  const db = fakeDb([{ id: 5 }]);
  await c.setComplaintStato(db, 5, 'risolto', 'Cambio camera effettuato');
  assert.strictEqual(db.calls.length, 1); // un solo giro: niente stato senza follow-up
  assert.strictEqual(db.calls[0].params.followUp, 'Cambio camera effettuato');
  assert.match(db.calls[0].text, /follow_up = @followUp/);
});

test('setComplaintStato: riaprendo non si tocca il follow-up già scritto', async () => {
  const db = fakeDb([{ id: 5 }]);
  await c.setComplaintStato(db, 5, 'aperto');
  assert.doesNotMatch(db.calls[0].text, /follow_up/);
  assert.strictEqual('followUp' in db.calls[0].params, false);
});

test('setComplaintFollowUp: corregge il solo testo, vuoto → NULL', async () => {
  const db = fakeDb([{ id: 5 }]);
  assert.strictEqual(await c.setComplaintFollowUp(db, 5, 'Omaggio SPA offerto'), true);
  assert.strictEqual(db.calls[0].params.followUp, 'Omaggio SPA offerto');
  assert.doesNotMatch(db.calls[0].text, /stato/);
  const db2 = fakeDb([{ id: 5 }]);
  await c.setComplaintFollowUp(db2, 5, '');
  assert.strictEqual(db2.calls[0].params.followUp, null);
  assert.strictEqual(await c.setComplaintFollowUp(fakeDb([]), 999, 'x'), false);
});

test('listComplaints legge anche il follow-up', async () => {
  const db = fakeDb([]);
  await c.listComplaints(db, 47186);
  assert.match(db.calls[0].text, /c\.follow_up/);
});

test('updateComplaintTesto/deleteComplaint true solo se riga toccata', async () => {
  assert.strictEqual(await c.updateComplaintTesto(fakeDb([{ id: 5 }]), 5, 'nuovo'), true);
  assert.strictEqual(await c.updateComplaintTesto(fakeDb([]), 999, 'x'), false);
  assert.strictEqual(await c.deleteComplaint(fakeDb([{ id: 5 }]), 5), true);
  assert.strictEqual(await c.deleteComplaint(fakeDb([]), 999), false);
});
