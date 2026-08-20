const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Una preferenza si poteva solo cancellare e riscrivere: l'API accettava già la
// correzione di testo, reparto e categoria — e l'analisi funzionale §9 la dava
// per fatta — ma nell'interfaccia il pulsante non c'era. Rifarla da capo perdeva
// autore e data, cioè proprio quello che serve a capire da dove viene una riga.
// Aggiunta il 20/08/2026, con la stessa forma della modifica del nucleo.

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'web', 'styles.css'), 'utf8');

function estrai(nome) {
  const inizio = SRC.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovata in web/app.js`);
  return SRC.slice(inizio, SRC.indexOf('\n}', inizio) + 2);
}

const REPARTI = ['Rooms', 'F&B', 'SPA', 'Front office'];
const CATEGORIE = ['F&B', 'Camera', 'Persona', 'Occasioni', 'Generale'];
const riga = new Function('esc', 'REPARTI', 'CATEGORIE',
  `${estrai('rigaPreferenzaInModifica')}; return rigaPreferenzaInModifica;`)(
  (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  REPARTI, CATEGORIE);

const PREF = { id: 7, reparto: 'SPA', categoria: 'Persona', testo: 'Massaggio alle 18', ambito: 'nucleo' };

test('la riga in modifica parte dai valori attuali, non da un modulo vuoto', () => {
  const h = riga(PREF);
  assert.match(h, /<option selected>SPA<\/option>/, 'il reparto attuale dev\'essere già scelto');
  assert.match(h, /<option selected>Persona<\/option>/, 'e così la categoria');
  assert.match(h, />Massaggio alle 18</, 'il testo attuale sta nel campo');
  // Le liste sono quelle chiuse del server, non un campo libero.
  // `F&B` compare scappato come `F&amp;B`: si confronta con la stessa regola.
  const scappato = (s) => s.replace(/&/g, '&amp;');
  for (const r of REPARTI) assert.ok(h.includes(`>${scappato(r)}</option>`), `manca il reparto ${r}`);
  for (const c of CATEGORIE) assert.ok(h.includes(`>${scappato(c)}</option>`), `manca la categoria ${c}`);
});

test('la riga in modifica ha Salva e Annulla, e porta il proprio id', () => {
  const h = riga(PREF);
  assert.match(h, /data-save-pref="7"/);
  assert.match(h, /data-cancel-pref="7"/);
  assert.match(h, /data-pref="7"/, 'serve al gestore per sapere quale riga sta salvando');
});

test('il testo in modifica rispetta il tetto dei 400 caratteri', () => {
  // Lo stesso limite che il server applica: meglio non far scrivere che
  // rifiutare dopo. Il controllo vero resta comunque quello del server.
  assert.match(riga(PREF), /maxlength="400"/);
});

test('il testo di una preferenza non finisce mai grezzo nell\'HTML', () => {
  const h = riga({ ...PREF, testo: '<img src=x onerror=alert(1)> "virgolette" & simboli' });
  assert.doesNotMatch(h, /<img/, 'il tag dev\'essere scappato');
  assert.match(h, /&lt;img/);
  assert.match(h, /&quot;virgolette&quot;/);
});

test('i comandi nuovi sono coperti dalla modalità sola lettura', () => {
  // La regola sta in CSS proprio perché valga anche per ciò che viene disegnato
  // dopo. Chi aggiunge un comando lo aggiunge lì: test/permessi-ui.test.js
  // fallisce se resta scoperto, ed è così che questi tre sono stati trovati.
  const regola = CSS.slice(CSS.indexOf('body.sola-lettura :is('), CSS.indexOf(')', CSS.indexOf('body.sola-lettura :is(')));
  for (const attr of ['data-edit-pref', 'data-save-pref', 'data-cancel-pref']) {
    assert.ok(regola.includes(`[${attr}]`), `${attr} non è coperto dalla sola lettura`);
  }
});

test('modificare NON passa dalla cancellazione: si usa la correzione', () => {
  // Se un giorno qualcuno "semplificasse" facendo cancella+ricrea, autore e
  // data della preferenza cambierebbero in silenzio.
  const gestore = SRC.slice(SRC.indexOf("$('#cli-preferenze').addEventListener"), SRC.indexOf('\n});', SRC.indexOf("$('#cli-preferenze').addEventListener")));
  const blocco = gestore.slice(gestore.indexOf('data-save-pref'), gestore.indexOf('data-del-pref'));
  assert.match(blocco, /method: 'PATCH'/, 'il salvataggio dev\'essere una correzione');
  assert.doesNotMatch(blocco, /method: 'DELETE'/);
});
