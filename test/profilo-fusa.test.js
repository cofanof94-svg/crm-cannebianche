const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { creaApp, store } = require('../scripts/dev-mock');

// Bug del collaudo dell'11/08/2026: su una scheda fusa la nota personale non si
// riusciva a cancellare. La lettura prende il primo valore non nullo di TUTTO il
// gruppo di fusione, la cancellazione invece svuotava una riga sola: la nota di un
// altro codice riaffiorava subito e il testo tornava a video. Premere Elimina una
// seconda volta non serviva a niente.
//
// Decisione presa con Mik il 12/08/2026: la nota è della PERSONA, quindi Elimina
// cancella su tutto il gruppo. Qui si verifica end-to-end, contro lo stesso strato
// SQL finto che usa il server di sviluppo.

const A = 1001; // resterà il codice principale
const B = 1201; // duplicato da fondere su A

async function entra() {
  // Ogni prova parte pulita: `store` è condiviso fra i test dello stesso file, e
  // una fusione lasciata da una prova precedente falserebbe la successiva.
  store.profili.length = 0;
  store.merge.length = 0;
  const app = await creaApp();
  const ag = request.agent(app);
  const res = await ag.post('/api/auth/login').send({ username: 'admin', password: 'admin' });
  assert.strictEqual(res.status, 200);
  return ag;
}

const profiloDi = async (ag, cod) => (await ag.get(`/api/clienti/${cod}/profilo`)).body.profilo;

async function fondi(ag) {
  const res = await ag.post(`/api/clienti/${A}/merge`).send({ memberId: B, canonicalId: A });
  assert.ok(res.status === 200 || res.status === 201, `merge fallito: ${res.status}`);
}

test('nota personale: cancellare su una scheda fusa la toglie davvero', async () => {
  const ag = await entra();
  assert.strictEqual((await ag.put(`/api/clienti/${B}/note-personali`).send({ testo: 'Nota registrata sul duplicato' })).status, 200);
  await fondi(ag);
  // Prima della cancellazione la nota del duplicato si vede dalla scheda principale.
  assert.match((await profiloDi(ag, A)).note_personali, /duplicato/);

  const del = await ag.put(`/api/clienti/${A}/note-personali`).send({ testo: '' });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.body.notePersonali, null);
  assert.strictEqual(del.body.nota, null); // la sintesi per le card sparisce con la nota

  // Il punto del bug: prima qui la nota tornava.
  assert.strictEqual((await profiloDi(ag, A)).note_personali, null);
  // E non resta appesa nemmeno all'anagrafica su cui era scritta.
  assert.strictEqual((await profiloDi(ag, B)).note_personali, null);
});

test('lingua preferita: stessa storia, stessa cura', async () => {
  const ag = await entra();
  assert.strictEqual((await ag.put(`/api/clienti/${B}/profilo`).send({ lingua: 'DE' })).status, 200);
  assert.strictEqual((await ag.put(`/api/clienti/${A}/profilo`).send({ lingua: 'IT' })).status, 200);
  await fondi(ag);

  assert.strictEqual((await ag.put(`/api/clienti/${A}/profilo`).send({ lingua: '' })).status, 200);
  assert.strictEqual((await profiloDi(ag, A)).lingua, null, 'riaffiorava il DE del duplicato');
  assert.strictEqual((await profiloDi(ag, B)).lingua, null);
});

test('cancellare la nota non porta via la lingua, e viceversa', async () => {
  // Sono due colonne della stessa riga: una cancellazione troppo larga se le
  // porterebbe via entrambe senza che nessuno se ne accorga subito.
  const ag = await entra();
  await ag.put(`/api/clienti/${A}/profilo`).send({ lingua: 'FR' });
  await ag.put(`/api/clienti/${A}/note-personali`).send({ testo: 'Ama la Puglia' });

  await ag.put(`/api/clienti/${A}/note-personali`).send({ testo: '' });
  assert.strictEqual((await profiloDi(ag, A)).lingua, 'FR', 'la lingua non c\'entrava niente');

  await ag.put(`/api/clienti/${A}/profilo`).send({ lingua: 'ES' });
  await ag.put(`/api/clienti/${A}/note-personali`).send({ testo: 'Rimessa' });
  await ag.put(`/api/clienti/${A}/profilo`).send({ lingua: '' });
  assert.strictEqual((await profiloDi(ag, A)).note_personali, 'Rimessa');
});

test('su una scheda non fusa la cancellazione resta quella di sempre', async () => {
  const ag = await entra();
  await ag.put(`/api/clienti/${A}/note-personali`).send({ testo: 'Solo sua' });
  assert.strictEqual((await profiloDi(ag, A)).note_personali, 'Solo sua');
  await ag.put(`/api/clienti/${A}/note-personali`).send({ testo: '' });
  assert.strictEqual((await profiloDi(ag, A)).note_personali, null);
  // Un'anagrafica estranea non viene toccata da una cancellazione altrui.
  await ag.put(`/api/clienti/${B}/note-personali`).send({ testo: 'Di un altro cliente' });
  await ag.put(`/api/clienti/${A}/note-personali`).send({ testo: '' });
  assert.strictEqual((await profiloDi(ag, B)).note_personali, 'Di un altro cliente');
});
