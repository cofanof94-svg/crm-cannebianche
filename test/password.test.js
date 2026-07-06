const { test } = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword } = require('../src/auth/password');

test('hash e verifica password corretta', async () => {
  const hash = await hashPassword('segreta');
  assert.notStrictEqual(hash, 'segreta');
  assert.strictEqual(await verifyPassword('segreta', hash), true);
});

test('verifica fallisce con password errata', async () => {
  const hash = await hashPassword('segreta');
  assert.strictEqual(await verifyPassword('sbagliata', hash), false);
});
