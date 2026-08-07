const { test } = require('node:test');
const assert = require('node:assert');
const { getProfilo, upsertLingua, upsertNotePersonali, upsertDataNascita, validaDataNascita, applicaDataNascita } = require('../src/crm/profilo');

function fakeDb(recordset = []) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('getProfilo restituisce lingua + data_nascita + note_personali (con autore/data) o null', async () => {
  const rows = [
    { pms_customer_id: 1, lingua: null, data_nascita: null, note_personali: 'Direttore LUISS', updated_at: 'b', autore: 'admin' },
    { pms_customer_id: 1, lingua: 'IT', data_nascita: '1964-10-17', note_personali: null, updated_at: 'a', autore: null },
  ];
  assert.deepStrictEqual(await getProfilo(fakeDb(rows), 1), {
    pms_customer_id: 1, lingua: 'IT', data_nascita: '1964-10-17', note_personali: 'Direttore LUISS',
    note_autore: 'admin', note_updated_at: 'b', updated_at: 'b',
  });
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

test('upsertDataNascita tocca solo data_nascita via MERGE', async () => {
  const db = fakeDb([]);
  await upsertDataNascita(db, { pmsCustomerId: 47186, dataNascita: '1964-10-17', autoreUserId: 1 });
  assert.match(db.calls[0].text, /MERGE customer_profile/);
  assert.match(db.calls[0].text, /SET data_nascita = CAST\(@dataNascita AS date\)/);
  assert.doesNotMatch(db.calls[0].text, /SET lingua|SET note_personali/);
  assert.strictEqual(db.calls[0].params.dataNascita, '1964-10-17');
});

test('validaDataNascita: accetta ISO valide, vuoto = nessun override', () => {
  assert.deepStrictEqual(validaDataNascita('1964-10-17'), { ok: true, valore: '1964-10-17' });
  assert.deepStrictEqual(validaDataNascita('  1964-10-17  '), { ok: true, valore: '1964-10-17' });
  assert.deepStrictEqual(validaDataNascita(''), { ok: true, valore: null });
  assert.deepStrictEqual(validaDataNascita(null), { ok: true, valore: null });
});

test('validaDataNascita: rifiuta formati errati, date inesistenti e date future', () => {
  assert.strictEqual(validaDataNascita('17/10/1964').ok, false);   // formato italiano
  assert.strictEqual(validaDataNascita('1964-13-01').ok, false);   // mese inesistente
  assert.strictEqual(validaDataNascita('2026-02-30').ok, false);   // giorno inesistente
  assert.strictEqual(validaDataNascita('1899-12-31').ok, false);   // troppo indietro
  const domani = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.strictEqual(validaDataNascita(domani).ok, false);         // futura
});

test('applicaDataNascita: l\'override CRM vince sul PMS, altrimenti resta il PMS', () => {
  const conOverride = applicaDataNascita({ dtNascita: '1964-10-17' }, { data_nascita: '1965-01-02' });
  assert.deepStrictEqual(conOverride, { dtNascita: '1965-01-02', dtNascitaFonte: 'crm' });
  const senzaProfilo = applicaDataNascita({ dtNascita: '1964-10-17' }, null);
  assert.deepStrictEqual(senzaProfilo, { dtNascita: '1964-10-17', dtNascitaFonte: 'pms' });
  const vuoti = applicaDataNascita({ dtNascita: null }, { data_nascita: null });
  assert.deepStrictEqual(vuoti, { dtNascita: null, dtNascitaFonte: 'pms' });
});
