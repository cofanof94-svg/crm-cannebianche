// Intolleranze / allergie del cliente nel DB CRM. Dato di SICUREZZA, una riga per
// intolleranza. Solo lista/aggiungi/elimina (nessuna modifica in place). Le funzioni
// di eliminazione restituiscono true se una riga è stata effettivamente toccata
// (per il 404 dell'API).

async function listIntolleranze(db, pmsCustomerId) {
  return db.query(
    `SELECT i.id, i.pms_customer_id, i.testo, i.created_at, i.autore_user_id, u.username AS autore
     FROM customer_intolerances i LEFT JOIN users u ON u.id = i.autore_user_id
     WHERE i.pms_customer_id = @pmsCustomerId
     ORDER BY i.created_at DESC`,
    { pmsCustomerId }
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
const deleteIntolleranza = (db, id) => deleteById(db, 'customer_intolerances', id);

module.exports = { listIntolleranze, createIntolleranza, deleteIntolleranza };
