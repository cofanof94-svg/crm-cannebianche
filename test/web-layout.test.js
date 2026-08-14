const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// La barra laterale ancorata non si può provare senza un browser: qui si
// difende la sola parte che qualcuno potrebbe togliere per sbaglio credendola
// superflua, cioè l'altezza esplicita. Senza quella, `position: sticky` c'è ma
// non ancora niente — la cella della griglia è alta quanto tutta la pagina e
// non c'è mai nulla da tenere fermo. È un guasto silenzioso: il CSS resta
// valido, la barra torna semplicemente a scorrere via.

const web = (f) => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8');
const CSS = web('styles.css');
const APP = web('app.js');

// La regola .sidebar della vista a colonne (la prima: quella dentro la media
// query per gli schermi stretti viene dopo e serve a disfarla).
const REGOLA = (() => {
  const i = CSS.indexOf('.sidebar {');
  assert.notStrictEqual(i, -1, 'manca la regola .sidebar in styles.css');
  return CSS.slice(i, CSS.indexOf('}', i));
})();

test('la barra laterale resta ancorata durante lo scroll', () => {
  assert.match(REGOLA, /position:\s*sticky/, 'la barra deve essere ancorata');
  assert.match(REGOLA, /top:\s*0/, 'senza `top` sticky non si attiva mai');
  assert.match(REGOLA, /height:\s*100[dv]vh|height:\s*100vh/, 'serve un\'altezza esplicita, altrimenti non c\'è niente da ancorare');
  // Finestre basse: le voci di menu devono restare raggiungibili scorrendo
  // dentro la barra, non sparire sotto il bordo dello schermo.
  assert.match(REGOLA, /overflow-y:\s*auto/);
});

test('sugli schermi stretti la barra torna a scorrere con la pagina', () => {
  // Lì non è più una colonna ma una striscia in alto: ancorarla toglierebbe
  // spazio verticale a uno schermo che ne ha già poco.
  const mq = CSS.slice(CSS.indexOf('@media (max-width: 720px)'));
  const riga = mq.slice(mq.indexOf('.sidebar {'), mq.indexOf('}', mq.indexOf('.sidebar {')));
  assert.match(riga, /position:\s*static/);
  assert.match(riga, /height:\s*auto/);
});

test('cambiando sezione si riparte dall\'inizio della pagina', () => {
  // Conseguenza diretta della barra ancorata: si può cambiare sezione stando a
  // metà di una lista lunga, e senza questo la sezione nuova si aprirebbe già
  // scrollata in un punto qualunque.
  const router = APP.slice(APP.indexOf('function route()'), APP.indexOf('window.addEventListener(\'hashchange\''));
  assert.match(router, /window\.scrollTo\(0,\s*0\)/, 'il router deve riportare in cima al cambio di vista');
  assert.match(router, /hash !== cameFrom/, 'solo quando la vista cambia davvero');
});
