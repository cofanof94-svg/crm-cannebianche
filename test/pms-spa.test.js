const { test } = require('node:test');
const assert = require('node:assert');
const { getTrattamentiSpa, macroSpa } = require('../src/pms/spa');

function fakePms(recordset) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('macroSpa: trattamenti vs prodotti', () => {
  assert.strictEqual(macroSpa('SPA'), 'Trattamento');
  assert.strictEqual(macroSpa('SPA.VEN'), 'Prodotto');
  assert.strictEqual(macroSpa('SPA.CAB'), 'Trattamento');
  assert.strictEqual(macroSpa(''), 'Altro');
});

test('getTrattamentiSpa mappa, categorizza e totalizza', async () => {
  const pms = fakePms([
    { nome: 'SERENITY', grp: 'SPA', volte: 24, qta: 24, eur: 2685 },
    { nome: 'BASIC MANICURE', grp: 'SPA', volte: 41, qta: 41, eur: 1434 },
    { nome: 'CREMA VISO AQUASENSE', grp: 'SPA.VEN', volte: 3, qta: 3, eur: 120 },
  ]);
  const s = await getTrattamentiSpa(pms, 18598);
  assert.strictEqual(s.totVoci, 3);
  assert.strictEqual(s.totConsumi, 68);                 // 24+41+3
  assert.strictEqual(s.items[0].categoria, 'Trattamento');
  assert.strictEqual(s.items[2].categoria, 'Prodotto');
  assert.strictEqual(s.items[0].nome, 'SERENITY');
  assert.strictEqual(pms.calls[0].params.codCli, 18598);
  assert.match(pms.calls[0].text, /StorMatura/);        // extra da Matura/StorMatura
  assert.match(pms.calls[0].text, /codgrpmerCAT LIKE 'SPA%'/); // filtro gruppo SPA
  assert.match(pms.calls[0].text, /alb\.codalb = mov\.codalb/); // aggancio via codalb
});

test('getTrattamentiSpa: nessun trattamento → vuoto', async () => {
  const s = await getTrattamentiSpa(fakePms([]), 1);
  assert.deepStrictEqual(s, { totVoci: 0, totConsumi: 0, items: [] });
});
