const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { cercaClienti, getCliente, getSoggiorniCliente } = require('../pms/clienti');
const { getGustiFB } = require('../pms/gusti');
const { getTrattamentiSpa } = require('../pms/spa');
const { listNote, createNota, updateNota, deleteNota } = require('../crm/note');
const { listComplaints, createComplaint, updateComplaintTesto, setComplaintPeriodo, setComplaintStato, deleteComplaint } = require('../crm/complaint');
const { listIntolleranze, createIntolleranza, deleteIntolleranza } = require('../crm/intolleranze');
const { getProfilo, upsertLingua } = require('../crm/profilo');
const { listPreferenze, createPreferenza, deletePreferenza, REPARTI, CATEGORIE } = require('../crm/preferenze');
const { listNucleo, createMembro, deleteMembro, RELAZIONI } = require('../crm/nucleo');
const { aggregaCumulativi } = require('../stats');
const { getAiClient } = require('../ai/client');
const { costruisciFatti, haFatti, suggerisci } = require('../ai/suggerisci');
const { getGruppo, mergeInto, unmerge, listMappature } = require('../crm/merge');
const { getDuplicatiCandidati, getTuttiGruppiDuplicati } = require('../pms/duplicati');

// Eliminate e No-show restano nello storico ma non sono soggiorni reali:
// escluse dai conteggi. L'aggregazione vera è nel modulo condiviso src/stats.js.
const STATI_NON_VALIDI = ['Eliminata', 'No-show'];
function calcolaStatistiche(soggiorni) {
  return aggregaCumulativi(soggiorni.filter((x) => !STATI_NON_VALIDI.includes(x.stato)));
}

// Ritorna l'intero da un parametro di rotta, o null se non valido.
const intParam = (v) => { const n = Number(v); return Number.isInteger(n) ? n : null; };

function createClientiRouter(pmsDb, crmDb) {
  const router = express.Router();
  router.use(requireAuth);

  // Factory per le rotte DELETE /<risorsa>/:id (tutte identiche tranne fn e messaggio).
  const delRoute = (path, fn, notFound) => router.delete(path, async (req, res) => {
    const id = intParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'ID non valido' });
    if (!(await fn(crmDb, id))) return res.status(404).json({ error: notFound });
    res.json({ ok: true });
  });

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
    const { canonicalId, membri } = await getGruppo(crmDb, codCli);
    const soggiorni = await getSoggiorniCliente(pmsDb, membri);
    // Info fusione per il banner: se il gruppo ha più codici, elenco i nominativi.
    let merge = null;
    if (membri.length > 1) {
      const anags = await Promise.all(membri.map((id) => getCliente(pmsDb, id)));
      merge = {
        canonicalId,
        membri,
        anagrafiche: anags.filter(Boolean).map((a) => ({ codCli: a.codCli, nominativo: a.nominativo })),
      };
    }
    res.json({ anagrafica, statistiche: calcolaStatistiche(soggiorni), soggiorni, merge });
  });

  // Gusti F&B (Fase 3 A): endpoint separato, query più pesante → caricata a parte.
  router.get('/clienti/:codCli/gusti', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    res.json({ gusti: await getGustiFB(pmsDb, membri) });
  });

  // Trattamenti SPA (Fase 3): consumi benessere dagli extra, aggregati per nome.
  router.get('/clienti/:codCli/spa', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    res.json({ spa: await getTrattamentiSpa(pmsDb, membri) });
  });

  // --- Fusione anagrafiche duplicate (virtual merge, lato CRM) ---
  // Candidati duplicati per la scheda, esclusi i codici già nel gruppo.
  router.get('/clienti/:codCli/duplicati', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    const candidati = await getDuplicatiCandidati(pmsDb, codCli);
    res.json({ candidati: candidati.filter((c) => !membri.includes(c.codCli)) });
  });

  // Fonde un codice (memberId) nel gruppo di un principale (canonicalId).
  router.post('/clienti/:codCli/merge', async (req, res) => {
    const b = req.body || {};
    const memberId = intParam(b.memberId);
    const canonicalId = intParam(b.canonicalId);
    if (memberId === null || canonicalId === null) return res.status(400).json({ error: 'memberId/canonicalId non validi' });
    const r = await mergeInto(crmDb, { memberId, canonicalId, autoreUserId: req.session.user.id });
    if (!r.ok) return res.status(400).json({ error: 'Fusione non valida (auto-fusione)' });
    res.status(201).json({ ok: true, canonicalId: r.canonicalId });
  });

  // Annulla la fusione di un singolo codice (torna standalone).
  router.delete('/merge/:memberId', async (req, res) => {
    const memberId = intParam(req.params.memberId);
    if (memberId === null) return res.status(400).json({ error: 'ID non valido' });
    if (!(await unmerge(crmDb, memberId))) return res.status(404).json({ error: 'Mappatura non trovata' });
    res.json({ ok: true });
  });

  // Tutti i gruppi di duplicati (pagina di gestione), con lo stato "già fuso".
  router.get('/duplicati', async (req, res) => {
    const [gruppi, mappature] = await Promise.all([
      getTuttiGruppiDuplicati(pmsDb),
      listMappature(crmDb),
    ]);
    const fusi = new Set(mappature.map((m) => m.pms_customer_id));
    res.json({ gruppi: gruppi.map((g) => ({ ...g, fusiCount: g.membri.filter((id) => fusi.has(id)).length })) });
  });

  // Suggerisci preferenze (Fase 3 C, AI on-demand). Raccoglie i fatti dell'ospite
  // (gusti F&B + note + intolleranze/preferenze già presenti) e chiede a Claude di
  // proporre preferenze/intolleranze. NON salva: l'operatore conferma a mano dai
  // pulsanti esistenti. 503 se l'AI non è configurata (SDK/chiave assenti).
  router.post('/clienti/:codCli/suggerimenti', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const ai = getAiClient();
    if (!ai) return res.status(503).json({ error: 'AI non configurata (manca @anthropic-ai/sdk o ANTHROPIC_API_KEY)' });
    const { membri } = await getGruppo(crmDb, codCli);
    const [gusti, spa, note, intolleranze, preferenze] = await Promise.all([
      getGustiFB(pmsDb, membri),
      getTrattamentiSpa(pmsDb, membri),
      listNote(crmDb, membri),
      listIntolleranze(crmDb, membri),
      listPreferenze(crmDb, membri),
    ]);
    const fatti = costruisciFatti({ gusti, spa, note, intolleranze, preferenze });
    if (!haFatti(fatti)) return res.json({ suggerimenti: [], motivo: 'dati insufficienti' });
    const suggerimenti = await suggerisci(ai.client, fatti, { model: ai.model });
    // Audit minimale (Fase 3 privacy): chi ha generato suggerimenti, per chi, quanti.
    console.log(`[AI suggerimenti] cliente=${codCli} utente=${req.session.user.username} n=${suggerimenti.length}`);
    res.json({ suggerimenti });
  });

  router.get('/clienti/:codCli/note', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    res.json({ note: await listNote(crmDb, membri) });
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

  delRoute('/note/:id', deleteNota, 'Nota non trovata');

  // --- Complaints (reclami) ---
  router.get('/clienti/:codCli/complaints', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    res.json({ complaints: await listComplaints(crmDb, membri) });
  });

  router.post('/clienti/:codCli/complaints', async (req, res) => {
    const codCli = Number(req.params.codCli);
    const b = req.body || {};
    const testo = (b.testo ? String(b.testo) : '').trim();
    const periodo = (b.periodo != null ? String(b.periodo).trim() : '') || null;
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    if (!testo) return res.status(400).json({ error: 'Testo mancante' });
    const complaint = await createComplaint(crmDb, { pmsCustomerId: codCli, autoreUserId: req.session.user.id, testo, periodo });
    res.status(201).json({ complaint });
  });

  router.patch('/complaints/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const body = req.body || {};
    const testo = body.testo != null ? String(body.testo).trim() : null;
    const stato = body.stato != null ? String(body.stato).trim() : null;
    const periodo = body.periodo != null ? String(body.periodo).trim() : null;
    if (stato != null && stato !== 'aperto' && stato !== 'risolto') return res.status(400).json({ error: 'Stato non valido' });
    if (testo === '') return res.status(400).json({ error: 'Testo mancante' });
    if (testo == null && stato == null && periodo == null) return res.status(400).json({ error: 'Niente da aggiornare' });
    let ok = true;
    if (testo != null) ok = await updateComplaintTesto(crmDb, id, testo);
    if (ok && stato != null) ok = await setComplaintStato(crmDb, id, stato);
    if (ok && periodo != null) ok = await setComplaintPeriodo(crmDb, id, periodo);
    if (!ok) return res.status(404).json({ error: 'Complaint non trovato' });
    res.json({ ok: true });
  });

  delRoute('/complaints/:id', deleteComplaint, 'Complaint non trovato');

  // --- Intolleranze / allergie (dato di sicurezza) ---
  router.get('/clienti/:codCli/intolleranze', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    res.json({ intolleranze: await listIntolleranze(crmDb, membri) });
  });

  router.post('/clienti/:codCli/intolleranze', async (req, res) => {
    const codCli = Number(req.params.codCli);
    const testo = (req.body && req.body.testo ? String(req.body.testo) : '').trim();
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    if (!testo) return res.status(400).json({ error: 'Testo mancante' });
    const intolleranza = await createIntolleranza(crmDb, { pmsCustomerId: codCli, autoreUserId: req.session.user.id, testo });
    res.status(201).json({ intolleranza });
  });

  delRoute('/intolleranze/:id', deleteIntolleranza, 'Intolleranza non trovata');

  // --- Profilo / Lingua preferita (1:1) ---
  router.get('/clienti/:codCli/profilo', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    res.json({ profilo: await getProfilo(crmDb, membri) });
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
    const { membri } = await getGruppo(crmDb, codCli);
    res.json({ preferenze: await listPreferenze(crmDb, membri) });
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

  delRoute('/preferenze/:id', deletePreferenza, 'Preferenza non trovata');

  // --- Nucleo di viaggio / accompagnatori ---
  router.get('/clienti/:codCli/nucleo', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    res.json({ nucleo: await listNucleo(crmDb, membri) });
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

  delRoute('/nucleo/:id', deleteMembro, 'Membro non trovato');

  return router;
}

module.exports = { createClientiRouter, calcolaStatistiche };
