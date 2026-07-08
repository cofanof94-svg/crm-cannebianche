const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { cercaClienti, getCliente, getSoggiorniCliente } = require('../pms/clienti');
const { listNote, createNota, updateNota, deleteNota } = require('../crm/note');

function calcolaStatistiche(soggiorni) {
  const nSoggiorni = soggiorni.length;
  const totaleSpeso = soggiorni.reduce((s, x) => s + (x.importo || 0), 0);
  const date = soggiorni.map((x) => x.dtarrivo).filter(Boolean).sort();
  return {
    nSoggiorni,
    totaleSpeso,
    primaVisita: date[0] || null,
    ultimaVisita: date[date.length - 1] || null,
  };
}

function createClientiRouter(pmsDb, crmDb) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/clienti', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ risultati: [] });
    const risultati = await cercaClienti(pmsDb, q);
    res.json({ risultati });
  });

  router.get('/clienti/:codCli', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const anagrafica = await getCliente(pmsDb, codCli);
    if (!anagrafica) return res.status(404).json({ error: 'Cliente non trovato' });
    const soggiorni = await getSoggiorniCliente(pmsDb, codCli);
    res.json({ anagrafica, statistiche: calcolaStatistiche(soggiorni), soggiorni });
  });

  router.get('/clienti/:codCli/note', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    res.json({ note: await listNote(crmDb, codCli) });
  });

  router.post('/clienti/:codCli/note', async (req, res) => {
    const codCli = Number(req.params.codCli);
    const testo = (req.body && req.body.testo ? String(req.body.testo) : '').trim();
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    if (!testo) return res.status(400).json({ error: 'Testo mancante' });
    const nota = await createNota(crmDb, { pmsCustomerId: codCli, autoreUserId: req.session.user.id, testo });
    res.status(201).json({ nota });
  });

  router.patch('/note/:id', async (req, res) => {
    const id = Number(req.params.id);
    const testo = (req.body && req.body.testo ? String(req.body.testo) : '').trim();
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    if (!testo) return res.status(400).json({ error: 'Testo mancante' });
    const ok = await updateNota(crmDb, id, testo);
    if (!ok) return res.status(404).json({ error: 'Nota non trovata' });
    res.json({ ok: true });
  });

  router.delete('/note/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const ok = await deleteNota(crmDb, id);
    if (!ok) return res.status(404).json({ error: 'Nota non trovata' });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createClientiRouter, calcolaStatistiche };
