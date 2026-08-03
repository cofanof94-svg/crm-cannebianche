// Rilevamento anagrafiche duplicate nel PMS (SOLO SELECT).
//
// Due criteri: (a) stesso Codice Fiscale non vuoto (alta confidenza); (b) stesso
// Cognome+Nome+data di nascita (intercetta anche i casi con CF diversi/mancanti,
// es. lo stesso ospite inserito con CF italiano e CF estero). La conferma della
// fusione resta all'operatore.

const SQL_CANDIDATI = `
SELECT a.CodCli AS codCli, a.Cognome, a.Nome,
  CONVERT(varchar(10), a.dtNascita, 23) AS dtNascita, a.CodFis AS codiceFiscale,
  CASE WHEN ISNULL(a.CodFis,'') <> '' AND a.CodFis = me.CodFis THEN 'CF' ELSE 'anagrafica' END AS match,
  (SELECT COUNT(1) FROM Prenota p WHERE p.codclinterm = a.CodCli)
    + (SELECT COUNT(1) FROM StorPrenota sp WHERE sp.codclinterm = a.CodCli) AS nPrenotazioni
FROM Anagra a
CROSS JOIN (SELECT CodFis, Cognome, Nome, dtNascita FROM Anagra WHERE CodCli = @codCli) me
WHERE a.CodCli <> @codCli AND (
  (ISNULL(a.CodFis,'') <> '' AND a.CodFis = me.CodFis)
  OR (a.dtNascita IS NOT NULL AND a.dtNascita = me.dtNascita
      AND a.Cognome = me.Cognome AND a.Nome = me.Nome)
)
ORDER BY nPrenotazioni DESC`;

const SQL_TUTTI_GRUPPI = `
SELECT 'CF' AS tipo, MAX(Cognome) AS cognome, MAX(Nome) AS nome, CodFis AS chiave,
  COUNT(1) AS n, STRING_AGG(CAST(CodCli AS varchar(12)), ',') AS membri
FROM Anagra WHERE ISNULL(CodFis,'') <> '' GROUP BY CodFis HAVING COUNT(1) > 1
UNION ALL
SELECT 'anagrafica', Cognome, Nome,
  CONCAT(Cognome, '|', Nome, '|', CONVERT(varchar(10), dtNascita, 23)),
  COUNT(1), STRING_AGG(CAST(CodCli AS varchar(12)), ',')
FROM Anagra WHERE ISNULL(Cognome,'') <> '' AND dtNascita IS NOT NULL
GROUP BY Cognome, Nome, dtNascita HAVING COUNT(1) > 1`;

function pulisci(v) {
  const s = (v == null ? '' : String(v)).trim();
  return s === '' ? null : s;
}
const nominativo = (cog, nom) => [cog, nom].map((s) => (s == null ? '' : String(s)).trim()).filter(Boolean).join(' ') || null;

async function getDuplicatiCandidati(pmsDb, codCli) {
  const rows = await pmsDb.query(SQL_CANDIDATI, { codCli });
  return rows.map((r) => ({
    codCli: r.codCli,
    nominativo: nominativo(r.Cognome, r.Nome),
    dtNascita: pulisci(r.dtNascita),
    codiceFiscale: pulisci(r.codiceFiscale),
    match: r.match,
    nPrenotazioni: Number(r.nPrenotazioni) || 0,
  }));
}

async function getTuttiGruppiDuplicati(pmsDb) {
  const rows = await pmsDb.query(SQL_TUTTI_GRUPPI);
  return rows.map((r) => ({
    tipo: r.tipo,
    nominativo: nominativo(r.cognome, r.nome),
    membri: String(r.membri || '').split(',').map((s) => Number(s)).filter(Number.isInteger),
    n: Number(r.n) || 0,
  }));
}

module.exports = { getDuplicatiCandidati, getTuttiGruppiDuplicati };
