const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { cercaClienti, getCliente, getSoggiorniCliente } = require('../pms/clienti');
const { getGustiFB } = require('../pms/gusti');
const { getTrattamentiSpa } = require('../pms/spa');
const { listComplaints, createComplaint, updateComplaintTesto, setComplaintPeriodo, setComplaintStato, setComplaintFollowUp, setComplaintClasse, deleteComplaint, FOLLOWUP_MAX, CATEGORIE_COMPLAINT } = require('../crm/complaint');
const { listIntolleranze, createIntolleranza, deleteIntolleranza } = require('../crm/intolleranze');
const { getProfilo, upsertLingua, upsertNotePersonali } = require('../crm/profilo');
const { sintetizzaNota } = require('../crm/arrivi-brief');
const { listPreferenze, listCondivise, createPreferenza, updatePreferenza, deletePreferenza, REPARTI, CATEGORIE, AMBITI } = require('../crm/preferenze');
const { listNucleo, createMembro, updateMembro, deleteMembro, getNucleoGroup, nucleoInizializzato, markNucleoInit, RELAZIONI } = require('../crm/nucleo');
const { getCoOccupanti, filtraCoOccupanti } = require('../pms/nucleo');
const { aggregaCumulativi } = require('../stats');
const { getAiClient } = require('../ai/client');
const { costruisciFatti, haFatti, suggerisci } = require('../ai/suggerisci');
const briefingAi = require('../ai/briefing');
const { getGruppo, mergeInto, unmerge, listMappature, separaGruppiDuplicati } = require('../crm/merge');
const { getDuplicatiCandidati, getTuttiGruppiDuplicati, getAnagreConfronto, calcolaConflitti } = require('../pms/duplicati');

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
    // Note PMS degli altri membri del nucleo (condivise, "del soggiorno").
    const altriNucleo = (await getNucleoGroup(crmDb, codCli)).filter((c) => !membri.includes(c));
    let noteNucleo = [];
    if (altriNucleo.length) {
      const anags = await Promise.all(altriNucleo.map((c) => getCliente(pmsDb, c)));
      noteNucleo = anags.filter((a) => a && a.note).map((a) => ({ codCli: a.codCli, nominativo: a.nominativo, nota: a.note }));
    }
    res.json({ anagrafica, statistiche: calcolaStatistiche(soggiorni), soggiorni, merge, noteNucleo });
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

  // Confronto anagrafiche per il merge guidato: dati a colonne, conflitti evidenziati,
  // principale suggerito (più prenotazioni). Sola lettura, non fonde nulla.
  router.get('/clienti/:codCli/confronto', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const richiesti = String(req.query.ids || '').split(',').map(intParam).filter((n) => n !== null);
    const ids = [...new Set([codCli, ...richiesti])];
    const anagrafiche = await getAnagreConfronto(pmsDb, ids);
    if (anagrafiche.length < 2) return res.status(400).json({ error: 'Servono almeno due anagrafiche da confrontare' });
    const conflitti = calcolaConflitti(anagrafiche);
    const suggerito = anagrafiche.reduce((best, a) => (a.nPrenotazioni > best.nPrenotazioni ? a : best), anagrafiche[0]).codCli;
    res.json({ anagrafiche, conflitti, suggerito });
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
  // Coda di lavoro: escono solo i gruppi su cui serve ancora una decisione.
  // Quelli già associati si gestiscono dalla scheda dell'ospite (banner "Scheda
  // fusa"); qui se ne riporta solo il conteggio, per non far sembrare che siano
  // spariti nel nulla.
  router.get('/duplicati', async (req, res) => {
    const [gruppi, mappature] = await Promise.all([
      getTuttiGruppiDuplicati(pmsDb),
      listMappature(crmDb),
    ]);
    const { daGestire, gestiti } = separaGruppiDuplicati(gruppi, mappature);
    res.json({ gruppi: daGestire, gestiti: gestiti.length });
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
    // Proposte già mostrate in questa sessione (dal client), da non riproporre.
    const b = req.body || {};
    const giaMostrate = Array.isArray(b.giaMostrate) ? b.giaMostrate.map((t) => String(t)).slice(0, 50) : [];
    const { membri } = await getGruppo(crmDb, codCli);
    // Controllo duplicati esteso al NUCLEO: i consumi F&B sono condivisi, quindi una
    // preferenza già salvata su un altro membro del nucleo non va riproposta. La lista
    // "già registrate" (preferenze/intolleranze) copre self + gruppo di fusione + nucleo.
    const nucleoIds = await getNucleoGroup(crmDb, codCli);
    const idsDedup = [...new Set([...membri, ...nucleoIds])];
    const [gusti, spa, intolleranze, preferenze, anags] = await Promise.all([
      getGustiFB(pmsDb, membri),
      getTrattamentiSpa(pmsDb, membri),
      listIntolleranze(crmDb, idsDedup),
      listPreferenze(crmDb, idsDedup),
      Promise.all(membri.map((id) => getCliente(pmsDb, id))),
    ]);
    // Note anagrafica dal PMS (Annotazioni), unite su tutti i codici del gruppo.
    const notePms = anags.filter(Boolean).map((a) => a.note).filter(Boolean).join('\n');
    const fatti = costruisciFatti({ gusti, spa, notePms, intolleranze, preferenze, giaMostrate });
    if (!haFatti(fatti)) return res.json({ suggerimenti: [], motivo: 'dati insufficienti' });
    const suggerimenti = await suggerisci(ai.client, fatti, { model: ai.model });
    // Audit minimale (Fase 3 privacy): chi ha generato suggerimenti, per chi, quanti.
    console.log(`[AI suggerimenti] cliente=${codCli} utente=${req.session.user.username} n=${suggerimenti.length}`);
    res.json({ suggerimenti });
  });

  // Guest Briefing (AI, Fase B). SOLO su richiesta operatore, mai automatico. Cerca
  // su fonti web PUBBLICHE se l'ospite è un personaggio pubblico e ne sintetizza un
  // briefing citando le fonti. NON persiste nulla. 503 se l'AI non è configurata.
  router.post('/clienti/:codCli/briefing', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const ai = getAiClient();
    if (!ai) return res.status(503).json({ error: 'AI non configurata (manca @anthropic-ai/sdk o ANTHROPIC_API_KEY)' });
    const cliente = await getCliente(pmsDb, codCli);
    if (!cliente) return res.status(404).json({ error: 'Ospite non trovato' });
    const fatti = briefingAi.costruisciFatti({
      nominativo: cliente.nominativo, citta: cliente.citta, nazione: cliente.nazione, vip: cliente.vip, note: cliente.note,
      // Solo il dominio arriva al modello: è la prova d'identità contro l'omonimia.
      email: cliente.email,
    });
    if (!briefingAi.haFatti(fatti)) return res.json(briefingAi.NIENTE());
    const out = await briefingAi.briefing(ai.client, fatti, { model: ai.modelBriefing });
    // Audit (privacy): chi ha richiesto un briefing pubblico, per chi, con quante fonti.
    console.log(`[AI briefing] cliente=${codCli} utente=${req.session.user.username} identificazione=${out.identificazione} fonti=${out.fonti.length}`);
    res.json(out);
  });

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
    const reparto = (b.reparto != null ? String(b.reparto).trim() : '');
    const categoria = (b.categoria != null ? String(b.categoria).trim() : '');
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    if (!testo) return res.status(400).json({ error: 'Testo mancante' });
    // Obbligatori sui NUOVI reclami: è la classificazione che permette di girare
    // il problema al reparto giusto. I vecchi restano senza, e va bene così.
    if (!REPARTI.includes(reparto)) return res.status(400).json({ error: 'Reparto non valido' });
    if (!CATEGORIE_COMPLAINT.includes(categoria)) return res.status(400).json({ error: 'Categoria non valida' });
    const complaint = await createComplaint(crmDb, { pmsCustomerId: codCli, autoreUserId: req.session.user.id, testo, periodo, reparto, categoria });
    res.status(201).json({ complaint });
  });

  router.patch('/complaints/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const body = req.body || {};
    const testo = body.testo != null ? String(body.testo).trim() : null;
    const stato = body.stato != null ? String(body.stato).trim() : null;
    const periodo = body.periodo != null ? String(body.periodo).trim() : null;
    const followUp = body.followUp != null ? String(body.followUp).trim() : null;
    const reparto = body.reparto != null ? String(body.reparto).trim() : null;
    const categoria = body.categoria != null ? String(body.categoria).trim() : null;
    if (stato != null && stato !== 'aperto' && stato !== 'risolto') return res.status(400).json({ error: 'Stato non valido' });
    if (testo === '') return res.status(400).json({ error: 'Testo mancante' });
    if (reparto != null && !REPARTI.includes(reparto)) return res.status(400).json({ error: 'Reparto non valido' });
    if (categoria != null && !CATEGORIE_COMPLAINT.includes(categoria)) return res.status(400).json({ error: 'Categoria non valida' });
    // Risolvere senza dire cosa è stato fatto lascia un dato inutile a chi legge
    // dopo: la regola sta qui, non solo nella maschera, così vale per ogni client.
    if (stato === 'risolto' && !followUp) return res.status(400).json({ error: 'Follow-up mancante: descrivi come è stato gestito il problema' });
    if (followUp && followUp.length > FOLLOWUP_MAX) return res.status(400).json({ error: `Follow-up troppo lungo (max ${FOLLOWUP_MAX} caratteri)` });
    if (testo == null && stato == null && periodo == null && followUp == null && reparto == null && categoria == null) return res.status(400).json({ error: 'Niente da aggiornare' });
    let ok = true;
    if (testo != null) ok = await updateComplaintTesto(crmDb, id, testo);
    // Stato e follow-up nello stesso UPDATE: si risolve e si registra come, insieme.
    if (ok && stato != null) ok = await setComplaintStato(crmDb, id, stato, stato === 'risolto' ? followUp : undefined);
    else if (ok && followUp != null) ok = await setComplaintFollowUp(crmDb, id, followUp);
    if (ok && periodo != null) ok = await setComplaintPeriodo(crmDb, id, periodo);
    if (ok && (reparto != null || categoria != null)) {
      ok = await setComplaintClasse(crmDb, id, {
        ...(reparto != null ? { reparto } : {}),
        ...(categoria != null ? { categoria } : {}),
      });
    }
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

  // Note personali (info biografiche/ruoli). mode 'append' accoda al testo esistente
  // del gruppo (usato dal "Salva nel profilo" del briefing AI, non distruttivo);
  // 'set' (default) sovrascrive col testo passato (la textarea della scheda).
  router.put('/clienti/:codCli/note-personali', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const testo = (req.body && req.body.testo != null ? String(req.body.testo) : '').trim();
    const mode = req.body && req.body.mode === 'append' ? 'append' : 'set';
    let finale = testo || null;
    if (mode === 'append' && testo) {
      const { membri } = await getGruppo(crmDb, codCli);
      const attuale = (await getProfilo(crmDb, membri) || {}).note_personali;
      finale = attuale && attuale.trim() ? `${attuale.trim()}\n\n${testo}` : testo;
    }
    const out = await upsertNotePersonali(crmDb, { pmsCustomerId: codCli, notePersonali: finale, autoreUserId: req.session.user.id });
    // `nota` è la stessa versione sintetica che finisce nelle card Arrivi/In casa:
    // la calcola il server, così chi ha appena salvato la vede comparire subito
    // nella card senza ricaricare — e senza una seconda regola di taglio nel browser.
    res.json({ notePersonali: out.notePersonali, nota: sintetizzaNota(out.notePersonali) });
  });

  // --- Preferenze (reparto + categoria + testo, liste chiuse) ---
  router.get('/clienti/:codCli/preferenze', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    const preferenze = await listPreferenze(crmDb, membri);
    // Preferenze 'nucleo' degli ALTRI membri del nucleo familiare → in sola lettura.
    const altri = (await getNucleoGroup(crmDb, codCli)).filter((c) => !membri.includes(c));
    let condivise = [];
    if (altri.length) {
      const rows = await listCondivise(crmDb, altri);
      if (rows.length) {
        const owners = [...new Set(rows.map((r) => r.pms_customer_id))];
        const anags = await Promise.all(owners.map((c) => getCliente(pmsDb, c)));
        const nome = {};
        anags.filter(Boolean).forEach((a) => { nome[a.codCli] = a.nominativo; });
        condivise = rows.map((r) => ({ ...r, proprietario: nome[r.pms_customer_id] || `#${r.pms_customer_id}` }));
      }
    }
    res.json({ preferenze, condivise });
  });

  router.post('/clienti/:codCli/preferenze', async (req, res) => {
    const codCli = Number(req.params.codCli);
    const b = req.body || {};
    const reparto = b.reparto != null ? String(b.reparto).trim() : '';
    const categoria = b.categoria != null ? String(b.categoria).trim() : '';
    const testo = b.testo != null ? String(b.testo).trim() : '';
    const ambito = b.ambito != null ? String(b.ambito).trim() : 'nucleo';
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    if (!testo) return res.status(400).json({ error: 'Testo mancante' });
    if (!REPARTI.includes(reparto)) return res.status(400).json({ error: 'Reparto non valido' });
    if (!CATEGORIE.includes(categoria)) return res.status(400).json({ error: 'Categoria non valida' });
    if (!AMBITI.includes(ambito)) return res.status(400).json({ error: 'Ambito non valido' });
    const preferenza = await createPreferenza(crmDb, { pmsCustomerId: codCli, autoreUserId: req.session.user.id, reparto, categoria, testo, ambito });
    res.status(201).json({ preferenza });
  });

  // Cambia l'ambito (o testo/reparto/categoria) di una preferenza.
  router.patch('/preferenze/:id', async (req, res) => {
    const id = intParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'ID non valido' });
    const b = req.body || {};
    const fields = {};
    if (b.ambito !== undefined) {
      const a = String(b.ambito).trim();
      if (!AMBITI.includes(a)) return res.status(400).json({ error: 'Ambito non valido' });
      fields.ambito = a;
    }
    if (b.testo !== undefined) { const t = String(b.testo).trim(); if (!t) return res.status(400).json({ error: 'Testo mancante' }); fields.testo = t; }
    if (b.reparto !== undefined) { if (!REPARTI.includes(String(b.reparto).trim())) return res.status(400).json({ error: 'Reparto non valido' }); fields.reparto = String(b.reparto).trim(); }
    if (b.categoria !== undefined) { if (!CATEGORIE.includes(String(b.categoria).trim())) return res.status(400).json({ error: 'Categoria non valida' }); fields.categoria = String(b.categoria).trim(); }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Niente da aggiornare' });
    if (!(await updatePreferenza(crmDb, id, fields))) return res.status(404).json({ error: 'Preferenza non trovata' });
    res.json({ ok: true });
  });

  delRoute('/preferenze/:id', deletePreferenza, 'Preferenza non trovata');

  // --- Nucleo di viaggio / accompagnatori ---
  // Auto-popolamento iniziale (one-shot): alla prima apertura precompila il nucleo
  // con i co-occupanti delle prenotazioni (ricorrenti, o tutti se poche; no aziende).
  async function autoPopulaNucleo(canonicalId, membri, autoreUserId) {
    if (await nucleoInizializzato(crmDb, canonicalId)) return;
    const { total, items } = await getCoOccupanti(pmsDb, membri);
    for (const o of filtraCoOccupanti(total, items)) {
      await createMembro(crmDb, { pmsCustomerId: canonicalId, autoreUserId, tipoRelazione: 'Altro', nome: o.nome, cognome: o.cognome, nota: null, pmsOccupantId: o.codCli });
    }
    await markNucleoInit(crmDb, canonicalId);
  }

  router.get('/clienti/:codCli/nucleo', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const { canonicalId, membri } = await getGruppo(crmDb, codCli);
    await autoPopulaNucleo(canonicalId, membri, req.session.user.id);
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

  // Modifica un membro del nucleo (relazione/nome/cognome/nota) — tutto editabile.
  router.patch('/nucleo/:id', async (req, res) => {
    const id = intParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'ID non valido' });
    const b = req.body || {};
    const fields = {};
    if (b.tipoRelazione !== undefined) {
      const rel = String(b.tipoRelazione).trim();
      if (!RELAZIONI.includes(rel)) return res.status(400).json({ error: 'Relazione non valida' });
      fields.tipoRelazione = rel;
    }
    if (b.nome !== undefined) fields.nome = String(b.nome).trim() || null;
    if (b.cognome !== undefined) fields.cognome = String(b.cognome).trim() || null;
    if (b.nota !== undefined) fields.nota = String(b.nota).trim() || null;
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Niente da aggiornare' });
    if (!(await updateMembro(crmDb, id, fields))) return res.status(404).json({ error: 'Membro non trovato' });
    res.json({ ok: true });
  });

  delRoute('/nucleo/:id', deleteMembro, 'Membro non trovato');

  return router;
}

module.exports = { createClientiRouter, calcolaStatistiche };
