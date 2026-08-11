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
  // `data-toggle-compl` è il caso che è sfuggito alla prima stesura: si chiama
  // toggle, sembra un espandi, ma è il pulsante Risolvi/Riapri di un reclamo.
  for (const a of ['data-merge', 'data-unmerge', 'data-confronta', 'data-classe-compl', 'data-set-ambito', 'data-brief', 'data-brief-cli', 'data-toggle-compl']) {
    assert.ok(coperti.has(a), `${a} non è nascosto in sola lettura`);
  }
  for (const sel of ['.prop-box', '#btn-suggerisci', '#pref-form', '#intol-form', '#compl-form', '#nucleo-form', '#lingua-form', '#btn-notepers-ai', '#dup-actions']) {
    assert.ok(REGOLA.includes(sel), `${sel} non è nascosto in sola lettura`);
  }
});

test('nessun pulsante d\'azione resta fuori dalla regola', () => {
  // Rete più larga: ogni id che comincia per "btn-" deve essere o nella regola,
  // o in questa lista di cose che si possono fare anche consultando.
  const LECITI = new Set([
    'btn-export-arrivi', 'btn-export-incasa', // l'export è una lettura
  ]);
  const ids = new Set([...APP.matchAll(/id="(btn-[a-z0-9-]+)"/g)].map((m) => m[1]));
  for (const m of web('index.html').matchAll(/id="(btn-[a-z0-9-]+)"/g)) ids.add(m[1]);
  const scoperti = [...ids].filter((id) => !LECITI.has(id) && !REGOLA.includes(`#${id}`));
  assert.deepStrictEqual(scoperti, [], `pulsanti visibili in sola lettura: ${scoperti.join(', ')}`);
});

test('i riquadri che senza dato mostrano un form non lo mostrano in sola lettura', () => {
  // Lingua e note personali, quando il dato non c'è, disegnano direttamente il
  // form. Nasconderlo col CSS lascerebbe un buco bianco: si mostra invece che il
  // dato non c'è.
  for (const fn of ['function renderLingua()', 'function renderNotePersonali()']) {
    const i = APP.indexOf(fn);
    assert.notStrictEqual(i, -1, `${fn} non trovata`);
    const corpo = APP.slice(i, i + 1400);
    assert.match(corpo, /if \(!puo\('scrivi'\)\)/, `${fn} non gestisce la sola lettura`);
    assert.match(corpo, /nota-vuota/, `${fn} non dice che il dato non c'è`);
  }
});

test('l\'interfaccia ragiona per permesso, non per ruolo', () => {
  // Il punto del ticket: niente `role === 'admin'` sparsi. Se ne ricompare uno,
  // vuol dire che qualcuno ha aggirato la tabella dei permessi.
  const confrontiSulRuolo = APP.match(/\.role\s*[=!]==?\s*['"]/g) || [];
  assert.deepStrictEqual(confrontiSulRuolo, [], 'il frontend confronta ancora il ruolo invece di chiedere un permesso');
  assert.match(APP, /function puo\(permesso\)/);
});

test('permessi assenti = server disallineato, non un ruolo senza diritti', () => {
  // Successo davvero: server acceso da prima del rilascio + file nuovi sul disco.
  // /api/me rispondeva senza `permessi` e l'admin si è ritrovato in sola lettura,
  // convinto di avere un problema di ruolo. Prudenza sì, ma detta com'è.
  assert.match(APP, /const permessiIgnoti = \(\) =>/);
  assert.match(APP, /Server da riavviare/);
  const i = APP.indexOf('const badge = $(\'#ruolo-badge\')');
  assert.notStrictEqual(i, -1, 'manca la gestione del badge di ruolo');
  const blocco = APP.slice(i, i + 900);
  assert.match(blocco, /permessiIgnoti\(\)/);
  assert.match(blocco, /Sola lettura/); // il caso normale resta distinto
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
