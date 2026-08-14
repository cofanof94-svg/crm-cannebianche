const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Sui dati veri del 14/08/2026: 78 legami di nucleo su 80 sono stati rilevati
// dal gestionale, e 75 portano ancora la relazione predefinita "Altro". Con
// quell'etichetta uguale per tutti, l'unica cosa che distingue un
// accompagnatore di ieri da uno del 2016 è questa riga.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

function estrai(nome) {
  const inizio = SRC.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovata in web/app.js`);
  return SRC.slice(inizio, SRC.indexOf('\n}', inizio) + 2);
}
function estraiConst(nome) {
  const riga = SRC.split('\n').find((l) => l.startsWith(`const ${nome} =`));
  assert.ok(riga, `const ${nome} non trovata`);
  return riga;
}

const freq = new Function(`
  ${estraiConst('esc')}
  ${estrai('fmtData')}
  ${estraiConst('TRE_ANNI')}
  ${estrai('frequentazioneNucleo')}
  return frequentazioneNucleo;`)();

// Date relative a oggi, così il test non scade fra un anno.
const giorniFa = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test('mostra quante volte e il mese dell\'ultima volta insieme', () => {
  const html = freq({ insieme: 10, ultimaInsieme: giorniFa(1) });
  assert.match(html, /insieme 10 volte/);
  assert.match(html, /· ultima /);
  // La data intera resta nel tooltip: in riga il mese basta e non occupa spazio.
  assert.match(html, /title="Ultimo soggiorno fatto insieme: /);
});

test('una volta sola si dice al singolare', () => {
  assert.match(freq({ insieme: 1, ultimaInsieme: giorniFa(3) }), /insieme 1 volta\b/);
});

test('oltre i tre anni la riga si accende', () => {
  // 36 soggiorni insieme ma l'ultimo nel 2022: è il caso vero che ha motivato
  // questa aggiunta. Non è un allarme — la coppia può semplicemente non essere
  // più tornata — ma chi accoglie deve poterlo notare.
  const vecchia = freq({ insieme: 36, ultimaInsieme: giorniFa(365 * 4) });
  assert.match(vecchia, /nucleo-freq-vecchia/);
  const recente = freq({ insieme: 36, ultimaInsieme: giorniFa(30) });
  assert.doesNotMatch(recente, /nucleo-freq-vecchia/);
});

test('senza soggiorni insieme non si scrive niente', () => {
  // Un accompagnatore aggiunto a mano non è agganciato al gestionale: uno
  // "insieme 0 volte" sembrerebbe un giudizio invece di un dato che manca.
  assert.strictEqual(freq({ insieme: null, ultimaInsieme: null }), '');
  assert.strictEqual(freq({ insieme: 0, ultimaInsieme: null }), '');
  assert.strictEqual(freq({}), '');
});

test('se manca la data si dice solo quante volte', () => {
  const html = freq({ insieme: 4, ultimaInsieme: null });
  assert.match(html, /insieme 4 volte/);
  assert.doesNotMatch(html, /ultima/);
});
