const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// web/app.js è uno script da browser (niente moduli, niente build): non si può
// require(). Per le funzioni PURE si estrae il sorgente e lo si valuta, così
// anche il frontend ha una rete di sicurezza. matchPrenotazione la merita: la
// ricerca per numero di pratica era già stata persa una volta nel redesign di
// "In casa", e la pratica è l'unico identificativo univoco di una prenotazione.
function caricaFunzione(nome) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const inizio = src.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovata in web/app.js`);
  const fine = src.indexOf('\n}', inizio);
  assert.notStrictEqual(fine, -1, `fine di ${nome} non trovata`);
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(inizio, fine + 2)}\nreturn ${nome};`)();
}

const matchPrenotazione = caricaFunzione('matchPrenotazione');

const prenotazione = {
  codpratica: 70104,
  camere: '109, 218, 224',
  nominativo: 'PAGLIUSO ROBERT RALPH',
  ospiti: [{ nominativo: 'PAGLIUSO ROSEMARIE' }, { nominativo: 'PAGLIUSO NATALIA' }],
};

test('matchPrenotazione: trova per numero di pratica, intero o parziale', () => {
  assert.strictEqual(matchPrenotazione(prenotazione, '70104'), true);
  assert.strictEqual(matchPrenotazione(prenotazione, '104'), true);   // frammento
  assert.strictEqual(matchPrenotazione(prenotazione, '70999'), false);
});

test('matchPrenotazione: trova per camera, referente e occupante', () => {
  assert.strictEqual(matchPrenotazione(prenotazione, '218'), true);
  assert.strictEqual(matchPrenotazione(prenotazione, 'pagliuso'), true);
  assert.strictEqual(matchPrenotazione(prenotazione, 'ROBERT'), true);       // case-insensitive
  assert.strictEqual(matchPrenotazione(prenotazione, 'natalia'), true);      // solo fra gli occupanti
  assert.strictEqual(matchPrenotazione(prenotazione, 'rossi'), false);
});

test('matchPrenotazione: ricerca vuota mostra tutto, spazi ignorati', () => {
  assert.strictEqual(matchPrenotazione(prenotazione, ''), true);
  assert.strictEqual(matchPrenotazione(prenotazione, '   '), true);
  assert.strictEqual(matchPrenotazione(prenotazione, undefined), true);
  assert.strictEqual(matchPrenotazione(prenotazione, '  70104  '), true);
});

test('matchPrenotazione: regge i campi mancanti senza esplodere', () => {
  const scarna = { codpratica: 70201 };
  assert.strictEqual(matchPrenotazione(scarna, '70201'), true);
  assert.strictEqual(matchPrenotazione(scarna, 'rossi'), false);
  assert.strictEqual(matchPrenotazione({}, 'x'), false);
});
