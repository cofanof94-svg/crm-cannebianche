const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// "Conferma unione" buttava via l'esito delle richieste e dichiarava l'unione
// riuscita SEMPRE: bastava una sessione scaduta perché la finestra si chiudesse
// soddisfatta senza aver collegato niente, lasciando il gruppo nella coda senza
// nessuna spiegazione. E senza una rete intorno al ciclo, una caduta di rete
// lasciava il pulsante su "Unione in corso…" per sempre.
// Decisione del 20/08/2026: fermarsi al primo rifiuto e dirlo.

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

function estrai(nome) {
  const inizio = SRC.indexOf(`async function ${nome}(`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovata in web/app.js`);
  return SRC.slice(inizio, SRC.indexOf('\n}', inizio) + 2);
}

// Finto minimo della finestra: registra cosa viene scritto e com'è il pulsante.
function finestra() {
  const stato = { avvisi: [], pulsante: { disabled: false, innerHTML: 'Conferma unione' } };
  const azioni = { insertAdjacentHTML: (_dove, html) => stato.avvisi.push(html) };
  const body = {
    querySelector: (sel) => (sel === '.modal-actions' ? azioni : null),
  };
  const $ = (sel) => {
    if (sel === '#merge-conferma') return stato.pulsante;
    if (sel === '#merge-dialog-body .merge-body') return body;
    return null;
  };
  return { stato, $ };
}

function costruisci({ risposte, mergeData, mergePrincipale }) {
  const chiamate = [];
  const avanzamenti = [];
  const api = async (url, opts) => {
    chiamate.push({ url, body: JSON.parse(opts.body) });
    const r = risposte[chiamate.length - 1];
    if (r instanceof Error) throw r;
    return r;
  };
  const { stato, $ } = finestra();
  const esc = (s) => String(s == null ? '' : s);
  const avanzaMerge = (fatto) => avanzamenti.push(fatto);
  const fn = new Function('$', 'api', 'esc', 'mergeData', 'mergePrincipale', 'avanzaMerge',
    `${estrai('confermaMerge')}; return confermaMerge;`)($, api, esc, mergeData, mergePrincipale, avanzaMerge);
  return { fn, chiamate, avanzamenti, stato };
}

const TRE = { anagrafiche: [{ codCli: 1001 }, { codCli: 1201 }, { codCli: 1101 }] };

test('tutte riuscite: si avanza nella coda', async () => {
  const c = costruisci({ risposte: [{ status: 201, body: {} }, { status: 201, body: {} }], mergeData: TRE, mergePrincipale: 1001 });
  await c.fn();
  assert.strictEqual(c.chiamate.length, 2, 'una richiesta per ogni codice da collegare');
  assert.deepStrictEqual(c.avanzamenti, [true]);
  assert.deepStrictEqual(c.stato.avvisi, [], 'nessun avviso quando va tutto bene');
});

test('il server rifiuta: ci si ferma, si dice il motivo, NON si avanza', async () => {
  const c = costruisci({
    risposte: [{ status: 400, body: { error: 'Fusione non valida (auto-fusione)' } }],
    mergeData: TRE,
    mergePrincipale: 1001,
  });
  await c.fn();
  assert.deepStrictEqual(c.avanzamenti, [], 'la coda non deve avanzare su un errore');
  assert.strictEqual(c.stato.avvisi.length, 1);
  assert.match(c.stato.avvisi[0], /Unione non completata/);
  assert.match(c.stato.avvisi[0], /auto-fusione/, 'il messaggio del server arriva a schermo');
  assert.strictEqual(c.stato.pulsante.disabled, false, 'il pulsante torna premibile');
});

test('rifiuto a metà: si dice quante erano già state collegate', async () => {
  // Senza questo numero non si capisce a che punto è rimasta l'operazione.
  const c = costruisci({
    risposte: [{ status: 201, body: {} }, { status: 403, body: { error: 'Permesso negato' } }],
    mergeData: TRE,
    mergePrincipale: 1001,
  });
  await c.fn();
  assert.deepStrictEqual(c.avanzamenti, []);
  assert.match(c.stato.avvisi[0], /1 anagrafica era già stata collegata/);
});

test('la rete cade: messaggio, non un pulsante bloccato per sempre', async () => {
  const c = costruisci({
    risposte: [new Error('Failed to fetch')],
    mergeData: TRE,
    mergePrincipale: 1001,
  });
  await c.fn();
  assert.deepStrictEqual(c.avanzamenti, []);
  assert.match(c.stato.avvisi[0], /non ha risposto/);
  assert.strictEqual(c.stato.pulsante.disabled, false);
  assert.strictEqual(c.stato.pulsante.innerHTML, 'Conferma unione', 'il pulsante torna com\'era');
});

test('un avviso vecchio non si somma a quello nuovo', async () => {
  // Riprovando due volte non devono restare due bandierine rosse in colonna.
  const c = costruisci({
    risposte: [{ status: 400, body: { error: 'Primo errore' } }],
    mergeData: TRE,
    mergePrincipale: 1001,
  });
  await c.fn();
  assert.strictEqual(c.stato.avvisi.length, 1);
  assert.match(SRC, /const vecchio = box\.querySelector\('\.merge-errore'\);/, 'il precedente va rimosso');
});
