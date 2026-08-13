// Analytics — la parte che legge il gestionale: ospiti, soggiorni, canali,
// provenienze, consumi. SOLA LETTURA, come tutto ciò che tocca il PMS.
//
// Un soggiorno "cade nel periodo" quando ci FINISCE, non quando comincia: è
// concluso, i consumi sono stati registrati e l'importo è maturato. Contarlo
// dall'arrivo farebbe entrare nel periodo soggiorni ancora in corso, con metà
// dei numeri a zero.
//
// ⚠️ Che cosa è un soggiorno: da 1 a 200 notti. Sotto c'è la giornata (SPA,
// piscina, cene per esterni: 12.492 nell'archivio), sopra il voucher regalo,
// registrato come prenotazione lunga un anno perché quella è la sua validità.
// Contarli tutti è l'errore che faceva dire al badge "Nª volta" che 5.363
// ospiti erano di ritorno senza aver mai dormito qui (vedi `src/pms/clienti.js`).
const NOTTI_MIN = 1;
const NOTTI_MAX = 200;

// I soggiorni conclusi nel periodo, correnti e archiviati insieme. Ogni
// interrogazione di questo modulo parte da qui, così la definizione sta in un
// posto solo e non si può divergere da una query all'altra.
const SOGGIORNI = `
  SELECT sp.codpratica, sp.codclinterm AS codCli, sp.dtarrivo, sp.dtpartenza, sp.CodSource,
         DATEDIFF(day, sp.dtarrivo, sp.dtpartenza) AS notti
    FROM StorPrenota sp
   WHERE sp.DataEliminazione IS NULL AND sp.codclinterm IS NOT NULL
     AND DATEDIFF(day, sp.dtarrivo, sp.dtpartenza) BETWEEN ${NOTTI_MIN} AND ${NOTTI_MAX}
     AND CAST(sp.dtpartenza AS date) BETWEEN @da AND @a
  UNION ALL
  SELECT p.codpratica, p.codclinterm, p.dtarrivo, p.dtpartenza, p.CodSource,
         DATEDIFF(day, p.dtarrivo, p.dtpartenza)
    FROM Prenota p
   WHERE p.DataEliminazione IS NULL AND p.codclinterm IS NOT NULL
     AND DATEDIFF(day, p.dtarrivo, p.dtpartenza) BETWEEN ${NOTTI_MIN} AND ${NOTTI_MAX}
     AND CAST(p.dtpartenza AS date) BETWEEN @da AND @a`;

// I cinque numeri in testa alla pagina.
//
// "Di ritorno" = quel soggiorno aveva già un soggiorno precedente ALLE SPALLE,
// qualunque cosa fosse, non "prima dell'inizio del periodo". La differenza non è
// accademica: con la seconda definizione un ospite venuto due volte nello stesso
// anno risultava nuovo tutte e due le volte, e su dodici mesi veri i clienti di
// ritorno scendevano a 199 su 2.400 — un numero che avrebbe fatto credere
// all'hotel di non fidelizzare nessuno. Così invece il conteggio non dipende da
// dove si taglia la finestra, che è la proprietà che serve a un filtro
// temporale.
// I due CASE sono calcolati in una tappa a parte perché SQL Server non accetta
// una sottointerrogazione dentro un aggregato: qui diventano colonne, e il
// COUNT(DISTINCT ...) di sopra guarda solo quelle.
const sqlKpi = `
-- analytics:kpi
WITH s AS (${SOGGIORNI}),
-- Il PRIMO soggiorno di ogni ospite, calcolato una volta sola su tutta la
-- storia. Serve a dire se un soggiorno del periodo sia il suo primo o no.
--
-- La versione precedente lo chiedeva con due EXISTS correlate, una per tabella,
-- valutate riga per riga: leggibile ma insostenibile — sette giorni ci mettevano
-- 2,5 secondi, trenta giorni dieci, tre mesi andavano in timeout. Qui è una
-- lettura sola aggregata, e la si aggancia con una join.
primi AS (
  SELECT codCli, MIN(fine) AS primaFine FROM (
    SELECT sp.codclinterm AS codCli, CAST(sp.dtpartenza AS date) AS fine
      FROM StorPrenota sp
     WHERE sp.DataEliminazione IS NULL AND sp.codclinterm IS NOT NULL
       AND DATEDIFF(day, sp.dtarrivo, sp.dtpartenza) BETWEEN ${NOTTI_MIN} AND ${NOTTI_MAX}
    UNION ALL
    SELECT p.codclinterm, CAST(p.dtpartenza AS date)
      FROM Prenota p
     WHERE p.DataEliminazione IS NULL AND p.codclinterm IS NOT NULL
       AND DATEDIFF(day, p.dtarrivo, p.dtpartenza) BETWEEN ${NOTTI_MIN} AND ${NOTTI_MAX}
  ) x GROUP BY codCli
),
f AS (
  SELECT s.codCli, s.notti,
    CASE WHEN ISNULL(LTRIM(RTRIM(a.CodVip)), '') <> '' THEN 1 ELSE 0 END AS vip,
    -- Il confronto con l'ARRIVO, non con l'inizio del periodo: se il primo
    -- soggiorno in assoluto è finito prima che questo cominciasse, l'ospite era
    -- già stato qui. Il soggiorno stesso non può ingannare il conto, perché la
    -- sua partenza è sempre successiva al suo arrivo.
    CASE WHEN pr.primaFine IS NOT NULL AND pr.primaFine <= CAST(s.dtarrivo AS date)
         THEN 1 ELSE 0 END AS diRitorno
  FROM s
  LEFT JOIN Anagra a ON a.CodCli = s.codCli
  LEFT JOIN primi pr ON pr.codCli = s.codCli
)
SELECT
  COUNT(*) AS soggiorni,
  COUNT(DISTINCT f.codCli) AS ospiti,
  SUM(f.notti) AS notti,
  COUNT(DISTINCT CASE WHEN f.vip = 1 THEN f.codCli END) AS vip,
  COUNT(DISTINCT CASE WHEN f.diRitorno = 1 THEN f.codCli END) AS diRitorno
FROM f`;

// Da dove arrivano le prenotazioni: diretto, portali, tour operator, agenzie.
const sqlCanali = `
-- analytics:canali
WITH s AS (${SOGGIORNI})
SELECT TOP 8 ISNULL(NULLIF(LTRIM(RTRIM(src.DesSource)), ''), 'Non indicato') AS voce,
       COUNT(*) AS n
FROM s LEFT JOIN SourcePrenota src ON src.CodSource = s.CodSource
GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(src.DesSource)), ''), 'Non indicato')
ORDER BY COUNT(*) DESC`;

// Provenienza degli ospiti. Il campo è popolato all'80%: il "Non indicato" si
// mostra insieme agli altri invece di nasconderlo, altrimenti le percentuali
// sarebbero calcolate su una base che chi guarda non conosce.
const sqlNazioni = `
-- analytics:nazioni
WITH s AS (${SOGGIORNI})
SELECT TOP 8 ISNULL(NULLIF(LTRIM(RTRIM(a.CodNaz)), ''), 'Non indicata') AS voce,
       COUNT(DISTINCT s.codCli) AS n
FROM s LEFT JOIN Anagra a ON a.CodCli = s.codCli
GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(a.CodNaz)), ''), 'Non indicata')
ORDER BY COUNT(DISTINCT s.codCli) DESC`;

// Le classificazioni VIP sono 27 e descritte: è la dimensione più ricca che il
// gestionale offra, e nessuna pagina la mostra aggregata.
const sqlVip = `
-- analytics:vip
WITH s AS (${SOGGIORNI})
SELECT TOP 8 ISNULL(NULLIF(LTRIM(RTRIM(tv.desvip)), ''), LTRIM(RTRIM(a.CodVip))) AS voce,
       COUNT(DISTINCT s.codCli) AS n
FROM s
JOIN Anagra a ON a.CodCli = s.codCli AND ISNULL(LTRIM(RTRIM(a.CodVip)), '') <> ''
LEFT JOIN TabVip tv ON LTRIM(RTRIM(tv.codvip)) = LTRIM(RTRIM(a.CodVip))
GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(tv.desvip)), ''), LTRIM(RTRIM(a.CodVip)))
ORDER BY COUNT(DISTINCT s.codCli) DESC`;

// Consumi F&B. Si contano le ORDINAZIONI, non i pezzi: "quante volte è stato
// chiesto" dice cosa piace, mentre la quantità premia ciò che si serve a
// bottiglia. `soloVip` taglia sugli ospiti con una classificazione VIP.
const sqlConsumi = (soloVip) => `
-- analytics:consumi
SELECT TOP 12 LEFT(ISNULL(ma.desart, ac.CodArt), 60) AS voce,
  ISNULL(ma.flgFoodBeverage, '') AS tipo,
  COUNT(1) AS n, CAST(SUM(ac.impoEur) AS int) AS euro
FROM StorComanda co
JOIN StorAddebitiComanda ac ON ac.CodComanda = co.CodComanda AND ISNULL(ac.flgEliminato, '') <> 'S'
LEFT JOIN MagArtico ma ON ma.codart = ac.CodArt
${soloVip ? `JOIN StorComandaDettCamere dc ON dc.codComanda = co.CodComanda
JOIN StorAlbergDay ad ON ad.codcam = dc.CodCam AND CAST(co.dtComanda AS date) BETWEEN CAST(ad.dtarrivo AS date) AND CAST(ad.dtpartenza AS date)
JOIN StorAlberg al ON al.codalb = ad.codalb
JOIN Anagra av ON av.CodCli = al.codcli AND ISNULL(LTRIM(RTRIM(av.CodVip)), '') <> ''` : ''}
WHERE ISNULL(co.flgEliminata, '') <> 'S'
  AND CAST(co.dtComanda AS date) BETWEEN @da AND @a
  AND ISNULL(ma.codgrpmerCAT, '') NOT LIKE 'SPA%'
GROUP BY ac.CodArt, ma.desart, ma.flgFoodBeverage
ORDER BY COUNT(1) DESC`;

// La SPA non passa dalle comande ma dagli extra del conto: due strade diverse
// nel gestionale per due mondi diversi, e va interrogata dove sta.
const sqlSpa = `
-- analytics:spa
SELECT TOP 8 LEFT(ISNULL(ma.desart, m.codart), 60) AS voce,
  COUNT(1) AS n, CAST(SUM(m.impoeur) AS int) AS euro
FROM StorMatura m
JOIN MagArtico ma ON ma.codart = m.codart AND ma.codgrpmerCAT LIKE 'SPA%'
WHERE CAST(m.dtCompetenza AS date) BETWEEN @da AND @a
GROUP BY m.codart, ma.desart
ORDER BY COUNT(1) DESC`;

// Andamento: soggiorni conclusi per mese. Serve a vedere la forma della
// stagione, non il dettaglio: su un periodo di sette giorni resta un mese solo,
// ed è giusto così — un grafico con un punto dice già tutto quello che sa.
const sqlAndamento = `
-- analytics:andamento
WITH s AS (${SOGGIORNI})
SELECT CONVERT(varchar(7), s.dtpartenza, 23) AS mese, COUNT(*) AS n
FROM s GROUP BY CONVERT(varchar(7), s.dtpartenza, 23) ORDER BY 1`;

const numero = (v) => (v == null ? 0 : Number(v));

// Le classifiche hanno tutte la stessa forma { voce, n }: il frontend ne
// disegna una sola, e aggiungerne una nuova non tocca l'interfaccia.
const classifica = (righe) => (righe || []).map((r) => ({
  voce: String(r.voce == null ? '' : r.voce).trim() || '—',
  n: numero(r.n),
  euro: r.euro == null ? null : numero(r.euro),
  tipo: r.tipo == null ? null : String(r.tipo),
}));

async function getKpiPeriodo(pmsDb, { da, a }) {
  const [r] = await pmsDb.query(sqlKpi, { da, a });
  const soggiorni = numero(r && r.soggiorni);
  const notti = numero(r && r.notti);
  return {
    soggiorni,
    ospiti: numero(r && r.ospiti),
    notti,
    // Media a soggiorno, non a ospite: è la domanda che si fa in hotel.
    nottiMedie: soggiorni ? Math.round((notti / soggiorni) * 10) / 10 : 0,
    vip: numero(r && r.vip),
    diRitorno: numero(r && r.diRitorno),
  };
}

async function getDettagliPeriodo(pmsDb, { da, a, soloVip = false }) {
  const [canali, nazioni, vip, consumi, spa, andamento] = await Promise.all([
    pmsDb.query(sqlCanali, { da, a }),
    pmsDb.query(sqlNazioni, { da, a }),
    pmsDb.query(sqlVip, { da, a }),
    pmsDb.query(sqlConsumi(soloVip), { da, a }),
    pmsDb.query(sqlSpa, { da, a }),
    pmsDb.query(sqlAndamento, { da, a }),
  ]);
  return {
    canali: classifica(canali),
    nazioni: classifica(nazioni),
    vip: classifica(vip),
    consumi: classifica(consumi),
    spa: classifica(spa),
    andamento: (andamento || []).map((r) => ({ mese: r.mese, n: numero(r.n) })),
  };
}

// Anagrafiche incomplete fra chi ha soggiornato nel periodo. È l'indicatore di
// qualità più onesto che abbiamo, perché il campo è pieno per davvero: sul
// totale delle anagrafiche mancano email e telefono a due terzi.
const sqlQualitaAnagrafica = `
-- analytics:qualita
WITH s AS (${SOGGIORNI})
SELECT COUNT(DISTINCT s.codCli) AS ospiti,
  COUNT(DISTINCT CASE WHEN ISNULL(LTRIM(RTRIM(a.email)), '') = '' THEN s.codCli END) AS senzaEmail,
  COUNT(DISTINCT CASE WHEN ISNULL(LTRIM(RTRIM(a.Cellulare)), '') = ''
                       AND ISNULL(LTRIM(RTRIM(a.Telefono)), '') = '' THEN s.codCli END) AS senzaTelefono,
  COUNT(DISTINCT CASE WHEN a.dtNascita IS NULL THEN s.codCli END) AS senzaDataNascita
FROM s LEFT JOIN Anagra a ON a.CodCli = s.codCli`;

async function getQualitaAnagrafica(pmsDb, { da, a }) {
  const [r] = await pmsDb.query(sqlQualitaAnagrafica, { da, a });
  return {
    ospiti: numero(r && r.ospiti),
    senzaEmail: numero(r && r.senzaEmail),
    senzaTelefono: numero(r && r.senzaTelefono),
    senzaDataNascita: numero(r && r.senzaDataNascita),
  };
}

module.exports = { getKpiPeriodo, getDettagliPeriodo, getQualitaAnagrafica, NOTTI_MIN, NOTTI_MAX };
