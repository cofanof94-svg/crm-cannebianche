const { test } = require('node:test');
const assert = require('node:assert');
const note = require('../src/crm/note');

function fakeDb(recordset = []) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('listNote filtra per cliente e unisce l\'autore', async () => {
  const db = fakeDb([{ id: 1, pms_customer_id: 47186, testo: 'ciao', created_at: 'x', autore_user_id: 1, autore: 'admin' }]);
  const r = await note.listNote(db, 47186);
  assert.strictEqual(r[0].autore, 'admin');
  assert.strictEqual(db.calls[0].params.pmsCustomerId, 47186);
  assert.match(db.calls[0].text, /FROM customer_notes/);
});

test('createNota passa cliente, autore e testo', async () => {
  const db = fakeDb([{ id: 9 }]);
  const r = await note.createNota(db, { pmsCustomerId: 47186, autoreUserId: 1, testo: 'nota' });
  assert.strictEqual(r.id, 9);
  assert.strictEqual(db.calls[0].params.testo, 'nota');
  assert.strictEqual(db.calls[0].params.autoreUserId, 1);
});

test('updateNota aggiorna il testo per id', async () => {
  const db = fakeDb([]);
  await note.updateNota(db, 9, 'nuovo');
  assert.match(db.calls[0].text, /UPDATE customer_notes SET testo = @testo OUTPUT INSERTED.id WHERE id = @id/);
  assert.strictEqual(db.calls[0].params.testo, 'nuovo');
});

test('deleteNota elimina per id', async () => {
  const db = fakeDb([]);
  await note.deleteNota(db, 9);
  assert.match(db.calls[0].text, /DELETE FROM customer_notes OUTPUT DELETED.id WHERE id = @id/);
  assert.strictEqual(db.calls[0].params.id, 9);
});
