const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');

async function appWithUser(user) {
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text) && params.username === user.username) {
        return [user];
      }
      // Il server rilegge l'utente per id a ogni richiesta autenticata.
      if (/SELECT[\s\S]*FROM users WHERE id/.test(text) && Number(params.id) === user.id) {
        return [user];
      }
      return [];
    },
  };
  return createApp({ crmDb, pmsDb: {}, sessionSecret: 'test-secret' });
}

test('login corretto imposta il cookie di sessione', async () => {
  const user = { id: 1, username: 'mik', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const app = await appWithUser(user);
  const res = await request(app).post('/api/auth/login').send({ username: 'mik', password: 'pw' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.role, 'admin');
  assert.ok(res.headers['set-cookie']);
});

test('login con password errata → 401', async () => {
  const user = { id: 1, username: 'mik', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const app = await appWithUser(user);
  const res = await request(app).post('/api/auth/login').send({ username: 'mik', password: 'sbagliata' });
  assert.strictEqual(res.status, 401);
});

test('utente disattivato non può loggare', async () => {
  const user = { id: 1, username: 'mik', password_hash: await hashPassword('pw'), role: 'admin', attivo: 0 };
  const app = await appWithUser(user);
  const res = await request(app).post('/api/auth/login').send({ username: 'mik', password: 'pw' });
  assert.strictEqual(res.status, 401);
});

test('login senza password → 400', async () => {
  const user = { id: 1, username: 'mik', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const app = await appWithUser(user);
  const res = await request(app).post('/api/auth/login').send({ username: 'mik' });
  assert.strictEqual(res.status, 400);
});

test('login seguito da logout → 200 e {ok:true}', async () => {
  const user = { id: 1, username: 'mik', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const app = await appWithUser(user);
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username: 'mik', password: 'pw' });
  const res = await agent.post('/api/auth/logout');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { ok: true });
});

test('GET /api/me senza login → 401, con login → 200 e username', async () => {
  const user = { id: 1, username: 'mik', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const app = await appWithUser(user);

  const resNoAuth = await request(app).get('/api/me');
  assert.strictEqual(resNoAuth.status, 401);

  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username: 'mik', password: 'pw' });
  const resAuth = await agent.get('/api/me');
  assert.strictEqual(resAuth.status, 200);
  assert.strictEqual(resAuth.body.user.username, user.username);
});
