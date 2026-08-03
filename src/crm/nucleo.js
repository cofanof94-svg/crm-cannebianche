// Nucleo di viaggio / accompagnatori nel DB CRM (parte manuale). I nomi degli
// occupanti effettivi arrivano dal PMS (Alberg); qui si aggiungono relazione e nota.
// tipo_relazione = lista chiusa (validata anche a livello DB con CHECK).

const { inClause } = require('../db/query');

const RELAZIONI = ['Coniuge', 'Figlio-a', 'Genitore', 'Amico-a', 'Assistente', 'Altro'];

// ids: codice singolo o array (gruppo di anagrafiche fuse).
async function listNucleo(db, ids) {
  return db.query(
    `SELECT n.id, n.pms_customer_id, n.tipo_relazione, n.nome, n.cognome, n.nota, n.created_at,
            n.autore_user_id, u.username AS autore
     FROM customer_travel_party n LEFT JOIN users u ON u.id = n.autore_user_id
     WHERE n.pms_customer_id IN ${inClause(ids)}
     ORDER BY n.created_at DESC`
  );
}

async function createMembro(db, { pmsCustomerId, autoreUserId, tipoRelazione, nome, cognome, nota }) {
  const rows = await db.query(
    `INSERT INTO customer_travel_party (pms_customer_id, autore_user_id, tipo_relazione, nome, cognome, nota, created_at)
     OUTPUT INSERTED.id
     VALUES (@pmsCustomerId, @autoreUserId, @tipoRelazione, @nome, @cognome, @nota, SYSUTCDATETIME())`,
    { pmsCustomerId, autoreUserId, tipoRelazione, nome, cognome, nota }
  );
  return rows[0];
}

const { deleteById } = require('./helpers');
const deleteMembro = (db, id) => deleteById(db, 'customer_travel_party', id);

module.exports = { listNucleo, createMembro, deleteMembro, RELAZIONI };
