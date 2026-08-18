const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');
const { risolviPeriodo } = require('../src/api/analytics');

// --- Periodi -----------------------------------------------------------------

test('periodo predefinito: la finestra comprende oggi e dura quanto dichiarato', () => {
  const p = risolviPeriodo({ periodo: '7g' }, '2026-08-13');
  assert.strictEqual(p.a, '2026-08-13');
  assert.strictEqual(p.da, '2026-08-07'); // 7 giorni INCLUSO oggi, non 8
  assert.strictEqual(p.durata, 7);
});

test('periodo personalizzato: si usa quello, e la durata si ricalcola', () => {
  const p = risolviPeriodo({ da: '2026-01-01', a: '2026-01-31' }, '2026-08-13');
  assert.strictEqual(p.da, '2026-01-01');
  assert.strictEqual(p.a, '2026-01-31');
  assert.strictEqual(p.durata, 31);
});

test('del periodo precedente non resta traccia', () => {
  // Le frecce di confronto sono state tolte il 18/08/2026: in un albergo
  // stagionale confrontare trenta giorni di agosto con trenta di luglio racconta
  // la stagione, non l'hotel. Se un giorno tornera' un confronto dovra' essere
  // con lo stesso periodo dell'anno prima, che e' un altro calcolo.
  const p = risolviPeriodo({ periodo: '7g' }, '2026-08-13');
  assert.strictEqual(p.precedente, undefined);
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

// --- La rotta ----------------------------------------------------------------

// `conta` (facoltativo) tiene il numero di esecuzioni per interrogazione: serve a
// dimostrare che l'interrogazione piu' pesante della pagina viene fatta UNA volta.
async function appAnalytics({ pms = {}, crm = {}, conta = {} } = {}) {
  const admin = { id: 1, username: 'admin', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) return params.username === 'admin' ? [admin] : [];
      if (/SELECT[\s\S]*FROM users WHERE id/.test(text)) return Number(params.id) === 1 ? [admin] : [];
      if (/INSERT INTO crm_accessi/.test(text)) return [];
      if (/conPreferenze/.test(text)) return [crm.copertura || {}];
      if (/AS preferenze/.test(text)) return [crm.scritte || {}];
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
      if (/AS diRitorno/.test(text)) { conta.kpi = (conta.kpi || 0) + 1; return [pms.kpi || {}]; }
      if (/AS senzaEmail/.test(text)) return [pms.qualita || {}];
      if (/SourcePrenota/.test(text)) return pms.canali || [];
      if (/CodNaz/.test(text)) return pms.nazioni || [];
      if (/TabVip/.test(text)) return [];
      if (/StorAddebitiComanda/.test(text)) return pms.consumi || [];
      if (/codgrpmerCAT LIKE 'SPA%'/.test(text)) return [];
      if (/AS inizio/.test(text)) {
        if (pms.inizio === 'guasto') throw new Error('storico non leggibile');
        return [{ inizio: pms.inizio || null }];
      }
      if (/AS mese/.test(text)) { conta.perAnno = /varchar\(4\)/.test(text); return pms.andamento || []; }
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

test('GET /api/analytics: KPI e periodo risolto', async () => {
  const conta = {};
  const app = await appAnalytics({
    conta,
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
  assert.deepStrictEqual(res.body.canali.map((c) => c.voce), ['DIRETTI', 'OTA']);
  // Niente piu' confronto col periodo precedente, ne' nella risposta ne' come
  // seconda esecuzione dell'interrogazione piu' pesante della pagina.
  assert.strictEqual(res.body.ospiti.confronto, undefined);
  assert.strictEqual(res.body.periodo.precedente, undefined);
  assert.strictEqual(conta.kpi, 1, 'la query dei KPI dev\'essere eseguita una volta sola');
});

test('GET /api/analytics: quanto e\' stato scritto nel periodo arriva alla pagina', async () => {
  // Il dato veniva calcolato dal server e buttato via: e' l'unico numero del
  // blocco CRM che si muove, e risponde a "stiamo raccogliendo o siamo fermi?".
  const app = await appAnalytics({ crm: { scritte: { preferenze: 12, allergie: 3, reclami: 1 } } });
  const ag = await entra(app);
  const res = await ag.get('/api/analytics?periodo=30g');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.crm.scritteNelPeriodo, { preferenze: 12, allergie: 3, reclami: 1 });
});

// --- Tutto lo storico --------------------------------------------------------

test('tutto lo storico parte dal primo soggiorno che il gestionale ricorda', async () => {
  const conta = {};
  const app = await appAnalytics({ conta, pms: { inizio: '2016-05-04' } });
  const ag = await entra(app);
  const res = await ag.get('/api/analytics?periodo=tutto');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.periodo.da, '2016-05-04');
  assert.strictEqual(res.body.periodo.a, '2026-08-13'); // la data di lavoro
  assert.strictEqual(res.body.periodo.tutto, true);
  // Oltre i due anni i punti del grafico sono anni: un'etichetta per mese su
  // dieci anni di storico sarebbe centoventi scritte da dieci pixel.
  assert.strictEqual(res.body.andamentoPerAnno, true);
  assert.strictEqual(conta.perAnno, true, 'la query deve raggruppare per anno');
});

test('una data d\'inizio assurda non fa partire il grafico da un secolo vuoto', async () => {
  // Nei gestionali vecchi capita una prenotazione con l'anno sbagliato: basta
  // quella per portare l'inizio dello storico a prima che l'hotel esistesse.
  const app = await appAnalytics({ pms: { inizio: '1974-01-01' } });
  const ag = await entra(app);
  const res = await ag.get('/api/analytics?periodo=tutto');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.periodo.da > '2006-01-01', `inizio non limitato: ${res.body.periodo.da}`);
  assert.ok(res.body.periodo.da < '2007-01-01', `inizio limitato troppo: ${res.body.periodo.da}`);
});

test('se lo storico non si riesce a leggere la pagina si apre lo stesso', async () => {
  for (const inizio of ['guasto', null]) {
    const app = await appAnalytics({ pms: { inizio } });
    const ag = await entra(app);
    const res = await ag.get('/api/analytics?periodo=tutto');
    assert.strictEqual(res.status, 200, `caso ${inizio}`);
    assert.ok(res.body.periodo.da < '2017-01-01', `ripiego troppo corto: ${res.body.periodo.da}`);
  }
});

test('anche un periodo scelto a mano, se lungo, passa agli anni', async () => {
  // La regola sta sulla DURATA, non sul pulsante: chi digita dal 2015 a oggi
  // deve avere lo stesso grafico leggibile.
  const conta = {};
  const app = await appAnalytics({ conta });
  const ag = await entra(app);
  const lungo = await ag.get('/api/analytics?da=2015-01-01&a=2026-08-13');
  assert.strictEqual(lungo.body.andamentoPerAnno, true);
  assert.strictEqual(lungo.body.periodo.tutto, false);
  const corto = await ag.get('/api/analytics?da=2026-01-01&a=2026-08-13');
  assert.strictEqual(corto.body.andamentoPerAnno, false);
  assert.strictEqual(conta.perAnno, false);
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

test('i duplicati da gestire arrivano nel blocco CRM', async () => {
  // E' la coda di lavoro della pagina Duplicati, ed e' l'esempio che il ticket
  // fa di riquadro navigabile: sui dati veri sono 305.
  const app = await appAnalytics();
  const ag = await entra(app);
  const res = await ag.get('/api/analytics?periodo=7g');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.crm.duplicati, 'il conteggio dev\'essere presente');
  assert.strictEqual(typeof res.body.crm.duplicati.daGestire, 'number');
});

test('se i duplicati non si contano, la pagina si apre lo stesso', async () => {
  // Costa mezzo secondo su tutte le anagrafiche: se fallisce, un riquadro in
  // meno e' meglio di una schermata bianca.
  const admin = { id: 1, username: 'admin', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) return params.username === 'admin' ? [admin] : [];
      if (/SELECT[\s\S]*FROM users WHERE id/.test(text)) return Number(params.id) === 1 ? [admin] : [];
      return [];
    },
  };
  const pmsDb = {
    async query(text) {
      if (/FROM Persona/.test(text)) return [{ data: '2026-08-13' }];
      if (/CodFis/.test(text)) throw new Error('interrogazione duplicati non disponibile');
      return [];
    },
  };
  const app = createApp({ crmDb, pmsDb, sessionSecret: 'test' });
  const ag = request.agent(app);
  await ag.post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  const res = await ag.get('/api/analytics?periodo=7g');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.crm.duplicati, null);
});
