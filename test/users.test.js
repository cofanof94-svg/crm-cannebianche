const { test } = require('node:test');
const assert = require('node:assert');
const users = require('../src/crm/users');

function fakeDb(recordset = []) {
  return {
    calls: [],
    async query(text, params) { this.calls.push({ text, params }); return recordset; },
  };
}

test('findUserByUsername passa il parametro e restituisce la prima riga', async () => {
  const db = fakeDb([{ id: 1, username: 'mik', password_hash: 'h', role: 'admin', attivo: 1 }]);
  const u = await users.findUserByUsername(db, 'mik');
  assert.strictEqual(u.username, 'mik');
  assert.strictEqual(db.calls[0].params.username, 'mik');
});

test('findUserByUsername restituisce null se nessuna riga', async () => {
  const db = fakeDb([]);
  assert.strictEqual(await users.findUserByUsername(db, 'x'), null);
});

test('createUser passa username/hash/role', async () => {
  const db = fakeDb([{ id: 5, username: 'nuovo', role: 'reception', attivo: 1 }]);
  const u = await users.createUser(db, { username: 'nuovo', passwordHash: 'h', role: 'reception' });
  assert.strictEqual(u.id, 5);
  assert.strictEqual(db.calls[0].params.role, 'reception');
});

test('setUserActive normalizza a 0/1', async () => {
  const db = fakeDb([]);
  await users.setUserActive(db, 3, false);
  assert.strictEqual(db.calls[0].params.attivo, 0);
});

test('getUserById restituisce la prima riga', async () => {
  const db = fakeDb([{ id: 7, username: 'mik', role: 'admin', attivo: 1 }]);
  const u = await users.getUserById(db, 7);
  assert.strictEqual(u.id, 7);
  assert.strictEqual(db.calls[0].params.id, 7);
});

test('getUserById restituisce null se nessuna riga', async () => {
  const db = fakeDb([]);
  assert.strictEqual(await users.getUserById(db, 99), null);
});

test('countActiveAdmins restituisce il valore n', async () => {
  const db = fakeDb([{ n: 2 }]);
  const n = await users.countActiveAdmins(db);
  assert.strictEqual(n, 2);
});

test('updateUser aggiorna solo i campi in whitelist', async () => {
  const db = fakeDb([]);
  await users.updateUser(db, 7, { nome: 'Mario', email: 'm@x.it', ruoloFinto: 'x' });
  const { text, params } = db.calls[0];
  assert.match(text, /UPDATE users SET/);
  assert.match(text, /nome = @nome/);
  assert.match(text, /email = @email/);
  assert.doesNotMatch(text, /ruoloFinto/);
  assert.strictEqual(params.nome, 'Mario');
  assert.strictEqual(params.id, 7);
});

test('updateUser senza campi validi non esegue query', async () => {
  const db = fakeDb([]);
  await users.updateUser(db, 7, { qualcosa: 1 });
  assert.strictEqual(db.calls.length, 0);
});

test('deleteUser esegue DELETE per id', async () => {
  const db = fakeDb([]);
  await users.deleteUser(db, 9);
  assert.match(db.calls[0].text, /DELETE FROM users WHERE id = @id/);
  assert.strictEqual(db.calls[0].params.id, 9);
});

test('createUser passa i campi anagrafici', async () => {
  const db = fakeDb([{ id: 5 }]);
  await users.createUser(db, { username: 'u', passwordHash: 'h', role: 'reception', nome: 'A', cognome: 'B', email: 'a@b.it' });
  assert.strictEqual(db.calls[0].params.nome, 'A');
  assert.strictEqual(db.calls[0].params.email, 'a@b.it');
});
