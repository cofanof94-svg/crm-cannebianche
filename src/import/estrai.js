// Estrazione (SELECT sul PMS, sola lettura) delle prenotazioni per l'import.
// Ritorna righe GREZZE; la logica di derivazione sta in trasforma.js.
//
// ⚠️ VERIFICARE IN HOTEL sui dati veri: shape dei risultati, importi (arr/extra/
// city tax), decodifiche e performance sul dataset completo. Struttura importi
// allineata a src/pms/clienti.js (maturato per codalb; city tax = codser 'IMP').
//
// Parametri opzionali:
//   - codCli: limita a un singolo referente (refresh on-demand).
//   - updatedAfter: solo prenotazioni correnti modificate dopo (incrementale).

// Espressione importi per un ramo (albTable = Alberg|StorAlberg, prefissoPratica = p|sp).
function importiExpr(albTable, prat) {
  const codalbSet = `(SELECT codalb FROM ${albTable} WHERE codpratica = ${prat}.codpratica)`;
  const sum = (matTable, cond) =>
    `(SELECT ISNULL(SUM(m.impoeur), 0) FROM ${matTable} m WHERE m.codalb IN ${codalbSet} AND ${cond})`;
  const arr = `LTRIM(RTRIM(ISNULL(m.codarr, ''))) <> ''`;
  const extra = `LTRIM(RTRIM(ISNULL(m.codarr, ''))) = '' AND ISNULL(m.flgDistintaArr, '') <> 'S' AND LTRIM(RTRIM(ISNULL(m.codser, ''))) <> 'IMP'`;
  const city = `LTRIM(RTRIM(ISNULL(m.codser, ''))) = 'IMP'`;
  return {
    arrangiamento: `(${sum('Matura', arr)} + ${sum('StorMatura', arr)})`,
    extra: `(${sum('Matura', extra)} + ${sum('StorMatura', extra)})`,
    cityTax: `(${sum('Matura', city)} + ${sum('StorMatura', city)})`,
  };
}

function ramoCorrenti(filtri) {
  const i = importiExpr('Alberg', 'p');
  return `
  SELECT p.codpratica, p.codclinterm AS pms_customer_id, 0 AS isStorico,
    CONVERT(varchar(10), p.dtarrivo, 23) AS dtarrivo,
    CONVERT(varchar(10), p.dtpartenza, 23) AS dtpartenza,
    DATEDIFF(day, p.dtarrivo, p.dtpartenza) AS notti,
    p.flgincasa, CONVERT(varchar(10), p.DataEliminazione, 23) AS dataEliminazione, p.Motivo,
    ISNULL(p.paxadulti,0) + ISNULL(p.paxbambini,0) AS pax, p.codarr AS trattamento,
    (SELECT TOP 1 s.DesSource FROM SourcePrenota s WHERE s.CodSource = p.CodSource) AS source,
    (SELECT TOP 1 pr.DesProvenienza FROM PrenotaProvenienze pr WHERE pr.CodProvenienza = p.CodProvenienza) AS mercato,
    (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = p.codpratica AND ISNULL(ad.codcam,'') <> '' FOR XML PATH('')), 1, 2, '')) AS camere,
    (SELECT TOP 1 t.destip FROM TipoPre tp JOIN Tipologie t ON t.codtip = tp.codtip WHERE tp.codpratica = p.codpratica) AS tipologia,
    (SELECT CodVip FROM Anagra WHERE CodCli = p.codclinterm) AS vipSnapshot,
    p.ListaCodAmenities AS amenitiesSnapshot,
    CASE WHEN EXISTS (SELECT 1 FROM Alberg alo WHERE alo.codpratica = p.codpratica AND alo.codcli IS NOT NULL) THEN 1 ELSE 0 END AS hasOccupanti,
    p.UpdatedAtNewDH AS pmsUpdatedAt,
    ${i.arrangiamento} AS impArrangiamento, ${i.extra} AS impExtra, ${i.cityTax} AS cityTax
  FROM Prenota p
  WHERE p.codclinterm IS NOT NULL
    ${filtri.codCli ? 'AND p.codclinterm = @codCli' : ''}
    ${filtri.updatedAfter ? 'AND p.UpdatedAtNewDH > @updatedAfter' : ''}`;
}

function ramoStorici(filtri) {
  const i = importiExpr('StorAlberg', 'sp');
  return `
  SELECT sp.codpratica, sp.codclinterm AS pms_customer_id, 1 AS isStorico,
    CONVERT(varchar(10), sp.dtarrivo, 23) AS dtarrivo,
    CONVERT(varchar(10), sp.dtpartenza, 23) AS dtpartenza,
    DATEDIFF(day, sp.dtarrivo, sp.dtpartenza) AS notti,
    sp.flgincasa, CONVERT(varchar(10), sp.DataEliminazione, 23) AS dataEliminazione, sp.Motivo,
    ISNULL(sp.paxadulti,0) + ISNULL(sp.paxbambini,0) AS pax, sp.codarr AS trattamento,
    (SELECT TOP 1 s.DesSource FROM SourcePrenota s WHERE s.CodSource = sp.CodSource) AS source,
    (SELECT TOP 1 pr.DesProvenienza FROM PrenotaProvenienze pr WHERE pr.CodProvenienza = sp.CodProvenienza) AS mercato,
    (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam FROM StorAlberg al JOIN StorAlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = sp.codpratica AND ISNULL(ad.codcam,'') <> '' FOR XML PATH('')), 1, 2, '')) AS camere,
    (SELECT TOP 1 t.destip FROM TipoPre tp JOIN Tipologie t ON t.codtip = tp.codtip WHERE tp.codpratica = sp.codpratica) AS tipologia,
    (SELECT CodVip FROM Anagra WHERE CodCli = sp.codclinterm) AS vipSnapshot,
    sp.ListaCodAmenities AS amenitiesSnapshot,
    CASE WHEN EXISTS (SELECT 1 FROM StorAlberg alo WHERE alo.codpratica = sp.codpratica AND alo.codcli IS NOT NULL) THEN 1 ELSE 0 END AS hasOccupanti,
    sp.UpdatedAtNewDH AS pmsUpdatedAt,
    ${i.arrangiamento} AS impArrangiamento, ${i.extra} AS impExtra, ${i.cityTax} AS cityTax
  FROM StorPrenota sp
  WHERE sp.codclinterm IS NOT NULL
    ${filtri.codCli ? 'AND sp.codclinterm = @codCli' : ''}`;
}

async function estraiPrenotazioni(pmsDb, { codCli = null, updatedAfter = null } = {}) {
  const filtri = { codCli, updatedAfter };
  // Gli storici non hanno un marcatore incrementale affidabile → sempre pieni,
  // salvo il filtro per cliente (refresh on-demand).
  const parts = [ramoCorrenti(filtri)];
  if (!updatedAfter || codCli) parts.push(ramoStorici({ codCli }));
  const sql = parts.join('\n  UNION ALL\n');
  const params = {};
  if (codCli) params.codCli = codCli;
  if (updatedAfter) params.updatedAfter = updatedAfter;
  return pmsDb.query(sql, params);
}

module.exports = { estraiPrenotazioni, importiExpr };
