const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { guastoAi } = require('../src/ai/client');

// Un guasto dell'AI arrivava in reception come "Errore durante la generazione":
// per chi legge è indistinguibile da un bug del CRM, e parte la segnalazione.
// Quasi sempre invece è una cosa che si sistema da sola o con una ricarica.

// L'errore vero restituito dall'SDK a credito esaurito, con la forma annidata
// che ha davvero (err.error.error.message).
const creditoFinito = Object.assign(new Error('400 {"type":"error",…}'), {
  status: 400,
  error: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } },
});

test('credito esaurito: si capisce che è la fatturazione, non il CRM', () => {
  const m = guastoAi(creditoFinito);
  assert.match(m, /Credito AI esaurito/);
  assert.match(m, /ricaricare/i);
  // Chi legge deve sapere subito che il resto dell'applicazione funziona.
  assert.match(m, /altre funzioni del CRM non sono toccate/);
});

test('chiave sbagliata, troppe richieste, servizio giù: ognuno il suo messaggio', () => {
  assert.match(guastoAi({ status: 401, message: 'invalid x-api-key' }), /Chiave API/);
  assert.match(guastoAi({ status: 401, message: 'invalid x-api-key' }), /\.env/);
  assert.match(guastoAi({ status: 429, message: 'rate limit' }), /riprovare fra qualche minuto/);
  assert.match(guastoAi({ status: 529, message: 'overloaded' }), /non disponibile/);
});

test('errore sconosciuto: nessun messaggio inventato, deve diventare un 500', () => {
  // Se non sappiamo cos'è, nasconderlo dietro una frase rassicurante lo toglie
  // dai log e lo rende irrintracciabile.
  assert.strictEqual(guastoAi(new Error('ECONNRESET')), null);
  assert.strictEqual(guastoAi({ status: 400, message: 'max_tokens too large' }), null);
  assert.strictEqual(guastoAi(null), null);
  assert.strictEqual(guastoAi(undefined), null);
});

// --- lato interfaccia -------------------------------------------------------
const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

function estrai(nome) {
  const inizio = SRC.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovata in web/app.js`);
  return SRC.slice(inizio, SRC.indexOf('\n}', inizio) + 2);
}
// eslint-disable-next-line no-new-func
const motivoAiNonDisponibile = new Function(`${estrai('motivoAiNonDisponibile')}\nreturn motivoAiNonDisponibile;`)();

test('la card mostra il motivo che manda il server, non una frase fissa', () => {
  assert.strictEqual(
    motivoAiNonDisponibile({ error: 'Credito AI esaurito: ricaricare il piano Anthropic.' }),
    'Credito AI esaurito: ricaricare il piano Anthropic.'
  );
  // Senza motivo (server vecchio, corpo vuoto) resta la spiegazione storica.
  for (const b of [null, undefined, {}, { error: '   ' }]) {
    assert.match(motivoAiNonDisponibile(b), /AI non configurata/);
  }
});

test('tutti i punti dove l\'interfaccia gestisce un 503 usano il motivo del server', () => {
  // Sono tre: briefing dalla card, note personali, suggerisci preferenze. Se
  // domani se ne aggiunge un quarto con la frase fissa, questo test lo trova.
  const righe503 = SRC.split('\n').filter((r) => r.includes('status === 503'));
  assert.strictEqual(righe503.length, 3);
  for (const r of righe503) assert.match(r, /motivoAiNonDisponibile\(body\)/);
});
