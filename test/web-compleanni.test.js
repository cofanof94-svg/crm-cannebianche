const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// La pastiglia dei compleanni in card (Arrivi e In casa usano lo stesso pezzo).
// Misurato sul database dell'hotel il 14/08/2026: delle 1.482 prenotazioni con
// almeno un compleanno durante il soggiorno, 41 ne hanno più di uno — e in
// quasi metà di quei casi le due date COINCIDONO (gemelle, madre e figlia).
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

const flagCompleanni = new Function(`
  ${estraiConst('esc')}
  ${estrai('fmtData')}
  ${estrai('linkCliente')}
  ${estrai('flagCompleanni')}
  return flagCompleanni;`)();

const testo = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

test('un solo festeggiato: si legge come prima', () => {
  const html = flagCompleanni({ compleanni: [{ codCli: 7, nome: 'ROSSI MARIO', data: '2026-08-05' }] }, 'flag');
  assert.strictEqual(testo(html), '🎂 Compleanno 05/08/2026 ROSSI MARIO');
});

test('due date diverse: ognuna con il suo nome', () => {
  const html = flagCompleanni({ compleanni: [
    { codCli: 1, nome: 'FABIO COFANO', data: '2026-07-03' },
    { codCli: 2, nome: 'GIOVANNINO COFANO', data: '2026-07-08' },
  ] }, 'flag');
  assert.strictEqual(testo(html), '🎂 Compleanni 03/07/2026 FABIO COFANO · 08/07/2026 GIOVANNINO COFANO');
});

test('stessa data: si scrive una volta e i nomi si affiancano', () => {
  // Caso vero, pratica 51908: due gemelle nate il 20/12/1964. Ripetere la data
  // due volte di seguito sembrerebbe un errore invece di due festeggiate.
  const html = flagCompleanni({ compleanni: [
    { codCli: 1, nome: 'ELISABETH', data: '2026-12-20' },
    { codCli: 2, nome: 'MARGARETE', data: '2026-12-20' },
  ] }, 'flag');
  assert.strictEqual(testo(html), '🎂 Compleanni 20/12/2026 ELISABETH, MARGARETE');
});

test('tre festeggiati, due nello stesso giorno: si raggruppa solo ciò che coincide', () => {
  const html = flagCompleanni({ compleanni: [
    { codCli: 1, nome: 'ANNA', data: '2026-07-03' },
    { codCli: 2, nome: 'BRUNO', data: '2026-07-03' },
    { codCli: 3, nome: 'CARLA', data: '2026-07-09' },
  ] }, 'flag');
  assert.strictEqual(testo(html), '🎂 Compleanni 03/07/2026 ANNA, BRUNO · 09/07/2026 CARLA');
});

test('ogni nome resta cliccabile: dalla card si apre la scheda del festeggiato', () => {
  const html = flagCompleanni({ compleanni: [
    { codCli: 11, nome: 'ANNA', data: '2026-07-03' },
    { codCli: 22, nome: 'BRUNO', data: '2026-07-03' },
  ] }, 'flag');
  assert.match(html, /#cliente\/11/);
  assert.match(html, /#cliente\/22/);
});

test('nessun compleanno: nessuna pastiglia', () => {
  assert.strictEqual(flagCompleanni({ compleanni: [] }, 'flag'), '');
  assert.strictEqual(flagCompleanni({}, 'flag'), '');
  assert.strictEqual(flagCompleanni(null, 'flag'), '');
});

test('il nome arriva dall\'anagrafica, quindi passa per l\'escape', () => {
  const html = flagCompleanni({ compleanni: [{ codCli: 1, nome: '<img src=x onerror=alert(1)>', data: '2026-07-03' }] }, 'flag');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
