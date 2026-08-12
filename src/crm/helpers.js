// Helper condivisi per i moduli data-access CRM.

const { inClause } = require('../db/query');

// DELETE per id con convenzione "true se una riga è stata toccata" (per il 404
// dell'API). `table` è un identificatore fisso interno (mai input utente) →
// interpolazione sicura; l'id resta parametrizzato.
//
// `membri` (opzionale) sono i codici ospite del gruppo che si sta guardando: se
// passati, la riga si cancella SOLO se appartiene a uno di loro. Il controllo sta
// nella query e non prima, così è una cosa sola e non due — non esiste il momento
// in cui la riga risulta di un altro ma viene cancellata lo stesso.
// Serve contro gli errori di programmazione, non contro il personale: chi ha il
// permesso di scrivere lo ha comunque. Ma un numero sbagliato mandato per sbaglio
// dall'interfaccia non tocca più la scheda di un altro ospite.
async function deleteById(db, table, id, membri) {
  const filtro = Array.isArray(membri) && membri.length
    ? ` AND pms_customer_id IN ${inClause(membri)}`
    : '';
  const rows = await db.query(`DELETE FROM ${table} OUTPUT DELETED.id WHERE id = @id${filtro}`, { id });
  return rows.length > 0;
}

// La riga è di uno dei codici del gruppo che si sta guardando?
//
// Per le CORREZIONI si controlla prima, invece di filtrare dentro la UPDATE come si
// fa per le cancellazioni: i reclami si aggiornano attraverso più funzioni diverse
// (testo, stato, periodo, classificazione) e infilare il filtro in ognuna
// significherebbe ripetere lo stesso controllo quattro volte, con quattro occasioni
// di dimenticarlo.
async function appartieneA(db, table, id, membri) {
  if (!Array.isArray(membri) || !membri.length) return false;
  const rows = await db.query(
    `SELECT TOP 1 id FROM ${table} WHERE id = @id AND pms_customer_id IN ${inClause(membri)}`,
    { id }
  );
  return rows.length > 0;
}

module.exports = { deleteById, appartieneA };
