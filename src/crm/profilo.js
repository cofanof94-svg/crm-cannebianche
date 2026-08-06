// Profilo CRM del cliente (1:1). Campi manuali che il PMS non memorizza:
// - lingua preferita
// - note_personali: info biografiche/ruoli (es. "Direttore LUISS", cariche), distinte
//   dalle preferenze; compilabili dalla reception e popolabili dal Guest Briefing AI.
// upsert su UNIQUE pms_customer_id.

const { inClause } = require('../db/query');

// ids: codice singolo o array (gruppo). Per ogni campo si prende il primo valore
// non nullo del gruppo (più recente). La scrittura resta sul codice visualizzato.
async function getProfilo(db, ids) {
  const rows = await db.query(
    `SELECT pms_customer_id, lingua, note_personali, updated_at FROM customer_profile
     WHERE pms_customer_id IN ${inClause(ids)}
     ORDER BY updated_at DESC`
  );
  if (!rows.length) return null;
  const primo = (campo) => { const r = rows.find((x) => x[campo] != null); return r ? r[campo] : null; };
  return {
    pms_customer_id: rows[0].pms_customer_id,
    lingua: primo('lingua'),
    note_personali: primo('note_personali'),
    updated_at: rows[0].updated_at,
  };
}

async function upsertLingua(db, { pmsCustomerId, lingua, autoreUserId }) {
  await db.query(
    `MERGE customer_profile AS t
     USING (SELECT @pmsCustomerId AS pms_customer_id) AS s ON t.pms_customer_id = s.pms_customer_id
     WHEN MATCHED THEN UPDATE SET lingua = @lingua, autore_user_id = @autoreUserId, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (pms_customer_id, lingua, autore_user_id, updated_at)
       VALUES (@pmsCustomerId, @lingua, @autoreUserId, SYSUTCDATETIME());`,
    { pmsCustomerId, lingua, autoreUserId }
  );
  return { pmsCustomerId, lingua };
}

// Salva le note personali. Tocca SOLO la colonna note_personali (non la lingua).
async function upsertNotePersonali(db, { pmsCustomerId, notePersonali, autoreUserId }) {
  await db.query(
    `MERGE customer_profile AS t
     USING (SELECT @pmsCustomerId AS pms_customer_id) AS s ON t.pms_customer_id = s.pms_customer_id
     WHEN MATCHED THEN UPDATE SET note_personali = @notePersonali, autore_user_id = @autoreUserId, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (pms_customer_id, note_personali, autore_user_id, updated_at)
       VALUES (@pmsCustomerId, @notePersonali, @autoreUserId, SYSUTCDATETIME());`,
    { pmsCustomerId, notePersonali, autoreUserId }
  );
  return { pmsCustomerId, notePersonali };
}

module.exports = { getProfilo, upsertLingua, upsertNotePersonali };
