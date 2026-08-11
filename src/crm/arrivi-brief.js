// Dashboard Arrivi 2.0 — arricchimento CRM/PMS degli arrivi del giorno.
//
// Ogni arrivo (dati operativi PMS) viene arricchito con uno "snapshot" pensato per
// l'accoglienza: VIP, relazioni del nucleo, preferenze principali, allergie/intolleranze
// (sicurezza), reclami passati, compleanno durante il soggiorno. In cima alla pagina
// un "briefing" giornaliero riassume le priorità (arrivi, VIP, compleanni, reclami, alert).
//
// Efficienza: NON una query per card. Si raccolgono tutti i codici ospite del giorno
// (referenti + occupanti), si risolvono i gruppi di fusione in batch (getGruppiByIds),
// poi UNA query per fonte sull'unione dei membri; il raggruppamento è in memoria.
// Le funzioni pure (raccogliIds, costruisciSnapshot, calcolaBriefing, ...) sono
// esportate e testabili senza DB.

const { getGruppiByIds } = require('./merge');
const { getRelazioniByIds } = require('./nucleo');
const { getAnagraByIds, getStoricoByIds } = require('../pms/clienti');
const { listPreferenze } = require('./preferenze');
const { listComplaints } = require('./complaint');
const { listIntolleranze } = require('./intolleranze');
const { listNotePersonali } = require('./profilo');

function briefingVuoto(nArrivi) {
  // anniversari e suggerimentiAi: nessuna fonte dati affidabile per ora → 0 (TODO).
  return { arrivi: nArrivi || 0, vip: 0, compleanni: 0, reclami: 0, alert: 0, anniversari: 0, suggerimentiAi: 0 };
}

// Codici ospite di tutti gli arrivi: referente (codCliente) + occupanti (ospiti[].codCli).
function raccogliIds(arrivi) {
  const set = new Set();
  for (const a of arrivi || []) {
    if (Number.isInteger(a.codCliente)) set.add(a.codCliente);
    for (const o of a.ospiti || []) if (Number.isInteger(o.codCli)) set.add(o.codCli);
  }
  return [...set];
}

// Indicizza righe CRM (con pms_customer_id) per codice.
function indicizza(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (!m.has(r.pms_customer_id)) m.set(r.pms_customer_id, []);
    m.get(r.pms_customer_id).push(r);
  }
  return m;
}

// Tutte le righe indicizzate per un insieme di codici. Una fonte assente (mappa
// non passata) vale "nessuna riga": lo snapshot degrada, non esplode.
function raccogli(map, ids) {
  const out = [];
  if (!map) return out;
  for (const id of ids) for (const r of map.get(id) || []) out.push(r);
  return out;
}

// Data del compleanno DENTRO il soggiorno [arrivo, partenza] (ISO) o null.
// Gestisce il soggiorno che scavalca il capodanno provando ogni anno del range.
function compleannoNelSoggiorno(dtNascita, arrivo, partenza) {
  if (!dtNascita || !arrivo || !partenza) return null;
  const md = String(dtNascita).slice(5); // 'MM-DD'
  if (!/^\d{2}-\d{2}$/.test(md)) return null;
  const aY = Number(String(arrivo).slice(0, 4));
  const pY = Number(String(partenza).slice(0, 4));
  for (let y = aY; y <= pY; y++) {
    const cand = `${y}-${md}`;
    if (cand >= arrivo && cand <= partenza) return cand;
  }
  return null;
}

// Versione da card della nota personale. Non è un riassunto: è l'inizio della
// nota, tagliato dove la frase finisce. Chi scrive mette il "chi è" in apertura
// ("Direttore LUISS · Economista") e il dettaglio dopo — il dettaglio resta
// nell'anagrafica, che è l'unico posto dove la nota si legge e si modifica.
const NOTA_MAX = 90;
function sintetizzaNota(testo, max = NOTA_MAX) {
  const completo = String(testo == null ? '' : testo).trim();
  if (!completo) return null;
  // Prima riga non vuota: se la nota è su più righe, la prima è l'identikit.
  const riga = completo.split(/\r?\n/).map((r) => r.trim()).find(Boolean) || '';
  const piatta = riga.replace(/\s+/g, ' ');
  if (piatta.length <= max) {
    return { sintesi: piatta, testo: completo, troncata: piatta.length < completo.replace(/\s+/g, ' ').length };
  }
  // Taglio sulla fine di frase se cade nei limiti, altrimenti sull'ultima parola intera.
  // Il punto e virgola chiude il concetto ma da solo, in coda, sembra un errore: si toglie.
  const fineFrase = piatta.slice(0, max + 1).search(/[.;](\s|$)/);
  if (fineFrase > 20) return { sintesi: piatta.slice(0, fineFrase + 1).replace(/;$/, ''), testo: completo, troncata: true };
  // Niente puntini qui: il segno "c'è dell'altro" lo mette la card, una volta sola.
  const taglio = piatta.slice(0, max);
  const spazio = taglio.lastIndexOf(' ');
  return { sintesi: (spazio > 20 ? taglio.slice(0, spazio) : taglio).trim(), testo: completo, troncata: true };
}

// Codici del gruppo (fusione) rilevanti per la prenotazione: referente + occupanti,
// ciascuno espanso ai membri del proprio gruppo di fusione.
function idsPrenotazione(a, gruppi) {
  const base = [a.codCliente, ...(a.ospiti || []).map((o) => o.codCli)].filter((x) => Number.isInteger(x));
  const set = new Set();
  for (const id of base) for (const m of (gruppi.get(id) || [id])) set.add(m);
  return [...set];
}

// Snapshot per un arrivo. ctx = { gruppi, anagra:Map, prefBy, complBy, intolBy, relBy:Map('ref|occ'→rel) }.
function costruisciSnapshot(a, ctx) {
  const ids = idsPrenotazione(a, ctx.gruppi);

  // VIP: preferisco la classificazione del referente, poi quella di un occupante.
  const vipList = ids.map((id) => ctx.anagra.get(id) && ctx.anagra.get(id).vip).filter(Boolean);
  const vipRef = ctx.anagra.get(a.codCliente) && ctx.anagra.get(a.codCliente).vip;
  const vip = vipRef || vipList.find(Boolean) || null;
  const indesiderato = vipList.some((v) => v && v.indesiderato);

  // Preferenze principali: solo 'nucleo' (condivise), dedup per testo, max 3.
  const prefTop = [];
  const vistiPref = new Set();
  for (const p of raccogli(ctx.prefBy, ids)) {
    if (p.ambito !== 'nucleo') continue;
    const key = (p.testo || '').trim().toLowerCase();
    if (!key || vistiPref.has(key)) continue;
    vistiPref.add(key);
    prefTop.push({ reparto: p.reparto, categoria: p.categoria, testo: (p.testo || '').trim() });
    if (prefTop.length >= 3) break;
  }

  // Intolleranze/allergie (sicurezza): dedup per testo.
  const intoll = [];
  const vistiInt = new Set();
  for (const i of raccogli(ctx.intolBy, ids)) {
    const key = (i.testo || '').trim().toLowerCase();
    if (!key || vistiInt.has(key)) continue;
    vistiInt.add(key);
    intoll.push((i.testo || '').trim());
  }

  // Reclami sul gruppo. Oltre al conteggio si porta il TESTO di quelli aperti:
  // "1 reclamo aperto" non dice niente a chi deve accogliere l'ospite, "ritardo
  // nella pulizia camera" sì. Solo gli aperti: i risolti sono storia, e il loro
  // testo in card diventerebbe rumore.
  const compl = raccogli(ctx.complBy, ids);
  const aperti = compl.filter((c) => c.stato === 'aperto');
  const reclami = {
    aperti: aperti.length,
    totali: compl.length,
    // Con reparto e categoria: chi legge la card sa anche a chi gira il problema.
    // I reclami inseriti prima della classificazione hanno reparto/categoria nulli.
    apertiDettaglio: aperti
      .map((c) => ({
        testo: (c.testo == null ? '' : String(c.testo)).trim(),
        reparto: c.reparto || null,
        categoria: c.categoria || null,
      }))
      .filter((c) => c.testo),
  };

  // Relazioni degli occupanti col referente (o con un membro del suo gruppo).
  const ancore = ctx.gruppi.get(a.codCliente) || [a.codCliente];
  const relazioni = {};
  for (const o of a.ospiti || []) {
    if (!Number.isInteger(o.codCli) || o.codCli === a.codCliente) continue;
    for (const anc of ancore) {
      const rel = ctx.relBy.get(`${anc}|${o.codCli}`);
      if (rel) { relazioni[o.codCli] = rel; break; }
    }
  }

  // Nota personale del REFERENTE (e delle sue anagrafiche fuse: stessa persona).
  // Non si pescano quelle degli occupanti: la card è intestata al referente e
  // attribuirgli la nota di un altro sarebbe un'informazione sbagliata. Le loro
  // restano sulle rispettive schede, raggiungibili dal nome cliccabile.
  const rigaNota = raccogli(ctx.noteBy, ancore).find((r) => r.note_personali);
  const notaPersonale = rigaNota ? sintetizzaNota(rigaNota.note_personali) : null;

  // Compleanno durante il soggiorno (primo membro che compie gli anni). Porta
  // con sé il codice cliente: nelle card il nome dev'essere cliccabile.
  let compleanno = null;
  for (const id of ids) {
    const an = ctx.anagra.get(id);
    if (!an) continue;
    const data = compleannoNelSoggiorno(an.dtNascita, a.dtarrivo, a.dtpartenza);
    if (data) { compleanno = { codCli: id, nome: an.nominativo, data }; break; }
  }

  return { vip, indesiderato, preferenzeTop: prefTop, intolleranze: intoll, reclami, relazioni, compleanno, notaPersonale };
}

// Riepilogo giornata dai singoli snapshot.
function calcolaBriefing(arriviArr) {
  const b = briefingVuoto(arriviArr.length);
  for (const a of arriviArr) {
    const s = a.snapshot || {};
    if (s.vip) b.vip += 1;
    if (s.compleanno) b.compleanni += 1;
    if (s.reclami && s.reclami.totali > 0) b.reclami += 1;
    if ((s.intolleranze && s.intolleranze.length > 0) || s.indesiderato) b.alert += 1;
  }
  return b;
}

// Orchestratore: arricchisce la lista arrivi con snapshot + briefing giornaliero.
async function arricchisciArrivi(pmsDb, crmDb, arrivi) {
  if (!arrivi || !arrivi.length) return { briefing: briefingVuoto(0), arrivi: arrivi || [] };

  const idOspiti = raccogliIds(arrivi);
  const gruppi = await getGruppiByIds(crmDb, idOspiti);
  const allIds = [...new Set([...gruppi.values()].flat().concat(idOspiti))];

  // Le date di nascita (quindi i compleanni) arrivano solo da Anagra: il PMS è
  // l'unica fonte del dato.
  const [anagra, prefRows, complRows, intolRows, relRows, noteRows] = await Promise.all([
    getAnagraByIds(pmsDb, allIds),
    listPreferenze(crmDb, allIds),
    listComplaints(crmDb, allIds),
    listIntolleranze(crmDb, allIds),
    getRelazioniByIds(crmDb, idOspiti),
    listNotePersonali(crmDb, allIds),
  ]);

  const relBy = new Map();
  for (const r of relRows) relBy.set(`${r.pms_customer_id}|${r.pms_occupant_id}`, r.tipo_relazione);

  const ctx = {
    gruppi,
    anagra,
    prefBy: indicizza(prefRows),
    complBy: indicizza(complRows),
    intolBy: indicizza(intolRows),
    noteBy: indicizza(noteRows),
    relBy,
  };

  // Storico soggiorni del referente: serve sia a "In casa" (badge Nª volta) sia
  // all'export, che deve dire se l'ospite è di ritorno o alla prima visita.
  // Sta qui e non solo in "In casa" perché è la stessa domanda su entrambe le
  // pagine: chi ho davanti, l'ho già avuto?
  const storico = await getStoricoByIds(pmsDb, arrivi.map((a) => a.codCliente));

  const arriviArr = arrivi.map((a) => ({
    ...a,
    snapshot: costruisciSnapshot(a, ctx),
    storico: storico.get(a.codCliente) || null,
  }));
  return { briefing: calcolaBriefing(arriviArr), arrivi: arriviArr };
}

module.exports = {
  arricchisciArrivi,
  briefingVuoto,
  raccogliIds,
  costruisciSnapshot,
  calcolaBriefing,
  compleannoNelSoggiorno,
  idsPrenotazione,
  sintetizzaNota,
};
