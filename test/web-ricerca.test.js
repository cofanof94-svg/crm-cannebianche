const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// web/app.js è uno script da browser (niente moduli, niente build): non si può
// require(). Per le funzioni PURE si estrae il sorgente e lo si valuta, così
// anche il frontend ha una rete di sicurezza. matchPrenotazione la merita: la
// ricerca per numero di pratica era già stata persa una volta nel redesign di
// "In casa", e la pratica è l'unico identificativo univoco di una prenotazione.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

function estrai(nome) {
  const inizio = SRC.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovata in web/app.js`);
  const fine = SRC.indexOf('\n}', inizio);
  assert.notStrictEqual(fine, -1, `fine di ${nome} non trovata`);
  return SRC.slice(inizio, fine + 2);
}

// `esc` è dichiarata come arrow su una riga (const esc = …): si preleva quella
// vera invece di riscriverla, altrimenti il test verificherebbe una copia.
function estraiConst(nome) {
  const riga = SRC.split('\n').find((l) => l.startsWith(`const ${nome} =`));
  assert.ok(riga, `const ${nome} non trovata in web/app.js`);
  return riga;
}

// Carica una funzione insieme alle sue dipendenze nello STESSO scope
// (linkCliente usa esc). `dipendenze` sono frammenti di sorgente già estratti.
function caricaFunzione(nome, ...dipendenze) {
  // eslint-disable-next-line no-new-func
  return new Function(`${[...dipendenze, estrai(nome)].join('\n')}\nreturn ${nome};`)();
}

// Come sopra, ma per più simboli che condividono lo stesso stato (il registro
// dei pulsanti AI): vanno valutati insieme, altrimenti ognuno avrebbe il suo.
function caricaModulo(nomi, ...dipendenze) {
  const corpi = nomi.map((n) => (SRC.includes(`function ${n}(`) ? estrai(n) : estraiConst(n)));
  // eslint-disable-next-line no-new-func
  return new Function(`${[...dipendenze, ...corpi].join('\n')}\nreturn { ${nomi.join(', ')} };`)();
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

// --- linkCliente: la regola "ogni nome di cliente apre la sua anagrafica" ---
const linkCliente = caricaFunzione('linkCliente', estraiConst('esc'));

test('linkCliente: con un codice valido produce il link alla scheda ospite', () => {
  const h = linkCliente(1001, 'TOSTI CARLO');
  assert.match(h, /href="#cliente\/1001"/);
  assert.match(h, />TOSTI CARLO</);
  assert.match(h, /class="cli-ref"/);
  assert.match(h, /title="Apri l&#39;anagrafica #1001"/); // apostrofo con escape
});

test('linkCliente: senza codice resta testo, nessun link morto', () => {
  assert.strictEqual(linkCliente(null, 'MARIO ROSSI'), 'MARIO ROSSI');
  assert.strictEqual(linkCliente(undefined, 'MARIO ROSSI'), 'MARIO ROSSI');
  assert.strictEqual(linkCliente('', 'MARIO ROSSI'), 'MARIO ROSSI');
  assert.strictEqual(linkCliente(0, 'MARIO ROSSI'), 'MARIO ROSSI');   // 0 non è un codice
  assert.strictEqual(linkCliente('abc', 'MARIO ROSSI'), 'MARIO ROSSI');
  // con una classe richiesta il testo resta comunque nel suo contenitore
  assert.strictEqual(linkCliente(null, 'MARIO ROSSI', { classe: 'nucleo-nome' }), '<span class="nucleo-nome">MARIO ROSSI</span>');
});

test('linkCliente: testo assente → mostra il codice; classi e nuova scheda', () => {
  assert.match(linkCliente(42, null), />#42</);
  assert.match(linkCliente(42, 'X', { classe: 'dup-nome' }), /class="cli-ref dup-nome"/);
  const nuova = linkCliente(42, 'X', { nuovaScheda: true });
  assert.match(nuova, /target="_blank"/);
  assert.match(nuova, /rel="noopener"/);
});

test('linkCliente: nome ed eventuale titolo sono sempre con escape', () => {
  const h = linkCliente(7, '<img src=x onerror=alert(1)>');
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img/);
});

// --- Registro dei pulsanti AI: "generato una volta, finché resti qui" ---
function registroAi() {
  return caricaModulo(['aiGiaFatto', 'aiSegnaFatto', 'aiAzzera', 'aiApplicaStato'], estraiConst('aiEseguiti'));
}
const bottoneFinto = () => ({ disabled: false, textContent: '✨ Genera con AI', title: '' });

test('registro AI: una generazione riuscita risulta fatta, le altre no', () => {
  const ai = registroAi();
  assert.strictEqual(ai.aiGiaFatto('scheda:notepers'), false);
  ai.aiSegnaFatto('scheda:notepers');
  assert.strictEqual(ai.aiGiaFatto('scheda:notepers'), true);
  assert.strictEqual(ai.aiGiaFatto('scheda:suggerimenti'), false); // pulsanti indipendenti
});

test('registro AI: aiAzzera svuota solo il proprio ambito', () => {
  const ai = registroAi();
  ['scheda:notepers', 'scheda:suggerimenti', 'arrivi:brief:1001'].forEach(ai.aiSegnaFatto);
  ai.aiAzzera('scheda'); // cambio anagrafica: i pulsanti della scheda tornano attivi
  assert.strictEqual(ai.aiGiaFatto('scheda:notepers'), false);
  assert.strictEqual(ai.aiGiaFatto('scheda:suggerimenti'), false);
  assert.strictEqual(ai.aiGiaFatto('arrivi:brief:1001'), true); // la pagina arrivi non c'entra
});

test('registro AI: il briefing è per singolo ospite, non per pagina', () => {
  const ai = registroAi();
  ai.aiSegnaFatto('arrivi:brief:1001');
  assert.strictEqual(ai.aiGiaFatto('arrivi:brief:1002'), false); // le altre card restano usabili
  ai.aiAzzera('arrivi');
  assert.strictEqual(ai.aiGiaFatto('arrivi:brief:1001'), false);
});

test('aiApplicaStato: spegne il pulsante solo se la generazione è già avvenuta', () => {
  const ai = registroAi();
  const btn = bottoneFinto();
  assert.strictEqual(ai.aiApplicaStato(btn, 'scheda:notepers', '✨ Già generato', 'Riapri la scheda'), false);
  assert.strictEqual(btn.disabled, false); // non ancora generato → resta cliccabile
  ai.aiSegnaFatto('scheda:notepers');
  assert.strictEqual(ai.aiApplicaStato(btn, 'scheda:notepers', '✨ Già generato', 'Riapri la scheda'), true);
  assert.strictEqual(btn.disabled, true);
  assert.strictEqual(btn.textContent, '✨ Già generato');
  assert.strictEqual(btn.title, 'Riapri la scheda'); // il perché è a portata di mouse
  assert.doesNotThrow(() => ai.aiApplicaStato(null, 'scheda:notepers', 'x', 'y')); // pulsante non a video
});
