// Lista arrivi / clienti in casa di una data.
// Camera = COALESCE(assegnazione roomlist in AlbergDay per @data, pianificata in TipoPre).
// Tipologia camera = Camere.codtip delle camere (assegnate o pianificate).
// OSPITE = codclinterm (l'ospite reale); codcli è l'intestatario del conto/pagante.
// Trattamento (codarr, es. BB) e Tariffa (CodConvenzione) presi con COALESCE(Alberg, TipoPre).
// IMPORTO: stessa logica dello storico prenotazioni della scheda cliente (getSoggiorniCliente):
//   maturato room (Matura, via importiExpr) come importo del soggiorno; se non ancora maturato
//   si mostra il "previsto" (pianificato). Prima si usava MAX(Alberg.impoeur) per camera, che dava
//   ~una sola notte per gli ospiti già in casa.
// Una riga per prenotazione.

const { importiExpr } = require('../import/estrai');
const _imp = importiExpr('Alberg', 'p'); // maturato room/extra (Matura + StorMatura)

// Totale PIANIFICATO (previsto) del soggiorno. TipoPre.ImpoEur è una tariffa A NOTTE:
// il totale = SUM(ImpoEur × notti-della-riga × qta). Fallback su Alberg (impoeur a notte
// × notti prenotazione) se TipoPre è vuoto. prat = alias Prenota (es. 'p').
function pianificatoExpr(prat) {
  const notti = `DATEDIFF(day, ${prat}.dtarrivo, ${prat}.dtpartenza)`;
  return `COALESCE(
    NULLIF((SELECT SUM(tp.ImpoEur * ISNULL(NULLIF(DATEDIFF(day, tp.dtinizio, tp.dtfine), 0), 1) * ISNULL(NULLIF(tp.qta, 0), 1))
       FROM TipoPre tp WHERE tp.codpratica = ${prat}.codpratica), 0),
    ((SELECT ISNULL(SUM(tc.camImp), 0) FROM (SELECT MAX(al.impoeur) AS camImp
       FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb WHERE al.codpratica = ${prat}.codpratica GROUP BY ad.codcam) tc) * ${notti})
  )`;
}

// Colonne arricchite condivise da arrivi e "in casa" (riferiscono p e @data).
const COLONNE = `
  COALESCE(
    (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam
       FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = p.codpratica AND ISNULL(ad.codcam,'') <> ''
         AND CAST(@data AS date) >= CAST(ad.dtarrivo AS date)
         AND CAST(@data AS date) <= CAST(ad.dtpartenza AS date)
       FOR XML PATH('')), 1, 2, '')),
    (SELECT STUFF((SELECT DISTINCT ', ' + tp.codcam
       FROM TipoPre tp WHERE tp.codpratica = p.codpratica AND ISNULL(tp.codcam,'') <> ''
       FOR XML PATH('')), 1, 2, ''))
  ) AS camere,
  (SELECT STUFF((SELECT DISTINCT ', ' + cm.codtip
     FROM Camere cm
     WHERE ISNULL(cm.codtip, '') <> '' AND cm.codcam IN (
       SELECT ad.codcam FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb
         WHERE al.codpratica = p.codpratica AND ISNULL(ad.codcam, '') <> ''
           AND CAST(@data AS date) >= CAST(ad.dtarrivo AS date) AND CAST(@data AS date) <= CAST(ad.dtpartenza AS date)
       UNION
       SELECT tp.codcam FROM TipoPre tp WHERE tp.codpratica = p.codpratica AND ISNULL(tp.codcam, '') <> ''
     )
     FOR XML PATH('')), 1, 2, '')) AS tipologie,
  p.paxadulti AS paxAdulti,
  p.paxbambini AS paxBambini,
  (SELECT MIN(NULLIF(LTRIM(RTRIM(tp.EstTimeArr)), '')) FROM TipoPre tp WHERE tp.codpratica = p.codpratica) AS oraArrivo,
  p.flgincasa AS inCasa,
  COALESCE(
    (SELECT TOP 1 al.codarr FROM Alberg al WHERE al.codpratica = p.codpratica AND ISNULL(al.codarr, '') <> ''),
    (SELECT TOP 1 tp.CodArr FROM TipoPre tp WHERE tp.codpratica = p.codpratica AND ISNULL(tp.CodArr, '') <> ''),
    NULLIF(p.codarr, '')) AS trattamento,
  COALESCE(
    (SELECT STUFF((SELECT DISTINCT ', ' + al.CodConvenzione
       FROM Alberg al WHERE al.codpratica = p.codpratica AND ISNULL(al.CodConvenzione, '') <> ''
       FOR XML PATH('')), 1, 2, '')),
    (SELECT STUFF((SELECT DISTINCT ', ' + tp.CodConvenzione
       FROM TipoPre tp WHERE tp.codpratica = p.codpratica AND ISNULL(tp.CodConvenzione, '') <> ''
       FOR XML PATH('')), 1, 2, ''))
  ) AS tariffa,
  ${_imp.arrangiamento} AS arrangiamento,
  ${_imp.extra} AS extra,
  ${pianificatoExpr('p')} AS pianificato,
  CONVERT(varchar(10), p.dtprenota, 23) AS dtPrenota,
  (SELECT al.codcli AS codCli,
     LTRIM(RTRIM(ISNULL(a2.Cognome, '') + ' ' + ISNULL(a2.Nome, ''))) AS nominativo,
     MAX(ad.codcam) AS camera
   FROM Alberg al
   LEFT JOIN Anagra a2 ON a2.CodCli = al.codcli
   LEFT JOIN AlbergDay ad ON ad.codalb = al.codalb AND ISNULL(ad.codcam, '') <> ''
   WHERE al.codpratica = p.codpratica AND al.codcli IS NOT NULL
   GROUP BY al.codcli, LTRIM(RTRIM(ISNULL(a2.Cognome, '') + ' ' + ISNULL(a2.Nome, '')))
   FOR JSON PATH) AS ospitiJson,
  p.Note AS note`;

// Arrivi della data: prenotazioni con dtarrivo = @data (esclusi i 'P' partiti).
const SQL_ARRIVI = `
SELECT
  p.codpratica,
  p.codclinterm AS codCliente,
  a.Cognome AS cognome,
  a.Nome AS nome,
  CONVERT(varchar(10), p.dtarrivo, 23) AS dtarrivo,
  CONVERT(varchar(10), p.dtpartenza, 23) AS dtpartenza,
  DATEDIFF(day, p.dtarrivo, p.dtpartenza) AS notti,
  ${COLONNE}
FROM Prenota p
LEFT JOIN Anagra a ON a.CodCli = p.codclinterm
WHERE p.DataEliminazione IS NULL AND ISNULL(p.flgincasa, '') <> 'P'
  AND CAST(p.dtarrivo AS date) = CAST(@data AS date)
ORDER BY a.Cognome, p.codpratica`;

// Clienti in casa alla data: check-in fatto (flgincasa='S') e @data nel soggiorno [arrivo, partenza).
const SQL_INCASA = `
SELECT
  p.codpratica,
  p.codclinterm AS codCliente,
  a.Cognome AS cognome,
  a.Nome AS nome,
  CONVERT(varchar(10), p.dtarrivo, 23) AS dtarrivo,
  CONVERT(varchar(10), p.dtpartenza, 23) AS dtpartenza,
  DATEDIFF(day, p.dtarrivo, p.dtpartenza) AS notti,
  CASE
    WHEN (SELECT TOP 1 al.flgpar FROM Alberg al WHERE al.codpratica = p.codpratica) IN ('O', 'D') THEN 'checkout'
    WHEN CAST(p.dtpartenza AS date) = CAST(@data AS date) THEN 'partenza'
    ELSE 'incasa'
  END AS statoPartenza,
  ${COLONNE}
FROM Prenota p
LEFT JOIN Anagra a ON a.CodCli = p.codclinterm
WHERE p.DataEliminazione IS NULL AND p.flgincasa = 'S'
  AND CAST(p.dtarrivo AS date) <= CAST(@data AS date)
  AND CAST(p.dtpartenza AS date) >= CAST(@data AS date)
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

// Importo del soggiorno (room): maturato se presente, altrimenti il pianificato
// ("previsto"). Stessa scelta della riga storico prenotazioni (rigaSoggiorno).
function importoSoggiorno(r) {
  const arrangiamento = r.arrangiamento == null ? 0 : Number(r.arrangiamento);
  const extra = r.extra == null ? 0 : Number(r.extra);
  const pianificato = r.pianificato == null ? 0 : Number(r.pianificato);
  if (arrangiamento + extra === 0 && pianificato > 0) return pianificato;
  return arrangiamento;
}

function mapRiga(r) {
  const nominativo = [r.cognome, r.nome]
    .map((s) => (s == null ? '' : String(s)).trim())
    .filter(Boolean)
    .join(' ') || null;
  // Occupanti della camera (righe Alberg con codcli distinti) = solo i clienti
  // effettivamente in camera. Il referente (codclinterm) NON va qui: sta in
  // intestazione. Se nessuno è assegnato, la camera resta senza occupanti.
  let ospiti = [];
  try { ospiti = r.ospitiJson ? JSON.parse(r.ospitiJson) : []; } catch (e) { ospiti = []; }
  return {
    codpratica: r.codpratica,
    codCliente: r.codCliente,
    nominativo,
    ospiti,
    camere: pulisci(r.camere),
    tipologie: pulisci(r.tipologie),
    paxAdulti: r.paxAdulti,
    paxBambini: r.paxBambini,
    dtarrivo: r.dtarrivo,
    dtpartenza: r.dtpartenza,
    dtPrenota: r.dtPrenota, // data creazione prenotazione
    notti: r.notti,
    statoPartenza: r.statoPartenza, // 'incasa' | 'partenza' | 'checkout' (solo "in casa")
    oraArrivo: normalizzaOra(r.oraArrivo),
    inCasa: r.inCasa === 'S',
    trattamento: pulisci(r.trattamento),
    tariffa: pulisci(r.tariffa),
    // Importo del soggiorno come nello storico: maturato room; se non ancora maturato → previsto.
    importo: importoSoggiorno(r),
    extra: r.extra == null ? 0 : Number(r.extra),
    note: pulisci(r.note),
  };
}

async function getArriviByData(pmsDb, data) {
  const rows = await pmsDb.query(SQL_ARRIVI, { data });
  return rows.map(mapRiga);
}

async function getInCasaByData(pmsDb, data) {
  const rows = await pmsDb.query(SQL_INCASA, { data });
  return rows.map(mapRiga);
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

// Data di lavoro del PMS (business date), da Persona.Dataggio. Formato 'YYYY-MM-DD'.
async function getDataLavoro(pmsDb) {
  const rows = await pmsDb.query('SELECT TOP 1 CONVERT(varchar(10), Dataggio, 23) AS data FROM Persona', {});
  return rows[0] && rows[0].data ? rows[0].data : null;
}

module.exports = { getArriviByData, getInCasaByData, getRiepilogoGiorno, getDataLavoro, pianificatoExpr };
