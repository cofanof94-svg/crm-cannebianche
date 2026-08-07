// Profilo CRM del cliente (1:1). Campi manuali che il PMS non memorizza:
// - lingua preferita
// - note_personali: info biografiche/ruoli (es. "Direttore LUISS", cariche), distinte
//   dalle preferenze; compilabili dalla reception e popolabili dal Guest Briefing AI.
// - data_nascita: override del dato PMS (Anagra.dtNascita, sola lettura), così la
//   reception può correggerlo/compilarlo quando manca. Vuoto → vale il dato PMS.
// upsert su UNIQUE pms_customer_id.

const { inClause } = require('../db/query');

// ids: codice singolo o array (gruppo). Per ogni campo si prende il primo valore
// non nullo del gruppo (più recente). La scrittura resta sul codice visualizzato.
async function getProfilo(db, ids) {
  const rows = await db.query(
    `SELECT p.pms_customer_id, p.lingua, p.note_personali,
            CONVERT(varchar(10), p.data_nascita, 23) AS data_nascita,
            p.updated_at, u.username AS autore
     FROM customer_profile p LEFT JOIN users u ON u.id = p.autore_user_id
     WHERE p.pms_customer_id IN ${inClause(ids)}
     ORDER BY p.updated_at DESC`
  );
  if (!rows.length) return null;
  const primo = (campo) => { const r = rows.find((x) => x[campo] != null); return r ? r[campo] : null; };
  const rigaNota = rows.find((r) => r.note_personali != null) || null;
  return {
    pms_customer_id: rows[0].pms_customer_id,
    lingua: primo('lingua'),
    data_nascita: primo('data_nascita'),
    note_personali: rigaNota ? rigaNota.note_personali : null,
    note_autore: rigaNota && rigaNota.autore != null ? rigaNota.autore : null,
    note_updated_at: rigaNota ? rigaNota.updated_at : null,
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

// Salva l'override CRM della data di nascita. Tocca SOLO quella colonna.
// dataNascita null → override rimosso (torna a valere il dato PMS).
async function upsertDataNascita(db, { pmsCustomerId, dataNascita, autoreUserId }) {
  await db.query(
    `MERGE customer_profile AS t
     USING (SELECT @pmsCustomerId AS pms_customer_id) AS s ON t.pms_customer_id = s.pms_customer_id
     WHEN MATCHED THEN UPDATE SET data_nascita = CAST(@dataNascita AS date), autore_user_id = @autoreUserId, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (pms_customer_id, data_nascita, autore_user_id, updated_at)
       VALUES (@pmsCustomerId, CAST(@dataNascita AS date), @autoreUserId, SYSUTCDATETIME());`,
    { pmsCustomerId, dataNascita, autoreUserId }
  );
  return { pmsCustomerId, dataNascita };
}

// Valida una data di nascita in ISO 'YYYY-MM-DD'. Vuota → null (nessun override).
// Rifiuta formati errati, date inesistenti (es. 2026-02-30), date future e
// anni assurdi. Ritorna { ok, valore }.
function validaDataNascita(valore) {
  const v = (valore == null ? '' : String(valore)).trim();
  if (!v) return { ok: true, valore: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, valore: null };
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return { ok: false, valore: null };
  const oggi = new Date().toISOString().slice(0, 10);
  if (v > oggi || v < '1900-01-01') return { ok: false, valore: null };
  return { ok: true, valore: v };
}

// Data di nascita effettiva sull'anagrafica: override CRM se presente, altrimenti
// il dato PMS. `dtNascitaFonte` dice all'interfaccia da dove arriva il valore.
function applicaDataNascita(anagrafica, profilo) {
  if (!anagrafica) return anagrafica;
  const override = profilo && profilo.data_nascita ? profilo.data_nascita : null;
  if (override) anagrafica.dtNascita = override;
  anagrafica.dtNascitaFonte = override ? 'crm' : 'pms';
  return anagrafica;
}

module.exports = { getProfilo, upsertLingua, upsertNotePersonali, upsertDataNascita, validaDataNascita, applicaDataNascita };
