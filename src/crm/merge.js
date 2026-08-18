// Fusione anagrafiche duplicate (virtual merge) — data-access CRM.
//
// customer_merge mappa un codice DUPLICATO (pms_customer_id) al PRINCIPALE
// (canonical_id). Un "gruppo" = il principale + tutti i codici che vi puntano.
// Nessuna catena: un principale non è mai a sua volta un membro (garantito qui).
// Il PMS resta intatto: questa è solo una vista logica lato CRM.

const { inClause } = require('../db/query');

// Ritorna il gruppo di un codice: { canonicalId, membri:[...] }.
// - se codCli è un membro → canonical = suo canonical_id;
// - se codCli è un principale (qualcuno vi punta) → canonical = codCli;
// - altrimenti standalone → { codCli, [codCli] }.
// membri include SEMPRE codCli e il principale, senza duplicati.
async function getGruppo(crmDb, codCli) {
  const asMember = await crmDb.query(
    'SELECT canonical_id FROM customer_merge WHERE pms_customer_id = @codCli',
    { codCli }
  );
  const canonicalId = asMember.length ? asMember[0].canonical_id : codCli;
  const rows = await crmDb.query(
    'SELECT pms_customer_id FROM customer_merge WHERE canonical_id = @canonicalId',
    { canonicalId }
  );
  const set = new Set([canonicalId, codCli, ...rows.map((r) => r.pms_customer_id)]);
  return { canonicalId, membri: [...set] };
}

// Versione batch di getGruppo per una lista di codici (dashboard arrivi): risolve i
// gruppi di fusione con 2 sole query set-based invece di N. Ritorna una Map
// codice → membri[] (ogni codice mappa a tutti i codici del suo gruppo, sé incluso).
async function getGruppiByIds(crmDb, ids) {
  const uniq = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isInteger))];
  const map = new Map();
  if (!uniq.length) return map;
  // 1) codice → canonical (per i codici che sono membri di un gruppo)
  const asMember = await crmDb.query(
    `SELECT pms_customer_id, canonical_id FROM customer_merge WHERE pms_customer_id IN ${inClause(uniq)}`
  );
  const canonById = new Map(asMember.map((r) => [r.pms_customer_id, r.canonical_id]));
  // canonical di ciascun codice: se membro → il suo canonical, altrimenti sé stesso
  const canonicals = [...new Set(uniq.map((id) => canonById.get(id) || id))];
  // 2) canonical → tutti i membri del gruppo
  const rows = await crmDb.query(
    `SELECT pms_customer_id, canonical_id FROM customer_merge WHERE canonical_id IN ${inClause(canonicals)}`
  );
  const membriByCanon = new Map(canonicals.map((c) => [c, new Set([c])]));
  for (const r of rows) {
    if (!membriByCanon.has(r.canonical_id)) membriByCanon.set(r.canonical_id, new Set([r.canonical_id]));
    membriByCanon.get(r.canonical_id).add(r.pms_customer_id);
  }
  for (const id of uniq) {
    const canon = canonById.get(id) || id;
    map.set(id, [...(membriByCanon.get(canon) || new Set([id]))]);
  }
  return map;
}

// Per una lista di codici: chi ha un PRINCIPALE diverso da sé, e quanti codici
// conta il suo gruppo. Serve alla ricerca, che deve mostrare un ospite una volta
// sola anche quando nel gestionale ha più anagrafiche.
//
// Due interrogazioni sole, non una per risultato: la ricerca ne restituisce
// fino a venti e una query per riga si sentirebbe.
async function getCanoniciByIds(crmDb, ids) {
  const uniq = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isInteger))];
  const out = new Map();
  if (!uniq.length) return out;
  const righe = await crmDb.query(
    `SELECT pms_customer_id, canonical_id FROM customer_merge WHERE pms_customer_id IN ${inClause(uniq)}`
  );
  if (!righe.length) return out;
  const canonici = [...new Set(righe.map((r) => r.canonical_id))];
  // Quanti codici pendono da ciascun principale: il gruppo è il principale più
  // i suoi membri, quindi la dimensione è il conteggio + 1.
  const conteggi = await crmDb.query(
    `SELECT canonical_id, COUNT(*) AS n FROM customer_merge WHERE canonical_id IN ${inClause(canonici)} GROUP BY canonical_id`
  );
  const quanti = new Map(conteggi.map((r) => [r.canonical_id, Number(r.n) || 0]));
  for (const r of righe) {
    out.set(r.pms_customer_id, { canonicalId: r.canonical_id, membri: (quanti.get(r.canonical_id) || 0) + 1 });
  }
  // Anche i principali entrano nella mappa: così chi la interroga non deve
  // sapere in anticipo se un codice è un membro o un capofila.
  for (const c of canonici) out.set(c, { canonicalId: c, membri: (quanti.get(c) || 0) + 1 });
  return out;
}

// Membri (esclusi/inclusi il principale) di un gruppo dato il principale.
async function listMembri(crmDb, canonicalId) {
  const rows = await crmDb.query(
    'SELECT pms_customer_id FROM customer_merge WHERE canonical_id = @canonicalId ORDER BY pms_customer_id',
    { canonicalId }
  );
  return rows.map((r) => r.pms_customer_id);
}

// Fonde memberId nel gruppo di canonicalId. Se canonicalId è già un membro di un
// altro gruppo, risolve al suo principale (niente catene). Rifiuta l'auto-fusione.
// Idempotente: se memberId è già mappato, aggiorna il principale.
async function mergeInto(crmDb, { memberId, canonicalId, autoreUserId = null }) {
  // risolvi il principale effettivo (no catene)
  const targetRow = await crmDb.query(
    'SELECT canonical_id FROM customer_merge WHERE pms_customer_id = @canonicalId',
    { canonicalId }
  );
  const principale = targetRow.length ? targetRow[0].canonical_id : canonicalId;
  if (memberId === principale) return { ok: false, motivo: 'auto-fusione' };

  await crmDb.query(
    `MERGE customer_merge AS t
     USING (SELECT @memberId AS pms_customer_id) AS s ON t.pms_customer_id = s.pms_customer_id
     WHEN MATCHED THEN UPDATE SET canonical_id = @principale, autore_user_id = @autoreUserId, created_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (pms_customer_id, canonical_id, autore_user_id)
       VALUES (@memberId, @principale, @autoreUserId);`,
    { memberId, principale, autoreUserId }
  );
  // se memberId era a sua volta un principale, ri-aggancia i suoi ex-membri al nuovo principale
  await crmDb.query(
    'UPDATE customer_merge SET canonical_id = @principale WHERE canonical_id = @memberId',
    { memberId, principale }
  );
  return { ok: true, canonicalId: principale };
}

// Annulla la fusione di un singolo codice (torna standalone). true se toccato.
async function unmerge(crmDb, memberId) {
  const rows = await crmDb.query(
    'DELETE FROM customer_merge OUTPUT DELETED.pms_customer_id WHERE pms_customer_id = @memberId',
    { memberId }
  );
  return rows.length > 0;
}

// Tutte le mappature (per la pagina di gestione): principale → membri.
async function listMappature(crmDb) {
  return crmDb.query(
    'SELECT pms_customer_id, canonical_id FROM customer_merge ORDER BY canonical_id, pms_customer_id'
  );
}

// Divide i gruppi di possibili duplicati (rilevati sul PMS) in "da gestire" e
// "già gestiti", per far funzionare la pagina Duplicati come una coda di lavoro.
//
// Un gruppo è GESTITO quando tutti i suoi codici convergono sullo stesso
// principale: è il segno che l'operatore li ha riconosciuti come la stessa
// persona. Se solo alcuni sono stati fusi, il gruppo resta da lavorare.
// Il principale può stare anche fuori dal gruppo (A e B entrambi fusi in X):
// conta che il punto d'arrivo sia lo stesso.
//
// Puro e derivato: nessuno stato "gestito" viene salvato. Se un'associazione
// viene sciolta (unmerge), la riga sparisce da customer_merge e il gruppo
// ricompare da solo fra quelli da gestire al caricamento successivo.
function separaGruppiDuplicati(gruppi, mappature) {
  const canonById = new Map((mappature || []).map((m) => [m.pms_customer_id, m.canonical_id]));
  const daGestire = [];
  const gestiti = [];
  for (const g of gruppi || []) {
    const membri = g.membri || [];
    const canonici = new Set(membri.map((id) => (canonById.has(id) ? canonById.get(id) : id)));
    const voce = { ...g, fusiCount: membri.filter((id) => canonById.has(id)).length };
    (membri.length > 1 && canonici.size === 1 ? gestiti : daGestire).push(voce);
  }
  return { daGestire, gestiti };
}

module.exports = { getGruppo, getGruppiByIds, getCanoniciByIds, listMembri, mergeInto, unmerge, listMappature, separaGruppiDuplicati };
