const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Il confronto aperto da una scheda GIÀ fusa non deve poter fondere niente: è lì
// per vedere i dati delle singole anagrafiche, che la fusione aggrega e quindi
// nasconde. Un "Conferma unione" in quel contesto rifarebbe un'unione già fatta.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

function estrai(nome) {
  const inizio = SRC.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovata in web/app.js`);
  const fine = SRC.indexOf('\n}', inizio);
  return SRC.slice(inizio, fine + 2);
}
function estraiConst(nome) {
  const riga = SRC.split('\n').find((l) => l.startsWith(`const ${nome} =`));
  assert.ok(riga, `const ${nome} non trovata`);
  return riga;
}
// Vale sia per un array (`= [ … \n];`) sia per un oggetto (`= { … \n};`): si
// prende la chiusura che arriva prima.
function estraiOggetto(nome) {
  const inizio = SRC.indexOf(`const ${nome} = `);
  assert.notStrictEqual(inizio, -1, `const ${nome} non trovato`);
  const chiusure = ['\n];', '\n};'].map((c) => SRC.indexOf(c, inizio)).filter((i) => i > 0);
  assert.ok(chiusure.length, `fine di ${nome} non trovata`);
  return SRC.slice(inizio, Math.min(...chiusure) + 3);
}

// renderMerge scrive dentro #merge-dialog-body: si finge il minimo indispensabile.
function rendi({ soloVista, conflitti = [], coda = null }) {
  const dati = {
    anagrafiche: [
      { codCli: 1001, nominativo: 'TOSTI CARLO', email: 'a@x.it', nPrenotazioni: 4 },
      { codCli: 1201, nominativo: 'TOSTI CARLO', email: 'b@y.it', nPrenotazioni: 1 },
    ],
    conflitti,
    suggerito: 1001,
  };
  let html = '';
  const ambiente = `
    ${estraiConst('esc')}
    ${estrai('linkCliente')}
    ${estrai('fmtData')}
    ${estraiOggetto('CAMPI_MERGE')}
    ${estraiConst('LABEL_CAMPO')}
    const loaderHTML = () => '';
    const $ = () => ({ set innerHTML(v) { fuori(v); } });
    let mergeData = DATI, mergePrincipale = DATI.suggerito, mergeCoda = CODA, mergeSolaLettura = SOLA;
    ${estrai('renderMerge')}
    renderMerge();`
    .replace('DATI.suggerito', 'DATI.suggerito')
    .replace(/DATI/g, 'dati').replace('CODA', 'coda').replace('SOLA', String(!!soloVista));
  // eslint-disable-next-line no-new-func
  new Function('dati', 'coda', 'fuori', ambiente)(dati, coda, (v) => { html = v; });
  return html;
}

test('sola vista: nessun comando che fonde, solo Chiudi', () => {
  const h = rendi({ soloVista: true });
  assert.doesNotMatch(h, /merge-conferma/, 'c\'è ancora "Conferma unione"');
  assert.doesNotMatch(h, /merge-salta/);
  assert.doesNotMatch(h, /type="radio"/, 'la scelta del principale non ha senso su un gruppo già fuso');
  assert.match(h, /id="merge-annulla">Chiudi/);
});

test('sola vista: il titolo e il testo dicono che si sta guardando, non decidendo', () => {
  const h = rendi({ soloVista: true });
  assert.match(h, /Anagrafiche di questa scheda/);
  assert.doesNotMatch(h, /Scegli l'anagrafica/);
  assert.match(h, /insieme/); // spiega che la scheda mostra l'aggregato
  // Il principale resta indicato, anche senza radio da scegliere.
  assert.match(h, /merge-badge">principale/);
});

test('sola vista: i dati delle singole anagrafiche ci sono tutti', () => {
  const h = rendi({ soloVista: true });
  // È il motivo per cui esiste questa schermata: le mail diverse si vedono solo qui.
  assert.match(h, /a@x\.it/);
  assert.match(h, /b@y\.it/);
  assert.match(h, /#1001/);
  assert.match(h, /#1201/);
});

test('sola vista: il conflitto informa, non blocca', () => {
  const h = rendi({ soloVista: true, conflitti: [{ campo: 'email' }] });
  assert.match(h, /hanno dati diversi/);
  assert.match(h, /si scollegano dal banner/); // la via d'uscita vera
  assert.doesNotMatch(h, /prima di confermare/); // non c'è niente da confermare
});

test('modalità normale: resta quella di sempre', () => {
  const h = rendi({ soloVista: false, conflitti: [{ campo: 'email' }] });
  assert.match(h, /merge-conferma">Conferma unione/);
  assert.match(h, /type="radio"/);
  assert.match(h, /Scegli l'anagrafica/);
  assert.match(h, /prima di confermare/);
});

test('il banner della scheda fusa offre il confronto', () => {
  const banner = estrai('renderMergeBanner');
  assert.match(banner, /data-vedi-anagrafiche/);
  // Non usa data-confronta: quello è il comando che FONDE, ed è nascosto a chi ha
  // il profilo di sola lettura. Guardare i dati invece è consentito a tutti.
  assert.doesNotMatch(banner, /data-confronta\b/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'styles.css'), 'utf8');
  const regola = css.slice(css.indexOf('body.sola-lettura'), css.indexOf('}', css.indexOf('body.sola-lettura')));
  assert.ok(!regola.includes('data-vedi-anagrafiche'), 'il confronto è una lettura: non va nascosto in sola lettura');
});
