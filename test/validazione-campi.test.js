const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { creaApp, store } = require('../scripts/dev-mock');

// Dal collaudo dell'11/08/2026: nessun tetto di lunghezza lato server, mentre le
// colonne del CRM ce l'hanno. Con il DB vero l'INSERT sarebbe stato rifiutato e
// l'API avrebbe risposto 500 — un errore del server per un dato dell'utente, per
// giunta visibile solo nei log. E i valori non stringa finivano a database come
// "[object Object]".

const CLI = 1001;

async function entra() {
  store.merge.length = 0;
  const app = await creaApp();
  const ag = request.agent(app);
  assert.strictEqual((await ag.post('/api/auth/login').send({ username: 'admin', password: 'admin' })).status, 200);
  return ag;
}

const lungo = (n) => 'a'.repeat(n);

test('testo oltre il limite della colonna: 400 con il numero, non 500 dal database', async () => {
  const ag = await entra();
  const casi = [
    ['intolleranza', 200, () => ag.post(`/api/clienti/${CLI}/intolleranze`).send({ testo: lungo(201) })],
    ['preferenza', 400, () => ag.post(`/api/clienti/${CLI}/preferenze`).send({ testo: lungo(401), reparto: 'F&B', categoria: 'F&B' })],
    ['lingua', 40, () => ag.put(`/api/clienti/${CLI}/profilo`).send({ lingua: lungo(41) })],
    ['nome nucleo', 80, () => ag.post(`/api/clienti/${CLI}/nucleo`).send({ tipoRelazione: 'Coniuge', nome: lungo(81) })],
    ['nota nucleo', 400, () => ag.post(`/api/clienti/${CLI}/nucleo`).send({ tipoRelazione: 'Coniuge', nome: 'Anna', nota: lungo(401) })],
    ['periodo reclamo', 60, () => ag.post(`/api/clienti/${CLI}/complaints`).send({ testo: 'x', reparto: 'F&B', categoria: 'Servizio', periodo: lungo(61) })],
  ];
  for (const [nome, max, chiamata] of casi) {
    const res = await chiamata();
    assert.strictEqual(res.status, 400, `${nome}: atteso 400`);
    // Il messaggio dice quanto ci sta e quanto è stato scritto: chi legge sa cosa fare.
    assert.match(res.body.error, new RegExp(`massimo ${max} caratteri`), `${nome}: messaggio poco chiaro`);
  }
});

test('esattamente al limite si salva: il confine non è spostato di uno', async () => {
  const ag = await entra();
  assert.strictEqual((await ag.post(`/api/clienti/${CLI}/intolleranze`).send({ testo: lungo(200) })).status, 201);
  assert.strictEqual((await ag.put(`/api/clienti/${CLI}/profilo`).send({ lingua: lungo(40) })).status, 200);
});

test('un oggetto non è un testo: niente "[object Object]" a database', async () => {
  const ag = await entra();
  const cattivi = [{ a: 1 }, ['x', 'y'], true];
  for (const v of cattivi) {
    const res = await ag.post(`/api/clienti/${CLI}/complaints`).send({ testo: v, reparto: 'F&B', categoria: 'Servizio' });
    assert.strictEqual(res.status, 400, `testo ${JSON.stringify(v)} accettato`);
    assert.match(res.body.error, /non valido/i);
  }
  const pref = await ag.post(`/api/clienti/${CLI}/preferenze`).send({ testo: { a: 1 }, reparto: 'F&B', categoria: 'F&B' });
  assert.strictEqual(pref.status, 400);
  // I numeri invece passano: "camera 101" scritto come 101 è un caso legittimo.
  assert.strictEqual((await ag.post(`/api/clienti/${CLI}/intolleranze`).send({ testo: 12345 })).status, 201);
});

test('quello che era valido prima resta valido', async () => {
  const ag = await entra();
  assert.strictEqual((await ag.post(`/api/clienti/${CLI}/intolleranze`).send({ testo: '  Celiachia  ' })).status, 201);
  assert.strictEqual((await ag.post(`/api/clienti/${CLI}/preferenze`).send({ testo: 'Amarone', reparto: 'F&B', categoria: 'F&B' })).status, 201);
  assert.strictEqual((await ag.post(`/api/clienti/${CLI}/nucleo`).send({ tipoRelazione: 'Coniuge', nome: 'Anna', cognome: 'Rossi' })).status, 201);
  assert.strictEqual((await ag.put(`/api/clienti/${CLI}/profilo`).send({ lingua: 'IT' })).status, 200);
  // Campo vuoto = ancora "mancante", non "troppo lungo".
  const vuoto = await ag.post(`/api/clienti/${CLI}/intolleranze`).send({ testo: '   ' });
  assert.strictEqual(vuoto.status, 400);
  assert.match(vuoto.body.error, /mancante/i);
});

// --- Il silenzio dei form -----------------------------------------------------

const APP = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

test('nessun form salva in silenzio quando la chiamata fallisce', async () => {
  // Prima c'era `if (status === 201) { … }` e basta: se falliva non succedeva
  // niente. Campo pieno, nessun messaggio, nessuna riga. Sulle intolleranze
  // significava credere di aver registrato un'allergia che non c'è.
  // Le etichette sono quelle che l'operatore legge nell'avviso: "Non è stato
  // possibile salvare la preferenza."
  const salvataggi = ['la preferenza', "l\\'allergia", 'il componente del nucleo', 'il reclamo', 'la lingua preferita', 'la nota personale'];
  for (const cosa of salvataggi) {
    assert.ok(APP.includes(`erroreSalvataggio(status, body, '${cosa}')`),
      `il salvataggio di "${cosa}" non segnala l'errore`);
  }
  // Sono sei: se qualcuno ne aggiunge un settimo e lo dimentica, la lista sopra
  // non lo copre — almeno il conteggio non deve calare in silenzio.
  // L'apice finale esclude la riga di definizione della funzione.
  assert.strictEqual((APP.match(/erroreSalvataggio\(status, body, '/g) || []).length, 6);
  // E il messaggio dice che il testo è ancora lì: si riprova senza riscrivere.
  assert.match(APP, /Il testo è rimasto nel campo/);
  // Un 403 non va raddoppiato: il motivo lo ha già mostrato api().
  assert.match(APP, /if \(status === 403\) return;/);
});
