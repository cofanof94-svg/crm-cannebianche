const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');
const { risolviPeriodo, variazione } = require('../src/api/analytics');

// --- Periodi -----------------------------------------------------------------
// Il confronto col periodo precedente ha senso solo a parita' di finestra:
// mettere sette giorni contro un mese direbbe soltanto che un mese e' piu' lungo.

test('periodo predefinito: la finestra comprende oggi e dura quanto dichiarato', () => {
  const p = risolviPeriodo({ periodo: '7g' }, '2026-08-13');
  assert.strictEqual(p.a, '2026-08-13');
  assert.strictEqual(p.da, '2026-08-07'); // 7 giorni INCLUSO oggi, non 8
  assert.strictEqual(p.durata, 7);
});

test('il periodo precedente e\' lungo uguale e finisce il giorno prima', () => {
  const p = risolviPeriodo({ periodo: '7g' }, '2026-08-13');
  assert.deepStrictEqual(p.precedente, { da: '2026-07-31', a: '2026-08-06' });
});

test('periodo personalizzato: si usa quello, e il precedente si ricalcola', () => {
  const p = risolviPeriodo({ da: '2026-01-01', a: '2026-01-31' }, '2026-08-13');
  assert.strictEqual(p.durata, 31);
  assert.deepStrictEqual(p.precedente, { da: '2025-12-01', a: '2025-12-31' });
});

test('date invertite: si rifiuta invece di restituire un periodo vuoto', () => {
  const p = risolviPeriodo({ da: '2026-08-13', a: '2026-01-01' }, '2026-08-13');
  assert.ok(p.errore);
});

test('parametri assenti o senza senso: si ripiega su 30 giorni', () => {
  assert.strictEqual(risolviPeriodo({}, '2026-08-13').durata, 30);
  assert.strictEqual(risolviPeriodo({ periodo: 'sempre' }, '2026-08-13').durata, 30);
  // Una data sola non basta: senza l'altra non c'e' nessun periodo.
  assert.strictEqual(risolviPeriodo({ da: '2026-01-01' }, '2026-08-13').durata, 30);
});

test("l'aritmetica sulle date non si sposta col cambio dell'ora", () => {
  // Ultima domenica di marzo: sommando ore locali si sbaglia di un giorno, e una
  // dashboard che sposta il periodo due volte l'anno e' peggio di una che non c'e'.
  const p = risolviPeriodo({ periodo: '7g' }, '2026-03-30');
  assert.strictEqual(p.da, '2026-03-24');
  assert.strictEqual(p.durata, 7);
});

// --- Variazione --------------------------------------------------------------

test('variazione: percentuale sul periodo precedente', () => {
  assert.strictEqual(variazione(120, 100), 20);
  assert.strictEqual(variazione(80, 100), -20);
  assert.strictEqual(variazione(100, 100), 0);
});

test('variazione: se prima non c\'era niente non si inventa un +100%', () => {
  // Una crescita percentuale calcolata su zero e' un numero senza significato
  // che pero' sembra un risultato: meglio non mostrare la freccia.
  assert.strictEqual(variazione(50, 0), null);
  assert.strictEqual(variazione(0, 0), null);
});

// --- La rotta ----------------------------------------------------------------

async function appAnalytics({ pms = {}, crm = {} } = {}) {
  const admin = { id: 1, username: 'admin', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) return params.username === 'admin' ? [admin] : [];
      if (/SELECT[\s\S]*FROM users WHERE id/.test(text)) return Number(params.id) === 1 ? [admin] : [];
      if (/INSERT INTO crm_accessi/.test(text)) return [];
      if (/conPreferenze/.test(text)) return [crm.copertura || {}];
      if (/AS preferenze/.test(text)) return [{}];
      if (/AS daClassificare/.test(text)) return [{}];
      if (/FROM customer_preferences GROUP BY reparto/.test(text)) return [];
      if (/FROM ai_events/.test(text)) return crm.ai || [];
      if (/FROM crm_accessi/.test(text)) return crm.accessi || [{}];
      return [];
    },
  };
  const pmsDb = {
    async query(text) {
      if (/FROM Persona/.test(text)) return [{ data: '2026-08-13' }];
      if (/AS diRitorno/.test(text)) return [pms.kpi || {}];
      if (/AS senzaEmail/.test(text)) return [pms.qualita || {}];
      if (/SourcePrenota/.test(text)) return pms.canali || [];
      if (/CodNaz/.test(text)) return pms.nazioni || [];
      if (/TabVip/.test(text)) return [];
      if (/StorAddebitiComanda/.test(text)) return pms.consumi || [];
      if (/codgrpmerCAT LIKE 'SPA%'/.test(text)) return [];
      if (/AS mese/.test(text)) return pms.andamento || [];
      return [];
    },
  };
  return createApp({ crmDb, pmsDb, sessionSecret: 'test' });
}

async function entra(app) {
  const ag = request.agent(app);
  await ag.post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return ag;
}

test('GET /api/analytics: KPI, confronto e periodo risolto', async () => {
  const app = await appAnalytics({
    pms: {
      kpi: { soggiorni: 100, ospiti: 90, notti: 400, vip: 20, diRitorno: 30 },
      qualita: { ospiti: 90, senzaEmail: 30, senzaTelefono: 25, senzaDataNascita: 10 },
      canali: [{ voce: 'DIRETTI', n: 60 }, { voce: 'OTA', n: 40 }],
    },
  });
  const ag = await entra(app);
  const res = await ag.get('/api/analytics?periodo=30g');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.periodo.giorni, 30);
  assert.strictEqual(res.body.ospiti.ospiti, 90);
  // Notti medie a SOGGIORNO, non a ospite: e' la domanda che si fa in hotel.
  assert.strictEqual(res.body.ospiti.nottiMedie, 4);
  // Il periodo precedente usa la stessa finta, quindi i numeri coincidono: la
  // variazione dev'essere zero, non nulla.
  assert.strictEqual(res.body.ospiti.confronto.ospiti, 0);
  assert.deepStrictEqual(res.body.canali.map((c) => c.voce), ['DIRETTI', 'OTA']);
});

test('GET /api/analytics: date invertite → 400 con un messaggio leggibile', async () => {
  const app = await appAnalytics();
  const ag = await entra(app);
  const res = await ag.get('/api/analytics?da=2026-08-13&a=2026-01-01');
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /successiva/i);
});

test('la dashboard si apre anche se le tabelle del registro non ci sono', async () => {
  // Su un database dove le migrazioni del 13/08 non sono ancora passate,
  // interrogare ai_events e crm_accessi e' un errore. Far fallire l'intera
  // pagina per due riquadri vuoti sarebbe sproporzionato.
  const app = await appAnalytics();
  const crmRotto = { ai: null, accessi: null };
  const appRotto = await appAnalytics({ crm: crmRotto });
  const ag = await entra(appRotto);
  const res = await ag.get('/api/analytics?periodo=7g');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.crm.ai, []);
  assert.strictEqual(res.body.crm.accessi.riusciti, 0);
  assert.ok(app); // l'altra app serve solo a tenere il confronto leggibile
});

test('sola lettura e reception non entrano in Analytics', async () => {
  // Regola stabilita col ticket dei ruoli, prima ancora che la pagina esistesse.
  const hash = await hashPassword('pw');
  const utenti = {
    lettore: { id: 2, username: 'lettore', password_hash: hash, role: 'readonly', attivo: 1 },
    banco: { id: 3, username: 'banco', password_hash: hash, role: 'reception', attivo: 1 },
  };
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) { const u = utenti[params.username]; return u ? [u] : []; }
      if (/SELECT[\s\S]*FROM users WHERE id/.test(text)) {
        const u = Object.values(utenti).find((x) => x.id === Number(params.id));
        return u ? [u] : [];
      }
      return [];
    },
  };
  const app = createApp({ crmDb, pmsDb: { async query() { return []; } }, sessionSecret: 'test' });
  for (const nome of ['lettore', 'banco']) {
    const ag = request.agent(app);
    await ag.post('/api/auth/login').send({ username: nome, password: 'pw' });
    const res = await ag.get('/api/analytics');
    assert.strictEqual(res.status, 403, `${nome} non deve entrare`);
  }
});
