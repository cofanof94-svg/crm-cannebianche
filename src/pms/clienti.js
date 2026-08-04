const { importiExpr } = require('../import/estrai');
const { inClause } = require('../db/query');

// cameraInCasa: camera(e) se l'ospite è in casa alla data di lavoro (Persona.Dataggio), altrimenti NULL.
const SQL_CERCA = `
DECLARE @dlav date = (SELECT TOP 1 Dataggio FROM Persona);
SELECT TOP 20 a.CodCli, a.Cognome, a.Nome, a.email, a.Cellulare, a.Telefono, a.Citta,
  (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam
      FROM Prenota p
      JOIN Alberg al ON al.codpratica = p.codpratica
      JOIN AlbergDay ad ON ad.codalb = al.codalb
      WHERE al.codcli = a.CodCli AND p.DataEliminazione IS NULL AND p.flgincasa = 'S'
        AND CAST(p.dtarrivo AS date) <= @dlav AND CAST(p.dtpartenza AS date) >= @dlav
        AND ISNULL(ad.codcam,'') <> ''
        AND @dlav >= CAST(ad.dtarrivo AS date) AND @dlav <= CAST(ad.dtpartenza AS date)
      FOR XML PATH('')), 1, 2, '')) AS cameraInCasa
FROM Anagra a
WHERE (a.Cognome LIKE @q OR a.Nome LIKE @q OR a.email LIKE @q OR a.Cellulare LIKE @q
   OR (ISNULL(a.Cognome,'') + ' ' + ISNULL(a.Nome,'')) LIKE @q)
  AND (ISNULL(a.Cognome,'') <> '' OR ISNULL(a.Nome,'') <> '')
ORDER BY a.Cognome, a.Nome`;

// VIP: CodVip è una classificazione (non un livello gerarchico) decodificata da
// TabVip.desvip (es. 'V1'→'BOLLICINE + FRUTTA FRESCA', 'IN'→'OSPITE INDESIDERATO').
const SQL_CLIENTE = `
SELECT a.CodCli, a.Cognome, a.Nome, a.Telefono, a.Cellulare, a.email, a.Citta, a.CodNaz,
       CONVERT(varchar(10), a.dtNascita, 23) AS dtNascita, a.CodFis, a.CodVip, tv.desvip AS DesVip, a.Annotazioni,
       a.Privacy, a.Privacy2, a.PrivacyConservaDati, a.PrivacyCessioneDati
FROM Anagra a
LEFT JOIN TabVip tv ON LTRIM(RTRIM(tv.codvip)) = LTRIM(RTRIM(a.CodVip)) AND ISNULL(a.CodVip,'') <> ''
WHERE a.CodCli = @codCli`;

// Storico soggiorni: correnti (Prenota) UNION storici (StorPrenota).
// Importi arr/extra calcolati PER PRATICA con importiExpr (STESSA logica dell'import
// src/import/estrai.js): catturano i consumi anche quando la camera non è ancora
// assegnata in roomlist, così scheda live e snapshot coincidono. City tax esclusa.
const _impP = importiExpr('Alberg', 'p');
const _impS = importiExpr('StorAlberg', 'sp');
const sqlSoggiorni = (inl) => `
DECLARE @dlav date = (SELECT TOP 1 Dataggio FROM Persona);
SELECT t.codpratica,
  CONVERT(varchar(10), t.dtarrivo, 23) AS dtarrivo,
  CONVERT(varchar(10), t.dtpartenza, 23) AS dtpartenza,
  DATEDIFF(day, t.dtarrivo, t.dtpartenza) AS notti,
  t.camere, t.stato, t.source, t.mercato, t.arrangiamento, t.extra, t.pianificato, t.ospitiJson
FROM (
  SELECT p.codpratica, p.dtarrivo, p.dtpartenza,
    COALESCE(
      (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb
         WHERE al.codpratica = p.codpratica AND ISNULL(ad.codcam,'') <> '' FOR XML PATH('')), 1, 2, '')),
      (SELECT STUFF((SELECT DISTINCT ', ' + tp.codcam FROM TipoPre tp
         WHERE tp.codpratica = p.codpratica AND ISNULL(tp.codcam,'') <> '' FOR XML PATH('')), 1, 2, ''))
    ) AS camere,
    CASE WHEN p.flgincasa = 'S' THEN 'In casa' WHEN p.flgincasa = 'P' THEN 'Partito'
         WHEN CAST(p.dtarrivo AS date) > @dlav THEN 'Pianificata'
         WHEN CAST(p.dtarrivo AS date) < @dlav THEN 'No-show'
         ELSE 'Confermato' END AS stato,
    (SELECT TOP 1 src.DesSource FROM SourcePrenota src WHERE src.CodSource = p.CodSource) AS source,
    (SELECT TOP 1 prov.DesProvenienza FROM PrenotaProvenienze prov WHERE prov.CodProvenienza = p.CodProvenienza) AS mercato,
    ${_impP.arrangiamento} AS arrangiamento,
    ${_impP.extra} AS extra,
    COALESCE(
      (SELECT SUM(tc.camImp) FROM (SELECT MAX(al.impoeur) AS camImp FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb
         WHERE al.codpratica = p.codpratica GROUP BY ad.codcam) tc),
      (SELECT SUM(tp.ImpoEur) FROM TipoPre tp WHERE tp.codpratica = p.codpratica)
    ) AS pianificato,
    (SELECT al.codcli AS codCli, LTRIM(RTRIM(ISNULL(a2.Cognome, '') + ' ' + ISNULL(a2.Nome, ''))) AS nominativo, MAX(ad.codcam) AS camera
     FROM Alberg al LEFT JOIN Anagra a2 ON a2.CodCli = al.codcli LEFT JOIN AlbergDay ad ON ad.codalb = al.codalb AND ISNULL(ad.codcam, '') <> ''
     WHERE al.codpratica = p.codpratica AND al.codcli IS NOT NULL
     GROUP BY al.codcli, LTRIM(RTRIM(ISNULL(a2.Cognome, '') + ' ' + ISNULL(a2.Nome, ''))) FOR JSON PATH) AS ospitiJson
  FROM Prenota p
  WHERE p.DataEliminazione IS NULL
    AND NOT EXISTS (SELECT 1 FROM StorPrenota spx WHERE spx.codpratica = p.codpratica) -- dedup: se archiviata, vince StorPrenota
    AND (p.codclinterm IN ${inl}
    OR EXISTS (SELECT 1 FROM Alberg alo WHERE alo.codpratica = p.codpratica AND alo.codcli IN ${inl}))
  UNION ALL
  SELECT sp.codpratica, sp.dtarrivo, sp.dtpartenza,
    (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam FROM StorAlberg al JOIN StorAlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = sp.codpratica AND ISNULL(ad.codcam,'') <> '' FOR XML PATH('')), 1, 2, '')) AS camere,
    CASE WHEN sp.DataEliminazione IS NOT NULL THEN 'Eliminata' ELSE 'Concluso' END AS stato,
    (SELECT TOP 1 src.DesSource FROM SourcePrenota src WHERE src.CodSource = sp.CodSource) AS source,
    (SELECT TOP 1 prov.DesProvenienza FROM PrenotaProvenienze prov WHERE prov.CodProvenienza = sp.CodProvenienza) AS mercato,
    ${_impS.arrangiamento} AS arrangiamento,
    ${_impS.extra} AS extra,
    (SELECT SUM(tc.camImp) FROM (SELECT MAX(al.impoeur) AS camImp FROM StorAlberg al JOIN StorAlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = sp.codpratica GROUP BY ad.codcam) tc) AS pianificato,
    (SELECT al.codcli AS codCli, LTRIM(RTRIM(ISNULL(a2.Cognome, '') + ' ' + ISNULL(a2.Nome, ''))) AS nominativo, MAX(ad.codcam) AS camera
     FROM StorAlberg al LEFT JOIN Anagra a2 ON a2.CodCli = al.codcli LEFT JOIN StorAlbergDay ad ON ad.codalb = al.codalb AND ISNULL(ad.codcam, '') <> ''
     WHERE al.codpratica = sp.codpratica AND al.codcli IS NOT NULL
     GROUP BY al.codcli, LTRIM(RTRIM(ISNULL(a2.Cognome, '') + ' ' + ISNULL(a2.Nome, ''))) FOR JSON PATH) AS ospitiJson
  FROM StorPrenota sp
  WHERE sp.codclinterm IN ${inl}
    OR EXISTS (SELECT 1 FROM StorAlberg alo WHERE alo.codpratica = sp.codpratica AND alo.codcli IN ${inl})
) t
ORDER BY t.dtarrivo DESC`;

function pulisci(v) {
  const s = (v == null ? '' : String(v)).trim();
  return s === '' ? null : s;
}

function nominativo(cognome, nome) {
  return [cognome, nome].map((s) => (s == null ? '' : String(s)).trim()).filter(Boolean).join(' ') || null;
}

// Info VIP: cod = classificazione (TabVip), descrizione = testo leggibile (fallback
// al codice). indesiderato = flag negativo riconosciuto dalla DESCRIZIONE
// ("OSPITE INDESIDERATO"), non da un elenco hardcoded di codici → robusto ai cambi.
function vipInfo(codVip, desVip) {
  const cod = pulisci(codVip);
  if (!cod) return null;
  const descrizione = pulisci(desVip) || cod;
  return { cod, descrizione, indesiderato: /indesiderat/i.test(descrizione) };
}

async function cercaClienti(pmsDb, termine) {
  const rows = await pmsDb.query(SQL_CERCA, { q: `%${(termine || '').trim()}%` });
  return rows.map((r) => ({
    codCli: r.CodCli,
    nominativo: nominativo(r.Cognome, r.Nome),
    email: pulisci(r.email),
    cellulare: pulisci(r.Cellulare),
    telefono: pulisci(r.Telefono),
    citta: pulisci(r.Citta),
    cameraInCasa: pulisci(r.cameraInCasa),
  }));
}

async function getCliente(pmsDb, codCli) {
  const rows = await pmsDb.query(SQL_CLIENTE, { codCli });
  const r = rows[0];
  if (!r) return null;
  return {
    codCli: r.CodCli,
    cognome: pulisci(r.Cognome),
    nome: pulisci(r.Nome),
    nominativo: nominativo(r.Cognome, r.Nome),
    telefono: pulisci(r.Telefono),
    cellulare: pulisci(r.Cellulare),
    email: pulisci(r.email),
    citta: pulisci(r.Citta),
    nazione: pulisci(r.CodNaz),
    dtNascita: pulisci(r.dtNascita),
    codiceFiscale: pulisci(r.CodFis),
    vip: vipInfo(r.CodVip, r.DesVip),
    note: pulisci(r.Annotazioni),
    // Nel PMS la logica è invertita: 'S' = NON autorizzato. Quindi il consenso
    // è concesso quando il valore è diverso da 'S' (es. 'N' o vuoto).
    consensi: {
      marketing: r.Privacy !== 'S',
      telefonate: r.Privacy2 !== 'S',
      conservazione: r.PrivacyConservaDati !== 'S',
      cessione: r.PrivacyCessioneDati !== 'S',
    },
  };
}

// ids: codice singolo o array di codici del gruppo (anagrafiche fuse).
async function getSoggiorniCliente(pmsDb, ids) {
  const rows = await pmsDb.query(sqlSoggiorni(inClause(ids)), {});
  return rows.map((r) => {
    let ospiti = [];
    try { ospiti = r.ospitiJson ? JSON.parse(r.ospitiJson) : []; } catch (e) { ospiti = []; }
    const arrangiamento = r.arrangiamento == null ? 0 : Number(r.arrangiamento);
    const extra = r.extra == null ? 0 : Number(r.extra);
    return {
      codpratica: r.codpratica,
      dtarrivo: r.dtarrivo,
      dtpartenza: r.dtpartenza,
      notti: r.notti,
      camere: pulisci(r.camere),
      importo: arrangiamento, // = arrangiamento (compat)
      arrangiamento,
      extra,
      pianificato: r.pianificato == null ? 0 : Number(r.pianificato), // tariffa pianificata (per "previsto" quando maturato=0)
      stato: r.stato,
      source: pulisci(r.source),
      mercato: pulisci(r.mercato),
      ospiti,
    };
  });
}

module.exports = { cercaClienti, getCliente, getSoggiorniCliente };
