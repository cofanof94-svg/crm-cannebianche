// Trattamenti SPA (Fase 3, estensione filone A/C): trattamenti e prodotti benessere
// dell'ospite, aggregati per nome. SOLO SELECT sul PMS.
//
// A differenza del F&B (comande per camera+data), la SPA è addebitata negli EXTRA:
// Matura (attive) / StorMatura (archivio), agganciate all'ospite via codalb →
// Alberg/StorAlberg → codpratica → Prenota/StorPrenota.codclinterm. Gli articoli SPA
// sono identificati dal gruppo merceologico MagArtico.codgrpmerCAT LIKE 'SPA%'
// (gruppo 'SPA' = trattamenti, 'SPA.VEN' = prodotti rivenduti).
//
// ⚠️ Questi importi sono già dentro il totale "Extra" dell'ospite: qui li itemizziamo
// per le preferenze, non è un doppio conteggio economico.

const { inClause } = require('../db/query');

// La SPA è un trattamento PERSONALE: addebitata sulla linea del singolo occupante
// (Alberg/StorAlberg.codcli → codalb). Filtro per codalb dell'ospite stesso, non
// per tutte le pratiche del gruppo → resta attribuita a chi l'ha ricevuto.
const sqlSpa = (inl) => `
WITH alb AS (
  SELECT al.codalb FROM StorAlberg al WHERE al.codcli IN ${inl}
  UNION
  SELECT al.codalb FROM Alberg al WHERE al.codcli IN ${inl}
),
mov AS (
  SELECT codalb, codart, impoeur, qta FROM Matura
  UNION ALL
  SELECT codalb, codart, impoeur, qta FROM StorMatura
)
SELECT TOP 40 LEFT(ma.desart, 60) AS nome, ISNULL(ma.codgrpmerCAT, '') AS grp,
  COUNT(1) AS volte, SUM(mov.qta) AS qta, SUM(mov.impoeur) AS eur
FROM mov
JOIN alb ON alb.codalb = mov.codalb
JOIN MagArtico ma ON ma.codart = mov.codart AND ma.codgrpmerCAT LIKE 'SPA%'
GROUP BY ma.desart, ma.codgrpmerCAT
ORDER BY COUNT(1) DESC`;

// Macro-categoria: SPA.VEN = prodotto rivenduto, SPA (base) = trattamento.
function macroSpa(grp) {
  const g = (grp || '').toUpperCase();
  if (g === 'SPA.VEN') return 'Prodotto';
  if (g === 'SPA' || g.startsWith('SPA')) return 'Trattamento';
  return 'Altro';
}

// ids: codice singolo o array di codici del gruppo (anagrafiche fuse).
async function getTrattamentiSpa(pmsDb, ids) {
  const rows = await pmsDb.query(sqlSpa(inClause(ids)), {});
  const items = rows.map((r) => ({
    nome: (r.nome == null ? '' : String(r.nome)).trim() || '(senza nome)',
    categoria: macroSpa(r.grp),
    volte: Number(r.volte) || 0,
    eur: r.eur == null ? 0 : Number(r.eur),
  }));
  return {
    totVoci: items.length,
    totConsumi: items.reduce((s, i) => s + i.volte, 0),
    items,
  };
}

module.exports = { getTrattamentiSpa, macroSpa };
