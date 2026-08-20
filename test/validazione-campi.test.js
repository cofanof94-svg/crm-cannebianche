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

test('fusione: niente codici finti, niente gruppi fantasma', async () => {
  // Number(true) è 1, Number('') e Number([]) sono 0: passavano tutti per interi
  // validi. Il gruppo si riempiva di codici che non esistono, che sporcano ogni
  // query per gruppo e dall'interfaccia non si tolgono — il pulsante per
  // scollegare c'è solo per le anagrafiche che si vedono.
  const ag = await entra();
  for (const memberId of [true, '', [], {}, 1.5, '1e3', '0x10', null, '  ']) {
    const res = await ag.post(`/api/clienti/${CLI}/merge`).send({ memberId, canonicalId: CLI });
    assert.strictEqual(res.status, 400, `memberId ${JSON.stringify(memberId)} accettato`);
  }
  // Numero valido ma anagrafica inesistente: 404, non una fusione con un fantasma.
  const inesistente = await ag.post(`/api/clienti/${CLI}/merge`).send({ memberId: 555555, canonicalId: CLI });
  assert.strictEqual(inesistente.status, 404);
  assert.match(inesistente.body.error, /555555/);

  // Il gruppo è rimasto quello che era: nessun codice fantasma si è attaccato.
  // Su una scheda non fusa `merge` è null, ed è il caso giusto qui.
  const scheda = await ag.get(`/api/clienti/${CLI}`);
  const membri = scheda.body.merge ? scheda.body.merge.membri : [CLI];
  assert.deepStrictEqual(membri, [CLI]);

  // E la fusione vera continua a funzionare.
  assert.strictEqual((await ag.post(`/api/clienti/${CLI}/merge`).send({ memberId: 1201, canonicalId: CLI })).status, 201);
});

test('i limiti valgono anche in modifica, non solo in inserimento', async () => {
  // Trovato dall'analisi funzionale: i controlli erano stati messi solo sulle POST.
  // Correggere una riga esistente non è meno rischioso che crearla — il database
  // rifiuta il testo troppo lungo allo stesso modo.
  const ag = await entra();
  const pref = await ag.post(`/api/clienti/${CLI}/preferenze`).send({ testo: 'Amarone', reparto: 'F&B', categoria: 'F&B' });
  assert.strictEqual(pref.status, 201);
  const idPref = pref.body.preferenza.id;
  const membro = await ag.post(`/api/clienti/${CLI}/nucleo`).send({ tipoRelazione: 'Coniuge', nome: 'Anna' });
  assert.strictEqual(membro.status, 201);
  const idMembro = membro.body.membro.id;

  const casi = [
    ['preferenza', 400, () => ag.patch(`/api/clienti/${CLI}/preferenze/${idPref}`).send({ testo: lungo(401) })],
    ['nome nucleo', 80, () => ag.patch(`/api/clienti/${CLI}/nucleo/${idMembro}`).send({ nome: lungo(81) })],
    ['nota nucleo', 400, () => ag.patch(`/api/clienti/${CLI}/nucleo/${idMembro}`).send({ nota: lungo(401) })],
  ];
  for (const [nome, max, chiamata] of casi) {
    const res = await chiamata();
    assert.strictEqual(res.status, 400, `${nome}: modifica troppo lunga accettata`);
    assert.match(res.body.error, new RegExp(`massimo ${max} caratteri`), nome);
  }
  // E i valori che stringa non sono restano fuori anche qui.
  assert.strictEqual((await ag.patch(`/api/clienti/${CLI}/preferenze/${idPref}`).send({ testo: { a: 1 } })).status, 400);
  assert.strictEqual((await ag.patch(`/api/clienti/${CLI}/nucleo/${idMembro}`).send({ nome: ['x'] })).status, 400);
  // Una modifica legittima passa ancora.
  assert.strictEqual((await ag.patch(`/api/clienti/${CLI}/preferenze/${idPref}`).send({ testo: 'Barolo' })).status, 200);
});

test('non si tocca la riga di un altro ospite, nemmeno conoscendone il numero', async () => {
  // D15: preferenze, allergie, reclami e nucleo si cancellavano per numero, senza
  // controllare di chi fossero. Dall'interfaccia non si poteva sbagliare, ma un id
  // sbagliato mandato per errore toccava la scheda di un altro.
  const ag = await entra();
  const ALTRO = 1002;
  const mia = await ag.post(`/api/clienti/${CLI}/intolleranze`).send({ testo: 'Glutine' });
  assert.strictEqual(mia.status, 201);
  const id = mia.body.intolleranza.id;

  // Stesso numero di riga, ma chiesto dalla scheda di un altro ospite: non esiste.
  assert.strictEqual((await ag.delete(`/api/clienti/${ALTRO}/intolleranze/${id}`)).status, 404);
  // E infatti è ancora lì.
  const dopo = await ag.get(`/api/clienti/${CLI}/intolleranze`);
  assert.ok(dopo.body.intolleranze.some((i) => i.id === id), 'la riga è stata cancellata da un\'altra scheda');

  // Dalla sua scheda invece si cancella.
  assert.strictEqual((await ag.delete(`/api/clienti/${CLI}/intolleranze/${id}`)).status, 200);

  // Stessa regola per le correzioni.
  const pref = await ag.post(`/api/clienti/${CLI}/preferenze`).send({ testo: 'Amarone', reparto: 'F&B', categoria: 'F&B' });
  const idPref = pref.body.preferenza.id;
  assert.strictEqual((await ag.patch(`/api/clienti/${ALTRO}/preferenze/${idPref}`).send({ testo: 'Barolo' })).status, 404);
  const rilettura = await ag.get(`/api/clienti/${CLI}/preferenze`);
  assert.strictEqual(rilettura.body.preferenze.find((p) => p.id === idPref).testo, 'Amarone');
});

test('la stessa difesa sugli identificativi vale su tutte le rotte', async () => {
  // D7: il controllo stretto era nato dopo l'incidente delle fusioni fantasma, ma
  // era rimasto solo nelle rotte dove era nato. Una difesa applicata a metà è una
  // difesa che qualcuno crede di avere.
  const ag = await entra();
  // Uno spazio non è in elenco apposta: "/api/clienti/ " viene normalizzato in
  // "/api/clienti/" e finisce sulla rotta di ricerca. È instradamento, non
  // validazione, e ha già la sua difesa nel frontend.
  const cattivi = ['1e3', '0x10', '1.5', 'abc', '1,0'];
  for (const id of cattivi) {
    assert.strictEqual((await ag.get(`/api/clienti/${id}`)).status, 400, `GET cliente ${id}`);
    assert.strictEqual((await ag.get(`/api/clienti/${id}/preferenze`)).status, 400, `preferenze ${id}`);
    assert.strictEqual((await ag.patch(`/api/clienti/${CLI}/complaints/${id}`).send({ testo: 'x' })).status, 400, `complaint ${id}`);
    assert.strictEqual((await ag.get(`/api/admin/users`).query({})).status, 200); // sanity
    assert.strictEqual((await ag.delete(`/api/admin/users/${id}`)).status, 400, `utente ${id}`);
  }
  // Un id valido continua a funzionare.
  assert.notStrictEqual((await ag.get(`/api/clienti/${CLI}`)).status, 400);
});

test('JSON malformato: 400, non un 500 che sembra un guasto nostro', async () => {
  const ag = await entra();
  const res = await ag.post(`/api/clienti/${CLI}/complaints`)
    .set('Content-Type', 'application/json')
    .send('{bad json');
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /non valido/i);
  // Non deve trapelare niente dell'interno: nessuno stack, nessun nome di modulo.
  assert.doesNotMatch(JSON.stringify(res.body), /SyntaxError|at Object|node_modules/);
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
  // Sono sette: se qualcuno ne aggiunge un altro e lo dimentica, la lista sopra
  // non lo copre — almeno il conteggio non deve calare in silenzio.
  // L'apice finale esclude la riga di definizione della funzione.
  // Il settimo è la CORREZIONE di una preferenza (20/08/2026): "la preferenza"
  // compare due volte, una per l'inserimento e una per la modifica in riga.
  assert.strictEqual((APP.match(/erroreSalvataggio\(status, body, '/g) || []).length, 7);
  // E il messaggio dice che il testo è ancora lì: si riprova senza riscrivere.
  assert.match(APP, /Il testo è rimasto nel campo/);
  // Un 403 non va raddoppiato: il motivo lo ha già mostrato api().
  assert.match(APP, /if \(status === 403\) return;/);
});
