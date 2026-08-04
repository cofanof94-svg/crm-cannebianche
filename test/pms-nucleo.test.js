const { test } = require('node:test');
const assert = require('node:assert');
const { getCoOccupanti, isAzienda, filtraCoOccupanti } = require('../src/pms/nucleo');

function fakePms(recordset) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('isAzienda riconosce le forme societarie, non i cognomi simili', () => {
  assert.strictEqual(isAzienda('ADB SRL'), true);
  assert.strictEqual(isAzienda('KIRKER GMBH'), true);
  assert.strictEqual(isAzienda('ROSSI S.P.A.'), true);
  assert.strictEqual(isAzienda('DE IACO ISABELLA'), false);
  assert.strictEqual(isAzienda('GIUSEPPE SPADA'), false);   // SPADA non è SPA
  assert.strictEqual(isAzienda(''), false);
});

test('filtraCoOccupanti: poche prenotazioni → tutti; molte → solo ricorrenti; mai aziende', () => {
  const items = [
    { cognome: 'BEBIE', nome: 'ADRIAN', nShared: 1 },
    { cognome: 'BEBIE', nome: 'SIENNA', nShared: 3 },
    { cognome: 'ADB', nome: 'SRL', nShared: 5 },   // azienda: sempre esclusa
  ];
  // poche prenotazioni (<= 3): tutti tranne l'azienda
  assert.deepStrictEqual(filtraCoOccupanti(3, items).map((o) => o.nome), ['ADRIAN', 'SIENNA']);
  // molte prenotazioni (> 3): solo chi ha condiviso >= 2 prenotazioni, tranne azienda
  assert.deepStrictEqual(filtraCoOccupanti(20, items).map((o) => o.nome), ['SIENNA']);
});

test('getCoOccupanti mappa righe e totale prenotazioni', async () => {
  const pms = fakePms([
    { codCli: 5, Cognome: 'BEBIE', Nome: 'ADRIAN', nShared: 3, totPrat: 53 },
    { codCli: 6, Cognome: 'GYGAX', Nome: 'MARKUS', nShared: 1, totPrat: 53 },
  ]);
  const { total, items } = await getCoOccupanti(pms, [2117]);
  assert.strictEqual(total, 53);
  assert.strictEqual(items.length, 2);
  assert.deepStrictEqual(items[0], { codCli: 5, cognome: 'BEBIE', nome: 'ADRIAN', nShared: 3 });
  assert.match(pms.calls[0].text, /IN \(2117\)/);
  assert.match(pms.calls[0].text, /COUNT\(DISTINCT o\.codpratica\)/);
});

test('getCoOccupanti: nessun co-occupante → total 0, items []', async () => {
  const { total, items } = await getCoOccupanti(fakePms([]), [1]);
  assert.strictEqual(total, 0);
  assert.deepStrictEqual(items, []);
});
