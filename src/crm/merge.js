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

module.exports = { getGruppo, getGruppiByIds, listMembri, mergeInto, unmerge, listMappature };
