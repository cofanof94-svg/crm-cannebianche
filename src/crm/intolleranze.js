// Intolleranze / allergie del cliente nel DB CRM. Dato di SICUREZZA, una riga per
// intolleranza. Solo lista/aggiungi/elimina (nessuna modifica in place). Le funzioni
// di eliminazione restituiscono true se una riga è stata effettivamente toccata
// (per il 404 dell'API).

const { inClause } = require('../db/query');

// ids: codice singolo o array (gruppo di anagrafiche fuse).
async function listIntolleranze(db, ids) {
  return db.query(
    `SELECT i.id, i.pms_customer_id, i.testo, i.created_at, i.autore_user_id, u.username AS autore
     FROM customer_intolerances i LEFT JOIN users u ON u.id = i.autore_user_id
     WHERE i.pms_customer_id IN ${inClause(ids)}
     ORDER BY i.created_at DESC`
  );
}

async function createIntolleranza(db, { pmsCustomerId, autoreUserId, testo }) {
  const rows = await db.query(
    `INSERT INTO customer_intolerances (pms_customer_id, autore_user_id, testo, created_at)
     OUTPUT INSERTED.id
     VALUES (@pmsCustomerId, @autoreUserId, @testo, SYSUTCDATETIME())`,
    { pmsCustomerId, autoreUserId, testo }
  );
  return rows[0];
}

const { deleteById } = require('./helpers');
const deleteIntolleranza = (db, id, membri) => deleteById(db, 'customer_intolerances', id, membri);

module.exports = { listIntolleranze, createIntolleranza, deleteIntolleranza };
