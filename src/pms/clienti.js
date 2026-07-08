// cameraInCasa: camera(e) se l'ospite è in casa alla data di lavoro (Persona.Dataggio), altrimenti NULL.
const SQL_CERCA = `
DECLARE @dlav date = (SELECT TOP 1 Dataggio FROM Persona);
SELECT TOP 20 a.CodCli, a.Cognome, a.Nome, a.email, a.Cellulare, a.Telefono, a.Citta,
  (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam
      FROM Prenota p
      JOIN Alberg al ON al.codpratica = p.codpratica
      JOIN AlbergDay ad ON ad.codalb = al.codalb
      WHERE p.codclinterm = a.CodCli AND p.DataEliminazione IS NULL AND p.flgincasa = 'S'
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
  t.camere, t.importo, t.stato
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
    CASE WHEN p.flgincasa = 'S' THEN 'In casa' WHEN p.flgincasa = 'P' THEN 'Partito' ELSE 'Confermato' END AS stato
  FROM Prenota p
  WHERE p.codclinterm = @codCli AND p.DataEliminazione IS NULL
  UNION ALL
  SELECT sp.codpratica, sp.dtarrivo, sp.dtpartenza,
    (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam FROM StorAlberg al JOIN StorAlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = sp.codpratica AND ISNULL(ad.codcam,'') <> '' FOR XML PATH('')), 1, 2, '')) AS camere,
    (SELECT SUM(tc.camImp) FROM (SELECT MAX(al.impoeur) AS camImp
       FROM StorAlberg al JOIN StorAlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = sp.codpratica GROUP BY ad.codcam) tc) AS importo,
    'Concluso' AS stato
  FROM StorPrenota sp
  WHERE sp.codclinterm = @codCli
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
  return rows.map((r) => ({
    codpratica: r.codpratica,
    dtarrivo: r.dtarrivo,
    dtpartenza: r.dtpartenza,
    notti: r.notti,
    camere: pulisci(r.camere),
    importo: r.importo == null ? null : Number(r.importo),
    stato: r.stato,
  }));
}

module.exports = { cercaClienti, getCliente, getSoggiorniCliente };
