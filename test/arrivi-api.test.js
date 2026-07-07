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
      return [];
    },
  };
  const pmsDb = {
    async query(text) {
      if (/FROM Persona/.test(text)) return [{ data: '2026-07-07' }];
      if (/AS arrivi/.test(text)) return [{ arrivi: 8, partenze: 3, presenti: 21 }];
      if (/statoPartenza/.test(text)) return [{ codpratica: 5, cognome: 'VERDI', nome: 'LUIGI', camere: '104',
        paxAdulti: 2, paxBambini: 0, dtarrivo: '2026-04-20', dtpartenza: '2026-04-25', notti: 5,
        oraArrivo: null, inCasa: 'S', statoPartenza: 'incasa', trattamento: 'BB', tariffa: 'X', importo: 500, note: null }];
      // query arrivi
      return [{ codpratica: 1, cognome: 'ROSSI', nome: 'MARIO', camere: '101',
        paxAdulti: 2, paxBambini: 0, dtpartenza: '2026-07-10', notti: 4,
        oraArrivo: '15:00', inCasa: 'N', provenienza: 'Diretto', trattamento: 'BB', note: null }];
    },
  };
  return createApp({ crmDb, pmsDb, sessionSecret: 'test' });
}

async function agente(app) {
  const ag = request.agent(app);
  await ag.post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return ag;
}

test('senza login GET /api/arrivi → 401', async () => {
  const app = await makeApp();
  const res = await request(app).get('/api/arrivi?data=2026-07-06');
  assert.strictEqual(res.status, 401);
});

test('GET /api/arrivi con data valida → 200 con lista', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/arrivi?data=2026-07-06');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data, '2026-07-06');
  assert.strictEqual(res.body.arrivi[0].nominativo, 'ROSSI MARIO');
});

test('GET /api/arrivi con data non valida → 400', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/arrivi?data=nonvalida');
  assert.strictEqual(res.status, 400);
});

test('GET /api/arrivi senza data → usa la data di lavoro del PMS (Persona.Dataggio)', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/arrivi');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data, '2026-07-07');
});

test('senza login GET /api/incasa → 401', async () => {
  const app = await makeApp();
  const res = await request(app).get('/api/incasa?data=2026-04-22');
  assert.strictEqual(res.status, 401);
});

test('GET /api/incasa → 200 con clienti in casa', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/incasa?data=2026-04-22');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data, '2026-04-22');
  assert.strictEqual(res.body.clienti[0].nominativo, 'VERDI LUIGI');
});

test('GET /api/dashboard → 200 con i tre conteggi', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/dashboard?data=2026-07-06');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.arrivi, 8);
  assert.strictEqual(res.body.partenze, 3);
  assert.strictEqual(res.body.presenti, 21);
});
