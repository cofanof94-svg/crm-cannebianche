const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { getArriviByData, getInCasaByData, getRiepilogoGiorno, getDataLavoro } = require('../pms/prenotazioni');
const { arricchisciArrivi, briefingVuoto } = require('../crm/arrivi-brief');
const { arricchisciInCasa, briefingInCasaVuoto, ordinaInCasa } = require('../crm/incasa-brief');

function oggiISO() {
  return new Date().toISOString().slice(0, 10);
}

function dataValida(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime());
}

function createArriviRouter(pmsDb, crmDb) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/arrivi', async (req, res) => {
    const data = req.query.data || (await getDataLavoro(pmsDb)) || oggiISO();
    if (!dataValida(data)) return res.status(400).json({ error: 'Data non valida' });
    const arrivi = await getArriviByData(pmsDb, data);
    // Arricchimento CRM/PMS (snapshot + briefing). Degradazione morbida: se qualcosa
    // nel CRM fallisce, si serve comunque la lista operativa PMS (la dashboard non deve rompersi).
    try {
      const enr = await arricchisciArrivi(pmsDb, crmDb, arrivi);
      res.json({ data, briefing: enr.briefing, arrivi: enr.arrivi });
    } catch (e) {
      console.error('Arricchimento arrivi fallito, degrado a lista PMS:', e.message);
      res.json({ data, briefing: briefingVuoto(arrivi.length), arrivi });
    }
  });

  router.get('/incasa', async (req, res) => {
    const data = req.query.data || (await getDataLavoro(pmsDb)) || oggiISO();
    if (!dataValida(data)) return res.status(400).json({ error: 'Data non valida' });
    const clienti = await getInCasaByData(pmsDb, data);
    // Stessa degradazione morbida degli arrivi: se il CRM non risponde si serve
    // comunque la lista PMS, almeno ordinata per camera.
    try {
      const enr = await arricchisciInCasa(pmsDb, crmDb, clienti, data);
      res.json({ data, briefing: enr.briefing, clienti: enr.clienti });
    } catch (e) {
      console.error('Arricchimento In Casa fallito, degrado a lista PMS:', e.message);
      res.json({ data, briefing: briefingInCasaVuoto(clienti.length), clienti: ordinaInCasa(clienti) });
    }
  });

  router.get('/dashboard', async (req, res) => {
    const data = req.query.data || (await getDataLavoro(pmsDb)) || oggiISO();
    if (!dataValida(data)) return res.status(400).json({ error: 'Data non valida' });
    const riepilogo = await getRiepilogoGiorno(pmsDb, data);
    res.json({ data, ...riepilogo });
  });

  return router;
}

module.exports = { createArriviRouter, dataValida };
