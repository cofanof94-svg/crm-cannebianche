const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { cercaClienti, getCliente, getSoggiorniCliente } = require('../pms/clienti');
const { listNote, createNota, updateNota, deleteNota } = require('../crm/note');
const { listComplaints, createComplaint, updateComplaintTesto, setComplaintStato, deleteComplaint } = require('../crm/complaint');
const { listIntolleranze, createIntolleranza, deleteIntolleranza } = require('../crm/intolleranze');
const { getProfilo, upsertLingua } = require('../crm/profilo');
const { listPreferenze, createPreferenza, deletePreferenza, REPARTI, CATEGORIE } = require('../crm/preferenze');
const { listNucleo, createMembro, deleteMembro, RELAZIONI } = require('../crm/nucleo');

function calcolaStatistiche(soggiorni) {
  // Le prenotazioni eliminate (annullate) restano nello storico ma non sono
  // soggiorni reali: escluse dai conteggi e da prima/ultima visita.
  const validi = soggiorni.filter((x) => x.stato !== 'Eliminata');
  const nSoggiorni = validi.length;
  const totArrangiamenti = validi.reduce((s, x) => s + (x.arrangiamento || 0), 0);
  const totExtra = validi.reduce((s, x) => s + (x.extra || 0), 0);
  const nottiTotali = validi.reduce((s, x) => s + (Number(x.notti) || 0), 0);
  const ltv = totArrangiamenti + totExtra; // valore storico (city tax esclusa dagli extra)
  const date = validi.map((x) => x.dtarrivo).filter(Boolean).sort();
  // Ultima Source = source del soggiorno valido con data di arrivo più recente
  const piuRecente = validi.filter((x) => x.dtarrivo).sort((a, b) => (a.dtarrivo < b.dtarrivo ? 1 : -1))[0];
  const media = (tot) => (nSoggiorni ? tot / nSoggiorni : 0);
  return {
    nSoggiorni,
    nottiTotali,
    totArrangiamenti,
    totExtra,
    totaleSpeso: ltv,
    ltv,
    spesaMediaSoggiorno: media(ltv),
    spesaMediaRooms: media(totArrangiamenti),
    spesaMediaServizi: media(totExtra),
    ultimaSource: (piuRecente && piuRecente.source) || null,
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

  // --- Complaints (reclami) ---
  router.get('/clienti/:codCli/complaints', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    res.json({ complaints: await listComplaints(crmDb, codCli) });
  });

  router.post('/clienti/:codCli/complaints', async (req, res) => {
    const codCli = Number(req.params.codCli);
    const testo = (req.body && req.body.testo ? String(req.body.testo) : '').trim();
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    if (!testo) return res.status(400).json({ error: 'Testo mancante' });
    const complaint = await createComplaint(crmDb, { pmsCustomerId: codCli, autoreUserId: req.session.user.id, testo });
    res.status(201).json({ complaint });
  });

  router.patch('/complaints/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const body = req.body || {};
    const testo = body.testo != null ? String(body.testo).trim() : null;
    const stato = body.stato != null ? String(body.stato).trim() : null;
    if (stato != null && stato !== 'aperto' && stato !== 'risolto') return res.status(400).json({ error: 'Stato non valido' });
    if (testo === '') return res.status(400).json({ error: 'Testo mancante' });
    if (testo == null && stato == null) return res.status(400).json({ error: 'Niente da aggiornare' });
    let ok = true;
    if (testo != null) ok = await updateComplaintTesto(crmDb, id, testo);
    if (ok && stato != null) ok = await setComplaintStato(crmDb, id, stato);
    if (!ok) return res.status(404).json({ error: 'Complaint non trovato' });
    res.json({ ok: true });
  });

  router.delete('/complaints/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const ok = await deleteComplaint(crmDb, id);
    if (!ok) return res.status(404).json({ error: 'Complaint non trovato' });
    res.json({ ok: true });
  });

  // --- Intolleranze / allergie (dato di sicurezza) ---
  router.get('/clienti/:codCli/intolleranze', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    res.json({ intolleranze: await listIntolleranze(crmDb, codCli) });
  });

  router.post('/clienti/:codCli/intolleranze', async (req, res) => {
    const codCli = Number(req.params.codCli);
    const testo = (req.body && req.body.testo ? String(req.body.testo) : '').trim();
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    if (!testo) return res.status(400).json({ error: 'Testo mancante' });
    const intolleranza = await createIntolleranza(crmDb, { pmsCustomerId: codCli, autoreUserId: req.session.user.id, testo });
    res.status(201).json({ intolleranza });
  });

  router.delete('/intolleranze/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const ok = await deleteIntolleranza(crmDb, id);
    if (!ok) return res.status(404).json({ error: 'Intolleranza non trovata' });
    res.json({ ok: true });
  });

  // --- Profilo / Lingua preferita (1:1) ---
  router.get('/clienti/:codCli/profilo', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    res.json({ profilo: await getProfilo(crmDb, codCli) });
  });

  router.put('/clienti/:codCli/profilo', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const lingua = (req.body && req.body.lingua != null ? String(req.body.lingua) : '').trim() || null;
    const profilo = await upsertLingua(crmDb, { pmsCustomerId: codCli, lingua, autoreUserId: req.session.user.id });
    res.json({ profilo });
  });

  // --- Preferenze (reparto + categoria + testo, liste chiuse) ---
  router.get('/clienti/:codCli/preferenze', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    res.json({ preferenze: await listPreferenze(crmDb, codCli) });
  });

  router.post('/clienti/:codCli/preferenze', async (req, res) => {
    const codCli = Number(req.params.codCli);
    const b = req.body || {};
    const reparto = b.reparto != null ? String(b.reparto).trim() : '';
    const categoria = b.categoria != null ? String(b.categoria).trim() : '';
    const testo = b.testo != null ? String(b.testo).trim() : '';
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    if (!testo) return res.status(400).json({ error: 'Testo mancante' });
    if (!REPARTI.includes(reparto)) return res.status(400).json({ error: 'Reparto non valido' });
    if (!CATEGORIE.includes(categoria)) return res.status(400).json({ error: 'Categoria non valida' });
    const preferenza = await createPreferenza(crmDb, { pmsCustomerId: codCli, autoreUserId: req.session.user.id, reparto, categoria, testo });
    res.status(201).json({ preferenza });
  });

  router.delete('/preferenze/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const ok = await deletePreferenza(crmDb, id);
    if (!ok) return res.status(404).json({ error: 'Preferenza non trovata' });
    res.json({ ok: true });
  });

  // --- Nucleo di viaggio / accompagnatori ---
  router.get('/clienti/:codCli/nucleo', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    res.json({ nucleo: await listNucleo(crmDb, codCli) });
  });

  router.post('/clienti/:codCli/nucleo', async (req, res) => {
    const codCli = Number(req.params.codCli);
    const b = req.body || {};
    const tipoRelazione = b.tipoRelazione != null ? String(b.tipoRelazione).trim() : '';
    const nome = b.nome != null ? String(b.nome).trim() : '';
    const cognome = b.cognome != null ? String(b.cognome).trim() : '';
    const nota = b.nota != null ? String(b.nota).trim() : '';
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    if (!RELAZIONI.includes(tipoRelazione)) return res.status(400).json({ error: 'Relazione non valida' });
    if (!nome && !cognome) return res.status(400).json({ error: 'Nome o cognome richiesto' });
    const membro = await createMembro(crmDb, { pmsCustomerId: codCli, autoreUserId: req.session.user.id, tipoRelazione, nome: nome || null, cognome: cognome || null, nota: nota || null });
    res.status(201).json({ membro });
  });

  router.delete('/nucleo/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const ok = await deleteMembro(crmDb, id);
    if (!ok) return res.status(404).json({ error: 'Membro non trovato' });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createClientiRouter, calcolaStatistiche };
