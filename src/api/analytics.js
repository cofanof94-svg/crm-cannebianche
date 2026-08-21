const express = require('express');
const {
  getKpiPeriodo, getDettagliPeriodo, getQualitaAnagrafica, getPrimoSoggiorno, GIORNI_PER_ANNO,
} = require('../pms/analytics');
const { getAnalyticsCrm } = require('../crm/analytics');
const { getDataLavoro } = require('../pms/prenotazioni');
const { getTuttiGruppiDuplicati } = require('../pms/duplicati');
const { listMappature, separaGruppiDuplicati } = require('../crm/merge');

// Periodi predefiniti, in giorni. Il periodo personalizzato arriva come coppia
// di date e non passa di qui; "tutto" nemmeno, perché la sua data d'inizio la
// sa solo il gestionale (vedi inizioStorico).
const PERIODI = { '7g': 7, '30g': 30, '3m': 91, '12m': 365 };

// Quanto indietro si accetta di andare con "tutto lo storico". Non è diffidenza
// verso l'hotel: nei gestionali vecchi capita una prenotazione con una data
// sbagliata di decenni, e basta quella per far partire il grafico da un secolo
// in cui non c'era niente. Venti anni sono già più storia di quanta ne esista.
const ANNI_MAX_STORICO = 20;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// La forma non basta: "2026-13-45" e "2026-02-31" la rispettano ma non sono
// giorni esistenti. Passavano fino a SQL Server, che non riesce a convertirli e
// fa rispondere 500 — un errore del server per un dato scritto male. Si
// riconoscono confrontando la data ricostruita con quella scritta: il 31
// febbraio, ricostruito, diventa il 3 marzo e non combacia più.
function dataVera(iso) {
  if (!ISO.test(iso || '')) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return false; // "2026-13-45": non è nemmeno una data
  return giorno(d) === iso;
}
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
    // Una data sola continua a ripiegare sul periodo predefinito (vedi sotto):
    // qui ci si arriva solo quando ci sono entrambe, e allora devono esistere.
    if (!dataVera(da) || !dataVera(a)) return { errore: 'Date non valide: controlla giorno e mese' };
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

  // Da dove comincia "tutto lo storico". Si chiede al gestionale invece di
  // inventare una data: partire da un anno in cui non c'era niente farebbe un
  // grafico che comincia con una lunga riga a zero. Se la lettura non riesce si
  // ripiega su dieci anni, che è più di quanto l'hotel abbia in archivio: la
  // pagina si apre lo stesso, con qualche mese vuoto in testa.
  const inizioStorico = async (oggi) => {
    const limite = sposta(oggi, -Math.round(ANNI_MAX_STORICO * 365.25));
    let primo = null;
    try {
      primo = await getPrimoSoggiorno(pmsDb);
    } catch (err) {
      console.warn(`[analytics] inizio dello storico non leggibile: ${err.message}`);
    }
    if (!primo) return sposta(oggi, -3653);
    return primo < limite ? limite : primo;
  };

  // Una sola chiamata per tutta la pagina: sono una decina di interrogazioni
  // brevi, e servirle insieme evita che i riquadri compaiano a scaglioni.
  router.get('/analytics', async (req, res) => {
    const oggi = await dataDiLavoro();
    const tutto = String(req.query.periodo || '') === 'tutto';
    const query = tutto ? { da: await inizioStorico(oggi), a: oggi } : req.query;
    const p = risolviPeriodo(query, oggi);
    if (p.errore) return res.status(400).json({ error: p.errore });
    const soloVip = String(req.query.vip || '') === '1';
    // Oltre i due anni l'andamento passa da mese ad anno: un'etichetta per mese
    // su tutto lo storico sarebbe un grafico illeggibile.
    const perAnno = p.durata > GIORNI_PER_ANNO;

    const [kpi, dettagli, qualita, crm, duplicati] = await Promise.all([
      getKpiPeriodo(pmsDb, p),
      getDettagliPeriodo(pmsDb, { ...p, soloVip, perAnno }),
      getQualitaAnagrafica(pmsDb, p),
      getAnalyticsCrm(crmDb, p),
      contaDuplicati(),
    ]);

    res.json({
      periodo: { da: p.da, a: p.a, giorni: p.durata, tutto },
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
