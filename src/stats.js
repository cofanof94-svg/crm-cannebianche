// Aggregazione cumulativa PURA su una lista di soggiorni già filtrati (validi).
// Fonte unica per LTV / notti / medie / ultima Source, usata sia dalla scheda
// live (src/api/clienti.js) sia dall'import (src/import/trasforma.js), così le
// due strade non possono divergere.
//
// Ogni riga: { arrangiamento, extra, notti, dtarrivo, source, mercato }.
// Un DAY USE non è un soggiorno: zero notti, nessuna camera. Contarlo faceva
// dire alla scheda "5 soggiorni" mentre il badge in card diceva "4ª volta",
// due risposte diverse sullo stesso ospite (decisione del 13/08, ripresa il
// 18/08). I suoi SOLDI però restano: sono stati incassati davvero, e toglierli
// farebbe risultare l'ospite meno generoso di quanto è stato.
//
// Quindi: gli importi si sommano su TUTTE le righe, il conteggio dei soggiorni
// e le medie solo su chi ha dormito qui.
// Day use = arrivo e partenza nello stesso giorno. È la stessa definizione che
// usa il resto del CRM (src/pms/prenotazioni.js), non una seconda regola.
// Se le date non ci sono si guardano le notti; se non c'è neanche quel dato la
// riga vale come soggiorno: un dato che manca non è uno zero, e buttare via un
// soggiorno per un campo vuoto sarebbe peggio che contarne uno di troppo.
const haDormito = (r) => {
  if (r.dtarrivo && r.dtpartenza) return String(r.dtarrivo) !== String(r.dtpartenza);
  const n = Number(r.notti);
  return !Number.isFinite(n) || n > 0;
};

function aggregaCumulativi(rows) {
  const tutte = rows || [];
  const soggiorni = tutte.filter(haDormito);
  const n = soggiorni.length;
  const arr = tutte.reduce((s, r) => s + (Number(r.arrangiamento) || 0), 0);
  const ext = tutte.reduce((s, r) => s + (Number(r.extra) || 0), 0);
  const notti = tutte.reduce((s, r) => s + (Number(r.notti) || 0), 0);
  const ltv = arr + ext;
  // Le date restano su TUTTE le righe: un day use è comunque una visita, e la
  // scheda le chiama così — "prima visita", "ultima visita".
  const date = tutte.map((r) => r.dtarrivo).filter(Boolean).sort();
  const piuRecente = tutte.reduce((best, r) => (r.dtarrivo && (!best || r.dtarrivo > best.dtarrivo) ? r : best), null);
  const media = (t) => (n ? t / n : 0);
  return {
    nSoggiorni: n,
    nDayUse: tutte.length - n,
    nottiTotali: notti,
    totArrangiamenti: arr,
    totExtra: ext,
    ltv,
    totaleSpeso: ltv,
    spesaMediaSoggiorno: media(ltv),
    spesaMediaRooms: media(arr),
    spesaMediaServizi: media(ext),
    ultimaSource: (piuRecente && piuRecente.source) || null,
    ultimoMercato: (piuRecente && piuRecente.mercato) || null,
    primaVisita: date[0] || null,
    ultimaVisita: date[date.length - 1] || null,
  };
}

module.exports = { aggregaCumulativi };
