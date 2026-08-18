const express = require('express');
const { getKpiPeriodo, getDettagliPeriodo, getQualitaAnagrafica } = require('../pms/analytics');
const { getAnalyticsCrm } = require('../crm/analytics');
const { getDataLavoro } = require('../pms/prenotazioni');
const { getTuttiGruppiDuplicati } = require('../pms/duplicati');
const { listMappature, separaGruppiDuplicati } = require('../crm/merge');

// Periodi predefiniti del ticket, in giorni. Il periodo personalizzato arriva
// come coppia di date e non passa di qui.
const PERIODI = { '7g': 7, '30g': 30, '3m': 91, '12m': 365 };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const giorno = (d) => d.toISOString().slice(0, 10);
// Aritmetica sulle date in UTC: sommare ore locali fa sbagliare di un giorno
// nelle notti di cambio ora, e una dashboard che sposta il periodo due volte
// l'anno è peggio di una che non c'è.
const sposta = (iso, giorni) => giorno(new Date(new Date(`${iso}T00:00:00Z`).getTime() + giorni * 86400000));

// Il periodo richiesto: due date e la sua durata in giorni.
//
// Fino al 18/08/2026 qui si calcolava anche il periodo IMMEDIATAMENTE
// PRECEDENTE, della stessa lunghezza, per mettere una freccia ▲▼ sotto ogni
// numero. È stato tolto per decisione di Mik, e la ragione vale la pena di
// restare scritta: in un albergo stagionale quel confronto è sbagliato, non
// soltanto inutile. Trenta giorni di agosto contro trenta di luglio danno un
// "+40%" che racconta la stagione, non l'hotel. Il confronto che avrebbe senso è
// con lo STESSO periodo dell'anno prima, e non è un pezzo di questo: è un altro
// lavoro. Nel frattempo si risparmia la seconda esecuzione dell'interrogazione
// più pesante della pagina, che veniva fatta solo per quelle frecce.
function risolviPeriodo(query, oggi) {
  const { da, a, periodo } = query || {};
  if (ISO.test(da || '') && ISO.test(a || '')) {
    if (da > a) return { errore: 'La data iniziale è successiva alla finale' };
    return conDurata(da, a);
  }
  const giorni = PERIODI[periodo] || PERIODI['30g'];
  const fine = oggi;
  const inizio = sposta(fine, -(giorni - 1));
  return conDurata(inizio, fine);
}

function conDurata(da, a) {
  const durata = Math.round(
    (new Date(`${a}T00:00:00Z`) - new Date(`${da}T00:00:00Z`)) / 86400000
  ) + 1;
  return { da, a, durata };
}

function createAnalyticsRouter(pmsDb, crmDb) {
  const router = express.Router();

  // "Oggi" è la data di lavoro del gestionale, non l'orologio del server: è la
  // stessa regola di Arrivi e In casa, e serve perché in hotel la giornata
  // contabile non finisce a mezzanotte.
  const dataDiLavoro = async () => {
    try {
      const d = await getDataLavoro(pmsDb);
      if (d) return d;
    } catch (err) {
      console.warn(`[analytics] data di lavoro non leggibile: ${err.message}`);
    }
    return giorno(new Date());
  };

  // Duplicati ancora da gestire: è il numero della coda di lavoro della pagina
  // Duplicati, e il ticket lo chiede fra gli indicatori di qualità. Costa una
  // lettura di mezzo secondo su tutte le anagrafiche, quindi se fallisce la
  // pagina si apre lo stesso senza quel riquadro: non vale una schermata bianca.
  const contaDuplicati = async () => {
    try {
      const [gruppi, mappature] = await Promise.all([
        getTuttiGruppiDuplicati(pmsDb),
        listMappature(crmDb),
      ]);
      const { daGestire, gestiti } = separaGruppiDuplicati(gruppi, mappature);
      return { daGestire: daGestire.length, gestiti: gestiti.length };
    } catch (err) {
      console.warn(`[analytics] duplicati non calcolabili: ${err.message}`);
      return null;
    }
  };

  // Una sola chiamata per tutta la pagina: sono una decina di interrogazioni
  // brevi, e servirle insieme evita che i riquadri compaiano a scaglioni.
  router.get('/analytics', async (req, res) => {
    const p = risolviPeriodo(req.query, await dataDiLavoro());
    if (p.errore) return res.status(400).json({ error: p.errore });
    const soloVip = String(req.query.vip || '') === '1';

    const [kpi, dettagli, qualita, crm, duplicati] = await Promise.all([
      getKpiPeriodo(pmsDb, p),
      getDettagliPeriodo(pmsDb, { ...p, soloVip }),
      getQualitaAnagrafica(pmsDb, p),
      getAnalyticsCrm(crmDb, p),
      contaDuplicati(),
    ]);

    res.json({
      periodo: { da: p.da, a: p.a, giorni: p.durata },
      ospiti: kpi,
      ...dettagli,
      qualitaAnagrafica: qualita,
      crm: { ...crm, duplicati },
      soloVip,
    });
  });

  return router;
}

module.exports = { createAnalyticsRouter, risolviPeriodo, PERIODI };
