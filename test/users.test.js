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
