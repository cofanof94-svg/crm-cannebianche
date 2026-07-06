const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');

async function makeApp() {
  const admin = { id: 1, username: 'admin', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const created = [];
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) {
        return params.username === 'admin' ? [admin] : [];
      }
      if (/INSERT INTO users/.test(text)) {
        const u = { id: 2, username: params.username, role: params.role, attivo: 1 };
        created.push(u); return [u];
      }
      if (/SELECT id, username, role, attivo, created_at FROM users/.test(text)) {
        return [admin, ...created];
      }
      return [];
    },
  };
  return { app: createApp({ crmDb, pmsDb: {}, sessionSecret: 'test' }) };
}

async function loginAgent(app) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return agent;
}

test('senza login GET /api/admin/users → 401', async () => {
  const { app } = await makeApp();
  const res = await request(app).get('/api/admin/users');
  assert.strictEqual(res.status, 401);
});

test('admin può listare gli utenti', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.get('/api/admin/users');
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.users));
});

test('admin crea un utente con ruolo valido', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.post('/api/admin/users').send({ username: 'nuovo', password: 'pw', role: 'reception' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.user.role, 'reception');
});

test('ruolo non valido → 400', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.post('/api/admin/users').send({ username: 'x', password: 'pw', role: 'root' });
  assert.strictEqual(res.status, 400);
});
