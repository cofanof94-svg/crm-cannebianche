// Profilo CRM del cliente (1:1). Campi manuali che il PMS non memorizza:
// - lingua preferita
// - note_personali: info biografiche/ruoli (es. "Direttore LUISS", cariche), distinte
//   dalle preferenze; compilabili dalla reception e popolabili dal Guest Briefing AI.
// upsert su UNIQUE pms_customer_id.
//
// NB: la data di nascita NON sta qui. È un dato del PMS (Anagra.dtNascita) e si
// legge solo da lì: tenerne una copia modificabile nel CRM significherebbe avere
// due valori che possono divergere, senza sapere quale sia quello buono.

const { inClause } = require('../db/query');

// ids: codice singolo o array (gruppo). Per ogni campo si prende il primo valore
// non nullo del gruppo (più recente).
//
// La SCRITTURA invece va sull'anagrafica PRINCIPALE del gruppo, non sul codice
// che si sta guardando (decisione del 12/08/2026): chi chiama passa già il
// canonico. Qui c'era scritto il contrario, ed era la frase rimasta dalla
// versione precedente — chi la leggeva per orientarsi rifaceva il difetto che
// quella decisione ha chiuso, cioè due schede a metà dopo uno "Scollega".
async function getProfilo(db, ids) {
  const rows = await db.query(
    `SELECT p.pms_customer_id, p.lingua, p.note_personali, p.updated_at, u.username AS autore
     FROM customer_profile p LEFT JOIN users u ON u.id = p.autore_user_id
     WHERE p.pms_customer_id IN ${inClause(ids)}
     ORDER BY p.updated_at DESC`
  );
  if (!rows.length) return null;
  const primo = (campo) => { const r = rows.find((x) => x[campo] != null); return r ? r[campo] : null; };
  const rigaNota = rows.find((r) => r.note_personali != null) || null;
  return {
    pms_customer_id: rows[0].pms_customer_id,
    lingua: primo('lingua'),
    note_personali: rigaNota ? rigaNota.note_personali : null,
    note_autore: rigaNota && rigaNota.autore != null ? rigaNota.autore : null,
    note_updated_at: rigaNota ? rigaNota.updated_at : null,
    updated_at: rows[0].updated_at,
  };
}

// Note personali di più clienti in una sola query (card Arrivi / In casa: una per
// riga sarebbe una query per card). Stessa colonna letta dall'anagrafica — la nota
// è UNA sola, le card ne sono solo una vista sintetica.
// Le righe senza nota non servono a nessuno: si scartano qui.
async function listNotePersonali(db, ids) {
  const rows = await db.query(
    `SELECT p.pms_customer_id, p.note_personali, p.updated_at
     FROM customer_profile p
     WHERE p.pms_customer_id IN ${inClause(ids)} AND p.note_personali IS NOT NULL
     ORDER BY p.updated_at DESC`
  );
  return (rows || []).filter((r) => r.note_personali != null && String(r.note_personali).trim() !== '');
}

async function upsertLingua(db, { pmsCustomerId, lingua, autoreUserId }) {
  await db.query(
    `MERGE customer_profile AS t
     USING (SELECT @pmsCustomerId AS pms_customer_id) AS s ON t.pms_customer_id = s.pms_customer_id
     WHEN MATCHED THEN UPDATE SET lingua = @lingua, autore_user_id = @autoreUserId, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (pms_customer_id, lingua, autore_user_id, updated_at)
       VALUES (@pmsCustomerId, @lingua, @autoreUserId, SYSUTCDATETIME());`,
    { pmsCustomerId, lingua, autoreUserId }
  );
  return { pmsCustomerId, lingua };
}

// Salva le note personali. Tocca SOLO la colonna note_personali (non la lingua).
async function upsertNotePersonali(db, { pmsCustomerId, notePersonali, autoreUserId }) {
  await db.query(
    `MERGE customer_profile AS t
     USING (SELECT @pmsCustomerId AS pms_customer_id) AS s ON t.pms_customer_id = s.pms_customer_id
     WHEN MATCHED THEN UPDATE SET note_personali = @notePersonali, autore_user_id = @autoreUserId, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (pms_customer_id, note_personali, autore_user_id, updated_at)
       VALUES (@pmsCustomerId, @notePersonali, @autoreUserId, SYSUTCDATETIME());`,
    { pmsCustomerId, notePersonali, autoreUserId }
  );
  return { pmsCustomerId, notePersonali };
}

// --- Cancellazione su tutto il gruppo di fusione -----------------------------
//
// La lettura prende il primo valore non nullo FRA TUTTE le anagrafiche fuse, la
// scrittura invece tocca una riga sola. Va bene per la modifica (la riga toccata
// diventa la più recente e vince), ma non per la cancellazione: svuotando la
// propria riga riaffiorava la nota di un altro codice del gruppo, e il testo
// tornava a video. Cliccare Elimina una seconda volta non serviva a niente.
//
// Decisione presa con Mik il 12/08/2026: la nota è della PERSONA, non
// dell'anagrafica. Elimina cancella su tutto il gruppo. Conseguenza accettata:
// dopo uno "Scollega" quell'anagrafica non ritrova la sua vecchia nota, perché è
// stata cancellata davvero.
async function cancellaNotePersonali(db, ids) {
  await db.query(
    `UPDATE customer_profile SET note_personali = NULL, updated_at = SYSUTCDATETIME()
     WHERE pms_customer_id IN ${inClause(ids)} AND note_personali IS NOT NULL`
  );
}

async function cancellaLingua(db, ids) {
  await db.query(
    `UPDATE customer_profile SET lingua = NULL, updated_at = SYSUTCDATETIME()
     WHERE pms_customer_id IN ${inClause(ids)} AND lingua IS NOT NULL`
  );
}

module.exports = {
  getProfilo, listNotePersonali, upsertLingua, upsertNotePersonali,
  cancellaNotePersonali, cancellaLingua,
};
