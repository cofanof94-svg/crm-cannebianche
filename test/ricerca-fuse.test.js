const { test } = require('node:test');
const assert = require('node:assert');
const { collassaSuPrincipale } = require('../src/api/clienti');

// Un ospite riconosciuto come uno solo deve comparire una volta sola nella
// ricerca. La regola vive qui, pura: quale riga tenere e quale codice andare a
// leggere. Il caso del ticket: Mario Rossi (principale) e Mario A. Rossi
// (collegata) sono la stessa persona.

const riga = (codCli, nominativo) => ({ codCli, nominativo, citta: 'BARI', email: '', telefono: '', cellulare: '', cameraInCasa: null });

// codice → { canonicalId, membri }. Nel gruppo 10+11 il principale è il 10.
const gruppo1011 = new Map([
  [10, { canonicalId: 10, membri: 2 }],
  [11, { canonicalId: 10, membri: 2 }],
]);

test('due anagrafiche dello stesso ospite: resta solo la principale', () => {
  const { risultati, daLeggere } = collassaSuPrincipale(
    [riga(10, 'ROSSI MARIO'), riga(11, 'ROSSI MARIO A.')], gruppo1011);
  assert.deepStrictEqual(risultati.map((r) => r.codCli), [10]);
  assert.strictEqual(risultati[0].collegate, 1);
  assert.deepStrictEqual(daLeggere, []);
});

test("cercare il nome vecchio trova il principale, non il nulla", () => {
  // È il caso che rende sbagliato limitarsi a scartare le collegate: chi cerca
  // "Mario A. Rossi" intercetta SOLO la collegata, e senza sostituzione la
  // ricerca risponderebbe che quell'ospite non esiste.
  const { risultati, daLeggere } = collassaSuPrincipale([riga(11, 'ROSSI MARIO A.')], gruppo1011);
  assert.deepStrictEqual(risultati, []);
  assert.deepStrictEqual(daLeggere, [10], 'il principale va letto e messo al suo posto');
});

test('un gruppo di tre produce comunque una riga sola', () => {
  const tre = new Map([
    [48758, { canonicalId: 31355, membri: 3 }],
    [55491, { canonicalId: 31355, membri: 3 }],
    [31355, { canonicalId: 31355, membri: 3 }],
  ]);
  const { risultati, daLeggere } = collassaSuPrincipale(
    [riga(48758, 'BROLIN THOMAS'), riga(31355, 'BROLIN TOMAS JOHAN'), riga(55491, 'BROLIN T.')], tre);
  assert.deepStrictEqual(risultati.map((r) => r.codCli), [31355]);
  assert.strictEqual(risultati[0].collegate, 2);
  assert.deepStrictEqual(daLeggere, []);
});

test('chi non è fuso con nessuno passa intatto', () => {
  const { risultati, daLeggere } = collassaSuPrincipale(
    [riga(70, 'VERDI LUCA'), riga(71, 'VERDI ANNA')], new Map());
  assert.deepStrictEqual(risultati.map((r) => r.codCli), [70, 71]);
  assert.deepStrictEqual(risultati.map((r) => r.collegate), [0, 0]);
  assert.deepStrictEqual(daLeggere, []);
});

test('ospiti diversi con lo stesso cognome non si fondono fra loro', () => {
  // Il collasso deve agire solo su chi è stato DAVVERO associato: due omonimi
  // distinti restano due risultati.
  const soloUnoFuso = new Map([[11, { canonicalId: 10, membri: 2 }], [10, { canonicalId: 10, membri: 2 }]]);
  const { risultati } = collassaSuPrincipale(
    [riga(10, 'ROSSI MARIO'), riga(11, 'ROSSI MARIO A.'), riga(99, 'ROSSI GIOVANNI')], soloUnoFuso);
  assert.deepStrictEqual(risultati.map((r) => r.codCli), [10, 99]);
});

test("l'ordine di arrivo non cambia il risultato", () => {
  // La collegata può arrivare prima della principale (ordine alfabetico del
  // gestionale): il risultato dev'essere lo stesso.
  const { risultati, daLeggere } = collassaSuPrincipale(
    [riga(11, 'ROSSI MARIO A.'), riga(10, 'ROSSI MARIO')], gruppo1011);
  assert.deepStrictEqual(risultati.map((r) => r.codCli), [10]);
  assert.deepStrictEqual(daLeggere, []);
});

test('la riga originale non viene modificata', () => {
  const originali = [riga(10, 'ROSSI MARIO')];
  collassaSuPrincipale(originali, gruppo1011);
  assert.strictEqual(originali[0].collegate, undefined);
});

test('elenchi vuoti o mappa assente: nessun errore', () => {
  assert.deepStrictEqual(collassaSuPrincipale([], new Map()), { risultati: [], daLeggere: [] });
  assert.deepStrictEqual(collassaSuPrincipale(null, new Map()), { risultati: [], daLeggere: [] });
  const { risultati } = collassaSuPrincipale([riga(10, 'ROSSI MARIO')], null);
  assert.deepStrictEqual(risultati.map((r) => r.codCli), [10]);
});
