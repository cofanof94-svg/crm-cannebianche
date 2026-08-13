// Preferenze cliente nel DB CRM. Categorizzate per reparto (destinatario) e
// categoria (tipo). Liste chiuse validate anche a livello DB (CHECK). lista/aggiungi/elimina.

const REPARTI = ['Rooms', 'F&B', 'SPA', 'Front office'];
const CATEGORIE = ['F&B', 'Camera', 'Persona', 'Occasioni', 'Generale'];
// ambito: 'nucleo' = condivisa (visibile su tutti i membri); 'personale' = del singolo.
const AMBITI = ['personale', 'nucleo'];

const { inClause } = require('../db/query');

// ids: codice singolo o array (gruppo di anagrafiche fuse).
async function listPreferenze(db, ids) {
  return db.query(
    `SELECT p.id, p.pms_customer_id, p.reparto, p.categoria, p.testo, p.ambito, p.created_at,
            p.autore_user_id, u.username AS autore
     FROM customer_preferences p LEFT JOIN users u ON u.id = p.autore_user_id
     WHERE p.pms_customer_id IN ${inClause(ids)}
     ORDER BY p.created_at DESC`
  );
}

// Preferenze condivise: solo quelle 'nucleo' dei membri indicati (per mostrarle,
// in sola lettura, sugli altri familiari). ids = codici degli ALTRI membri.
async function listCondivise(db, ids) {
  return db.query(
    `SELECT p.id, p.pms_customer_id, p.reparto, p.categoria, p.testo, p.ambito, p.created_at
     FROM customer_preferences p
     WHERE p.pms_customer_id IN ${inClause(ids)} AND p.ambito = 'nucleo'
     ORDER BY p.created_at DESC`
  );
}

// `origine` dice se la preferenza è stata scritta a mano o confermata da un
// suggerimento dell'AI. Le due strade passano dalla stessa chiamata e producono
// righe identiche: senza questo campo non si può rispondere a "l'AI ci sta
// facendo risparmiare tempo o ci stiamo rileggendo quello che già sapevamo".
// Il valore arriva da chi chiama, perché è l'unico che sa da quale pulsante si
// è passati.
const ORIGINI = ['manuale', 'ai'];

async function createPreferenza(db, { pmsCustomerId, autoreUserId, reparto, categoria, testo, ambito = 'nucleo', origine = 'manuale' }) {
  const rows = await db.query(
    `INSERT INTO customer_preferences (pms_customer_id, autore_user_id, reparto, categoria, testo, ambito, origine, created_at)
     OUTPUT INSERTED.id
     VALUES (@pmsCustomerId, @autoreUserId, @reparto, @categoria, @testo, @ambito, @origine, SYSUTCDATETIME())`,
    { pmsCustomerId, autoreUserId, reparto, categoria, testo, ambito, origine: ORIGINI.includes(origine) ? origine : 'manuale' }
  );
  return rows[0];
}

// Aggiorna solo i campi passati (ambito/testo/reparto/categoria). true se toccato.
async function updatePreferenza(db, id, { ambito, testo, reparto, categoria }) {
  const set = [];
  const params = { id };
  if (ambito !== undefined) { set.push('ambito = @ambito'); params.ambito = ambito; }
  if (testo !== undefined) { set.push('testo = @testo'); params.testo = testo; }
  if (reparto !== undefined) { set.push('reparto = @reparto'); params.reparto = reparto; }
  if (categoria !== undefined) { set.push('categoria = @categoria'); params.categoria = categoria; }
  if (!set.length) return false;
  const rows = await db.query(`UPDATE customer_preferences SET ${set.join(', ')} OUTPUT INSERTED.id WHERE id = @id`, params);
  return rows.length > 0;
}

const { deleteById } = require('./helpers');
const deletePreferenza = (db, id, membri) => deleteById(db, 'customer_preferences', id, membri);

module.exports = { listPreferenze, listCondivise, createPreferenza, updatePreferenza, deletePreferenza, REPARTI, CATEGORIE, AMBITI, ORIGINI };
