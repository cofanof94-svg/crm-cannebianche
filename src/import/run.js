// Entry point dell'import ibrido: `npm run import [-- --client=<codCli>]`.
// Estrae dal PMS (sola lettura), trasforma, carica su booking_snapshot e
// ricalcola i cumulativi. Non blocca su errori di riga: li accumula in un
// report anomalie. Nessuna scrittura sul PMS.
//
// ⚠️ L'estrazione (src/import/estrai.js) va verificata sui dati veri in hotel.

const { loadConfig } = require('../config');
const { connectPms } = require('../db/pms');
const { connectCrm } = require('../db/crm');
const { estraiPrenotazioni } = require('./estrai');
const { buildSnapshotRow, calcolaCumulativiCliente } = require('./trasforma');
const { upsertSnapshot, upsertCumulativi } = require('./carica');

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}

async function eseguiImport(pmsDb, crmDb, opts = {}) {
  const codCli = opts.client ? Number(opts.client) : null;
  const raw = await estraiPrenotazioni(pmsDb, { codCli, updatedAfter: opts.since || null });

  const anomalie = [];
  const perCliente = new Map(); // pms_customer_id -> righe snapshot valide
  let ok = 0;

  for (const r of raw) {
    try {
      if (r.codpratica == null || r.pms_customer_id == null) { anomalie.push({ codpratica: r.codpratica, motivo: 'chiave mancante' }); continue; }
      const row = buildSnapshotRow({
        codpratica: r.codpratica, pmsCustomerId: r.pms_customer_id, isStorico: r.isStorico === 1 || r.isStorico === true,
        dtarrivo: r.dtarrivo, dtpartenza: r.dtpartenza, notti: r.notti, flgincasa: r.flgincasa,
        dataEliminazione: r.dataEliminazione, motivo: r.Motivo, source: r.source, mercato: r.mercato,
        camere: r.camere, tipologia: r.tipologia, trattamento: r.trattamento, pax: r.pax,
        impArrangiamento: r.impArrangiamento, impExtra: r.impExtra, cityTax: r.cityTax,
        vipSnapshot: r.vipSnapshot, amenitiesSnapshot: r.amenitiesSnapshot, hasOccupanti: r.hasOccupanti,
        pmsUpdatedAt: r.pmsUpdatedAt,
      });
      await upsertSnapshot(crmDb, row);
      ok++;
      if (row.validoCumulativi) {
        if (!perCliente.has(row.pmsCustomerId)) perCliente.set(row.pmsCustomerId, []);
        perCliente.get(row.pmsCustomerId).push(row);
      }
    } catch (e) {
      anomalie.push({ codpratica: r && r.codpratica, motivo: e.message });
    }
  }

  // Cumulativi per cliente (solo righe valide). NB: in import incrementale i
  // cumulativi vanno ricalcolati leggendo lo snapshot completo del cliente; qui
  // (import pieno) usiamo le righe appena costruite.
  let clientiAgg = 0;
  for (const [pmsCustomerId, righe] of perCliente) {
    try { await upsertCumulativi(crmDb, pmsCustomerId, calcolaCumulativiCliente(righe)); clientiAgg++; }
    catch (e) { anomalie.push({ codpratica: `cumulativi:${pmsCustomerId}`, motivo: e.message }); }
  }

  return { totali: raw.length, snapshotOk: ok, clientiAgg, anomalie };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const pmsDb = await connectPms(cfg.pms);
  const crmDb = await connectCrm(cfg.crm);
  try {
    const t0 = Date.now();
    const res = await eseguiImport(pmsDb, crmDb, opts);
    console.log(`Import completato in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`  righe estratte:   ${res.totali}`);
    console.log(`  snapshot scritti: ${res.snapshotOk}`);
    console.log(`  clienti aggreg.:  ${res.clientiAgg}`);
    console.log(`  anomalie:         ${res.anomalie.length}`);
    if (res.anomalie.length) console.log('  prime anomalie:', JSON.stringify(res.anomalie.slice(0, 10)));
  } finally {
    await pmsDb.close();
    await crmDb.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('IMPORT FALLITO:', e.message); process.exit(1); });
}

module.exports = { eseguiImport, parseArgs };
