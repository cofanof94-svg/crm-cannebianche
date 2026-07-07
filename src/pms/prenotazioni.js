// Arrivi di una data. Camera = COALESCE(assegnazione roomlist in AlbergDay, pianificata in TipoPre).
// OSPITE = codclinterm (l'ospite reale); codcli è l'intestatario del conto/pagante.
// Trattamento: codtrat da TipoPre.CodArr, decodificato in Trattamenti.destrat (NON Arrangia).
// Provenienza via subquery TOP 1 per evitare fan-out. Una riga per prenotazione.
const SQL_ARRIVI = `
SELECT
  p.codpratica,
  a.Cognome AS cognome,
  a.Nome AS nome,
  COALESCE(
    (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam
       FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = p.codpratica AND ISNULL(ad.codcam,'') <> ''
         AND CAST(p.dtarrivo AS date) >= CAST(ad.dtarrivo AS date)
         AND CAST(p.dtarrivo AS date) <  CAST(ad.dtpartenza AS date)
       FOR XML PATH('')), 1, 2, '')),
    (SELECT STUFF((SELECT DISTINCT ', ' + tp.codcam
       FROM TipoPre tp WHERE tp.codpratica = p.codpratica AND ISNULL(tp.codcam,'') <> ''
       FOR XML PATH('')), 1, 2, ''))
  ) AS camere,
  p.paxadulti AS paxAdulti,
  p.paxbambini AS paxBambini,
  CONVERT(varchar(10), p.dtpartenza, 23) AS dtpartenza,
  DATEDIFF(day, p.dtarrivo, p.dtpartenza) AS notti,
  (SELECT MIN(NULLIF(LTRIM(RTRIM(tp.EstTimeArr)), '')) FROM TipoPre tp WHERE tp.codpratica = p.codpratica) AS oraArrivo,
  p.flgincasa AS inCasa,
  (SELECT TOP 1 DesProvenienza FROM PrenotaProvenienze WHERE CodProvenienza = p.CodProvenienza) AS provenienza,
  (SELECT TOP 1 t.destrat FROM Trattamenti t
   WHERE t.codtrat = COALESCE(
     (SELECT TOP 1 tp.CodArr FROM TipoPre tp WHERE tp.codpratica = p.codpratica AND ISNULL(tp.CodArr, '') <> ''),
     NULLIF(p.codarr, ''))
   ORDER BY t.CodStag DESC) AS trattamento,
  p.Note AS note
FROM Prenota p
LEFT JOIN Anagra a ON a.CodCli = p.codclinterm
WHERE p.DataEliminazione IS NULL AND ISNULL(p.flgincasa, '') <> 'P'
  AND CAST(p.dtarrivo AS date) = CAST(@data AS date)
ORDER BY a.Cognome, p.codpratica`;

const SQL_RIEPILOGO = `
SELECT
  (SELECT COUNT(*) FROM Prenota WHERE DataEliminazione IS NULL AND ISNULL(flgincasa, '') <> 'P' AND CAST(dtarrivo AS date) = CAST(@data AS date)) AS arrivi,
  (SELECT COUNT(*) FROM Prenota WHERE DataEliminazione IS NULL AND ISNULL(flgincasa, '') <> 'P' AND CAST(dtpartenza AS date) = CAST(@data AS date)) AS partenze,
  (SELECT COUNT(*) FROM Prenota WHERE DataEliminazione IS NULL AND flgincasa = 'S'
     AND CAST(dtarrivo AS date) <= CAST(@data AS date) AND CAST(dtpartenza AS date) > CAST(@data AS date)) AS presenti`;

function pulisci(v) {
  const s = (v == null ? '' : String(v)).trim();
  return s === '' ? null : s;
}

function normalizzaOra(v) {
  const s = (v == null ? '' : String(v)).trim();
  if (s === '') return null;
  if (/^[_.\s:]+$/.test(s)) return null; // placeholder tipo '__.__' o '__:__'
  return s;
}

function mapArrivo(r) {
  const nominativo = [r.cognome, r.nome]
    .map((s) => (s == null ? '' : String(s)).trim())
    .filter(Boolean)
    .join(' ') || null;
  return {
    codpratica: r.codpratica,
    nominativo,
    camere: pulisci(r.camere),
    paxAdulti: r.paxAdulti,
    paxBambini: r.paxBambini,
    dtpartenza: r.dtpartenza,
    notti: r.notti,
    oraArrivo: normalizzaOra(r.oraArrivo),
    inCasa: r.inCasa === 'S',
    provenienza: pulisci(r.provenienza),
    trattamento: pulisci(r.trattamento),
    note: pulisci(r.note),
  };
}

async function getArriviByData(pmsDb, data) {
  const rows = await pmsDb.query(SQL_ARRIVI, { data });
  return rows.map(mapArrivo);
}

async function getRiepilogoGiorno(pmsDb, data) {
  const rows = await pmsDb.query(SQL_RIEPILOGO, { data });
  const r = rows[0] || {};
  return {
    arrivi: r.arrivi || 0,
    partenze: r.partenze || 0,
    presenti: r.presenti || 0,
  };
}

module.exports = { getArriviByData, getRiepilogoGiorno };
