// Helper condivisi per i moduli data-access CRM.

// DELETE per id con convenzione "true se una riga è stata toccata" (per il 404
// dell'API). `table` è un identificatore fisso interno (mai input utente) →
// interpolazione sicura; l'id resta parametrizzato.
async function deleteById(db, table, id) {
  const rows = await db.query(`DELETE FROM ${table} OUTPUT DELETED.id WHERE id = @id`, { id });
  return rows.length > 0;
}

module.exports = { deleteById };
