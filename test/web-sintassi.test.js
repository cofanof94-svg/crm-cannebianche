const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

// I file di web/ non passano da nessun compilatore: il browser li scopre rotti
// al primo caricamento. Gli altri test li leggono come TESTO — estraggono una
// funzione e la valutano — quindi un errore di sintassi altrove non lo vedono.
//
// Il 18/08/2026 è successo davvero: un apostrofo dentro un tooltip
// ("un'allergia") ha spezzato una stringa, app.js ha smesso di caricarsi e le
// pagine Arrivi e In casa sono rimaste vuote. La suite era tutta verde.
//
// Questo test compila ogni file per intero. Non lo esegue: serve solo a sapere
// che è JavaScript valido.

const WEB = path.join(__dirname, '..', 'web');
const script = fs.readdirSync(WEB).filter((f) => f.endsWith('.js'));

test('in web/ ci sono gli script che ci aspettiamo', () => {
  // Sentinella: se un giorno la cartella cambiasse nome, questo test smetterebbe
  // di controllare qualcosa senza fallire.
  assert.ok(script.length >= 3, `trovati solo ${script.length} script in web/`);
  for (const atteso of ['app.js', 'export.js', 'analytics.js']) {
    assert.ok(script.includes(atteso), `manca ${atteso}`);
  }
});

for (const f of script) {
  test(`web/${f} è JavaScript valido`, () => {
    const src = fs.readFileSync(path.join(WEB, f), 'utf8');
    assert.doesNotThrow(() => new vm.Script(src, { filename: `web/${f}` }),
      `web/${f} non si carica: il browser mostrerebbe una pagina vuota`);
  });
}

test("l'apostrofo tipografico non spezza le stringhe", () => {
  // La causa del guasto del 18/08. In italiano l'apostrofo ricorre di continuo
  // nei testi dell'interfaccia: qui si verifica che il caso sia gestito.
  const src = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  assert.match(src, /un\u2019allergia/, 'ci si aspetta l\u2019apostrofo tipografico nei tooltip');
  assert.doesNotMatch(src, /'[^'\n]*\bun'allergia/, 'apostrofo dritto dentro una stringa fra apici');
});
