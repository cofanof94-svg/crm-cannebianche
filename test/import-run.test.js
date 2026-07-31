const { test } = require('node:test');
const assert = require('node:assert');
const { eseguiImport, parseArgs } = require('../src/import/run');

test('parseArgs legge --chiave=valore e flag', () => {
  assert.deepStrictEqual(parseArgs(['--client=47186', '--full']), { client: '47186', full: true });
});

test('eseguiImport: carica snapshot validi, aggrega cumulativi, raccoglie anomalie', async () => {
  const rawRows = [
    // valida, conclusa con importo → snapshot + cumulativi
    { codpratica: 100, pms_customer_id: 9, isStorico: 1, dtarrivo: '2026-04-17', notti: 2, impArrangiamento: 800, impExtra: 200, source: 'DIRETTI', hasOccupanti: 1 },
    // cancellata → snapshot sì, cumulativi no
    { codpratica: 101, pms_customer_id: 9, isStorico: 1, dataEliminazione: '2026-01-01', Motivo: 'CXL', impArrangiamento: 0, impExtra: 0 },
    // chiave mancante → anomalia, nessuno snapshot
    { codpratica: null, pms_customer_id: 9 },
  ];
  const pmsDb = { async query() { return rawRows; } };
  const merges = { snapshot: [], cumulativi: [] };
  const crmDb = {
    async query(text, params) {
      if (/MERGE booking_snapshot/.test(text)) merges.snapshot.push(params);
      else if (/MERGE customer_cumulativi/.test(text)) merges.cumulativi.push(params);
      return [];
    },
  };

  const res = await eseguiImport(pmsDb, crmDb, {});
  assert.strictEqual(res.totali, 3);
  assert.strictEqual(res.snapshotOk, 2);              // 100 e 101 scritti; il null no
  assert.strictEqual(res.anomalie.length, 1);         // chiave mancante
  assert.strictEqual(merges.snapshot.length, 2);
  assert.strictEqual(res.clientiAgg, 1);              // un solo cliente (9) con righe valide
  const cum = merges.cumulativi[0];
  assert.strictEqual(cum.pmsCustomerId, 9);
  assert.strictEqual(cum.nSoggiorni, 1);              // solo la 100 è valida (101 cancellata)
  assert.strictEqual(cum.ltv, 1000);
});
