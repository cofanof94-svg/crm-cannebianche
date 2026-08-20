const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { cercaClienti, getCliente, getSoggiorniCliente, getAnagraByIds, getNotePrenotazioni, getClientiRicercaByIds } = require('../pms/clienti');
const { proponiPerSoggiorno } = require('../crm/allergie-note');
const { registraAi } = require('../crm/registro');
const { getGustiFB } = require('../pms/gusti');
const { getTrattamentiSpa } = require('../pms/spa');
const { listComplaints, createComplaint, updateComplaintTesto, setComplaintPeriodo, setComplaintStato, setComplaintFollowUp, setComplaintClasse, deleteComplaint, FOLLOWUP_MAX, CATEGORIE_COMPLAINT } = require('../crm/complaint');
const { listIntolleranze, createIntolleranza, deleteIntolleranza } = require('../crm/intolleranze');
const { getProfilo, upsertLingua, upsertNotePersonali, cancellaLingua, cancellaNotePersonali } = require('../crm/profilo');
const { sintetizzaNota } = require('../crm/arrivi-brief');
const { listPreferenze, listCondivise, createPreferenza, updatePreferenza, deletePreferenza, REPARTI, CATEGORIE, AMBITI } = require('../crm/preferenze');
const { listNucleo, createMembro, updateMembro, deleteMembro, getNucleoGroup, scartatiDelNucleo, scartaDalNucleo, membroById, RELAZIONI } = require('../crm/nucleo');
const { getCoOccupanti, filtraCoOccupanti } = require('../pms/nucleo');
const { aggregaCumulativi } = require('../stats');
const { getAiClient, guastoAi } = require('../ai/client');
const { puo, PERMESSI } = require('../auth/permessi');
const { intParam } = require('./param');
const { appartieneA } = require('../crm/helpers');
const { costruisciFatti, haFatti, suggerisci } = require('../ai/suggerisci');
const briefingAi = require('../ai/briefing');
const { getGruppo, getCanoniciByIds, mergeInto, unmerge, listMappature, separaGruppiDuplicati } = require('../crm/merge');
const { getDuplicatiCandidati, getTuttiGruppiDuplicati, getAnagreConfronto, calcolaConflitti } = require('../pms/duplicati');

// Cosa NON è un soggiorno, ai fini delle statistiche.
//
// Eliminate e No-show restano nello storico ma non sono avvenute.
// Pianificata e Confermato sono prenotazioni che devono ancora cominciare: hanno
// importi a zero perché non c'è ancora nulla di maturato, quindi contarle gonfiava
// il numero dei soggiorni e abbassava tutte le medie. Un ospite con 10 soggiorni e
// 2 prenotazioni per l'estate prossima risultava con 12.
//
// Restano dentro "In casa" e "Partito": quel soggiorno sta avvenendo o è appena
// finito, e i soldi sono veri. Così il conto coincide con il badge "Nª volta"
// delle card, che mostra i soggiorni archiviati PIÙ quello in corso.
const STATI_NON_AVVENUTI = ['Eliminata', 'No-show', 'Pianificata', 'Confermato'];
function calcolaStatistiche(soggiorni) {
  return aggregaCumulativi(soggiorni.filter((x) => !STATI_NON_AVVENUTI.includes(x.stato)));
}

// intParam: vedi src/api/param.js. È condiviso con il router degli utenti perché
// la stessa difesa deve valere per tutte le rotte, non solo per quelle dove è nata.

// Lunghezze massime dei campi di testo, prese dalle colonne del CRM. Senza questi
// controlli il testo troppo lungo arrivava fino all'INSERT, SQL Server lo rifiutava
// e l'API rispondeva 500: un errore del server per un dato dell'utente, per giunta
// visibile solo nei log. Meglio dirlo subito e con precisione.
// Le colonne NVARCHAR(MAX) (nota personale, testo del reclamo) non hanno limite qui.
const LIMITI = {
  intolleranza: 200,   // customer_intolerances.testo
  preferenza: 400,     // customer_preferences.testo
  nomePersona: 80,     // customer_travel_party.nome / .cognome
  notaNucleo: 400,     // customer_travel_party.nota
  lingua: 40,          // customer_profile.lingua
  periodo: 60,         // customer_complaints.periodo
  // La colonna è NVARCHAR(MAX), il tetto è di buon senso: oltre, la nota non è più
  // leggibile da nessuno e pesa su ogni caricamento degli Arrivi, dove viene
  // caricata per ogni ospite del giorno. Serve soprattutto contro la crescita
  // silenziosa del "Salva nel profilo" del briefing, che accoda.
  notaPersonale: 4000,
};

// Testo di un campo: stringa ripulita, oppure un errore se sfora.
// Rifiuta anche i valori che stringa non sono: un oggetto diventava
// "[object Object]" e finiva a database così com'è.
function campoTesto(valore, { max, nome, obbligatorio = true }) {
  if (valore === undefined || valore === null) {
    return obbligatorio ? { errore: `${nome} mancante` } : { valore: '' };
  }
  if (typeof valore !== 'string' && typeof valore !== 'number') {
    return { errore: `${nome} non valido` };
  }
  const t = String(valore).trim();
  if (!t && obbligatorio) return { errore: `${nome} mancante` };
  if (t.length > max) return { errore: `${nome}: massimo ${max} caratteri (ne hai scritti ${t.length})` };
  return { valore: t };
}

// Un ospite, una riga. `canonici` mappa un codice al suo principale e dice
// quanti codici conta il gruppo; i codici che non compaiono sono anagrafiche
// a sé stanti. PURA e testabile: qui non si legge niente da nessun database.
//
// Chi è collegato non sparisce e basta: al suo posto va il PRINCIPALE. Se il
// principale non è fra i trovati — succede cercando il nome vecchio — il suo
// codice esce in `daLeggere`, e chi chiama lo legge dal gestionale. Toglierlo
// senza rimpiazzarlo farebbe sparire un ospite che esiste.
function collassaSuPrincipale(trovati, canonici) {
  const perCodice = new Map((trovati || []).map((r) => [r.codCli, r]));
  const risultati = [];
  const daLeggere = [];
  const visti = new Set();
  for (const r of trovati || []) {
    const g = canonici && canonici.get ? canonici.get(r.codCli) : null;
    const principale = g ? g.canonicalId : r.codCli;
    if (visti.has(principale)) continue; // due membri dello stesso gruppo: una riga sola
    visti.add(principale);
    const riga = perCodice.get(principale);
    const collegate = g ? Math.max(g.membri - 1, 0) : 0;
    if (riga) risultati.push({ ...riga, collegate });
    else daLeggere.push(principale);
  }
  return { risultati, daLeggere };
}

function createClientiRouter(pmsDb, crmDb) {
  const router = express.Router();
  router.use(requireAuth);

  // Factory per le rotte DELETE (tutte identiche tranne fn e messaggio).
  //
  // Il percorso porta anche il codice dell'ospite: la cancellazione avviene solo se
  // la riga appartiene al suo gruppo. Prima bastava il numero della riga, e un id
  // sbagliato — mandato per errore dall'interfaccia — cancellava il dato di un altro
  // ospite senza che nessuno se ne accorgesse. Se la riga non è sua, è un 404: dal
  // punto di vista di quella scheda, quella riga non esiste.
  const delRoute = (risorsa, fn, notFound) => router.delete(`/clienti/:codCli/${risorsa}/:id`, async (req, res) => {
    const codCli = intParam(req.params.codCli);
    const id = intParam(req.params.id);
    if (codCli === null || id === null) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    if (!(await fn(crmDb, id, membri))) return res.status(404).json({ error: notFound });
    res.json({ ok: true });
  });

  // Un ospite, un risultato. Quando due anagrafiche del gestionale sono state
  // riconosciute come la stessa persona, la ricerca ne mostra una sola: quella
  // PRINCIPALE. Cercare il nome vecchio continua a funzionare — si trova il
  // principale al suo posto, non il nulla — e le anagrafiche collegate restano
  // raggiungibili dalla sua scheda, che le elenca e le apre.
  router.get('/clienti', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ risultati: [] });
    const trovati = await cercaClienti(pmsDb, q);
    const canonici = await getCanoniciByIds(crmDb, trovati.map((r) => r.codCli));
    const { risultati, daLeggere } = collassaSuPrincipale(trovati, canonici);
    // I principali che il termine cercato non ha intercettato vanno letti a parte.
    const aggiunti = daLeggere.length ? await getClientiRicercaByIds(pmsDb, daLeggere) : [];
    for (const a of aggiunti) {
      const g = canonici.get(a.codCli);
      risultati.push({ ...a, collegate: g ? g.membri - 1 : 0 });
    }
    risultati.sort((a, b) => String(a.nominativo || '').localeCompare(String(b.nominativo || '')));
    res.json({ risultati });
  });

  router.get('/clienti/:codCli', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
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
    const altriNucleo = (await getNucleoGroup(crmDb, membri)).filter((c) => !membri.includes(c));
    let noteNucleo = [];
    if (altriNucleo.length) {
      const anags = await Promise.all(altriNucleo.map((c) => getCliente(pmsDb, c)));
      noteNucleo = anags.filter((a) => a && a.note).map((a) => ({ codCli: a.codCli, nominativo: a.nominativo, nota: a.note }));
    }
    res.json({ anagrafica, statistiche: calcolaStatistiche(soggiorni), soggiorni, merge, noteNucleo });
  });

  // Gusti F&B (Fase 3 A): endpoint separato, query più pesante → caricata a parte.
  router.get('/clienti/:codCli/gusti', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    res.json({ gusti: await getGustiFB(pmsDb, membri) });
  });

  // Trattamenti SPA (Fase 3): consumi benessere dagli extra, aggregati per nome.
  router.get('/clienti/:codCli/spa', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    res.json({ spa: await getTrattamentiSpa(pmsDb, membri) });
  });

  // --- Fusione anagrafiche duplicate (virtual merge, lato CRM) ---
  // Candidati duplicati per la scheda, esclusi i codici già nel gruppo.
  router.get('/clienti/:codCli/duplicati', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    const candidati = await getDuplicatiCandidati(pmsDb, codCli);
    res.json({ candidati: candidati.filter((c) => !membri.includes(c.codCli)) });
  });

  // Confronto anagrafiche per il merge guidato: dati a colonne, conflitti evidenziati,
  // principale suggerito (più prenotazioni). Sola lettura, non fonde nulla.
  router.get('/clienti/:codCli/confronto', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const richiesti = String(req.query.ids || '').split(',').map(intParam).filter((n) => n !== null);
    const ids = [...new Set([codCli, ...richiesti])];
    const anagrafiche = await getAnagreConfronto(pmsDb, ids);
    if (anagrafiche.length < 2) return res.status(400).json({ error: 'Servono almeno due anagrafiche da confrontare' });
    const conflitti = calcolaConflitti(anagrafiche);
    // Chi è già collegato a un altro principale NON può essere scelto come
    // principale: il server lo rifiuterebbe, perché risalendo la catena la
    // richiesta diventa "collega un codice a sé stesso". Meglio dirlo PRIMA
    // della scelta che dopo, con un errore (20/08/2026).
    const canonici = await getCanoniciByIds(crmDb, anagrafiche.map((a) => a.codCli));
    const giaCollegate = {};
    for (const a of anagrafiche) {
      const c = canonici.get(a.codCli);
      const principale = c && c.canonicalId;
      if (principale && principale !== a.codCli) giaCollegate[a.codCli] = principale;
    }
    // Il suggerito si sceglie fra quelle SELEZIONABILI: proporre un principale
    // che il server rifiuta sarebbe un invito a sbagliare.
    const eleggibili = anagrafiche.filter((a) => !giaCollegate[a.codCli]);
    const fra = eleggibili.length ? eleggibili : anagrafiche;
    const suggerito = fra.reduce((best, a) => (a.nPrenotazioni > best.nPrenotazioni ? a : best), fra[0]).codCli;
    res.json({ anagrafiche, conflitti, suggerito, giaCollegate });
  });

  // Fonde un codice (memberId) nel gruppo di un principale (canonicalId).
  router.post('/clienti/:codCli/merge', async (req, res) => {
    const b = req.body || {};
    const memberId = intParam(b.memberId);
    const canonicalId = intParam(b.canonicalId);
    if (memberId === null || canonicalId === null) return res.status(400).json({ error: 'memberId/canonicalId non validi' });
    // Che siano numeri non basta: devono essere anagrafiche che esistono davvero.
    // Un codice inventato entrava nel gruppo, sporcava tutte le query per gruppo
    // (preferenze, allergie, reclami, soggiorni) e dall'interfaccia non si toglieva,
    // perché il pulsante per scollegare c'è solo per le anagrafiche che si vedono.
    const [chiMuove, chiResta] = await Promise.all([getCliente(pmsDb, memberId), getCliente(pmsDb, canonicalId)]);
    if (!chiMuove || !chiResta) {
      return res.status(404).json({ error: `Anagrafica non trovata: ${!chiMuove ? memberId : canonicalId}` });
    }
    const r = await mergeInto(crmDb, { memberId, canonicalId, autoreUserId: req.session.user.id });
    if (!r.ok) {
      // Il messaggio dice cosa fare, non come si chiama l'errore: prima usciva
      // "Fusione non valida (auto-fusione)" anche quando la richiesta era
      // sensata — "rendi principale questo codice" — e l'operatore restava
      // fermo senza sapere qual era il passo successivo.
      const messaggio = r.motivo === 'principale-gia-collegato'
        ? `L'anagrafica ${canonicalId} è già collegata alla ${r.principale}, quindi non può essere il principale. Per renderla tale, scollegala prima dal banner "Scheda fusa" della sua scheda.`
        : 'Un\'anagrafica non si può collegare a sé stessa: scegli un principale diverso.';
      return res.status(400).json({ error: messaggio });
    }
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
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const ai = getAiClient();
    if (!ai) return res.status(503).json({ error: 'AI non configurata (manca @anthropic-ai/sdk o ANTHROPIC_API_KEY)' });
    // Proposte già mostrate in questa sessione (dal client), da non riproporre.
    const b = req.body || {};
    const giaMostrate = Array.isArray(b.giaMostrate) ? b.giaMostrate.map((t) => String(t)).slice(0, 50) : [];
    const { membri } = await getGruppo(crmDb, codCli);
    // Controllo duplicati esteso al NUCLEO: i consumi F&B sono condivisi, quindi una
    // preferenza già salvata su un altro membro del nucleo non va riproposta. La lista
    // "già registrate" (preferenze/intolleranze) copre self + gruppo di fusione + nucleo.
    const nucleoIds = await getNucleoGroup(crmDb, membri);
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
    let suggerimenti;
    try {
      suggerimenti = await suggerisci(ai.client, fatti, { model: ai.model });
    } catch (err) {
      const guasto = guastoAi(err);
      if (!guasto) throw err; // sconosciuto: meglio un 500 nei log che un messaggio inventato
      console.log(`[AI suggerimenti] cliente=${codCli} utente=${req.session.user.username} GUASTO: ${guasto}`);
      await registraAi(crmDb, {
        funzione: 'suggerimenti', azione: 'generato', codCli, utenteId: req.session.user.id, esito: 'guasto', dettaglio: guasto,
      });
      return res.status(503).json({ error: guasto });
    }
    // Audit minimale (Fase 3 privacy): chi ha generato suggerimenti, per chi, quanti.
    console.log(`[AI suggerimenti] cliente=${codCli} utente=${req.session.user.username} n=${suggerimenti.length}`);
    await registraAi(crmDb, {
      funzione: 'suggerimenti', azione: 'generato', codCli, utenteId: req.session.user.id, nProposte: suggerimenti.length,
    });
    res.json({ suggerimenti });
  });

  // Guest Briefing (AI, Fase B). SOLO su richiesta operatore, mai automatico. Cerca
  // su fonti web PUBBLICHE se l'ospite è un personaggio pubblico e ne sintetizza un
  // briefing citando le fonti. NON persiste nulla. 503 se l'AI non è configurata.
  router.post('/clienti/:codCli/briefing', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
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
    let out;
    try {
      out = await briefingAi.briefing(ai.client, fatti, { model: ai.modelBriefing });
    } catch (err) {
      const guasto = guastoAi(err);
      if (!guasto) throw err; // sconosciuto: meglio un 500 nei log che un messaggio inventato
      console.log(`[AI briefing] cliente=${codCli} utente=${req.session.user.username} GUASTO: ${guasto}`);
      await registraAi(crmDb, {
        funzione: 'briefing', azione: 'generato', codCli, utenteId: req.session.user.id, esito: 'guasto', dettaglio: guasto,
      });
      return res.status(503).json({ error: guasto });
    }
    // Audit (privacy): chi ha richiesto un briefing pubblico, per chi, con quante fonti.
    console.log(`[AI briefing] cliente=${codCli} utente=${req.session.user.username} identificazione=${out.identificazione} fonti=${out.fonti.length}`);
    // Un briefing che non trova nulla è un esito, non un guasto: distinguerli
    // serve a sapere se l'AI non funziona o se semplicemente l'ospite non è
    // una persona di cui il web parli.
    await registraAi(crmDb, {
      funzione: 'briefing',
      azione: 'generato',
      codCli,
      utenteId: req.session.user.id,
      nProposte: out.fonti.length,
      esito: out.testo ? 'ok' : 'vuoto',
      dettaglio: `identificazione=${out.identificazione}`,
    });
    res.json(out);
  });

  // --- Complaints (reclami) ---
  router.get('/clienti/:codCli/complaints', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    res.json({ complaints: await listComplaints(crmDb, membri) });
  });

  router.post('/clienti/:codCli/complaints', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    const b = req.body || {};
    const reparto = (b.reparto != null ? String(b.reparto).trim() : '');
    const categoria = (b.categoria != null ? String(b.categoria).trim() : '');
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    // Il testo del reclamo sta in NVARCHAR(MAX): nessun tetto, ma deve essere testo.
    const t = campoTesto(b.testo, { max: Number.MAX_SAFE_INTEGER, nome: 'Testo' });
    if (t.errore) return res.status(400).json({ error: t.errore });
    const testo = t.valore;
    const p = campoTesto(b.periodo, { max: LIMITI.periodo, nome: 'Periodo', obbligatorio: false });
    if (p.errore) return res.status(400).json({ error: p.errore });
    const periodo = p.valore || null;
    // Obbligatori sui NUOVI reclami: è la classificazione che permette di girare
    // il problema al reparto giusto. I vecchi restano senza, e va bene così.
    if (!REPARTI.includes(reparto)) return res.status(400).json({ error: 'Reparto non valido' });
    if (!CATEGORIE_COMPLAINT.includes(categoria)) return res.status(400).json({ error: 'Categoria non valida' });
    // Si scrive sul PRINCIPALE del gruppo di fusione, non sul codice che si sta
    // guardando. Le letture prendono già tutto il gruppo, quindi finché i codici
    // restano uniti non cambia nulla; cambia dopo uno "Scollega", che altrimenti
    // porterebbe via il dato lasciando l'ospite con due schede a metà.
    const { canonicalId } = await getGruppo(crmDb, codCli);
    const complaint = await createComplaint(crmDb, { pmsCustomerId: canonicalId, autoreUserId: req.session.user.id, testo, periodo, reparto, categoria });
    res.status(201).json({ complaint });
  });

  router.patch('/clienti/:codCli/complaints/:id', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    const id = intParam(req.params.id);
    if (codCli === null || id === null) return res.status(400).json({ error: 'ID non valido' });
    // Si corregge solo ciò che è dell'ospite che si sta guardando (vedi delRoute).
    const { membri } = await getGruppo(crmDb, codCli);
    if (!(await appartieneA(crmDb, 'customer_complaints', id, membri))) return res.status(404).json({ error: 'Complaint non trovato' });
    const body = req.body || {};
    // Stessi controlli dell'inserimento anche qui. Il follow-up aveva già il suo
    // tetto (FOLLOWUP_MAX, più sotto): resta quello, per non spostare un limite
    // che è già in uso.
    for (const [campo, max, etichetta] of [['testo', Number.MAX_SAFE_INTEGER, 'Testo'], ['periodo', LIMITI.periodo, 'Periodo']]) {
      if (body[campo] == null) continue;
      const c = campoTesto(body[campo], { max, nome: etichetta, obbligatorio: false });
      if (c.errore) return res.status(400).json({ error: c.errore });
    }
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

  delRoute('complaints', deleteComplaint, 'Complaint non trovato');

  // --- Intolleranze / allergie (dato di sicurezza) ---
  // Insieme alle allergie registrate viaggiano le PROPOSTE lette nei testi del
  // gestionale: informazioni che l'hotel ha già scritto e che restano invisibili
  // durante il servizio finché qualcuno non le registra qui.
  //
  // Due fonti, come nelle card, e per la stessa ragione — ma qui la persona è
  // una sola. Le annotazioni di anagrafica sono già sue per costruzione. Le note
  // di prenotazione invece riguardano la pratica, che può avere più occupanti:
  // all'inizio le avevo escluse da questa pagina proprio per non attribuirgliele
  // in silenzio. Alla prova coi dati veri la scelta non regge (Mik, 13/08/2026):
  // chi apre la scheda ha davanti la frase, il numero di pratica e le date, e
  // giudica meglio di qualunque regola. Quindi entrano, ma dichiarate: la
  // proposta porta con sé da quale prenotazione arriva.
  router.get('/clienti/:codCli/intolleranze', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const { canonicalId, membri } = await getGruppo(crmDb, codCli);
    const intolleranze = await listIntolleranze(crmDb, membri);
    const [anagra, note] = await Promise.all([
      getAnagraByIds(pmsDb, membri),
      getNotePrenotazioni(pmsDb, membri),
    ]);
    const annotazioni = membri
      .map((id) => anagra.get(id))
      .filter((an) => an && an.note)
      .map((an) => ({ codCli: an.codCli, nome: an.nominativo, testo: an.note }));
    // Su questa pagina la persona è quella della scheda: le proposte lette nelle
    // note della prenotazione vanno su di lei, ed è per questo che la card
    // mostra la frase da cui nascono.
    const proposte = proponiPerSoggiorno({ note, annotazioni, giaPresenti: intolleranze.map((i) => i.testo) })
      .map((p) => (p.codCli == null ? { ...p, codCli: canonicalId } : p));
    res.json({ intolleranze, proposte });
  });

  router.post('/clienti/:codCli/intolleranze', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const t = campoTesto(req.body && req.body.testo, { max: LIMITI.intolleranza, nome: 'Testo' });
    if (t.errore) return res.status(400).json({ error: t.errore });
    const testo = t.valore;
    const { canonicalId } = await getGruppo(crmDb, codCli); // scrittura sul principale, vedi complaints
    const intolleranza = await createIntolleranza(crmDb, { pmsCustomerId: canonicalId, autoreUserId: req.session.user.id, testo });
    res.status(201).json({ intolleranza });
  });

  delRoute('intolleranze', deleteIntolleranza, 'Intolleranza non trovata');

  // --- Profilo / Lingua preferita (1:1) ---
  router.get('/clienti/:codCli/profilo', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    res.json({ profilo: await getProfilo(crmDb, membri) });
  });

  router.put('/clienti/:codCli/profilo', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const l = campoTesto(req.body && req.body.lingua, { max: LIMITI.lingua, nome: 'Lingua', obbligatorio: false });
    if (l.errore) return res.status(400).json({ error: l.errore });
    const lingua = l.valore || null;
    // Svuotare = cancellare per tutta la persona, non solo per il codice aperto:
    // su una scheda fusa la lingua di un'altra anagrafica del gruppo riaffiorerebbe
    // subito e il campo sembrerebbe non cancellabile.
    const { canonicalId, membri } = await getGruppo(crmDb, codCli);
    if (lingua === null) {
      await cancellaLingua(crmDb, membri);
      return res.json({ profilo: { pmsCustomerId: canonicalId, lingua: null } });
    }
    const profilo = await upsertLingua(crmDb, { pmsCustomerId: canonicalId, lingua, autoreUserId: req.session.user.id });
    res.json({ profilo });
  });

  // Note personali (info biografiche/ruoli). mode 'append' accoda al testo esistente
  // del gruppo (usato dal "Salva nel profilo" del briefing AI, non distruttivo);
  // 'set' (default) sovrascrive col testo passato (la textarea della scheda).
  router.put('/clienti/:codCli/note-personali', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const testo = (req.body && req.body.testo != null ? String(req.body.testo) : '').trim();
    const mode = req.body && req.body.mode === 'append' ? 'append' : 'set';
    // Testo vuoto = cancellazione, e vale per tutta la persona: vedi
    // cancellaNotePersonali in src/crm/profilo.js.
    if (!testo) {
      const { membri } = await getGruppo(crmDb, codCli);
      await cancellaNotePersonali(crmDb, membri);
      return res.json({ notePersonali: null, nota: null });
    }
    const { canonicalId, membri } = await getGruppo(crmDb, codCli);
    let finale = testo;
    if (mode === 'append') {
      const attuale = (await getProfilo(crmDb, membri) || {}).note_personali;
      finale = attuale && attuale.trim() ? `${attuale.trim()}\n\n${testo}` : testo;
    }
    // Il tetto si controlla sul risultato, non su quello che arriva: è l'accodamento
    // del briefing AI a far crescere la nota, non una singola scrittura.
    if (finale.length > LIMITI.notaPersonale) {
      return res.status(400).json({
        error: `Nota personale: massimo ${LIMITI.notaPersonale} caratteri (ne risulterebbero ${finale.length}). Accorcia il testo esistente prima di aggiungerne altro.`,
      });
    }
    const out = await upsertNotePersonali(crmDb, { pmsCustomerId: canonicalId, notePersonali: finale, autoreUserId: req.session.user.id });
    // `nota` è la stessa versione sintetica che finisce nelle card Arrivi/In casa:
    // la calcola il server, così chi ha appena salvato la vede comparire subito
    // nella card senza ricaricare — e senza una seconda regola di taglio nel browser.
    res.json({ notePersonali: out.notePersonali, nota: sintetizzaNota(out.notePersonali) });
  });

  // --- Preferenze (reparto + categoria + testo, liste chiuse) ---
  router.get('/clienti/:codCli/preferenze', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    const preferenze = await listPreferenze(crmDb, membri);
    // Preferenze 'nucleo' degli ALTRI membri del nucleo familiare → in sola lettura.
    const altri = (await getNucleoGroup(crmDb, membri)).filter((c) => !membri.includes(c));
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
    const codCli = intParam(req.params.codCli);
    const b = req.body || {};
    const reparto = b.reparto != null ? String(b.reparto).trim() : '';
    const categoria = b.categoria != null ? String(b.categoria).trim() : '';
    const ambito = b.ambito != null ? String(b.ambito).trim() : 'nucleo';
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const t = campoTesto(b.testo, { max: LIMITI.preferenza, nome: 'Testo' });
    if (t.errore) return res.status(400).json({ error: t.errore });
    const testo = t.valore;
    if (!REPARTI.includes(reparto)) return res.status(400).json({ error: 'Reparto non valido' });
    if (!CATEGORIE.includes(categoria)) return res.status(400).json({ error: 'Categoria non valida' });
    if (!AMBITI.includes(ambito)) return res.status(400).json({ error: 'Ambito non valido' });
    // `origine` la dichiara il frontend: è l'unico che sa da quale pulsante si è
    // passati, perché la preferenza scritta a mano e quella confermata da un
    // suggerimento arrivano qui identiche. Un valore non previsto vale 'manuale'
    // — meglio sottostimare l'AI che gonfiarla.
    const origine = b.origine === 'ai' ? 'ai' : 'manuale';
    const { canonicalId } = await getGruppo(crmDb, codCli); // scrittura sul principale, vedi complaints
    const preferenza = await createPreferenza(crmDb, { pmsCustomerId: canonicalId, autoreUserId: req.session.user.id, reparto, categoria, testo, ambito, origine });
    if (origine === 'ai') {
      await registraAi(crmDb, {
        funzione: 'suggerimenti', azione: 'accettato', codCli, utenteId: req.session.user.id, dettaglio: testo,
      });
    }
    res.status(201).json({ preferenza });
  });

  // Cambia l'ambito (o testo/reparto/categoria) di una preferenza.
  router.patch('/clienti/:codCli/preferenze/:id', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    const id = intParam(req.params.id);
    if (codCli === null || id === null) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    if (!(await appartieneA(crmDb, 'customer_preferences', id, membri))) return res.status(404).json({ error: 'Preferenza non trovata' });
    const b = req.body || {};
    const fields = {};
    if (b.ambito !== undefined) {
      const a = String(b.ambito).trim();
      if (!AMBITI.includes(a)) return res.status(400).json({ error: 'Ambito non valido' });
      fields.ambito = a;
    }
    // Stessi controlli dell'inserimento: correggere una riga non è meno rischioso
    // che crearla, e un testo troppo lungo sarebbe rifiutato dal database uguale.
    if (b.testo !== undefined) {
      const t = campoTesto(b.testo, { max: LIMITI.preferenza, nome: 'Testo' });
      if (t.errore) return res.status(400).json({ error: t.errore });
      fields.testo = t.valore;
    }
    if (b.reparto !== undefined) { if (!REPARTI.includes(String(b.reparto).trim())) return res.status(400).json({ error: 'Reparto non valido' }); fields.reparto = String(b.reparto).trim(); }
    if (b.categoria !== undefined) { if (!CATEGORIE.includes(String(b.categoria).trim())) return res.status(400).json({ error: 'Categoria non valida' }); fields.categoria = String(b.categoria).trim(); }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Niente da aggiornare' });
    if (!(await updatePreferenza(crmDb, id, fields))) return res.status(404).json({ error: 'Preferenza non trovata' });
    res.json({ ok: true });
  });

  delRoute('preferenze', deletePreferenza, 'Preferenza non trovata');

  // --- Nucleo di viaggio / accompagnatori ---
  // Auto-popolamento iniziale (one-shot): alla prima apertura precompila il nucleo
  // con i co-occupanti delle prenotazioni (ricorrenti, o tutti se poche; no aziende).
  // Il controllo si rifà a OGNI apertura e aggiunge solo chi non c'è ancora.
  //
  // Prima girava una volta sola, alla primissima apertura, e questo fotografava
  // il nucleo troppo presto: la scheda si apre preparando l'arrivo, gli
  // occupanti entrano nel gestionale al check-in. Sui dati veri del 14/08 la
  // scheda 81866 era stata aperta il 07/08 e i tre accompagnatori registrati
  // poche ore dopo non vi erano mai entrati.
  //
  // Chi è già in elenco non si tocca (nome, relazione e nota corretti a mano
  // restano), e chi è stato tolto non torna.
  async function aggiornaNucleo(canonicalId, membri, autoreUserId, coOcc) {
    const presenti = new Set((await listNucleo(crmDb, membri)).map((m) => m.pms_occupant_id).filter((x) => x != null));
    const scartati = await scartatiDelNucleo(crmDb, membri);
    for (const o of filtraCoOccupanti(coOcc.total, coOcc.items)) {
      if (presenti.has(o.codCli) || scartati.has(o.codCli)) continue;
      await createMembro(crmDb, { pmsCustomerId: canonicalId, autoreUserId, tipoRelazione: 'Altro', nome: o.nome, cognome: o.cognome, nota: null, pmsOccupantId: o.codCli });
    }
  }

  // Da quante volte e da quanto tempo si conoscono: la riga del nucleo dice solo
  // un nome e una relazione, e quasi sempre la relazione è quella predefinita.
  // Senza questa lettura, sulla scheda un accompagnatore di ieri e uno del 2016
  // sono identici, e chi accoglie non ha modo di accorgersi che quel legame è
  // vecchio. Se il gestionale non risponde si mostrano le righe senza date:
  // meglio il nucleo senza il contorno che nessun nucleo.
  const frequentazione = async (membri) => {
    try {
      return await getCoOccupanti(pmsDb, membri);
    } catch (err) {
      console.warn(`[nucleo] co-occupanti non leggibili: ${err.message}`);
      return null;
    }
  };

  router.get('/clienti/:codCli/nucleo', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    const { canonicalId, membri } = await getGruppo(crmDb, codCli);
    const coOcc = await frequentazione(membri);
    // Questa GET, la prima volta, SCRIVE: precompila il nucleo con i co-occupanti.
    // Chi ha solo il permesso di consultare non deve lasciare righe a suo nome
    // aprendo una scheda. La guardia dei permessi qui non basta, perché ragiona sul
    // metodo HTTP e una GET la considera — giustamente — una lettura: è questa rotta
    // a comportarsi in modo diverso da come si presenta.
    // Il nucleo resta vuoto finché non lo apre qualcuno che può scrivere.
    if (coOcc && puo(req.session.user, PERMESSI.SCRIVI)) {
      await aggiornaNucleo(canonicalId, membri, req.session.user.id, coOcc);
    }
    const insieme = new Map((coOcc ? coOcc.items : []).map((o) => [o.codCli, o]));
    const nucleo = (await listNucleo(crmDb, membri)).map((m) => {
      const o = m.pms_occupant_id != null ? insieme.get(m.pms_occupant_id) : null;
      // Un accompagnatore scritto a mano non è agganciato a nessun codice del
      // gestionale: di lui non si sa quando abbia soggiornato, e non si inventa.
      return { ...m, insieme: o ? o.nShared : null, ultimaInsieme: o ? o.ultima : null };
    });
    res.json({ nucleo });
  });

  router.post('/clienti/:codCli/nucleo', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    const b = req.body || {};
    const tipoRelazione = b.tipoRelazione != null ? String(b.tipoRelazione).trim() : '';
    if (codCli === null) return res.status(400).json({ error: 'ID non valido' });
    if (!RELAZIONI.includes(tipoRelazione)) return res.status(400).json({ error: 'Relazione non valida' });
    const campi = {
      nome: campoTesto(b.nome, { max: LIMITI.nomePersona, nome: 'Nome', obbligatorio: false }),
      cognome: campoTesto(b.cognome, { max: LIMITI.nomePersona, nome: 'Cognome', obbligatorio: false }),
      nota: campoTesto(b.nota, { max: LIMITI.notaNucleo, nome: 'Nota', obbligatorio: false }),
    };
    const guasto = Object.values(campi).find((c) => c.errore);
    if (guasto) return res.status(400).json({ error: guasto.errore });
    const { nome, cognome, nota } = { nome: campi.nome.valore, cognome: campi.cognome.valore, nota: campi.nota.valore };
    if (!nome && !cognome) return res.status(400).json({ error: 'Nome o cognome richiesto' });
    const { canonicalId } = await getGruppo(crmDb, codCli); // scrittura sul principale, vedi complaints
    const membro = await createMembro(crmDb, { pmsCustomerId: canonicalId, autoreUserId: req.session.user.id, tipoRelazione, nome: nome || null, cognome: cognome || null, nota: nota || null });
    res.status(201).json({ membro });
  });

  // Modifica un membro del nucleo (relazione/nome/cognome/nota) — tutto editabile.
  router.patch('/clienti/:codCli/nucleo/:id', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    const id = intParam(req.params.id);
    if (codCli === null || id === null) return res.status(400).json({ error: 'ID non valido' });
    const { membri } = await getGruppo(crmDb, codCli);
    if (!(await appartieneA(crmDb, 'customer_travel_party', id, membri))) return res.status(404).json({ error: 'Membro non trovato' });
    const b = req.body || {};
    const fields = {};
    if (b.tipoRelazione !== undefined) {
      const rel = String(b.tipoRelazione).trim();
      if (!RELAZIONI.includes(rel)) return res.status(400).json({ error: 'Relazione non valida' });
      fields.tipoRelazione = rel;
    }
    // Come per l'inserimento: stessi tetti, stesso rifiuto dei valori non testuali.
    const daControllare = [
      ['nome', LIMITI.nomePersona, 'Nome'],
      ['cognome', LIMITI.nomePersona, 'Cognome'],
      ['nota', LIMITI.notaNucleo, 'Nota'],
    ];
    for (const [campo, max, etichetta] of daControllare) {
      if (b[campo] === undefined) continue;
      const c = campoTesto(b[campo], { max, nome: etichetta, obbligatorio: false });
      if (c.errore) return res.status(400).json({ error: c.errore });
      fields[campo] = c.valore || null;
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Niente da aggiornare' });
    if (!(await updateMembro(crmDb, id, fields))) return res.status(404).json({ error: 'Membro non trovato' });
    res.json({ ok: true });
  });

  // Togliere un componente dal nucleo non è come cancellare una preferenza: se
  // quella persona ha davvero soggiornato con l'ospite, il controllo automatico
  // la rimetterebbe alla prossima apertura. Si annota l'esclusione, così la
  // correzione fatta a mano resta fatta.
  router.delete('/clienti/:codCli/nucleo/:id', async (req, res) => {
    const codCli = intParam(req.params.codCli);
    const id = intParam(req.params.id);
    if (codCli === null || id === null) return res.status(400).json({ error: 'ID non valido' });
    const { canonicalId, membri } = await getGruppo(crmDb, codCli);
    const membro = await membroById(crmDb, id, membri);
    if (!membro) return res.status(404).json({ error: 'Membro non trovato' });
    if (!(await deleteMembro(crmDb, id, membri))) return res.status(404).json({ error: 'Membro non trovato' });
    // Solo chi è agganciato a un'anagrafica del gestionale può tornare da solo:
    // un accompagnatore scritto a mano, una volta tolto, non lo riporta nessuno.
    if (membro.pms_occupant_id != null) {
      await scartaDalNucleo(crmDb, {
        pmsCustomerId: canonicalId, pmsOccupantId: membro.pms_occupant_id, autoreUserId: req.session.user.id,
      });
    }
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createClientiRouter, calcolaStatistiche, collassaSuPrincipale };
