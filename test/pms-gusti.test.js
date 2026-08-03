const { test } = require('node:test');
const assert = require('node:assert');
const { getGustiFB, macro } = require('../src/pms/gusti');

function fakePms(recordset) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('macro classifica per flgFoodBeverage / gruppo', () => {
  assert.strictEqual(macro('C', ''), 'Vini');
  assert.strictEqual(macro('', 'BEV.VI'), 'Vini');
  assert.strictEqual(macro('B', 'BEV.BI'), 'Bevande');
  assert.strictEqual(macro('F', 'FO'), 'Cibo');
  assert.strictEqual(macro('', ''), 'Altro');
});

test('getGustiFB mappa, categorizza e totalizza', async () => {
  const pms = fakePms([
    { codArt: 'COCAZ', nome: 'COCA COLA ZERO', fb: 'B', grp: 'BEV.BI', volte: 88, qta: 88, eur: 601 },
    { codArt: 'BOLL', nome: 'CALICE BOLLICINE', fb: 'C', grp: 'BEV.VI', volte: 17, qta: 17, eur: 250 },
    { codArt: 'VERD', nome: 'VERDURE GRIGLIATE', fb: 'F', grp: 'FO', volte: 22, qta: 22, eur: 178 },
  ]);
  const g = await getGustiFB(pms, 2117);
  assert.strictEqual(g.totVoci, 3);
  assert.strictEqual(g.totConsumi, 127);              // 88+17+22
  assert.strictEqual(g.items[0].categoria, 'Bevande');
  assert.strictEqual(g.items[1].categoria, 'Vini');
  assert.strictEqual(g.items[2].categoria, 'Cibo');
  assert.strictEqual(g.items[0].nome, 'COCA COLA ZERO');
  assert.match(pms.calls[0].text, /IN \(2117\)/);           // codice del gruppo interpolato
  assert.match(pms.calls[0].text, /StorAddebitiComanda/);   // aggancio consumi
  assert.match(pms.calls[0].text, /BETWEEN s\.arr AND s\.par/); // camera + data
});

test('getGustiFB: nessun consumo → vuoto', async () => {
  const g = await getGustiFB(fakePms([]), 1);
  assert.deepStrictEqual(g, { totVoci: 0, totConsumi: 0, items: [] });
});
