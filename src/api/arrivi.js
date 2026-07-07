const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { getArriviByData, getRiepilogoGiorno } = require('../pms/prenotazioni');

function oggiISO() {
  return new Date().toISOString().slice(0, 10);
}

function dataValida(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime());
}

function createArriviRouter(pmsDb) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/arrivi', async (req, res) => {
    const data = req.query.data || oggiISO();
    if (!dataValida(data)) return res.status(400).json({ error: 'Data non valida' });
    const arrivi = await getArriviByData(pmsDb, data);
    res.json({ data, arrivi });
  });

  router.get('/dashboard', async (req, res) => {
    const data = req.query.data || oggiISO();
    if (!dataValida(data)) return res.status(400).json({ error: 'Data non valida' });
    const riepilogo = await getRiepilogoGiorno(pmsDb, data);
    res.json({ data, ...riepilogo });
  });

  return router;
}

module.exports = { createArriviRouter, dataValida };
