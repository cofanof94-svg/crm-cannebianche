async function listNote(db, pmsCustomerId) {
  return db.query(
    `SELECT n.id, n.pms_customer_id, n.testo, n.created_at, n.autore_user_id, u.username AS autore
     FROM customer_notes n LEFT JOIN users u ON u.id = n.autore_user_id
     WHERE n.pms_customer_id = @pmsCustomerId
     ORDER BY n.created_at DESC`,
    { pmsCustomerId }
  );
}

async function createNota(db, { pmsCustomerId, autoreUserId, testo }) {
  const rows = await db.query(
    `INSERT INTO customer_notes (pms_customer_id, autore_user_id, testo, created_at)
     OUTPUT INSERTED.id
     VALUES (@pmsCustomerId, @autoreUserId, @testo, SYSUTCDATETIME())`,
    { pmsCustomerId, autoreUserId, testo }
  );
  return rows[0];
}

async function updateNota(db, id, testo) {
  await db.query('UPDATE customer_notes SET testo = @testo WHERE id = @id', { id, testo });
}

async function deleteNota(db, id) {
  await db.query('DELETE FROM customer_notes WHERE id = @id', { id });
}

module.exports = { listNote, createNota, updateNota, deleteNota };
