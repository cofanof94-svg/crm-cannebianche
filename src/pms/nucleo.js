// Co-occupanti delle prenotazioni dell'ospite (per auto-popolare il nucleo).
// SOLO SELECT. Un co-occupante è chi compare in Alberg/StorAlberg per una pratica
// dell'ospite. Ritorna anche nShared (n. prenotazioni condivise) e il totale
// prenotazioni dell'ospite, per applicare la regola di ricorrenza.

const { inClause } = require('../db/query');

const sqlCoOcc = (inl) => `
WITH prat AS (
  SELECT codpratica FROM Alberg WHERE codcli IN ${inl}
  UNION SELECT codpratica FROM StorAlberg WHERE codcli IN ${inl}
  UNION SELECT codpratica FROM Prenota WHERE codclinterm IN ${inl} AND DataEliminazione IS NULL
  UNION SELECT codpratica FROM StorPrenota WHERE codclinterm IN ${inl} AND DataEliminazione IS NULL
),
occ AS (
  SELECT al.codcli, al.codpratica FROM Alberg al JOIN prat ON prat.codpratica = al.codpratica WHERE ISNULL(al.codcli,0) <> 0
  UNION SELECT al.codcli, al.codpratica FROM StorAlberg al JOIN prat ON prat.codpratica = al.codpratica WHERE ISNULL(al.codcli,0) <> 0
)
SELECT a.CodCli AS codCli, a.Cognome, a.Nome,
  COUNT(DISTINCT o.codpratica) AS nShared,
  (SELECT COUNT(*) FROM prat) AS totPrat
FROM occ o JOIN Anagra a ON a.CodCli = o.codcli
WHERE o.codcli NOT IN ${inl}
GROUP BY a.CodCli, a.Cognome, a.Nome`;

// Nomi che sono aziende (non persone) → esclusi dal nucleo.
function isAzienda(nome) {
  return /(\bs\.?r\.?l\.?s?\b|\bs\.?p\.?a\.?\b|\bs\.?n\.?c\.?\b|\bs\.?a\.?s\.?\b|\bltd\b|\bgmbh\b|\binc\b)/i.test(nome || '');
}

// Regola concordata: se l'ospite ha POCHE prenotazioni (<= soglia) prendo tutti i
// co-occupanti; altrimenti solo quelli ricorrenti (>= 2 prenotazioni condivise).
// In entrambi i casi escludo le aziende.
function filtraCoOccupanti(total, items, soglia = 3) {
  return items.filter((o) => {
    if (isAzienda(`${o.cognome || ''} ${o.nome || ''}`)) return false;
    return total <= soglia || o.nShared >= 2;
  });
}

async function getCoOccupanti(pmsDb, ids) {
  const rows = await pmsDb.query(sqlCoOcc(inClause(ids)), {});
  const items = rows.map((r) => ({
    codCli: r.codCli,
    cognome: (r.Cognome == null ? '' : String(r.Cognome)).trim() || null,
    nome: (r.Nome == null ? '' : String(r.Nome)).trim() || null,
    nShared: Number(r.nShared) || 0,
  }));
  const total = rows.length ? Number(rows[0].totPrat) || 0 : 0;
  return { total, items };
}

module.exports = { getCoOccupanti, isAzienda, filtraCoOccupanti };
