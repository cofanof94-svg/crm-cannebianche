// Preferenze cliente nel DB CRM. Categorizzate per reparto (destinatario) e
// categoria (tipo). Liste chiuse validate anche a livello DB (CHECK). lista/aggiungi/elimina.

const REPARTI = ['Rooms', 'F&B', 'SPA', 'Front office'];
const CATEGORIE = ['F&B', 'Camera', 'Persona', 'Occasioni', 'Generale'];

async function listPreferenze(db, pmsCustomerId) {
  return db.query(
    `SELECT p.id, p.pms_customer_id, p.reparto, p.categoria, p.testo, p.created_at,
            p.autore_user_id, u.username AS autore
     FROM customer_preferences p LEFT JOIN users u ON u.id = p.autore_user_id
     WHERE p.pms_customer_id = @pmsCustomerId
     ORDER BY p.created_at DESC`,
    { pmsCustomerId }
  );
}

async function createPreferenza(db, { pmsCustomerId, autoreUserId, reparto, categoria, testo }) {
  const rows = await db.query(
    `INSERT INTO customer_preferences (pms_customer_id, autore_user_id, reparto, categoria, testo, created_at)
     OUTPUT INSERTED.id
     VALUES (@pmsCustomerId, @autoreUserId, @reparto, @categoria, @testo, SYSUTCDATETIME())`,
    { pmsCustomerId, autoreUserId, reparto, categoria, testo }
  );
  return rows[0];
}

async function deletePreferenza(db, id) {
  const rows = await db.query('DELETE FROM customer_preferences OUTPUT DELETED.id WHERE id = @id', { id });
  return rows.length > 0;
}

module.exports = { listPreferenze, createPreferenza, deletePreferenza, REPARTI, CATEGORIE };
