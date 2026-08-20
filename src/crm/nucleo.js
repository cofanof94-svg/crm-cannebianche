// Nucleo di viaggio / accompagnatori nel DB CRM (parte manuale). I nomi degli
// occupanti effettivi arrivano dal PMS (Alberg); qui si aggiungono relazione e nota.
// tipo_relazione = lista chiusa (validata anche a livello DB con CHECK).

const { inClause } = require('../db/query');

const RELAZIONI = ['Coniuge', 'Figlio-a', 'Genitore', 'Amico-a', 'Assistente', 'Altro'];

// ids: codice singolo o array (gruppo di anagrafiche fuse).
async function listNucleo(db, ids) {
  return db.query(
    `SELECT n.id, n.pms_customer_id, n.tipo_relazione, n.nome, n.cognome, n.nota, n.pms_occupant_id, n.created_at,
            n.autore_user_id, u.username AS autore
     FROM customer_travel_party n LEFT JOIN users u ON u.id = n.autore_user_id
     WHERE n.pms_customer_id IN ${inClause(ids)}
     ORDER BY n.created_at DESC`
  );
}

async function createMembro(db, { pmsCustomerId, autoreUserId, tipoRelazione, nome, cognome, nota, pmsOccupantId = null }) {
  const rows = await db.query(
    `INSERT INTO customer_travel_party (pms_customer_id, autore_user_id, tipo_relazione, nome, cognome, nota, pms_occupant_id, created_at)
     OUTPUT INSERTED.id
     VALUES (@pmsCustomerId, @autoreUserId, @tipoRelazione, @nome, @cognome, @nota, @pmsOccupantId, SYSUTCDATETIME())`,
    { pmsCustomerId, autoreUserId, tipoRelazione, nome, cognome, nota, pmsOccupantId }
  );
  return rows[0];
}

// Aggiorna solo i campi passati (relazione/nome/cognome/nota). true se toccato.
async function updateMembro(db, id, { tipoRelazione, nome, cognome, nota }) {
  const set = [];
  const params = { id };
  if (tipoRelazione !== undefined) { set.push('tipo_relazione = @tipoRelazione'); params.tipoRelazione = tipoRelazione; }
  if (nome !== undefined) { set.push('nome = @nome'); params.nome = nome; }
  if (cognome !== undefined) { set.push('cognome = @cognome'); params.cognome = cognome; }
  if (nota !== undefined) { set.push('nota = @nota'); params.nota = nota; }
  if (!set.length) return false;
  const rows = await db.query(`UPDATE customer_travel_party SET ${set.join(', ')} OUTPUT INSERTED.id WHERE id = @id`, params);
  return rows.length > 0;
}

// Gruppo-nucleo di un ospite: sé stesso + i membri del suo nucleo (con
// pms_occupant_id) + chi lo elenca nel proprio nucleo (un livello, bidirezionale).
// Serve a condividere le preferenze 'nucleo' tra i familiari.
// Accetta un codice singolo oppure TUTTI i codici di un ospite con più
// anagrafiche fuse. Prima accettava solo il codice guardato, e siccome le
// scritture del nucleo vanno sull'anagrafica principale (decisione del 12/08),
// un ospite fuso vedeva il nucleo solo dal codice su cui le righe erano finite:
// il familiare restava elencato nel riquadro, ma la sua preferenza condivisa e
// le sue note di anagrafica sparivano (20/08/2026).
async function getNucleoGroup(db, ids) {
  const arr = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isInteger))];
  if (!arr.length) return [];
  const inl = inClause(arr);
  const rows = await db.query(
    `SELECT pms_occupant_id AS c FROM customer_travel_party WHERE pms_customer_id IN ${inl} AND pms_occupant_id IS NOT NULL
     UNION SELECT pms_customer_id FROM customer_travel_party WHERE pms_occupant_id IN ${inl}`
  );
  return [...new Set([...arr, ...rows.map((r) => r.c)])];
}

// Relazioni note per una lista di referenti (dashboard arrivi): righe
// { pms_customer_id (referente), pms_occupant_id (occupante), tipo_relazione }.
// Batch set-based; solo righe con occupante PMS agganciato.
async function getRelazioniByIds(db, ids) {
  const arr = [...new Set(Array.isArray(ids) ? ids : [ids])];
  if (!arr.length) return [];
  return db.query(
    `SELECT pms_customer_id, pms_occupant_id, tipo_relazione
     FROM customer_travel_party
     WHERE pms_customer_id IN ${inClause(arr)} AND pms_occupant_id IS NOT NULL`
  );
}

// --- Memoria delle esclusioni ------------------------------------------------
// Il controllo dei co-occupanti si rifà a ogni apertura della scheda, così un
// accompagnatore registrato dopo la prima volta entra comunque. Il prezzo è che
// chi è stato TOLTO a mano tornerebbe: qui si tiene traccia delle esclusioni,
// altrimenti correggere il nucleo sarebbe una fatica che si disfa da sola.

async function scartatiDelNucleo(db, ids) {
  const rows = await db.query(
    `SELECT pms_occupant_id FROM customer_nucleo_scartati WHERE pms_customer_id IN ${inClause(ids)}`
  );
  return new Set(rows.map((r) => r.pms_occupant_id));
}

async function scartaDalNucleo(db, { pmsCustomerId, pmsOccupantId, autoreUserId = null }) {
  await db.query(
    `IF NOT EXISTS (SELECT 1 FROM customer_nucleo_scartati WHERE pms_customer_id = @pmsCustomerId AND pms_occupant_id = @pmsOccupantId)
     INSERT INTO customer_nucleo_scartati (pms_customer_id, pms_occupant_id, autore_user_id)
     VALUES (@pmsCustomerId, @pmsOccupantId, @autoreUserId)`,
    { pmsCustomerId, pmsOccupantId, autoreUserId }
  );
}

// Chi si sta per cancellare: serve a sapere se era agganciato a un'anagrafica
// del gestionale, perché solo quelli possono tornare da soli.
async function membroById(db, id, membri) {
  const rows = await db.query(
    `SELECT TOP 1 id, pms_customer_id, pms_occupant_id FROM customer_travel_party
     WHERE id = @id AND pms_customer_id IN ${inClause(membri)}`,
    { id }
  );
  return rows[0] || null;
}

const { deleteById } = require('./helpers');
const deleteMembro = (db, id, membri) => deleteById(db, 'customer_travel_party', id, membri);

module.exports = {
  listNucleo, createMembro, updateMembro, deleteMembro, getNucleoGroup, getRelazioniByIds,
  scartatiDelNucleo, scartaDalNucleo, membroById, RELAZIONI,
};
