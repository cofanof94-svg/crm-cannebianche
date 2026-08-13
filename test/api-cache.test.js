const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');

async function makeApp() {
  const admin = { id: 1, username: 'admin', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) return params.username === 'admin' ? [admin] : [];
      if (/SELECT[\s\S]*FROM users WHERE id/.test(text)) return Number(params.id) === admin.id ? [admin] : [];
      return [];
    },
  };
  return createApp({ crmDb, pmsDb: {}, sessionSecret: 'test' });
}

test('le risposte API non sono cacheabili (Cache-Control: no-store)', async () => {
  const app = await makeApp();
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  const res = await agent.get('/api/me');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['cache-control'] || '', /no-store/);
});
