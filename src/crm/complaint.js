// Reclami cliente (Complaints) nel DB CRM. Stessa logica delle note + stato
// aperto/risolto. Le funzioni di modifica/eliminazione restituiscono true se
// una riga è stata effettivamente toccata (per il 404 dell'API).

async function listComplaints(db, pmsCustomerId) {
  return db.query(
    `SELECT c.id, c.pms_customer_id, c.testo, c.stato, c.periodo, c.created_at, c.resolved_at,
            c.autore_user_id, u.username AS autore
     FROM customer_complaints c LEFT JOIN users u ON u.id = c.autore_user_id
     WHERE c.pms_customer_id = @pmsCustomerId
     ORDER BY CASE WHEN c.stato = 'aperto' THEN 0 ELSE 1 END, c.created_at DESC`,
    { pmsCustomerId }
  );
}

async function createComplaint(db, { pmsCustomerId, autoreUserId, testo, periodo = null }) {
  const rows = await db.query(
    `INSERT INTO customer_complaints (pms_customer_id, autore_user_id, testo, periodo, stato, created_at)
     OUTPUT INSERTED.id
     VALUES (@pmsCustomerId, @autoreUserId, @testo, @periodo, 'aperto', SYSUTCDATETIME())`,
    { pmsCustomerId, autoreUserId, testo, periodo }
  );
  return rows[0];
}

async function updateComplaintTesto(db, id, testo) {
  const rows = await db.query(
    'UPDATE customer_complaints SET testo = @testo OUTPUT INSERTED.id WHERE id = @id',
    { id, testo }
  );
  return rows.length > 0;
}

async function setComplaintPeriodo(db, id, periodo) {
  const rows = await db.query(
    'UPDATE customer_complaints SET periodo = @periodo OUTPUT INSERTED.id WHERE id = @id',
    { id, periodo: periodo || null }
  );
  return rows.length > 0;
}

async function setComplaintStato(db, id, stato) {
  const rows = await db.query(
    `UPDATE customer_complaints
     SET stato = @stato, resolved_at = CASE WHEN @stato = 'risolto' THEN SYSUTCDATETIME() ELSE NULL END
     OUTPUT INSERTED.id WHERE id = @id`,
    { id, stato }
  );
  return rows.length > 0;
}

const { deleteById } = require('./helpers');
const deleteComplaint = (db, id) => deleteById(db, 'customer_complaints', id);

module.exports = { listComplaints, createComplaint, updateComplaintTesto, setComplaintPeriodo, setComplaintStato, deleteComplaint };
