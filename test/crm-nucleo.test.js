const { test } = require('node:test');
const assert = require('node:assert');
const { listNucleo, createMembro, deleteMembro, RELAZIONI } = require('../src/crm/nucleo');

function fakeDb(recordset = []) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('RELAZIONI esposte dal modulo', () => {
  assert.deepStrictEqual(RELAZIONI, ['Coniuge', 'Figlio-a', 'Genitore', 'Amico-a', 'Assistente', 'Altro']);
});

test('createMembro passa relazione/nome/cognome/nota', async () => {
  const db = fakeDb([{ id: 4 }]);
  const r = await createMembro(db, { pmsCustomerId: 1, autoreUserId: 2, tipoRelazione: 'Coniuge', nome: 'Maria', cognome: 'Bianchi', nota: 'Celiaca' });
  assert.strictEqual(r.id, 4);
  assert.match(db.calls[0].text, /INSERT INTO customer_travel_party/);
  assert.strictEqual(db.calls[0].params.tipoRelazione, 'Coniuge');
  assert.strictEqual(db.calls[0].params.nome, 'Maria');
});

test('listNucleo filtra per cliente; delete true/false', async () => {
  const db = fakeDb([{ id: 1, tipo_relazione: 'Coniuge', nome: 'Maria' }]);
  const r = await listNucleo(db, 47186);
  assert.strictEqual(r[0].nome, 'Maria');
  assert.match(db.calls[0].text, /IN \(47186\)/);
  assert.strictEqual(await deleteMembro(fakeDb([{ id: 1 }]), 1), true);
  assert.strictEqual(await deleteMembro(fakeDb([]), 9), false);
});
