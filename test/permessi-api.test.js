const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');

// Il requisito che conta del ticket: "un utente non autorizzato non deve poter
// eseguire un'azione aggirando la UI". Qui la UI non c'è proprio — si chiamano le
// API a mano, che è esattamente il modo in cui uno aggirerebbe i pulsanti nascosti.

const PASSWORD = 'pw';

async function appConUtenti() {
  const hash = await hashPassword(PASSWORD);
  const utenti = {
    lettore: { id: 1, username: 'lettore', password_hash: hash, role: 'readonly', attivo: 1 },
    banco: { id: 2, username: 'banco', password_hash: hash, role: 'reception', attivo: 1 },
    capo: { id: 3, username: 'capo', password_hash: hash, role: 'admin', attivo: 1 },
    // Utente con il vecchio ruolo, come potrebbe essercene uno nel DB dell'hotel.
    vecchio: { id: 4, username: 'vecchio', password_hash: hash, role: 'marketing', attivo: 1 },
  };
  // Basta rispondere al login: tutto ciò che qui verifichiamo viene rifiutato
  // dalla guardia PRIMA di arrivare al database.
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) {
        const u = utenti[params.username];
        return u ? [u] : [];
      }
      // Il ruolo si rilegge a ogni richiesta: qui la finta deve saperlo dire
      // anche per id, altrimenti la guardia crede che l'utente sia sparito.
      if (/SELECT[\s\S]*FROM users WHERE id/.test(text)) {
        const u = Object.values(utenti).find((x) => x.id === Number(params.id));
        return u ? [u] : [];
      }
      return [];
    },
  };
  const pmsDb = { async query() { return []; } };
  return createApp({ crmDb, pmsDb, sessionSecret: 'test' });
}

async function entra(app, username) {
  const ag = request.agent(app);
  const res = await ag.post('/api/auth/login').send({ username, password: PASSWORD });
  assert.strictEqual(res.status, 200, `login fallito per ${username}`);
  return { ag, login: res.body.user };
}

// Chiamate che modificano dati, una per famiglia: se la guardia si applicasse solo
// ad alcune rotte, questa lista lo direbbe subito.
const SCRITTURE = [
  ['post', '/api/clienti/47186/preferenze'],
  ['post', '/api/clienti/47186/intolleranze'],
  ['post', '/api/clienti/47186/complaints'],
  ['post', '/api/clienti/47186/nucleo'],
  ['post', '/api/clienti/47186/merge'],
  ['put', '/api/clienti/47186/note-personali'],
  ['put', '/api/clienti/47186/profilo'],
  ['patch', '/api/clienti/47186/preferenze/1'],
  ['patch', '/api/clienti/47186/complaints/1'],
  ['patch', '/api/clienti/47186/nucleo/1'],
  ['delete', '/api/merge/1'],
];

test('read only: legge, ma ogni scrittura torna 403', async () => {
  const app = await appConUtenti();
  const { ag, login } = await entra(app, 'lettore');
  // I permessi arrivano già risolti: il frontend non deve interpretare il ruolo.
  assert.deepStrictEqual(login.permessi, ['leggi']);

  const lettura = await ag.get('/api/clienti/47186');
  assert.notStrictEqual(lettura.status, 403, 'la consultazione deve restare libera');

  for (const [metodo, url] of SCRITTURE) {
    const res = await ag[metodo](url).send({});
    assert.strictEqual(res.status, 403, `${metodo.toUpperCase()} ${url} doveva essere negato`);
    assert.match(res.body.error, /sola consultazione/i);
    assert.strictEqual(res.body.permesso, 'scrivi'); // serve all'interfaccia per dire la cosa giusta
  }
});

test('read only: niente AI, niente utenti, niente Analytics', async () => {
  const app = await appConUtenti();
  const { ag } = await entra(app, 'lettore');
  for (const url of ['/api/clienti/47186/briefing', '/api/clienti/47186/suggerimenti']) {
    const res = await ag.post(url).send({});
    assert.strictEqual(res.status, 403, url);
    assert.strictEqual(res.body.permesso, 'usa-ai');
  }
  assert.strictEqual((await ag.get('/api/admin/users')).status, 403);
  assert.strictEqual((await ag.get('/api/analytics')).status, 403);
});

test('reception: scrive e usa l\'AI, ma non amministra', async () => {
  const app = await appConUtenti();
  const { ag, login } = await entra(app, 'banco');
  assert.deepStrictEqual(login.permessi, ['leggi', 'scrivi', 'usa-ai']);

  for (const [metodo, url] of SCRITTURE) {
    const res = await ag[metodo](url).send({});
    assert.notStrictEqual(res.status, 403, `${metodo.toUpperCase()} ${url} non doveva essere negato`);
  }
  // L'AI non è configurata nei test: 503, non 403. La differenza è il punto.
  const ai = await ag.post('/api/clienti/47186/briefing').send({});
  assert.notStrictEqual(ai.status, 403);

  // I due divieti espliciti del ticket.
  const utenti = await ag.get('/api/admin/users');
  assert.strictEqual(utenti.status, 403);
  assert.match(utenti.body.error, /amministratore/i);
  const analytics = await ag.get('/api/analytics');
  assert.strictEqual(analytics.status, 403);
  assert.match(analytics.body.error, /riservata agli amministratori/i);
});

test('admin: passa dappertutto', async () => {
  const app = await appConUtenti();
  const { ag, login } = await entra(app, 'capo');
  assert.ok(login.permessi.includes('gestisci-utenti'));
  assert.ok(login.permessi.includes('vedi-analytics'));
  assert.notStrictEqual((await ag.get('/api/admin/users')).status, 403);
  assert.notStrictEqual((await ag.post('/api/clienti/47186/preferenze').send({})).status, 403);
  // Analytics non è ancora implementata: 404 va bene, 403 no.
  assert.strictEqual((await ag.get('/api/analytics')).status, 404);
});

test('un ruolo vecchio nel database non diventa un permesso in più', async () => {
  const app = await appConUtenti();
  const { ag, login } = await entra(app, 'vecchio'); // role = 'marketing'
  assert.deepStrictEqual(login.permessi, ['leggi'], 'un ruolo ignoto vale sola lettura');
  assert.strictEqual((await ag.post('/api/clienti/47186/preferenze').send({})).status, 403);
  assert.strictEqual((await ag.get('/api/admin/users')).status, 403);
  // Ma continua a poter consultare: chi ha un account non resta chiuso fuori.
  assert.notStrictEqual((await ag.get('/api/clienti/47186')).status, 403);
});

test('nessuna scorciatoia: le maiuscole nell\'URL non scavalcano la guardia', async () => {
  // Successo davvero al primo collaudo: con /api/ADMIN/users la reception si e'
  // creata un amministratore. Qui si rifa' l'attacco per intero, perche' un test
  // sulla funzione pura non basterebbe: il punto era proprio che Express
  // instradava una forma che la guardia non riconosceva.
  const app = await appConUtenti();
  const { ag } = await entra(app, 'banco'); // reception
  for (const url of ['/api/ADMIN/users', '/api/Admin/users', '/api/aDmIn/users']) {
    assert.strictEqual((await ag.get(url)).status, 403, `GET ${url}`);
    const creato = await ag.post(url).send({ username: 'backdoor', password: 'x', role: 'admin' });
    assert.strictEqual(creato.status, 403, `POST ${url} ha creato un utente`);
  }
  // E la promozione di un utente esistente, che era l'altra strada.
  assert.strictEqual((await ag.patch('/api/ADMIN/users/1').send({ role: 'admin' })).status, 403);
  assert.strictEqual((await ag.get('/api/ANALYTICS')).status, 403);
});

test('chi consulta non lascia righe: nessuna scrittura durante una lettura', async () => {
  // Trovato dall'analisi funzionale. La guardia dei permessi ragiona sul metodo
  // HTTP e considera una GET una lettura — giustamente. Ma GET /clienti/:id/nucleo,
  // la prima volta, PRECOMPILA il nucleo con i co-occupanti: un utente di sola
  // consultazione, solo aprendo una scheda, si ritrovava righe scritte a suo nome.
  // Qui si usa il server finto, che ha davvero i dati per la precompilazione.
  const { creaApp, store } = require('../scripts/dev-mock');
  store.nucleo.length = 0;
  store.nucleoInit.clear();
  const app = await creaApp();

  const lettore = request.agent(app);
  assert.strictEqual((await lettore.post('/api/auth/login').send({ username: 'lettore', password: 'admin' })).status, 200);
  const vista = await lettore.get('/api/clienti/1001/nucleo');
  assert.strictEqual(vista.status, 200, 'la consultazione deve restare permessa');
  assert.strictEqual(store.nucleo.length, 0, 'un utente in sola lettura ha scritto nel database');

  // Chi può scrivere invece la precompilazione la fa, come previsto.
  const banco = request.agent(app);
  assert.strictEqual((await banco.post('/api/auth/login').send({ username: 'reception', password: 'admin' })).status, 200);
  assert.strictEqual((await banco.get('/api/clienti/1001/nucleo')).status, 200);
  assert.ok(store.nucleo.length > 0, 'la precompilazione non è avvenuta per chi può scrivere');
});

test('senza sessione tutto è 401, anche le rotte che non esistono', async () => {
  const app = await appConUtenti();
  assert.strictEqual((await request(app).get('/api/clienti/47186')).status, 401);
  assert.strictEqual((await request(app).post('/api/clienti/47186/preferenze').send({})).status, 401);
  assert.strictEqual((await request(app).get('/api/admin/users')).status, 401);
  // 401 e non 404: chi non è autenticato non deve nemmeno sapere cosa esiste.
  assert.strictEqual((await request(app).get('/api/analytics')).status, 401);
});

test('i ruoli assegnabili li elenca il server, con etichetta e descrizione', async () => {
  const app = await appConUtenti();
  const { ag } = await entra(app, 'capo');
  const res = await ag.get('/api/admin/ruoli');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.ruoli.map((r) => r.nome), ['readonly', 'reception', 'admin']);
  for (const r of res.body.ruoli) {
    assert.ok(r.etichetta, `${r.nome} senza etichetta`);
    assert.ok(r.descrizione, `${r.nome} senza descrizione`);
    assert.ok(Array.isArray(r.permessi) && r.permessi.length, `${r.nome} senza permessi`);
  }
  // 'marketing' non è più assegnabile: non deve ricomparire dal menu.
  assert.ok(!res.body.ruoli.some((r) => r.nome === 'marketing'));
});

// --- Revoca dei permessi a sessione aperta -----------------------------------
// Il ruolo viene letto al login e messo in sessione. Fino al 13/08/2026 nessuno
// lo rileggeva piu': declassare qualcuno non aveva effetto finche' non usciva e
// rientrava, e la sessione dura otto ore. Visto in hotel declassando un utente a
// sola lettura e trovandolo ancora operativo nell'altra finestra.

async function appConUtentiModificabili() {
  const hash = await hashPassword(PASSWORD);
  const utenti = {
    banco: { id: 2, username: 'banco', password_hash: hash, role: 'reception', attivo: 1 },
  };
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) {
        const u = utenti[params.username];
        return u ? [u] : [];
      }
      if (/SELECT[\s\S]*FROM users WHERE id/.test(text)) {
        const u = Object.values(utenti).find((x) => x.id === Number(params.id));
        return u ? [u] : [];
      }
      return [];
    },
  };
  const app = createApp({ crmDb, pmsDb: { async query() { return []; } }, sessionSecret: 'test' });
  return { app, utenti };
}

test('declassare un utente ha effetto subito, non al suo prossimo accesso', async () => {
  const { app, utenti } = await appConUtentiModificabili();
  const { ag } = await entra(app, 'banco');

  // Prima: scrive.
  assert.notStrictEqual((await ag.post('/api/clienti/47186/preferenze').send({})).status, 403);

  // Un admin lo declassa mentre lui e' dentro, con la sessione ancora aperta.
  utenti.banco.role = 'readonly';

  const dopo = await ag.post('/api/clienti/47186/preferenze').send({});
  assert.strictEqual(dopo.status, 403, 'la revoca deve valere sulla sessione gia\' aperta');
  // E anche cio' che l'interfaccia legge deve dire la verita' nuova.
  const me = await ag.get('/api/me');
  assert.deepStrictEqual(me.body.user.permessi, ['leggi']);
});

test('disattivare un utente lo butta fuori subito', async () => {
  const { app, utenti } = await appConUtentiModificabili();
  const { ag } = await entra(app, 'banco');
  assert.notStrictEqual((await ag.get('/api/clienti/47186')).status, 401);

  utenti.banco.attivo = 0;

  const res = await ag.get('/api/clienti/47186');
  assert.strictEqual(res.status, 401, 'un utente disattivato non resta dentro fino al logout');
  assert.match(res.body.error, /sessione/i);
});

test('un utente eliminato non sopravvive nella propria sessione', async () => {
  const { app, utenti } = await appConUtentiModificabili();
  const { ag } = await entra(app, 'banco');
  delete utenti.banco;
  assert.strictEqual((await ag.get('/api/clienti/47186')).status, 401);
});
