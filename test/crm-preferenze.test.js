const { test } = require('node:test');
const assert = require('node:assert');
const { listPreferenze, createPreferenza, updatePreferenza, deletePreferenza, REPARTI, CATEGORIE, AMBITI } = require('../src/crm/preferenze');

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

test('AMBITI esposti; createPreferenza default nucleo, updatePreferenza cambia ambito', async () => {
  assert.deepStrictEqual(AMBITI, ['personale', 'nucleo']);
  const db = fakeDb([{ id: 5 }]);
  await createPreferenza(db, { pmsCustomerId: 1, autoreUserId: 2, reparto: 'F&B', categoria: 'F&B', testo: 'Amarone' });
  assert.strictEqual(db.calls[0].params.ambito, 'nucleo');   // default
  assert.match(db.calls[0].text, /ambito/);
  const db2 = fakeDb([{ id: 5 }]);
  const ok = await updatePreferenza(db2, 5, { ambito: 'personale' });
  assert.strictEqual(ok, true);
  assert.match(db2.calls[0].text, /UPDATE customer_preferences SET ambito = @ambito/);
  assert.strictEqual(db2.calls[0].params.ambito, 'personale');
  assert.strictEqual(await updatePreferenza(fakeDb([]), 5, {}), false); // niente campi → no query
});

test('listPreferenze filtra per cliente; delete true/false', async () => {
  const db = fakeDb([{ id: 1, reparto: 'SPA', categoria: 'Persona', testo: 'Massaggio' }]);
  const r = await listPreferenze(db, 47186);
  assert.strictEqual(r[0].reparto, 'SPA');
  assert.match(db.calls[0].text, /IN \(47186\)/);
  assert.strictEqual(await deletePreferenza(fakeDb([{ id: 1 }]), 1), true);
  assert.strictEqual(await deletePreferenza(fakeDb([]), 9), false);
});

test("origine: 'ai' si registra, qualunque altra cosa vale 'manuale'", async () => {
  // Le due strade -- pulsante "Aggiungi" e conferma di un suggerimento --
  // arrivano al database identiche: senza questo campo non si puo' dire se
  // l'AI faccia risparmiare tempo o si stia rileggendo cio' che gia' si sapeva.
  const { createPreferenza } = require('../src/crm/preferenze');
  const visti = [];
  const db = { async query(text, params) { visti.push({ text, params }); return [{ id: 1 }]; } };
  const base = { pmsCustomerId: 1, autoreUserId: 1, reparto: 'F&B', categoria: 'Cibo', testo: 'x' };

  await createPreferenza(db, { ...base, origine: 'ai' });
  assert.strictEqual(visti[0].params.origine, 'ai');
  assert.match(visti[0].text, /origine/);

  await createPreferenza(db, base); // non dichiarata
  assert.strictEqual(visti[1].params.origine, 'manuale');

  // Meglio sottostimare l'AI che gonfiarla: un valore inventato non passa.
  await createPreferenza(db, { ...base, origine: 'magia' });
  assert.strictEqual(visti[2].params.origine, 'manuale');
});
