// Importo PIANIFICATO della prenotazione (BUG-006).
//
// Fonte corretta = "pianificazione di soggiorno" (tabella PianificazioneSogg):
// tariffe GIORNALIERE che sovrascrivono, a gradini, la tariffa base per notte.
// - Base per notte = TipoPre.ImpoEur (giornaliero) del segmento (dtinizio→dtfine).
// - PianificazioneSogg.GG = indice notte 1-based DELL'INTERO SOGGIORNO da cui vale
//   impoEur; il valore si trascina fino al cambio successivo. Le notti prima del
//   primo override usano la tariffa base.
//
// Modello a "tracce": più camere in PARALLELO (stesse date) → contributi sommati;
// segmenti SEQUENZIALI (cambio camera) → un'unica traccia continua. Calcolo notte
// per notte (soggiorni brevi → costo trascurabile). Verificato col gestionale:
//   61178 (2 camere) → 11.700 · 62518 → 5.253 · 59645 (cambio camera) → 29.725.
//
// Le prenotazioni CONCLUSE (StorPrenota) non hanno più TipoPre/PianificazioneSogg:
// per quelle si usa il maturato, gestito nello storico della scheda cliente.

const { inClause } = require('../db/query');

const giorno = (iso) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 86400000);

// Costruisce le tracce: ogni traccia = segmenti sequenziali (non sovrapposti);
// segmenti sovrapposti (camere parallele) finiscono in tracce distinte.
function costruisciTracce(segs) {
  const ordinati = segs.slice().sort((a, b) => a.di - b.di);
  const tracce = [];
  for (const s of ordinati) {
    const tr = tracce.find((t) => t.lastDf <= s.di);
    if (tr) { tr.segs.push(s); tr.lastDf = s.df; } else { tracce.push({ segs: [s], lastDf: s.df }); }
  }
  return tracce;
}

// Totale di una prenotazione. tpRows: righe TipoPre {id, base, di, df, qta} (di/df ISO);
// psRows: righe PianificazioneSogg {id, GG, impoEur} (id = ID_TipoPre).
function sommaPratica(tpRows, psRows) {
  if (!tpRows || !tpRows.length) return 0;
  const segs = tpRows.map((t) => ({ id: t.id, base: Number(t.base) || 0, di: giorno(t.di), df: giorno(t.df), qta: Number(t.qta) || 1 }));
  const arrivo = Math.min(...segs.map((s) => s.di));
  const psById = new Map();
  for (const p of psRows || []) {
    if (!psById.has(p.id)) psById.set(p.id, []);
    psById.get(p.id).push({ GG: Number(p.GG), impoEur: Number(p.impoEur) });
  }
  let tot = 0;
  for (const tr of costruisciTracce(segs)) {
    // tariffa base per notte (indice notte 1-based dall'arrivo del soggiorno)
    const basePerNotte = {};
    let ultima = 0;
    for (const s of tr.segs) {
      for (let d = s.di; d < s.df; d++) basePerNotte[d - arrivo + 1] = s.base;
      ultima = Math.max(ultima, s.df - arrivo); // ultima notte (df esclusiva)
    }
    const primaNotte = tr.segs[0].di - arrivo + 1;
    // override della traccia (righe PS dei segmenti della traccia), ordinati per GG
    const ids = new Set(tr.segs.map((s) => s.id));
    const ps = [];
    for (const id of ids) for (const p of (psById.get(id) || [])) ps.push(p);
    ps.sort((a, b) => a.GG - b.GG);
    const qta = tr.segs[0].qta;
    let override = null; let pi = 0; let sub = 0;
    for (let n = primaNotte; n <= ultima; n++) {
      while (pi < ps.length && ps[pi].GG <= n) { override = ps[pi].impoEur; pi += 1; }
      sub += override != null ? override : (basePerNotte[n] || 0);
    }
    tot += sub * qta;
  }
  return tot;
}

// Importo pianificato per una lista di pratiche → Map codpratica → totale.
async function getImportiPrenotazioni(pmsDb, codpratiche) {
  const ids = [...new Set((codpratiche || []).map(Number).filter(Number.isInteger))];
  const out = new Map();
  if (!ids.length) return out;
  const inl = inClause(ids);

  const tpRows = await pmsDb.query(
    `SELECT codpratica, ID_TIPOPRE AS id, ImpoEur AS base,
            CONVERT(varchar(10), dtinizio, 23) AS di, CONVERT(varchar(10), dtfine, 23) AS df,
            ISNULL(NULLIF(qta, 0), 1) AS qta
     FROM TipoPre WHERE codpratica IN ${inl}`
  );
  const psRows = await pmsDb.query(
    `SELECT CodPratica AS codpratica, ID_TipoPre AS id, GG, impoEur FROM PianificazioneSogg WHERE CodPratica IN ${inl}`
  );

  const tpByPratica = new Map();
  for (const r of tpRows) {
    if (!tpByPratica.has(r.codpratica)) tpByPratica.set(r.codpratica, []);
    tpByPratica.get(r.codpratica).push(r);
  }
  const psByPratica = new Map();
  for (const r of psRows) {
    if (!psByPratica.has(r.codpratica)) psByPratica.set(r.codpratica, []);
    psByPratica.get(r.codpratica).push(r);
  }
  for (const [cp, tp] of tpByPratica) out.set(cp, sommaPratica(tp, psByPratica.get(cp) || []));

  // Al CHECK-IN il PMS svuota TipoPre (i dati passano ad Alberg) ma la pianificazione
  // resta: per le pratiche senza TipoPre il totale = maturato (notti già consumate,
  // Matura) + notti residue valorizzate dalla pianificazione (o dalla tariffa corrente
  // Alberg.impoeur se la pianificazione non copre quelle notti).
  const daFallback = ids.filter((id) => !tpByPratica.has(id));
  if (daFallback.length) {
    const fb = await pmsDb.query(
      `SELECT p.codpratica,
         DATEDIFF(day, p.dtarrivo, p.dtpartenza) AS notti,
         DATEDIFF(day, p.dtarrivo, (SELECT TOP 1 Dataggio FROM Persona)) AS nottiFatte,
         (SELECT ISNULL(SUM(m.impoeur), 0) FROM Matura m
            WHERE m.codalb IN (SELECT codalb FROM Alberg WHERE codpratica = p.codpratica)
              AND LTRIM(RTRIM(ISNULL(m.codarr, ''))) <> '') AS maturato,
         (SELECT ISNULL(SUM(tc.camImp), 0) FROM (SELECT MAX(al.impoeur) AS camImp
            FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb
            WHERE al.codpratica = p.codpratica GROUP BY ad.codcam) tc) AS tariffaNotte
       FROM Prenota p WHERE p.codpratica IN ${inClause(daFallback)}`
    );
    for (const r of fb) {
      if (out.get(r.codpratica)) continue;
      const notti = Number(r.notti) || 0;
      const fatte = Math.min(Math.max(Number(r.nottiFatte) || 0, 0), notti);
      const maturato = Number(r.maturato) || 0;
      const tariffa = Number(r.tariffaNotte) || 0;
      const ps = (psByPratica.get(r.codpratica) || []).map((p) => ({ GG: Number(p.GG), impoEur: Number(p.impoEur) })).sort((a, b) => a.GG - b.GG);
      // n. camere paganti (tariffa > 0), per moltiplicare la pianificazione per camera
      const camere = new Set((psByPratica.get(r.codpratica) || []).map((p) => p.id)).size || 1;
      let residuo = 0;
      for (let n = fatte + 1; n <= notti; n++) {
        let val = null;
        for (const p of ps) { if (p.GG <= n) val = p.impoEur; else break; }
        residuo += (val != null ? val * camere : tariffa);
      }
      out.set(r.codpratica, maturato + residuo);
    }
  }
  return out;
}

module.exports = { sommaPratica, costruisciTracce, getImportiPrenotazioni };
