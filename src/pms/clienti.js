const { importiExpr } = require('../import/estrai');
const { inClause } = require('../db/query');
const { pianificatoExpr } = require('./prenotazioni');
const { getImportiPrenotazioni } = require('./importo');

// cameraInCasa: camera(e) se l'ospite è in casa alla data di lavoro (Persona.Dataggio), altrimenti NULL.
// Ricerca stile rubrica: ogni parola digitata (token) deve comparire nel testo
// dell'ospite, in QUALSIASI ordine (Nome Cognome o Cognome Nome), con match
// parziale. hs.h è un "haystack" normalizzato: cognome+nome+email+telefoni senza
// spazi/apostrofi/trattini/punti e COLLATE ..._CI_AI → case- e accent-insensitive.
const SQL_CERCA_HEAD = `
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
CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(REPLACE(
  ISNULL(a.Cognome,'') + ISNULL(a.Nome,'') + ISNULL(a.email,'') + ISNULL(a.Cellulare,'') + ISNULL(a.Telefono,'')
  , ' ', ''), CHAR(39), ''), '-', ''), '.', '') COLLATE Latin1_General_CI_AI AS h) hs
WHERE (ISNULL(a.Cognome,'') <> '' OR ISNULL(a.Nome,'') <> '')`;

// Compone la WHERE: un LIKE per token, tutti in AND (ordine-indipendente).
function sqlCerca(nToken) {
  const conds = Array.from({ length: nToken }, (_, i) => `hs.h LIKE @t${i}`).join(' AND ');
  return `${SQL_CERCA_HEAD}\n  AND ${conds}\nORDER BY a.Cognome, a.Nome`;
}

// Le stesse colonne della ricerca, ma per codici noti. Serve quando la ricerca
// trova un'anagrafica COLLEGATA a un'altra: al suo posto si mostra il principale,
// che però potrebbe non essere fra i risultati (il termine cercato è il vecchio
// nome). Senza questa lettura, cercare il nome vecchio non troverebbe più nulla.
const sqlCercaByIds = (inl) => `${SQL_CERCA_HEAD}
  AND a.CodCli IN ${inl}
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
    ${pianificatoExpr('p')} AS pianificato,
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
    ((SELECT ISNULL(SUM(tc.camImp), 0) FROM (SELECT MAX(al.impoeur) AS camImp FROM StorAlberg al JOIN StorAlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = sp.codpratica GROUP BY ad.codcam) tc) * DATEDIFF(day, sp.dtarrivo, sp.dtpartenza)) AS pianificato,
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

// Spezza il testo in token: toglie separatori (apostrofi/punti/trattini) e fa
// l'escape dei caratteri jolly di LIKE (% _ [). Max 6 token.
function normalizeTokens(termine) {
  return String(termine || '')
    .split(/\s+/)
    .map((t) => t.replace(/['’.\-]/g, '').trim())
    .filter(Boolean)
    .map((t) => t.replace(/[%_[]/g, (c) => `[${c}]`))
    .slice(0, 6);
}

// Una riga di risultato: la stessa forma per la ricerca per testo e per quella
// per codice, così le due strade non possono divergere.
const rigaRicerca = (r) => ({
  codCli: r.CodCli,
  nominativo: nominativo(r.Cognome, r.Nome),
  email: pulisci(r.email),
  cellulare: pulisci(r.Cellulare),
  telefono: pulisci(r.Telefono),
  citta: pulisci(r.Citta),
  cameraInCasa: pulisci(r.cameraInCasa),
});

async function cercaClienti(pmsDb, termine) {
  const tokens = normalizeTokens(termine);
  if (!tokens.length) return [];
  const params = {};
  tokens.forEach((t, i) => { params[`t${i}`] = `%${t}%`; });
  const rows = await pmsDb.query(sqlCerca(tokens.length), params);
  return rows.map(rigaRicerca);
}

// Anagrafiche per codice, nella forma dei risultati di ricerca.
async function getClientiRicercaByIds(pmsDb, ids) {
  const arr = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isInteger))];
  if (!arr.length) return [];
  const rows = await pmsDb.query(sqlCercaByIds(inClause(arr)), {});
  return rows.map(rigaRicerca);
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

// Prenotazioni "concluse": nessuna pianificazione disponibile → si usa il maturato.
const STATI_CONCLUSI = ['Concluso', 'Eliminata'];

// ids: codice singolo o array di codici del gruppo (anagrafiche fuse).
async function getSoggiorniCliente(pmsDb, ids) {
  const rows = await pmsDb.query(sqlSoggiorni(inClause(ids)), {});
  const soggiorni = rows.map((r) => {
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
      importo: arrangiamento, // riempito sotto (BUG-006)
      arrangiamento,
      extra,
      stato: r.stato,
      source: pulisci(r.source),
      mercato: pulisci(r.mercato),
      ospiti,
    };
  });
  // Importo unico (BUG-006): correnti → totale PIANIFICATO (PianificazioneSogg);
  // concluse → maturato (la pianificazione non è più disponibile in StorPrenota).
  const correnti = soggiorni.filter((s) => !STATI_CONCLUSI.includes(s.stato)).map((s) => s.codpratica);
  const imp = await getImportiPrenotazioni(pmsDb, correnti);
  soggiorni.forEach((s) => { s.importo = STATI_CONCLUSI.includes(s.stato) ? s.arrangiamento : (imp.get(s.codpratica) || 0); });
  return soggiorni;
}

// Anagrafica minima per una lista di codici (dashboard arrivi): nome, data di
// nascita e VIP decodificato. Una sola query set-based. Ritorna Map codice → dati.
// `Annotazioni` è la nota che il gestionale tiene sulla PERSONA (mentre
// `Prenota.Note` sta sulla pratica). Serve alle allergie: quando l'allergia è
// scritta lì, si sa di chi è senza doverlo chiedere a nessuno.
const sqlAnagraByIds = (inl) => `
SELECT a.CodCli, a.Cognome, a.Nome, CONVERT(varchar(10), a.dtNascita, 23) AS dtNascita,
       a.CodVip, tv.desvip AS DesVip, a.Annotazioni
FROM Anagra a
LEFT JOIN TabVip tv ON LTRIM(RTRIM(tv.codvip)) = LTRIM(RTRIM(a.CodVip)) AND ISNULL(a.CodVip,'') <> ''
WHERE a.CodCli IN ${inl}`;

async function getAnagraByIds(pmsDb, ids) {
  const arr = [...new Set(Array.isArray(ids) ? ids : [ids])];
  const map = new Map();
  if (!arr.length) return map;
  const rows = await pmsDb.query(sqlAnagraByIds(inClause(arr)), {});
  for (const r of rows) {
    map.set(r.CodCli, {
      codCli: r.CodCli,
      cognome: pulisci(r.Cognome),
      nome: pulisci(r.Nome),
      nominativo: nominativo(r.Cognome, r.Nome),
      dtNascita: pulisci(r.dtNascita),
      vip: vipInfo(r.CodVip, r.DesVip),
      note: pulisci(r.Annotazioni),
    });
  }
  return map;
}

// Storico soggiorni CONCLUSI per una lista di codici ("ospite di ritorno" della
// pagina In Casa): conta le pratiche archiviate (StorPrenota) in cui il codice
// compare come intestatario o come occupante, con la data dell'ultima partenza.
// Le eliminate non contano. Una sola query set-based → Map codice → {n, ultima}.
// COUNT(DISTINCT codpratica): lo stesso codice può comparire sia come intestatario
// sia come occupante della stessa pratica (e su più righe StorAlberg) → un soggiorno solo.
// "Nª volta" e "ultima visita" delle card. L'archivio delle prenotazioni NON
// contiene solo soggiorni: su 41.337 pratiche archiviate, 12.492 sono giornate
// (SPA, piscina, cene per esterni), 2.951 non hanno nemmeno le date e 79 sono
// voucher regalo, registrati come prenotazioni lunghe un anno perché quella è
// la loro validità. Contandole tutte, 9.996 ospiti risultavano più affezionati
// di quanto siano e 5.363 comparivano come "di ritorno" senza aver mai dormito
// qui (misurato il 13/08/2026).
//
// Quindi si separano due domande diverse:
// - `n`      = soggiorni con pernottamento conclusi → è il badge "Nª volta";
// - `visite` = giornate concluse → si mostra a parte, perché un cliente che
//              torna sei volte per la SPA è un dato commerciale, non rumore.
//
// Il tetto delle 200 notti taglia i voucher senza toccare i soggiorni lunghi:
// qui la stagione dura meno di così, e i voucher stanno tutti sui 365 giorni.
const NOTTI_MAX_SOGGIORNO = 200;

// `gruppo` è l'espressione su cui si raggruppa: di norma il codice stesso, ma
// per un ospite con più anagrafiche FUSE è quella principale. Il raggruppamento
// deve stare QUI e non nel codice che chiama, perché la stessa pratica può
// avere un codice come intestatario e l'altro come occupante: sommando i
// risultati a valle verrebbe contata due volte, e il badge direbbe "5ª volta"
// invece di "4ª". Dentro l'interrogazione il COUNT(DISTINCT codpratica) la
// conta una volta sola, che è il numero giusto (20/08/2026).
const sqlStoricoByIds = (inl, gruppo = 'c.codCli') => `
SELECT ${gruppo} AS codCli,
  COUNT(DISTINCT CASE WHEN c.notti BETWEEN 1 AND ${NOTTI_MAX_SOGGIORNO} THEN c.codpratica END) AS n,
  CONVERT(varchar(10), MAX(CASE WHEN c.notti BETWEEN 1 AND ${NOTTI_MAX_SOGGIORNO} THEN c.dtpartenza END), 23) AS ultima,
  COUNT(DISTINCT CASE WHEN c.notti = 0 THEN c.codpratica END) AS visite
FROM (
  SELECT sp.codclinterm AS codCli, sp.codpratica, sp.dtpartenza,
         DATEDIFF(day, sp.dtarrivo, sp.dtpartenza) AS notti
    FROM StorPrenota sp
   WHERE sp.DataEliminazione IS NULL AND sp.codclinterm IN ${inl}
  UNION ALL
  SELECT al.codcli, sp.codpratica, sp.dtpartenza,
         DATEDIFF(day, sp.dtarrivo, sp.dtpartenza)
    FROM StorPrenota sp
   JOIN StorAlberg al ON al.codpratica = sp.codpratica
   WHERE sp.DataEliminazione IS NULL AND al.codcli IN ${inl}
) c
GROUP BY ${gruppo}`;

// `gruppi` (facoltativo): Map codice → tutti i codici della stessa persona, così
// come la restituisce getGruppiByIds. Se c'è, la storia di un ospite con più
// anagrafiche viene sommata sotto la sua principale; se manca, ogni codice sta
// per sé — che è il comportamento di sempre.
//
// La mappa in uscita resta indicizzata per CODICE, non per gruppo: chi chiama
// cerca con il codice che ha in mano (quello della prenotazione) e deve trovare
// la storia intera senza sapere niente delle fusioni.
async function getStoricoByIds(pmsDb, ids, gruppi) {
  const arr = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Number.isInteger))];
  const map = new Map();
  if (!arr.length) return map;

  // Il principale di un gruppo è il codice più piccolo: serve solo che la scelta
  // sia STABILE, perché è la chiave su cui si raggruppa. Il principale "vero"
  // del CRM qui non lo sappiamo, e non serve saperlo.
  const membriDi = (id) => {
    const m = gruppi && gruppi.get(id);
    return Array.isArray(m) && m.length ? m.filter(Number.isInteger) : [id];
  };
  const chiaveDi = (id) => Math.min(...membriDi(id));

  const rimappati = arr.filter((id) => chiaveDi(id) !== id);
  const gruppo = rimappati.length
    ? `CASE c.codCli ${rimappati.map((id) => `WHEN ${id} THEN ${chiaveDi(id)}`).join(' ')} ELSE c.codCli END`
    : 'c.codCli';

  const rows = await pmsDb.query(sqlStoricoByIds(inClause(arr), gruppo), {});
  const perChiave = new Map();
  for (const r of rows) {
    const n = Number(r.n) || 0;
    const visite = Number(r.visite) || 0;
    // Anche chi non ha mai dormito qui entra nella mappa se è già venuto in
    // giornata: è proprio il caso che prima si perdeva.
    if (n > 0 || visite > 0) perChiave.set(Number(r.codCli), { n, ultima: r.ultima || null, visite });
  }
  // Ogni codice del gruppo punta alla stessa storia: la card intestata al
  // duplicato deve dire "4ª volta" come quella intestata al principale.
  for (const id of arr) {
    const v = perChiave.get(chiaveDi(id));
    if (v) map.set(id, v);
  }
  return map;
}

// Note delle prenotazioni CORRENTI di una persona (come intestataria o come
// occupante di una camera), per proporre le allergie anche dalla sua scheda.
//
// Solo `Prenota`, non l'archivio: sono le prenotazioni che riguardano l'ospite
// adesso o nei prossimi mesi. Le note dei soggiorni conclusi anni fa
// riporterebbero a galla richieste vecchie ogni volta che si apre la scheda,
// e chi legge non avrebbe modo di sapere se valgono ancora.
const sqlNotePrenotazioni = (inl) => `
SELECT p.codpratica,
  CONVERT(varchar(10), p.dtarrivo, 23) AS dtarrivo,
  CONVERT(varchar(10), p.dtpartenza, 23) AS dtpartenza,
  p.Note AS testo
FROM Prenota p
WHERE p.DataEliminazione IS NULL
  AND p.Note IS NOT NULL AND LTRIM(RTRIM(p.Note)) <> ''
  AND (p.codclinterm IN ${inl}
       OR EXISTS (SELECT 1 FROM Alberg al WHERE al.codpratica = p.codpratica AND al.codcli IN ${inl}))
ORDER BY p.dtarrivo DESC`;

async function getNotePrenotazioni(pmsDb, ids) {
  const arr = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Number.isInteger))];
  if (!arr.length) return [];
  const inl = inClause(arr);
  return pmsDb.query(sqlNotePrenotazioni(inl), {});
}

module.exports = {
  cercaClienti, getCliente, getSoggiorniCliente, getAnagraByIds, getStoricoByIds,
  getNotePrenotazioni, vipInfo, getClientiRicercaByIds,
};
