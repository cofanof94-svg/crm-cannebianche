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

const SQL_CLIENTE = `
SELECT CodCli, Cognome, Nome, Telefono, Cellulare, email, Citta, CodNaz,
       CONVERT(varchar(10), dtNascita, 23) AS dtNascita, CodFis, CodVip, Annotazioni,
       Privacy, Privacy2, PrivacyConservaDati, PrivacyCessioneDati
FROM Anagra WHERE CodCli = @codCli`;

// Storico soggiorni: correnti (Prenota + Alberg/TipoPre) UNION storici (StorPrenota + StorAlberg).
const SQL_SOGGIORNI = `
SELECT t.codpratica,
  CONVERT(varchar(10), t.dtarrivo, 23) AS dtarrivo,
  CONVERT(varchar(10), t.dtpartenza, 23) AS dtpartenza,
  DATEDIFF(day, t.dtarrivo, t.dtpartenza) AS notti,
  t.camere, t.importo, t.stato, t.ospitiJson, t.camereJson
FROM (
  SELECT p.codpratica, p.dtarrivo, p.dtpartenza,
    COALESCE(
      (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb
         WHERE al.codpratica = p.codpratica AND ISNULL(ad.codcam,'') <> '' FOR XML PATH('')), 1, 2, '')),
      (SELECT STUFF((SELECT DISTINCT ', ' + tp.codcam FROM TipoPre tp
         WHERE tp.codpratica = p.codpratica AND ISNULL(tp.codcam,'') <> '' FOR XML PATH('')), 1, 2, ''))
    ) AS camere,
    COALESCE(
      (SELECT SUM(tc.camImp) FROM (SELECT MAX(al.impoeur) AS camImp
         FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb
         WHERE al.codpratica = p.codpratica GROUP BY ad.codcam) tc),
      (SELECT SUM(tp.ImpoEur) FROM TipoPre tp WHERE tp.codpratica = p.codpratica)
    ) AS importo,
    CASE WHEN p.flgincasa = 'S' THEN 'In casa' WHEN p.flgincasa = 'P' THEN 'Partito' ELSE 'Confermato' END AS stato,
    (SELECT al.codcli AS codCli, LTRIM(RTRIM(ISNULL(a2.Cognome, '') + ' ' + ISNULL(a2.Nome, ''))) AS nominativo, MAX(ad.codcam) AS camera
     FROM Alberg al LEFT JOIN Anagra a2 ON a2.CodCli = al.codcli LEFT JOIN AlbergDay ad ON ad.codalb = al.codalb AND ISNULL(ad.codcam, '') <> ''
     WHERE al.codpratica = p.codpratica AND al.codcli IS NOT NULL
     GROUP BY al.codcli, LTRIM(RTRIM(ISNULL(a2.Cognome, '') + ' ' + ISNULL(a2.Nome, ''))) FOR JSON PATH) AS ospitiJson,
    (SELECT cc.camera,
       ((SELECT ISNULL(SUM(m.impoeur), 0) FROM Matura m WHERE m.codalb IN (
            SELECT alx.codalb FROM Alberg alx JOIN AlbergDay adx ON adx.codalb = alx.codalb WHERE alx.codpratica = p.codpratica AND adx.codcam = cc.camera)
          AND LTRIM(RTRIM(ISNULL(m.codarr, ''))) <> '')
        + (SELECT ISNULL(SUM(m.impoeur), 0) FROM StorMatura m WHERE m.codalb IN (
            SELECT alx.codalb FROM Alberg alx JOIN AlbergDay adx ON adx.codalb = alx.codalb WHERE alx.codpratica = p.codpratica AND adx.codcam = cc.camera)
          AND LTRIM(RTRIM(ISNULL(m.codarr, ''))) <> '')) AS arrangiamento,
       ((SELECT ISNULL(SUM(m.impoeur), 0) FROM Matura m WHERE m.codalb IN (
            SELECT alx.codalb FROM Alberg alx JOIN AlbergDay adx ON adx.codalb = alx.codalb WHERE alx.codpratica = p.codpratica AND adx.codcam = cc.camera)
          AND LTRIM(RTRIM(ISNULL(m.codarr, ''))) = '' AND ISNULL(m.flgDistintaArr, '') <> 'S')
        + (SELECT ISNULL(SUM(m.impoeur), 0) FROM StorMatura m WHERE m.codalb IN (
            SELECT alx.codalb FROM Alberg alx JOIN AlbergDay adx ON adx.codalb = alx.codalb WHERE alx.codpratica = p.codpratica AND adx.codcam = cc.camera)
          AND LTRIM(RTRIM(ISNULL(m.codarr, ''))) = '' AND ISNULL(m.flgDistintaArr, '') <> 'S')) AS extra
     FROM (SELECT DISTINCT ad.codcam AS camera FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb
           WHERE al.codpratica = p.codpratica) cc
     FOR JSON PATH) AS camereJson
  FROM Prenota p
  WHERE p.DataEliminazione IS NULL AND (p.codclinterm = @codCli
    OR EXISTS (SELECT 1 FROM Alberg alo WHERE alo.codpratica = p.codpratica AND alo.codcli = @codCli))
  UNION ALL
  SELECT sp.codpratica, sp.dtarrivo, sp.dtpartenza,
    (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam FROM StorAlberg al JOIN StorAlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = sp.codpratica AND ISNULL(ad.codcam,'') <> '' FOR XML PATH('')), 1, 2, '')) AS camere,
    (SELECT SUM(tc.camImp) FROM (SELECT MAX(al.impoeur) AS camImp
       FROM StorAlberg al JOIN StorAlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = sp.codpratica GROUP BY ad.codcam) tc) AS importo,
    CASE WHEN sp.DataEliminazione IS NOT NULL THEN 'Eliminata' ELSE 'Concluso' END AS stato,
    (SELECT al.codcli AS codCli, LTRIM(RTRIM(ISNULL(a2.Cognome, '') + ' ' + ISNULL(a2.Nome, ''))) AS nominativo, MAX(ad.codcam) AS camera
     FROM StorAlberg al LEFT JOIN Anagra a2 ON a2.CodCli = al.codcli LEFT JOIN StorAlbergDay ad ON ad.codalb = al.codalb AND ISNULL(ad.codcam, '') <> ''
     WHERE al.codpratica = sp.codpratica AND al.codcli IS NOT NULL
     GROUP BY al.codcli, LTRIM(RTRIM(ISNULL(a2.Cognome, '') + ' ' + ISNULL(a2.Nome, ''))) FOR JSON PATH) AS ospitiJson,
    (SELECT cc.camera,
       ((SELECT ISNULL(SUM(m.impoeur), 0) FROM Matura m WHERE m.codalb IN (
            SELECT alx.codalb FROM StorAlberg alx JOIN StorAlbergDay adx ON adx.codalb = alx.codalb WHERE alx.codpratica = sp.codpratica AND adx.codcam = cc.camera)
          AND LTRIM(RTRIM(ISNULL(m.codarr, ''))) <> '')
        + (SELECT ISNULL(SUM(m.impoeur), 0) FROM StorMatura m WHERE m.codalb IN (
            SELECT alx.codalb FROM StorAlberg alx JOIN StorAlbergDay adx ON adx.codalb = alx.codalb WHERE alx.codpratica = sp.codpratica AND adx.codcam = cc.camera)
          AND LTRIM(RTRIM(ISNULL(m.codarr, ''))) <> '')) AS arrangiamento,
       ((SELECT ISNULL(SUM(m.impoeur), 0) FROM Matura m WHERE m.codalb IN (
            SELECT alx.codalb FROM StorAlberg alx JOIN StorAlbergDay adx ON adx.codalb = alx.codalb WHERE alx.codpratica = sp.codpratica AND adx.codcam = cc.camera)
          AND LTRIM(RTRIM(ISNULL(m.codarr, ''))) = '' AND ISNULL(m.flgDistintaArr, '') <> 'S')
        + (SELECT ISNULL(SUM(m.impoeur), 0) FROM StorMatura m WHERE m.codalb IN (
            SELECT alx.codalb FROM StorAlberg alx JOIN StorAlbergDay adx ON adx.codalb = alx.codalb WHERE alx.codpratica = sp.codpratica AND adx.codcam = cc.camera)
          AND LTRIM(RTRIM(ISNULL(m.codarr, ''))) = '' AND ISNULL(m.flgDistintaArr, '') <> 'S')) AS extra
     FROM (SELECT DISTINCT ad.codcam AS camera FROM StorAlberg al JOIN StorAlbergDay ad ON ad.codalb = al.codalb
           WHERE al.codpratica = sp.codpratica) cc
     FOR JSON PATH) AS camereJson
  FROM StorPrenota sp
  WHERE sp.codclinterm = @codCli
    OR EXISTS (SELECT 1 FROM StorAlberg alo WHERE alo.codpratica = sp.codpratica AND alo.codcli = @codCli)
) t
ORDER BY t.dtarrivo DESC`;

function pulisci(v) {
  const s = (v == null ? '' : String(v)).trim();
  return s === '' ? null : s;
}

function nominativo(cognome, nome) {
  return [cognome, nome].map((s) => (s == null ? '' : String(s)).trim()).filter(Boolean).join(' ') || null;
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
    vip: pulisci(r.CodVip) != null,
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

async function getSoggiorniCliente(pmsDb, codCli) {
  const rows = await pmsDb.query(SQL_SOGGIORNI, { codCli });
  return rows.map((r) => {
    let ospiti = [];
    try { ospiti = r.ospitiJson ? JSON.parse(r.ospitiJson) : []; } catch (e) { ospiti = []; }
    let camereDett = [];
    try { camereDett = r.camereJson ? JSON.parse(r.camereJson) : []; } catch (e) { camereDett = []; }
    camereDett = camereDett.map((c) => ({
      camera: c.camera,
      arrangiamento: c.arrangiamento == null ? 0 : Number(c.arrangiamento),
      extra: c.extra == null ? 0 : Number(c.extra),
    }));
    const arrangiamento = camereDett.reduce((s, c) => s + c.arrangiamento, 0);
    const extra = camereDett.reduce((s, c) => s + c.extra, 0);
    return {
      codpratica: r.codpratica,
      dtarrivo: r.dtarrivo,
      dtpartenza: r.dtpartenza,
      notti: r.notti,
      camere: pulisci(r.camere),
      importo: arrangiamento, // = arrangiamento (compat)
      arrangiamento,
      extra,
      camereDett,
      stato: r.stato,
      ospiti,
    };
  });
}

module.exports = { cercaClienti, getCliente, getSoggiorniCliente };
