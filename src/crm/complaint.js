// Reclami cliente (Complaints) nel DB CRM. Stessa logica delle note + stato
// aperto/risolto. Le funzioni di modifica/eliminazione restituiscono true se
// una riga è stata effettivamente toccata (per il 404 dell'API).
//
// follow_up = come è stato gestito il problema (colonna della stessa riga, non
// una nota a parte): si scrive nello stesso UPDATE che risolve, così non può
// esistere un complaint "risolto ma senza sapere cosa è stato fatto".

const { inClause } = require('../db/query');
const { REPARTI } = require('./preferenze');

// Il follow-up è una descrizione breve dell'intervento, non un racconto: il
// limite è anche sulla colonna (NVARCHAR(500)), qui serve a dare un 400 chiaro.
const FOLLOWUP_MAX = 500;

// Reparto: la STESSA lista delle preferenze, di proposito. È la dimensione con
// cui si segregano i dati per reparto: due liste diverse renderebbero
// impossibile mettere insieme "cosa gradisce" e "cosa è andato storto".
// Categoria: lista PROPRIA. Quelle delle preferenze (Camera, Persona,
// Occasioni…) descrivono un gradimento; un reclamo deve dire cosa non ha
// funzionato, ed è questo che rende leggibile un "tipologie più frequenti".
const CATEGORIE_COMPLAINT = ['Pulizia', 'Manutenzione', 'Rumore', 'Servizio', 'Cibo e bevande', 'Attesa', 'Conto', 'Altro'];

// ids: codice singolo o array (gruppo di anagrafiche fuse).
async function listComplaints(db, ids) {
  return db.query(
    `SELECT c.id, c.pms_customer_id, c.testo, c.stato, c.periodo, c.reparto, c.categoria,
            c.follow_up, c.created_at, c.resolved_at,
            c.autore_user_id, u.username AS autore
     FROM customer_complaints c LEFT JOIN users u ON u.id = c.autore_user_id
     WHERE c.pms_customer_id IN ${inClause(ids)}
     ORDER BY CASE WHEN c.stato = 'aperto' THEN 0 ELSE 1 END, c.created_at DESC`
  );
}

async function createComplaint(db, { pmsCustomerId, autoreUserId, testo, periodo = null, reparto = null, categoria = null }) {
  const rows = await db.query(
    `INSERT INTO customer_complaints (pms_customer_id, autore_user_id, testo, periodo, reparto, categoria, stato, created_at)
     OUTPUT INSERTED.id
     VALUES (@pmsCustomerId, @autoreUserId, @testo, @periodo, @reparto, @categoria, 'aperto', SYSUTCDATETIME())`,
    { pmsCustomerId, autoreUserId, testo, periodo, reparto, categoria }
  );
  return rows[0];
}

// Riclassificazione di un reclamo già inserito (o classificazione di uno vecchio,
// che nasce senza). Aggiorna solo ciò che viene passato.
async function setComplaintClasse(db, id, { reparto, categoria }) {
  const set = [];
  const params = { id };
  if (reparto !== undefined) { set.push('reparto = @reparto'); params.reparto = reparto || null; }
  if (categoria !== undefined) { set.push('categoria = @categoria'); params.categoria = categoria || null; }
  if (!set.length) return false;
  const rows = await db.query(
    `UPDATE customer_complaints SET ${set.join(', ')} OUTPUT INSERTED.id WHERE id = @id`,
    params
  );
  return rows.length > 0;
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

// Cambio di stato. followUp non passato (undefined) = colonna non toccata: alla
// RIAPERTURA il follow-up precedente resta, ed è giusto — dice cosa era già stato
// tentato e non era bastato. Lo sovrascrive la risoluzione successiva.
async function setComplaintStato(db, id, stato, followUp) {
  const set = [
    'stato = @stato',
    "resolved_at = CASE WHEN @stato = 'risolto' THEN SYSUTCDATETIME() ELSE NULL END",
  ];
  const params = { id, stato };
  if (followUp !== undefined) { set.push('follow_up = @followUp'); params.followUp = followUp || null; }
  const rows = await db.query(
    `UPDATE customer_complaints SET ${set.join(', ')} OUTPUT INSERTED.id WHERE id = @id`,
    params
  );
  return rows.length > 0;
}

// Correzione del solo follow-up (refuso), senza rimettere mano allo stato.
async function setComplaintFollowUp(db, id, followUp) {
  const rows = await db.query(
    'UPDATE customer_complaints SET follow_up = @followUp OUTPUT INSERTED.id WHERE id = @id',
    { id, followUp: followUp || null }
  );
  return rows.length > 0;
}

const { deleteById } = require('./helpers');
const deleteComplaint = (db, id) => deleteById(db, 'customer_complaints', id);

module.exports = {
  listComplaints, createComplaint, updateComplaintTesto, setComplaintPeriodo,
  setComplaintStato, setComplaintFollowUp, setComplaintClasse, deleteComplaint,
  FOLLOWUP_MAX, REPARTI, CATEGORIE_COMPLAINT,
};
