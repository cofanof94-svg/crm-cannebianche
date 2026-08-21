const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');
const { risolviPeriodo } = require('../src/api/analytics');
const fs = require('fs');
const path = require('path');

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

// --- Date che rispettano la forma ma non esistono ---------------------------
// Trovate dal collaudo del 20/08/2026. "2026-02-31" passava il controllo (quattro
// cifre, due, due) e arrivava fino a SQL Server, che non riesce a convertirla:
// la pagina rispondeva 500 "Errore interno del server" invece di dire cosa non va.
test('il 31 febbraio non e\' una data: 400, non un errore del server', () => {
  for (const [da, a] of [['2026-02-31', '2026-03-01'], ['2026-13-45', '2026-99-99'], ['2026-01-01', '2026-06-31']]) {
    const r = risolviPeriodo({ da, a }, '2026-08-13');
    assert.ok(r.errore, `${da} → ${a} doveva essere rifiutata`);
  }
  // I giorni che esistono continuano a passare, bisestili compresi.
  assert.strictEqual(risolviPeriodo({ da: '2024-02-29', a: '2024-03-01' }, '2026-08-13').durata, 2);
  assert.strictEqual(risolviPeriodo({ da: '2026-06-01', a: '2026-06-30' }, '2026-08-13').durata, 30);
});

// --- "Solo ospiti VIP": il filtro non deve moltiplicare le ordinazioni -------
// Trovato dal collaudo del 20/08/2026. Il filtro era fatto di JOIN in fondo alla
// query, e `StorAlberg` ha una riga PER OCCUPANTE: una camera con due VIP dentro
// faceva contare due volte ogni ordinazione di quella camera. La spunta poteva
// quindi dare numeri piu' alti di quelli senza spunta — un sottoinsieme piu'
// grande dell'insieme. E guardava solo l'archivio, quindi sui periodi corti
// spariva la parte piu' grossa.
//
// La query non si puo' eseguire da qui (il server finto la riconosce per
// espressione regolare e non ne valida la sintassi): si controlla la FORMA, che
// e' dove stava il difetto. Il conteggio vero va confrontato in hotel.
const SQL_ANALYTICS = fs.readFileSync(path.join(__dirname, '..', 'src', 'pms', 'analytics.js'), 'utf8');

test('il filtro VIP passa da un EXISTS, che non puo\' moltiplicare le righe', () => {
  const i = SQL_ANALYTICS.indexOf('const sqlConsumi');
  const j = SQL_ANALYTICS.indexOf('ORDER BY COUNT(1) DESC`;', i);
  assert.ok(i > 0 && j > i);
  const corpo = SQL_ANALYTICS.slice(i, j);
  assert.match(corpo, /AND EXISTS \(/, 'il filtro dev\'essere un EXISTS');
  // Nessun JOIN condizionato alla spunta: sarebbe di nuovo una moltiplicazione.
  assert.doesNotMatch(corpo, /soloVip \? `JOIN/, 'un JOIN condizionale moltiplica le righe');
});

test('le camere VIP si cercano nel corrente E nell\'archivio, una volta ciascuna', () => {
  const i = SQL_ANALYTICS.indexOf('const CAMERE_VIP');
  const j = SQL_ANALYTICS.indexOf('`;', i);
  assert.ok(i > 0);
  const cte = SQL_ANALYTICS.slice(i, j);
  for (const t of ['StorAlbergDay', 'StorAlberg', 'AlbergDay', 'Alberg']) {
    assert.ok(cte.includes(t), `manca ${t}: un pezzo di soggiorni resta fuori dal filtro`);
  }
  // DISTINCT su entrambi i rami e UNION (non UNION ALL): una camera con due VIP
  // dentro deve restare UNA riga.
  assert.strictEqual((cte.match(/SELECT DISTINCT/g) || []).length, 2);
  assert.match(cte, /\n\s*UNION\n/, 'UNION, non UNION ALL');
});

test('la query dei consumi non ha un TOP: il taglio si fa dopo', () => {
  // Misurato sul database vero il 21/08/2026. Un `TOP 12` con `ORDER BY` su un
  // aggregato fa scegliere a SQL Server un piano che punta a produrre in fretta
  // le prime righe; con l'EXISTS del filtro VIP quel piano e' disastroso. Su
  // dodici mesi: 9,8 secondi con il TOP, 1,1 senza. Su tutto lo storico il TOP
  // superava il limite di quindici secondi e la pagina andava in errore.
  //
  // Rimetterlo sembra un'ottimizzazione ed e' il contrario: questa guardia
  // esiste perche' il difetto non si vede leggendo la query.
  const i = SQL_ANALYTICS.indexOf('const sqlConsumi');
  const j = SQL_ANALYTICS.indexOf('ORDER BY COUNT(1) DESC`;', i);
  const corpo = SQL_ANALYTICS.slice(i, j);
  assert.doesNotMatch(corpo, /SELECT\s+TOP/i, 'niente TOP dentro sqlConsumi');
  // e il taglio deve esserci comunque, altrimenti il riquadro mostra tutto
  assert.match(SQL_ANALYTICS, /const VOCI_CONSUMI = \d+/);
  assert.match(SQL_ANALYTICS, /classifica\(consumi\)\.slice\(0, VOCI_CONSUMI\)/);
});
