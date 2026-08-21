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
// Il nome della nazione, non il suo codice: chi sta al banco non deve indovinare
// che `PBS` sono i Paesi Bassi. La tabella `Nazioni` del gestionale ha 246 righe
// e i codici combaciano quasi sempre — misurato il 21/08/2026 su tutta l'anagrafica,
// solo QUATTRO righe in tutto hanno un codice che non si decodifica (`IT`, `ITA`,
// `Ù`). Per quelle si mostra il codice, come fa già `sqlVip` con `TabVip`.
//
// COALESCE e non ISNULL, e non è una preferenza di stile: `ISNULL` prende il TIPO
// del primo argomento, qui `Anagra.CodNaz`, che è `nvarchar(3)`. Il ripiego
// "Non indicata" ci veniva tagliato dentro e finiva a schermo come **"Non"** —
// un'etichetta che non vuol dire niente su 292 ospiti. `COALESCE` diventa un CASE
// e il tipo si calcola su tutti i rami. Provato sul database vero.
const NAZIONE = `COALESCE(
  NULLIF(LTRIM(RTRIM(z.desnaz)), ''),
  NULLIF(LTRIM(RTRIM(a.CodNaz)), ''),
  'Non indicata')`;

const sqlNazioni = `
-- analytics:nazioni
WITH s AS (${SOGGIORNI})
SELECT TOP 8 ${NAZIONE} AS voce,
       COUNT(DISTINCT s.codCli) AS n
FROM s
LEFT JOIN Anagra a ON a.CodCli = s.codCli
LEFT JOIN Nazioni z ON LTRIM(RTRIM(z.codnaz)) = LTRIM(RTRIM(a.CodNaz))
  AND ISNULL(LTRIM(RTRIM(a.CodNaz)), '') <> ''
GROUP BY ${NAZIONE}
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

// Quante voci di consumo mostra il riquadro. Prima era un `TOP 12` dentro il
// SQL: vedi `sqlConsumi` per il motivo per cui è dovuto uscire.
const VOCI_CONSUMI = 12;

// Le camere occupate da almeno un VIP, con la finestra in cui lo erano. Serve
// solo alla spunta "Solo ospiti VIP".
//
// Perché una CTE con DISTINCT e non tre JOIN in fondo alla query dei consumi,
// com'era prima: `StorAlberg` ha UNA RIGA PER OCCUPANTE, non per camera. Con i
// join, una camera con due VIP dentro faceva contare due volte ogni ordinazione
// di quella camera, e sommare due volta i suoi euro — quindi la spunta poteva
// dare numeri PIÙ ALTI di quelli senza spunta: un sottoinsieme più grande
// dell'insieme. È lo stesso motivo per cui `src/pms/gusti.js` costruisce la sua
// CTE `stays` con DISTINCT.
//
// E l'UNION con `AlbergDay`/`Alberg`: il ramo guardava solo l'archivio, quindi i
// soggiorni non ancora archiviati sparivano dal filtro. Sui periodi corti
// ("7 giorni", "30 giorni") sono la parte più grossa. Anche qui, la CTE
// `SOGGIORNI` di questo file e `gusti.js` uniscono già corrente e archiviato.
// Le date: la CTE si limita alle occupazioni che si SOVRAPPONGONO al periodo
// chiesto. Non cambia una riga del risultato — l'EXISTS più sotto pretende già
// una comanda che stia dentro tutt'e due gli intervalli, e due intervalli che
// non si sovrappongono non possono contenerne una — ma senza questo taglio la
// lista si costruisce su quindici anni di archivio per poi buttarne via il 99%.
// Misurato sui dati veri il 21/08/2026: da 9,5 secondi a meno di uno.
const CAMERE_VIP = `
  SELECT DISTINCT ad.codcam AS cam, CAST(ad.dtarrivo AS date) AS arr, CAST(ad.dtpartenza AS date) AS par
  FROM StorAlbergDay ad
  JOIN StorAlberg al ON al.codalb = ad.codalb
  JOIN Anagra av ON av.CodCli = al.codcli AND ISNULL(LTRIM(RTRIM(av.CodVip)), '') <> ''
  WHERE ISNULL(ad.codcam, '') <> ''
    AND CAST(ad.dtpartenza AS date) >= @da AND CAST(ad.dtarrivo AS date) <= @a
  UNION
  SELECT DISTINCT ad.codcam, CAST(ad.dtarrivo AS date), CAST(ad.dtpartenza AS date)
  FROM AlbergDay ad
  JOIN Alberg al ON al.codalb = ad.codalb
  JOIN Anagra av ON av.CodCli = al.codcli AND ISNULL(LTRIM(RTRIM(av.CodVip)), '') <> ''
  WHERE ISNULL(ad.codcam, '') <> ''
    AND CAST(ad.dtpartenza AS date) >= @da AND CAST(ad.dtarrivo AS date) <= @a`;

// Consumi F&B. Si contano le ORDINAZIONI, non i pezzi: "quante volte è stato
// chiesto" dice cosa piace, mentre la quantità premia ciò che si serve a
// bottiglia. `soloVip` taglia sugli ospiti con una classificazione VIP.
//
// Il filtro VIP è un EXISTS e non un JOIN apposta: un EXISTS risponde sì o no
// una volta sola, quindi non può moltiplicare le righe qualunque cosa ci sia
// dentro. Con i join servirebbe un DISTINCT, e un DISTINCT sbagliato non si
// vede — si vede solo il numero gonfio.
//
// Qui NON c'è il TOP, e le prime voci si prendono dopo (VOCI_CONSUMI). Non è una
// preferenza di stile: misurato sui dati veri il 21/08/2026, un `TOP 12` con
// `ORDER BY` su un aggregato fa scegliere a SQL Server un piano che punta a
// tirare fuori in fretta le prime righe, e con l'EXISTS quel piano è disastroso.
// Su dodici mesi: 9,8 secondi con il TOP, 1,1 senza. Su tutto lo storico il TOP
// supera il limite di quindici secondi e la pagina va in errore.
const sqlConsumi = (soloVip) => `
-- analytics:consumi
${soloVip ? `WITH camereVip AS (${CAMERE_VIP})` : ''}
SELECT LEFT(ISNULL(ma.desart, ac.CodArt), 60) AS voce,
  ISNULL(ma.flgFoodBeverage, '') AS tipo,
  COUNT(1) AS n, CAST(SUM(ac.impoEur) AS int) AS euro
FROM StorComanda co
JOIN StorAddebitiComanda ac ON ac.CodComanda = co.CodComanda AND ISNULL(ac.flgEliminato, '') <> 'S'
LEFT JOIN MagArtico ma ON ma.codart = ac.CodArt
WHERE ISNULL(co.flgEliminata, '') <> 'S'
  AND CAST(co.dtComanda AS date) BETWEEN @da AND @a
  AND ISNULL(ma.codgrpmerCAT, '') NOT LIKE 'SPA%'
${soloVip ? `  AND EXISTS (
    SELECT 1 FROM StorComandaDettCamere dc
    JOIN camereVip cv ON cv.cam = dc.CodCam
    WHERE dc.codComanda = co.CodComanda
      AND CAST(co.dtComanda AS date) BETWEEN cv.arr AND cv.par
  )` : ''}
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
//
// Oltre i due anni si raggruppa per ANNO. Il grafico scrive un'etichetta per
// punto: su tutto lo storico dell'hotel sarebbero oltre cento etichette da dieci
// pixel una sopra l'altra, cioè un grafico illeggibile che sembra un errore.
// Lo stile 23 è `aaaa-mm-gg`, quindi i primi quattro caratteri sono l'anno e i
// primi sette l'anno col mese: una sola espressione, tagliata più corta.
const sqlAndamento = (perAnno) => `
-- analytics:andamento
WITH s AS (${SOGGIORNI})
SELECT CONVERT(varchar(${perAnno ? 4 : 7}), s.dtpartenza, 23) AS mese, COUNT(*) AS n
FROM s GROUP BY CONVERT(varchar(${perAnno ? 4 : 7}), s.dtpartenza, 23) ORDER BY 1`;

// Il giorno in cui si è concluso il primo soggiorno che il gestionale ricorda.
// Serve al periodo "tutto lo storico": senza, bisognerebbe inventare una data di
// partenza, e il grafico partirebbe da anni in cui non c'era niente.
const sqlPrimoSoggiorno = `
-- analytics:inizio
SELECT MIN(fine) AS inizio FROM (
  SELECT MIN(CAST(sp.dtpartenza AS date)) AS fine
    FROM StorPrenota sp
   WHERE sp.DataEliminazione IS NULL AND sp.codclinterm IS NOT NULL
     AND DATEDIFF(day, sp.dtarrivo, sp.dtpartenza) BETWEEN ${NOTTI_MIN} AND ${NOTTI_MAX}
  UNION ALL
  SELECT MIN(CAST(p.dtpartenza AS date))
    FROM Prenota p
   WHERE p.DataEliminazione IS NULL AND p.codclinterm IS NOT NULL
     AND DATEDIFF(day, p.dtarrivo, p.dtpartenza) BETWEEN ${NOTTI_MIN} AND ${NOTTI_MAX}
) x`;

// Oltre questo, l'andamento passa da mese ad anno.
const GIORNI_PER_ANNO = 731;

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

async function getDettagliPeriodo(pmsDb, { da, a, soloVip = false, perAnno = false }) {
  const [canali, nazioni, vip, consumi, spa, andamento] = await Promise.all([
    pmsDb.query(sqlCanali, { da, a }),
    pmsDb.query(sqlNazioni, { da, a }),
    pmsDb.query(sqlVip, { da, a }),
    pmsDb.query(sqlConsumi(soloVip), { da, a }),
    pmsDb.query(sqlSpa, { da, a }),
    pmsDb.query(sqlAndamento(perAnno), { da, a }),
  ]);
  return {
    canali: classifica(canali),
    nazioni: classifica(nazioni),
    vip: classifica(vip),
    // Il taglio alle prime voci si fa qui e non nel SQL: vedi il commento su
    // `sqlConsumi`. Le righe sono poche centinaia e già ordinate dal database.
    consumi: classifica(consumi).slice(0, VOCI_CONSUMI),
    spa: classifica(spa),
    andamento: (andamento || []).map((r) => ({ mese: r.mese, n: numero(r.n) })),
    // La pagina deve sapere se i punti sono mesi o anni: le etichette si
    // scrivono in modo diverso, e "08/26" su un anno non vorrebbe dire niente.
    andamentoPerAnno: !!perAnno,
  };
}

// Da quando comincia lo storico. Torna null se non c'è niente da contare: chi
// chiama decide cosa farne, qui non si inventa una data.
async function getPrimoSoggiorno(pmsDb) {
  const [r] = await pmsDb.query(sqlPrimoSoggiorno, {});
  const g = r && r.inizio;
  if (!g) return null;
  const iso = String(g instanceof Date ? g.toISOString() : g).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
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

module.exports = {
  getKpiPeriodo, getDettagliPeriodo, getQualitaAnagrafica, getPrimoSoggiorno,
  NOTTI_MIN, NOTTI_MAX, GIORNI_PER_ANNO,
};
