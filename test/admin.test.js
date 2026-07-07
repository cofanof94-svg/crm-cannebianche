const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');

async function makeApp(opts = {}) {
  const {
    extraUsers = [],
    duplicateUsernames = [],
    listUsersShouldFail = false,
    countActiveAdminsOverride = null,
    fkDeleteIds = [],
  } = opts;
  const admin = { id: 1, username: 'admin', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const created = [];
  const deleted = [];
  const baseUsers = [admin, ...extraUsers];
  const allUsers = () => [...baseUsers, ...created];
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) {
        const u = allUsers().find((x) => x.username === params.username);
        return u ? [u] : [];
      }
      if (/INSERT INTO users/.test(text)) {
        if (duplicateUsernames.includes(params.username)) {
          const err = new Error('Violation of UNIQUE KEY constraint'); err.number = 2627; throw err;
        }
        const u = { id: 100 + created.length, username: params.username, role: params.role, attivo: 1 };
        created.push(u); return [u];
      }
      if (/UPDATE users SET/.test(text)) {
        if (params.username !== undefined && duplicateUsernames.includes(params.username)) {
          const err = new Error('Violation of UNIQUE KEY constraint'); err.number = 2627; throw err;
        }
        return [];
      }
      if (/DELETE FROM users/.test(text)) {
        if (fkDeleteIds.includes(params.id)) {
          const err = new Error('REFERENCE constraint'); err.number = 547; throw err;
        }
        deleted.push(params.id); return [];
      }
      if (/FROM users ORDER BY username/.test(text)) {
        if (listUsersShouldFail) throw new Error('DB non disponibile');
        return allUsers();
      }
      if (/WHERE id = @id/.test(text)) {
        const u = allUsers().find((x) => x.id === params.id);
        return u ? [u] : [];
      }
      if (/COUNT\(\*\) AS n/.test(text)) {
        if (countActiveAdminsOverride !== null) return [{ n: countActiveAdminsOverride }];
        const n = allUsers().filter((x) => x.role === 'admin' && x.attivo).length;
        return [{ n }];
      }
      return [];
    },
  };
  return { app: createApp({ crmDb, pmsDb: {}, sessionSecret: 'test' }) };
}

async function loginAgent(app, username = 'admin', password = 'pw') {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username, password });
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

test('reception loggato → GET /api/admin/users → 403', async () => {
  const recep = { id: 3, username: 'recep', password_hash: await hashPassword('pw'), role: 'reception', attivo: 1 };
  const { app } = await makeApp({ extraUsers: [recep] });
  const agent = await loginAgent(app, 'recep', 'pw');
  const res = await agent.get('/api/admin/users');
  assert.strictEqual(res.status, 403);
});

test('username duplicato → POST /api/admin/users → 409', async () => {
  const { app } = await makeApp({ duplicateUsernames: ['dup'] });
  const agent = await loginAgent(app);
  const res = await agent.post('/api/admin/users').send({ username: 'dup', password: 'pw', role: 'reception' });
  assert.strictEqual(res.status, 409);
});

test('PATCH /api/admin/users/abc (id non numerico) → 400', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.patch('/api/admin/users/abc').send({ attivo: false });
  assert.strictEqual(res.status, 400);
});

test('guardia ultimo admin: disattivare l\'unico admin attivo → 400', async () => {
  const admin2 = { id: 2, username: 'admin2', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const { app } = await makeApp({ extraUsers: [admin2], countActiveAdminsOverride: 1 });
  const agent = await loginAgent(app);
  const res = await agent.patch('/api/admin/users/2').send({ attivo: false });
  assert.strictEqual(res.status, 400);
});

test('un admin non può modificare il proprio ruolo/stato → 400', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app); // admin id=1
  const res = await agent.patch('/api/admin/users/1').send({ role: 'reception' });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /tuo ruolo o stato/);
});

test('route che lancia → 500 JSON', async () => {
  const { app } = await makeApp({ listUsersShouldFail: true });
  const agent = await loginAgent(app);
  const res = await agent.get('/api/admin/users');
  assert.strictEqual(res.status, 500);
  assert.ok(res.body.error);
});

test('creazione con nome/cognome/email → 201', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.post('/api/admin/users').send({ username: 'nuovo', password: 'pw', role: 'reception', nome: 'Anna', cognome: 'Bianchi', email: 'a@b.it' });
  assert.strictEqual(res.status, 201);
});

test('modifica nome/email/password → 200', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.patch('/api/admin/users/2').send({ nome: 'X', email: 'x@y.it', password: 'nuova' });
  assert.strictEqual(res.status, 200);
});

test('DELETE utente non-admin → 200', async () => {
  const recep = { id: 2, username: 'recep', password_hash: await hashPassword('pw'), role: 'reception', attivo: 1 };
  const { app } = await makeApp({ extraUsers: [recep] });
  const agent = await loginAgent(app);
  const res = await agent.delete('/api/admin/users/2');
  assert.strictEqual(res.status, 200);
});

test('DELETE del proprio account → 400', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app); // admin id=1
  const res = await agent.delete('/api/admin/users/1');
  assert.strictEqual(res.status, 400);
});

test('DELETE ultimo admin attivo → 400', async () => {
  const admin2 = { id: 2, username: 'admin2', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const { app } = await makeApp({ extraUsers: [admin2], countActiveAdminsOverride: 1 });
  const agent = await loginAgent(app);
  const res = await agent.delete('/api/admin/users/2');
  assert.strictEqual(res.status, 400);
});

test('DELETE id non numerico → 400', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.delete('/api/admin/users/abc');
  assert.strictEqual(res.status, 400);
});

test('DELETE senza login → 401', async () => {
  const { app } = await makeApp();
  const res = await request(app).delete('/api/admin/users/2');
  assert.strictEqual(res.status, 401);
});

test('guardia ultimo admin: PATCH {attivo:""} sull\'unico admin → 400', async () => {
  const admin2 = { id: 2, username: 'admin2', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const { app } = await makeApp({ extraUsers: [admin2], countActiveAdminsOverride: 1 });
  const agent = await loginAgent(app);
  const res = await agent.patch('/api/admin/users/2').send({ attivo: '' });
  assert.strictEqual(res.status, 400);
});

test('DELETE con vincolo FK → 409', async () => {
  const recep = { id: 2, username: 'recep', password_hash: await hashPassword('pw'), role: 'reception', attivo: 1 };
  const { app } = await makeApp({ extraUsers: [recep], fkDeleteIds: [2] });
  const agent = await loginAgent(app);
  const res = await agent.delete('/api/admin/users/2');
  assert.strictEqual(res.status, 409);
});

test('PATCH con username duplicato → 409', async () => {
  const recep = { id: 2, username: 'recep', password_hash: await hashPassword('pw'), role: 'reception', attivo: 1 };
  const { app } = await makeApp({ extraUsers: [recep], duplicateUsernames: ['esistente'] });
  const agent = await loginAgent(app);
  const res = await agent.patch('/api/admin/users/2').send({ username: 'esistente' });
  assert.strictEqual(res.status, 409);
});
