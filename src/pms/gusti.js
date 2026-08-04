// Gusti F&B (Fase 3, filone A): consumi ristorante/bar dell'ospite, aggregati per
// articolo. SOLO SELECT sul PMS. Fonte: StorAddebitiComanda (dettaglio voci) →
// StorComanda (data) → StorComandaDettCamere (camera) agganciati all'ospite per
// CAMERA + DATA del soggiorno (il CodPratica nelle comande è sempre vuoto).
// Nome/categoria da MagArtico.
//
// ⚠️ Attribuzione per camera: con famiglie/coppie i consumi sono del nucleo, non
// solo del referente. Le voci interne/omaggio (prezzo 0) sono escluse dai totali.

const { inClause } = require('../db/query');

// F&B/Bar sono consumi di CAMERA (per camera+data): dato DEL SOGGIORNO, condiviso
// tra tutti gli occupanti. Aggancio la prenotazione sia via intestatario
// (codclinterm) sia via occupante (Alberg.codcli) → visibile su tutti i membri.
const sqlGusti = (inl) => `
WITH stays AS (
  SELECT DISTINCT ad.codcam AS cam, CAST(sp.dtarrivo AS date) AS arr, CAST(sp.dtpartenza AS date) AS par
  FROM StorPrenota sp JOIN StorAlberg al ON al.codpratica = sp.codpratica
    JOIN StorAlbergDay ad ON ad.codalb = al.codalb
  WHERE (sp.codclinterm IN ${inl} OR al.codcli IN ${inl}) AND ISNULL(ad.codcam,'') <> '' AND sp.DataEliminazione IS NULL
  UNION
  SELECT DISTINCT ad.codcam, CAST(p.dtarrivo AS date), CAST(p.dtpartenza AS date)
  FROM Prenota p JOIN Alberg al ON al.codpratica = p.codpratica
    JOIN AlbergDay ad ON ad.codalb = al.codalb
  WHERE (p.codclinterm IN ${inl} OR al.codcli IN ${inl}) AND ISNULL(ad.codcam,'') <> '' AND p.DataEliminazione IS NULL
)
SELECT TOP 40 ac.CodArt AS codArt,
  LEFT(ISNULL(ma.desart, MAX(ac.desaggiunte)), 60) AS nome,
  ISNULL(ma.flgFoodBeverage, '') AS fb, ISNULL(ma.codgrpmerCAT, '') AS grp,
  COUNT(1) AS volte, SUM(ac.qta) AS qta, SUM(ac.impoEur) AS eur
FROM stays s
JOIN StorComandaDettCamere dc ON dc.CodCam = s.cam
JOIN StorComanda c ON c.CodComanda = dc.codComanda
  AND CAST(c.dtComanda AS date) BETWEEN s.arr AND s.par AND ISNULL(c.flgEliminata,'') <> 'S'
JOIN StorAddebitiComanda ac ON ac.CodComanda = dc.codComanda AND ISNULL(ac.flgEliminato,'') <> 'S'
LEFT JOIN MagArtico ma ON ma.codart = ac.CodArt
GROUP BY ac.CodArt, ma.desart, ma.flgFoodBeverage, ma.codgrpmerCAT
ORDER BY COUNT(1) DESC`;

// Macro-categoria per il raggruppamento in scheda.
function macro(fb, grp) {
  const g = (grp || '').toUpperCase();
  if (fb === 'C' || g.startsWith('BEV.VI')) return 'Vini';
  if (fb === 'B') return 'Bevande';
  if (fb === 'F') return 'Cibo';
  return 'Altro';
}

// ids: codice singolo o array di codici del gruppo (anagrafiche fuse).
async function getGustiFB(pmsDb, ids) {
  const rows = await pmsDb.query(sqlGusti(inClause(ids)), {});
  const items = rows.map((r) => ({
    codArt: r.codArt,
    nome: (r.nome == null ? '' : String(r.nome)).trim() || r.codArt,
    categoria: macro(r.fb, r.grp),
    volte: Number(r.volte) || 0,
    eur: r.eur == null ? 0 : Number(r.eur),
  }));
  return {
    totVoci: items.length,
    totConsumi: items.reduce((s, i) => s + i.volte, 0),
    items,
  };
}

module.exports = { getGustiFB, macro };
