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
const { proponiPerSoggiorno } = require('./allergie-note');

// Tolti `anniversari` e `suggerimentiAi` (12/08): valevano zero da sempre e nessuna
// schermata li mostrava. Un contatore fermo a zero, il giorno che finisce in una
// pagina, non dice "non lo sappiamo" ma "oggi non festeggia nessuno".
// L'anniversario di matrimonio richiede un dato che il PMS non ha: si rifarà quando
// ci sarà un campo da compilare, insieme alla sua pastiglia.
function briefingVuoto(nArrivi) {
  return { arrivi: nArrivi || 0, vip: 0, compleanni: 0, reclami: 0, alert: 0 };
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

// --- Quali preferenze finiscono in card ---------------------------------------
//
// La card deve rispondere a "cosa devo sapere di questa persona adesso", non
// elencare tutto: il dettaglio sta nella scheda. Quindi poche, e scelte.
//
// COSA DICONO I DATI VERI (misurati il 14/08/2026 sulle 64 preferenze scritte).
// Non esiste nessun segnale di importanza: non c'è un contatore di conferme, non
// c'è una fonte da pesare, non c'è un campo "critica". Tutte le righe hanno la
// stessa forma — "gradisce X", "predilige Y" — e 50 su 64 sono dello stesso
// reparto (F&B). Un punteggio costruito su questi dati sembrerebbe autorevole e
// sarebbe arbitrario: qui non si inventa una classifica che i dati non
// sostengono. Si sceglie invece in base a due cose che i dati dicono davvero.
//
// 1. PERSONALE PRIMA DI NUCLEO. Una preferenza personale riguarda UNA persona
//    presente, quindi dice più di una condivisa da tutti — ed è quella che fino
//    a ieri si perdeva del tutto. Porta il nome di chi la ha, come le allergie
//    (D2): "caffè decaffeinato" su una prenotazione da quattro persone, senza
//    dire per chi, non è servibile.
// 2. POI SI VARIA. 11 ospiti su 14 ne hanno più di tre, e chi ne ha otto le ha
//    quasi tutte di F&B: prendendo le prime tre si ottengono tre bevande e si
//    seppellisce l'unica riga di camera, che però va eseguita al check-in. A
//    parità, quindi, si evita di ripetere lo stesso reparto e la stessa persona
//    finché ci sono alternative.
//
// A parità di tutto, la più recente.
//
// QUANTE. Cinque, alzato da tre il 14/08/2026. Con tre, chi ha otto preferenze
// ne mostrava meno di metà; con cinque restano fuori solo le code lunghe, e la
// riga resta leggibile perché i testi sono corti (45 caratteri di media, 87 il
// più lungo, misurati sulle 64 preferenze vere).
const MAX_PREF_CARD = 5;

function scegliPreferenze(righe, nomeDi, max = MAX_PREF_CARD) {
  const cand = (righe || [])
    .map((p) => {
      const testo = String(p.testo || '').trim();
      const personale = p.ambito === 'personale';
      return {
        testo,
        reparto: p.reparto || null,
        categoria: p.categoria || null,
        ambito: personale ? 'personale' : 'nucleo',
        // Solo le personali portano il nome: una preferenza di nucleo è di
        // tutti, e attribuirla a qualcuno sarebbe un'informazione falsa.
        chi: personale ? (nomeDi ? nomeDi(p.pms_customer_id) : null) : null,
        codCli: personale ? p.pms_customer_id : null,
        quando: p.created_at || null,
      };
    })
    .filter((p) => p.testo)
    // L'ordine va deciso PRIMA di togliere i doppioni: se lo stesso testo esiste
    // sia come personale sia come nucleo, deve restare quello che dice di chi è.
    .sort((a, b) => (a.ambito === 'personale' ? 0 : 1) - (b.ambito === 'personale' ? 0 : 1)
      || String(b.quando || '').localeCompare(String(a.quando || '')));

  const viste = new Set();
  const unici = cand.filter((p) => {
    const k = p.testo.toLowerCase();
    if (viste.has(k)) return false;
    viste.add(k);
    return true;
  });

  // Scelta golosa: si prende la prima che non ripete né reparto né persona; se
  // non ce n'è, si molla il vincolo sulla persona, e infine anche sul reparto.
  // Così chi ha una sola preferenza per reparto le vede tutte, e chi ne ha otto
  // di cucina ne vede una di cucina e le altre di qualcos'altro.
  const scelte = [];
  const reparti = new Set();
  const persone = new Set();
  const preso = new Set();
  const libera = (p, i) => !preso.has(i) && p.testo;
  while (scelte.length < max) {
    let i = unici.findIndex((p, k) => libera(p, k) && !reparti.has(p.reparto) && !(p.codCli && persone.has(p.codCli)));
    if (i < 0) i = unici.findIndex((p, k) => libera(p, k) && !reparti.has(p.reparto));
    if (i < 0) i = unici.findIndex((p, k) => libera(p, k));
    if (i < 0) break;
    const p = unici[i];
    preso.add(i);
    reparti.add(p.reparto);
    if (p.codCli) persone.add(p.codCli);
    scelte.push({ testo: p.testo, reparto: p.reparto, categoria: p.categoria, ambito: p.ambito, chi: p.chi });
  }
  return { mostrate: scelte, altre: Math.max(0, unici.length - scelte.length) };
}

// Snapshot per un arrivo. ctx = { gruppi, anagra:Map, prefBy, complBy, intolBy, relBy:Map('ref|occ'→rel) }.
function costruisciSnapshot(a, ctx) {
  const ids = idsPrenotazione(a, ctx.gruppi);

  // VIP: preferisco la classificazione del referente, poi quella di un occupante.
  const vipList = ids.map((id) => ctx.anagra.get(id) && ctx.anagra.get(id).vip).filter(Boolean);
  const vipRef = ctx.anagra.get(a.codCliente) && ctx.anagra.get(a.codCliente).vip;
  const vip = vipRef || vipList.find(Boolean) || null;
  const indesiderato = vipList.some((v) => v && v.indesiderato);

  // Preferenze principali: personali E di nucleo, poche e assortite (vedi
  // scegliPreferenze). Fino al 14/08 entravano solo le 'nucleo', e la preferenza
  // scritta sulla singola persona non arrivava a chi la doveva servire.
  const { mostrate: prefTop, altre: preferenzeAltre } = scegliPreferenze(
    raccogli(ctx.prefBy, ids),
    (cod) => { const a = ctx.anagra.get(cod); return a && a.nominativo ? String(a.nominativo).trim() : null; }
  );

  // Intolleranze/allergie (sicurezza): ognuna porta il NOME di chi la ha.
  //
  // La nota di una prenotazione riguarda più persone, e chi accetta una proposta
  // sceglie con cura a chi attribuirla proprio perché mettere un'allergia sulla
  // persona sbagliata sposta l'attenzione della cucina sul commensale sbagliato.
  // Rimostrarle poi aggregate, senza nome, buttava via quel lavoro proprio dove
  // serviva: in card e sul foglio che va in cucina. (Decisione del 12/08, D2.)
  //
  // Il dedup ora è per coppia persona+testo: due occupanti celiaci sono due righe,
  // non una — perché sono due piatti da preparare.
  const intoll = [];
  const vistiInt = new Set();
  for (const i of raccogli(ctx.intolBy, ids)) {
    const testo = (i.testo || '').trim();
    if (!testo) continue;
    const di = ctx.anagra.get(i.pms_customer_id);
    const chi = (di && di.nominativo) ? String(di.nominativo).trim() : null;
    const key = `${i.pms_customer_id}|${testo.toLowerCase()}`;
    if (vistiInt.has(key)) continue;
    vistiInt.add(key);
    intoll.push({ testo, chi });
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

  // TUTTI i compleanni durante il soggiorno, in ordine di data. Ognuno porta il
  // codice cliente, perché nelle card il nome dev'essere cliccabile.
  //
  // Fino al 14/08/2026 ci si fermava al primo. Misurato sul database dell'hotel:
  // delle 1.482 prenotazioni con almeno un compleanno, 41 ne hanno più di uno e
  // una ne ha tre — coniugi che festeggiano nella stessa vacanza, gemelle nate
  // lo stesso giorno, madre e figlia entrambe il 3 luglio. Il secondo nome non
  // arrivava a nessuno, e in cucina si preparava una torta sola.
  const compleanni = [];
  for (const id of ids) {
    const an = ctx.anagra.get(id);
    if (!an) continue;
    const data = compleannoNelSoggiorno(an.dtNascita, a.dtarrivo, a.dtpartenza);
    // Stessa persona con più codici fusi: una voce sola, non una per codice.
    if (data && !compleanni.some((c) => c.nome === an.nominativo && c.data === data)) {
      compleanni.push({ codCli: id, nome: an.nominativo, data });
    }
  }
  compleanni.sort((x, y) => String(x.data).localeCompare(String(y.data)));

  // Possibili allergie: PROPOSTE, non dati. Il CRM non scrive mai da solo in un
  // dato di sicurezza. Due fonti, con due gradi di certezza diversi:
  // - le ANNOTAZIONI di anagrafica, che stanno sulla singola persona e quindi
  //   arrivano con il nome già attribuito;
  // - la NOTA della prenotazione, che riguarda la pratica: lì chi conferma
  //   sceglie anche a quale ospite attribuirla.
  // Già registrate → non si ripropongono.
  const annotazioni = ids
    .map((id) => ctx.anagra.get(id))
    .filter((an) => an && an.note)
    .map((an) => ({ codCli: an.codCli, nome: an.nominativo, testo: an.note }));
  const allergieProposte = proponiPerSoggiorno({ nota: a.note, annotazioni, giaPresenti: intoll });

  return { vip, indesiderato, preferenzeTop: prefTop, preferenzeAltre, intolleranze: intoll, reclami, relazioni, compleanni, notaPersonale, allergieProposte };
}

// Riepilogo giornata dai singoli snapshot.
function calcolaBriefing(arriviArr) {
  const b = briefingVuoto(arriviArr.length);
  for (const a of arriviArr) {
    const s = a.snapshot || {};
    if (s.vip) b.vip += 1;
    // Il contatore conta le PRENOTAZIONI con almeno un festeggiato, non le
    // persone: è una chip che filtra la lista, e deve tornare con le righe.
    if (s.compleanni && s.compleanni.length) b.compleanni += 1;
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
  scegliPreferenze,
  MAX_PREF_CARD,
};
