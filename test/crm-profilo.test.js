const { test } = require('node:test');
const assert = require('node:assert');
const { getProfilo, upsertLingua, upsertNotePersonali } = require('../src/crm/profilo');

function fakeDb(recordset = []) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('getProfilo restituisce lingua + note_personali (primo non nullo del gruppo) o null', async () => {
  const rows = [
    { pms_customer_id: 1, lingua: null, note_personali: 'Direttore LUISS', updated_at: 'b' },
    { pms_customer_id: 1, lingua: 'IT', note_personali: null, updated_at: 'a' },
  ];
  assert.deepStrictEqual(await getProfilo(fakeDb(rows), 1), { pms_customer_id: 1, lingua: 'IT', note_personali: 'Direttore LUISS', updated_at: 'b' });
  assert.strictEqual(await getProfilo(fakeDb([]), 1), null);
});

test('upsertLingua usa MERGE e passa i parametri', async () => {
  const db = fakeDb([]);
  await upsertLingua(db, { pmsCustomerId: 47186, lingua: 'EN', autoreUserId: 1 });
  assert.match(db.calls[0].text, /MERGE customer_profile/);
  assert.match(db.calls[0].text, /SET lingua = @lingua/);
  assert.strictEqual(db.calls[0].params.lingua, 'EN');
  assert.strictEqual(db.calls[0].params.pmsCustomerId, 47186);
});

test('upsertNotePersonali tocca solo note_personali via MERGE', async () => {
  const db = fakeDb([]);
  await upsertNotePersonali(db, { pmsCustomerId: 47186, notePersonali: 'Direttore LUISS', autoreUserId: 1 });
  assert.match(db.calls[0].text, /MERGE customer_profile/);
  assert.match(db.calls[0].text, /SET note_personali = @notePersonali/);
  assert.doesNotMatch(db.calls[0].text, /SET lingua/);
  assert.strictEqual(db.calls[0].params.notePersonali, 'Direttore LUISS');
});
