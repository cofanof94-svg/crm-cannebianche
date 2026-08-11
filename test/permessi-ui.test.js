const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// La sicurezza è nella guardia sul backend. Questo test guarda l'altra metà: che
// l'interfaccia non mostri comandi destinati a fallire.
//
// Il rischio non è oggi, è fra sei mesi: qualcuno aggiunge un pulsante "Elimina"
// e nessuno si ricorda della modalità sola lettura. Qui si sfrutta la convenzione
// che il codice già segue — le azioni di scrittura sono attributi
// data-(del|edit|add|save|ign)-qualcosa — per accorgersene da soli.

const web = (f) => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8');
const APP = web('app.js');
const CSS = web('styles.css');

// Il blocco CSS che nasconde i comandi in sola lettura.
const REGOLA = (() => {
  const i = CSS.indexOf('body.sola-lettura');
  assert.notStrictEqual(i, -1, 'manca la regola body.sola-lettura in styles.css');
  return CSS.slice(i, CSS.indexOf('}', i));
})();

const coperti = new Set([...REGOLA.matchAll(/\[(data-[a-z-]+)\]/g)].map((m) => m[1]));

test('ogni comando di scrittura è coperto dalla modalità sola lettura', () => {
  const usati = new Set([...APP.matchAll(/\b(data-(?:del|edit|add|save|ign)-[a-z]+)\b/g)].map((m) => m[1]));
  // Sentinella: se un giorno la convenzione cambia, questa ricerca smette di
  // trovare i comandi e il test passerebbe a vuoto. Oggi sono 14.
  assert.ok(usati.size >= 12, `trovati solo ${usati.size} comandi: il modo di scriverli è cambiato?`);
  const scoperti = [...usati].filter((a) => !coperti.has(a));
  assert.deepStrictEqual(scoperti, [], `comandi non nascosti in sola lettura: ${scoperti.join(', ')} — aggiungerli alla regola body.sola-lettura in web/styles.css`);
});

test('la regola non contiene selettori morti', () => {
  // Un attributo rimasto nella regola dopo che il pulsante è stato rinominato non
  // dà fastidio, ma fa credere coperto qualcosa che non esiste più.
  const morti = [...coperti].filter((a) => !APP.includes(a));
  assert.deepStrictEqual(morti, [], `selettori che non esistono più in app.js: ${morti.join(', ')}`);
});

test('sono coperti anche i comandi che non seguono la convenzione', () => {
  // Questi non si chiamano data-del-/data-edit-: vanno tenuti a mano, quindi il
  // test li elenca. Merge, classificazione reclamo, ambito preferenza, AI.
  for (const a of ['data-merge', 'data-unmerge', 'data-confronta', 'data-classe-compl', 'data-set-ambito', 'data-brief', 'data-brief-cli']) {
    assert.ok(coperti.has(a), `${a} non è nascosto in sola lettura`);
  }
  for (const sel of ['.prop-box', '#btn-suggerisci', '#pref-form', '#intol-form', '#compl-form', '#nucleo-form']) {
    assert.ok(REGOLA.includes(sel), `${sel} non è nascosto in sola lettura`);
  }
});

test('l\'interfaccia ragiona per permesso, non per ruolo', () => {
  // Il punto del ticket: niente `role === 'admin'` sparsi. Se ne ricompare uno,
  // vuol dire che qualcuno ha aggirato la tabella dei permessi.
  const confrontiSulRuolo = APP.match(/\.role\s*[=!]==?\s*['"]/g) || [];
  assert.deepStrictEqual(confrontiSulRuolo, [], 'il frontend confronta ancora il ruolo invece di chiedere un permesso');
  assert.match(APP, /function puo\(permesso\)/);
});

test('le sezioni riservate sono elencate, Analytics compresa', () => {
  // Analytics non esiste ancora, ma la regola di accesso sì: è un requisito
  // esplicito del ticket, non una dimenticanza da correggere quando arriverà.
  const i = APP.indexOf('const permessoDellaVista');
  assert.notStrictEqual(i, -1, 'manca la mappa vista → permesso nel router');
  const mappa = APP.slice(i, APP.indexOf('}', i));
  assert.match(mappa, /utenti:\s*'gestisci-utenti'/);
  assert.match(mappa, /analytics:\s*'vedi-analytics'/);
});
