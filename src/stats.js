// Aggregazione cumulativa PURA su una lista di soggiorni già filtrati (validi).
// Fonte unica per LTV / notti / medie / ultima Source, usata sia dalla scheda
// live (src/api/clienti.js) sia dall'import (src/import/trasforma.js), così le
// due strade non possono divergere.
//
// Ogni riga: { arrangiamento, extra, notti, dtarrivo, source }.
function aggregaCumulativi(rows) {
  const n = rows.length;
  const arr = rows.reduce((s, r) => s + (Number(r.arrangiamento) || 0), 0);
  const ext = rows.reduce((s, r) => s + (Number(r.extra) || 0), 0);
  const notti = rows.reduce((s, r) => s + (Number(r.notti) || 0), 0);
  const ltv = arr + ext;
  const date = rows.map((r) => r.dtarrivo).filter(Boolean).sort();
  const piuRecente = rows.reduce((best, r) => (r.dtarrivo && (!best || r.dtarrivo > best.dtarrivo) ? r : best), null);
  const media = (t) => (n ? t / n : 0);
  return {
    nSoggiorni: n,
    nottiTotali: notti,
    totArrangiamenti: arr,
    totExtra: ext,
    ltv,
    totaleSpeso: ltv,
    spesaMediaSoggiorno: media(ltv),
    spesaMediaRooms: media(arr),
    spesaMediaServizi: media(ext),
    ultimaSource: (piuRecente && piuRecente.source) || null,
    primaVisita: date[0] || null,
    ultimaVisita: date[date.length - 1] || null,
  };
}

module.exports = { aggregaCumulativi };
