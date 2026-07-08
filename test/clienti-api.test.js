const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');

async function makeApp() {
  const admin = { id: 1, username: 'admin', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const note = [];
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) return params.username === 'admin' ? [admin] : [];
      if (/INSERT INTO customer_notes/.test(text)) { const n = { id: note.length + 1, ...params }; note.push(n); return [{ id: n.id }]; }
      if (/UPDATE customer_notes/.test(text)) { const n = note.find((x) => x.id === params.id); if (n) { n.testo = params.testo; return [{ id: n.id }]; } return []; }
      if (/DELETE FROM customer_notes/.test(text)) { const i = note.findIndex((x) => x.id === params.id); if (i >= 0) { const id = note[i].id; note.splice(i, 1); return [{ id }]; } return []; }
      if (/FROM customer_notes/.test(text)) return note.filter((n) => n.pmsCustomerId === params.pmsCustomerId).map((n) => ({ id: n.id, testo: n.testo, autore: 'admin', created_at: 'x', autore_user_id: 1, pms_customer_id: n.pmsCustomerId }));
      return [];
    },
  };
  const pmsDb = {
    async query(text, params) {
      if (/cameraInCasa/.test(text)) return [{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANNA', email: 'a@b.it', Cellulare: '', Telefono: '080123', Citta: 'TRANI', cameraInCasa: null }];
      if (/FROM Anagra WHERE CodCli/.test(text)) { if (params && params.codCli === 999) return []; return [{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANNA', Telefono: '', Cellulare: '', email: 'a@b.it', Citta: 'TRANI', CodNaz: 'I', dtNascita: '1964-10-17', CodFis: 'X', CodVip: '', Annotazioni: '', Privacy: 'S', Privacy2: 'S', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' }]; }
      // soggiorni
      return [{ codpratica: 1, dtarrivo: '2026-04-17', dtpartenza: '2026-04-19', notti: 2, camere: '109', importo: 855, stato: 'Concluso' },
              { codpratica: 2, dtarrivo: '2026-07-07', dtpartenza: '2026-07-19', notti: 12, camere: '102', importo: 2300, stato: 'Confermato' }];
    },
  };
  return createApp({ crmDb, pmsDb, sessionSecret: 'test' });
}

async function agente(app) {
  const ag = request.agent(app);
  await ag.post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return ag;
}

test('senza login GET /api/clienti/47186 → 401', async () => {
  const app = await makeApp();
  const res = await request(app).get('/api/clienti/47186');
  assert.strictEqual(res.status, 401);
});

test('GET /api/clienti?q= → risultati', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti?q=bari');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.risultati[0].nominativo, 'DI BARI ANNA');
});

test('GET /api/clienti/:codCli → anagrafica+statistiche+soggiorni', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/47186');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.anagrafica.nominativo, 'DI BARI ANNA');
  assert.strictEqual(res.body.statistiche.nSoggiorni, 2);
  assert.strictEqual(res.body.statistiche.totaleSpeso, 3155);
  assert.strictEqual(res.body.statistiche.primaVisita, '2026-04-17');
  assert.strictEqual(res.body.statistiche.ultimaVisita, '2026-07-07');
});

test('GET /api/clienti/abc → 400', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/abc');
  assert.strictEqual(res.status, 400);
});

test('note: crea, elenca, elimina', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/note').send({ testo: 'prima nota' });
  assert.strictEqual(c.status, 201);
  const l = await ag.get('/api/clienti/47186/note');
  assert.strictEqual(l.body.note[0].testo, 'prima nota');
  const d = await ag.delete('/api/note/1');
  assert.strictEqual(d.status, 200);
});

test('nota vuota → 400', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.post('/api/clienti/47186/note').send({ testo: '   ' });
  assert.strictEqual(res.status, 400);
});

test('GET /api/clienti/999 (inesistente) → 404', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/999');
  assert.strictEqual(res.status, 404);
});

test('consensi invertiti (S = non autorizzato) esposti dall\'API', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/47186');
  assert.deepStrictEqual(res.body.anagrafica.consensi, { marketing: false, telefonate: false, conservazione: true, cessione: true });
});

test('note: PATCH modifica (200) e 404 su id inesistente', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/note').send({ testo: 'prima' });
  const id = c.body.nota.id;
  const upd = await ag.patch(`/api/note/${id}`).send({ testo: 'modificata' });
  assert.strictEqual(upd.status, 200);
  const patch404 = await ag.patch('/api/note/9999').send({ testo: 'x' });
  assert.strictEqual(patch404.status, 404);
  const del404 = await ag.delete('/api/note/9999');
  assert.strictEqual(del404.status, 404);
});
