const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { creaApp } = require('../scripts/dev-mock');

// Il server finto è lo strumento con cui si prova tutto quello che si sviluppa
// fuori dall'hotel: se sbaglia in silenzio, si finisce per credere funzionante
// (o rotto) qualcosa che non lo è.
//
// Successo davvero: "Elimina utente non fa niente". La cancellazione rispondeva
// ok senza cancellare, perché "DELETE FROM users WHERE id = @id" contiene anche
// "FROM users WHERE id" e finiva nel ramo della SELECT, messo prima. Il database
// vero non ha questo problema — è il mock che riconosce le query per pezzi di
// testo. Regola che ne discende: nel mock le SCRITTURE vanno prima delle letture.

async function entra() {
  const app = await creaApp();
  const ag = request.agent(app);
  const res = await ag.post('/api/auth/login').send({ username: 'admin', password: 'admin' });
  assert.strictEqual(res.status, 200, 'login admin fallito sul mock');
  return ag;
}

const nomiUtenti = async (ag) => (await ag.get('/api/admin/users')).body.users.map((u) => u.username);

test('mock: creare, modificare ed eliminare un utente cambia davvero la lista', async () => {
  const ag = await entra();
  const iniziali = await nomiUtenti(ag);
  assert.ok(iniziali.includes('admin'));

  const creato = await ag.post('/api/admin/users').send({ username: 'prova', password: 'pw', role: 'reception' });
  assert.strictEqual(creato.status, 201);
  assert.ok((await nomiUtenti(ag)).includes('prova'), 'utente creato ma non in elenco');

  const id = creato.body.user.id;
  assert.strictEqual((await ag.patch(`/api/admin/users/${id}`).send({ role: 'readonly' })).status, 200);
  const dopoPatch = (await ag.get('/api/admin/users')).body.users.find((u) => u.id === id);
  assert.strictEqual(dopoPatch.role, 'readonly', 'la modifica ha risposto ok senza modificare');

  assert.strictEqual((await ag.delete(`/api/admin/users/${id}`)).status, 200);
  assert.ok(!(await nomiUtenti(ag)).includes('prova'), 'la cancellazione ha risposto ok senza cancellare');
});

test('mock: i tre ruoli di prova ci sono, e nessuno di troppo', async () => {
  const ag = await entra();
  const utenti = (await ag.get('/api/admin/users')).body.users;
  assert.deepStrictEqual(
    utenti.map((u) => `${u.username}:${u.role}`).sort(),
    ['admin:admin', 'lettore:readonly', 'reception:reception']
  );
});

test('mock: le scritture vengono prima delle letture, per tutte le tabelle', () => {
  // La regola generale dietro al bug: se una SELECT scritta prima intercetta il
  // testo di una DELETE/UPDATE, quella scrittura non avviene mai e nessuno se ne
  // accorge, perché la rotta risponde ok lo stesso.
  const fs = require('fs');
  const path = require('path');
  const righe = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'dev-mock.js'), 'utf8').split('\n');
  const controlli = [];
  righe.forEach((l, i) => {
    const m = l.match(/if \(\/([^/]+)\/\.test\(t\)/);
    if (m) controlli.push({ riga: i + 1, re: m[1], scrittura: /^(DELETE|UPDATE|INSERT|MERGE)/.test(m[1]) });
  });
  assert.ok(controlli.length > 30, 'lo strato SQL finto è cambiato forma: rivedere questo controllo');

  const scavalcate = [];
  for (const s of controlli.filter((c) => c.scrittura)) {
    const query = s.re.replace(/\\/g, ''); // la query tipo che quella regola gestisce
    for (const l of controlli) {
      if (l.riga >= s.riga) break;
      if (l.scrittura) continue;
      // I blocchi annidati (es. `if (/customer_merge/) { … }`) non scavalcano: la
      // scrittura sta dentro, non dopo. Si riconoscono perché la regola esterna è
      // il solo nome della tabella.
      if (/^[a-z_]+$/.test(l.re)) continue;
      try {
        if (new RegExp(l.re).test(query)) scavalcate.push(`riga ${s.riga} [${s.re}] intercettata da riga ${l.riga} [${l.re}]`);
      } catch { /* frammento non valido come regexp isolata */ }
    }
  }
  assert.deepStrictEqual(scavalcate, [], `scritture mai eseguite nel mock:\n  ${scavalcate.join('\n  ')}`);
});
