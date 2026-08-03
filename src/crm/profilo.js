// Profilo CRM del cliente (1:1). Oggi: lingua preferita (dato manuale, il PMS non
// la memorizza). upsert su UNIQUE pms_customer_id.

const { inClause } = require('../db/query');

// ids: codice singolo o array (gruppo). Con più profili nel gruppo si prende la
// lingua non nulla più recente (la scrittura resta sul codice visualizzato).
async function getProfilo(db, ids) {
  const rows = await db.query(
    `SELECT TOP 1 pms_customer_id, lingua, updated_at FROM customer_profile
     WHERE pms_customer_id IN ${inClause(ids)}
     ORDER BY CASE WHEN lingua IS NOT NULL THEN 0 ELSE 1 END, updated_at DESC`
  );
  return rows[0] || null;
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

module.exports = { getProfilo, upsertLingua };
