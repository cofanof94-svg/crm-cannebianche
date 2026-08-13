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
      // Lettura per id: il server la fa a ogni richiesta per riallineare il
      // ruolo in sessione. Qui serve anche perché i test cancellano utenti, e
      // dopo la cancellazione la sessione di quell'utente deve cadere.
      if (/SELECT[\s\S]*FROM users WHERE id/.test(text)) {
        const u = allUsers().find((x) => x.id === Number(params.id) && !deleted.includes(x.id));
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
  const res = await agent.post('/api/admin/users').send({ username: 'nuovo', password: 'passwordlunga', role: 'reception' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.user.role, 'reception');
});

test('ruolo non valido → 400', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.post('/api/admin/users').send({ username: 'x', password: 'passwordlunga', role: 'root' });
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
  const res = await agent.post('/api/admin/users').send({ username: 'dup', password: 'passwordlunga', role: 'reception' });
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
  const res = await agent.post('/api/admin/users').send({ username: 'nuovo', password: 'passwordlunga', role: 'reception', nome: 'Anna', cognome: 'Bianchi', email: 'a@b.it' });
  assert.strictEqual(res.status, 201);
});

test('modifica nome/email/password → 200', async () => {
  // L'utente da modificare deve esistere: una PATCH su un id inventato ora è 404,
  // perché rispondere "ok" a chi ha sbagliato riga nasconde l'errore.
  const recep = { id: 2, username: 'recep', password_hash: await hashPassword('pw'), role: 'reception', attivo: 1 };
  const { app } = await makeApp({ extraUsers: [recep] });
  const agent = await loginAgent(app);
  const res = await agent.patch('/api/admin/users/2').send({ nome: 'X', email: 'x@y.it', password: 'nuovapassword' });
  assert.strictEqual(res.status, 200);
});

test('password: lunghezza minima, in creazione e in modifica', async () => {
  // D9: bastava un carattere. Non è una politica completa — niente complessità,
  // niente blocco tentativi, e il cookie resta non cifrato perché in hotel si va
  // in HTTP — ma è il minimo che non può fare danni.
  const recep = { id: 2, username: 'recep', password_hash: await hashPassword('pw'), role: 'reception', attivo: 1 };
  const { app } = await makeApp({ extraUsers: [recep] });
  const agent = await loginAgent(app);
  for (const password of ['', 'x', 'corta12', 12345678, null]) {
    const res = await agent.post('/api/admin/users').send({ username: 'tizio', password, role: 'readonly' });
    assert.strictEqual(res.status, 400, `password ${JSON.stringify(password)} accettata`);
  }
  // Il minimo vale anche cambiandola: altrimenti si aggirerebbe con una modifica.
  const corta = await agent.patch('/api/admin/users/2').send({ password: 'corta' });
  assert.strictEqual(corta.status, 400);
  assert.match(corta.body.error, /almeno 8 caratteri/);
  // Otto caratteri esatti passano: il confine non è spostato di uno.
  assert.strictEqual((await agent.patch('/api/admin/users/2').send({ password: 'ottochar' })).status, 200);
  // E una PATCH senza password continua a funzionare.
  assert.strictEqual((await agent.patch('/api/admin/users/2').send({ nome: 'Anna' })).status, 200);
});

test('modifica o eliminazione di un utente inesistente → 404, non un finto ok', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  assert.strictEqual((await agent.patch('/api/admin/users/99999').send({ nome: 'Fantasma' })).status, 404);
  assert.strictEqual((await agent.delete('/api/admin/users/99999')).status, 404);
});

test('username: niente spazi, niente vuoti, niente valori che stringa non sono', async () => {
  // Sul DB vero la colonna è NVARCHAR(50) NOT NULL UNIQUE: uno username di soli
  // spazi o numerico ci entrava, e con quell'account non si faceva più login.
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const cattivi = ['   ', '', 'con spazio', 'a'.repeat(51), 12345, null, { a: 1 }];
  for (const username of cattivi) {
    const res = await agent.post('/api/admin/users').send({ username, password: 'passwordlunga', role: 'readonly' });
    assert.strictEqual(res.status, 400, `username ${JSON.stringify(username)} accettato`);
  }
  // Gli spazi ai lati si tolgono, non fanno fallire.
  const ok = await agent.post('/api/admin/users').send({ username: '  mario.rossi  ', password: 'passwordlunga', role: 'readonly' });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.body.user.username, 'mario.rossi');
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
