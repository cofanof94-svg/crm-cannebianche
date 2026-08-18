const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// I tooltip sono l'unica documentazione che l'utente legge davvero, e sono anche
// la prima cosa che smette di essere vera quando il comportamento cambia. Questi
// test non giudicano lo stile: fissano le affermazioni che il 18/08/2026 erano
// diventate FALSE, e la regola che nessuna pastiglia resti senza spiegazione.

const web = (f) => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8');
const HTML = web('index.html');
const APP = web('app.js');
const AN = web('analytics.js');

const tips = (src) => [...src.matchAll(/data-tip="([^"]*)"/g)].map((m) => m[1]);

test('nessun tooltip dice più che il nucleo si compila solo alla prima apertura', () => {
  // Dal 14/08 il controllo si rifà a ogni apertura della scheda.
  const nucleo = tips(HTML).find((x) => x.startsWith("Chi viaggia con l'ospite"));
  assert.ok(nucleo, 'il tooltip del nucleo dev\'essere ancora lì');
  assert.doesNotMatch(nucleo, /prima apertura/i);
  assert.match(nucleo, /a ogni apertura/i);
  assert.match(nucleo, /non torna/i, 'va detto che chi si toglie non rientra');
});

test('prima e ultima visita: i day use sono visite, non soggiorni', () => {
  const v = tips(HTML).find((x) => x.startsWith("Prima e ultima volta"));
  assert.ok(v);
  assert.match(v, /day use/i);
  assert.doesNotMatch(v, /soggiorno valido/i, 'la vecchia formula contraddiceva la regola del 18/08');
});

test('i soggiorni non comprendono i day use, e lo dicono', () => {
  const s = tips(HTML).find((x) => x.includes('dormito qui'));
  assert.ok(s);
  assert.match(s, /day use/i);
  assert.match(s, /valore storico/i, 'va detto che la spesa resta');
});

test('nessun tooltip parla il linguaggio del database', () => {
  // "codalb" è il nome di una colonna: chi sta al banco non deve incontrarlo.
  const tecnici = [/codalb/i, /codclinterm/i, /codpratica/i, /StorPrenota/i, /flgincasa/i, /\bNVARCHAR\b/i];
  for (const t of tips(HTML).concat(tips(APP))) {
    for (const brutto of tecnici) {
      assert.doesNotMatch(t, brutto, `tooltip troppo tecnico: ${t.slice(0, 70)}…`);
    }
  }
});

test('ogni pastiglia di filtro spiega che cosa comprende', () => {
  // "Alert" è il caso peggiore: nessuno può indovinare che sono le allergie
  // OPPURE gli ospiti indesiderati.
  for (const nome of ['BRIEF_CHIPS', 'INCASA_CHIPS']) {
    const inizio = APP.indexOf(`const ${nome} = [`);
    assert.notStrictEqual(inizio, -1, `${nome} non trovato`);
    const blocco = APP.slice(inizio, APP.indexOf('\n];', inizio));
    const chiavi = [...blocco.matchAll(/\{ key: '([^']+)'/g)].map((m) => m[1]);
    const conTip = [...blocco.matchAll(/tip: '/g)].length;
    assert.strictEqual(conTip, chiavi.length, `${nome}: ${chiavi.length} pastiglie ma ${conTip} spiegazioni`);
  }
  const alert = APP.match(/key: 'alert'[\s\S]*?tip: '([^']*(?:\'[^']*)*)'/);
  assert.ok(alert && /indesiderato/.test(alert[1]), 'la pastiglia Alert deve dire che comprende gli indesiderati');
});

test('la variazione in Analytics dice rispetto a cosa', () => {
  // Un "+12%" senza termine di paragone non è un dato, è una decorazione.
  assert.match(AN, /const CONFRONTO = '[^']*periodo precedente[^']*'/);
  assert.match(AN, /an-delta-su[\s\S]*title="\$\{esc\(CONFRONTO\)\}"/);
});

test('il conteggio VIP di Analytics dichiara di misurare il presente', () => {
  // Il VIP non è storicizzato (decisione del 14/08): il numero cambia da solo
  // quando qualcuno tocca una classificazione in anagrafica.
  assert.match(AN, /VIP ADESSO/);
});

test('i tooltip restano brevi', () => {
  // Non sono documentazione: se servono più di trecento caratteri, la schermata
  // ha un problema che un tooltip non risolve.
  for (const t of tips(HTML).concat(tips(APP))) {
    assert.ok(t.length <= 340, `tooltip troppo lungo (${t.length}): ${t.slice(0, 60)}…`);
  }
});
