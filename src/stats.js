// Aggregazione cumulativa PURA su una lista di soggiorni già filtrati (validi).
// Fonte unica per LTV / notti / medie / ultima Source, usata sia dalla scheda
// live (src/api/clienti.js) sia dall'import (src/import/trasforma.js), così le
// due strade non possono divergere.
//
// Ogni riga: { arrangiamento, extra, notti, dtarrivo, source, mercato }.
// Un DAY USE non è un soggiorno: zero notti, nessuna camera. Contarlo faceva
// dire alla scheda "5 soggiorni" mentre il badge in card diceva "4ª volta",
// due risposte diverse sullo stesso ospite (decisione del 13/08, ripresa il
// 18/08).
//
// I SOLDI restano su tutte le righe — day use e pratiche senza date comprese.
// Sono stati incassati davvero: se in una pratica c'è un importo, qualcuno l'ha
// pagato, e toglierlo farebbe risultare l'ospite meno generoso di quanto è
// stato. Il valore storico è la somma di ciò che è entrato, non di ciò che
// sappiamo classificare (decisione di Mik, 18/08/2026).
//
// Quindi: gli importi si sommano su TUTTE le righe, il conteggio dei soggiorni
// e le medie solo su chi ha dormito qui.
// Ogni riga dello storico è una di tre cose, e la differenza conta:
//
//   'soggiorno'   ha dormito qui;
//   'dayuse'      arrivo e partenza nello stesso giorno (SPA, piscina, cena);
//   'sconosciuto' non si sa: non ha le date e non ha nemmeno le notti.
//
// Il day use è definito come nel resto del CRM (src/pms/prenotazioni.js), non
// con una seconda regola.
//
// Le righe 'sconosciuto' NON si contano da nessuna parte — decisione di Mik del
// 18/08/2026. Sono in gran parte pratiche archiviate vecchie, dati sporchi:
// contarle come soggiorni gonfiava lo storico dell'ospite, contarle come day use
// gli attribuiva giornate che non ha mai fatto. Toglierle allinea la scheda al
// badge "Nª volta" e alla dashboard, che le escludevano già entrambi.
//
// Prima si provava a farle valere come soggiorno ("un campo vuoto non è uno
// zero"), e non funzionava nemmeno: `Number(null)` e `Number('')` fanno ZERO,
// quindi finivano fra i day use. Da qui il controllo esplicito sul valore
// grezzo, prima di qualunque conversione a numero.
function classifica(r) {
  if (r.dtarrivo && r.dtpartenza) {
    return String(r.dtarrivo) === String(r.dtpartenza) ? 'dayuse' : 'soggiorno';
  }
  if (r.notti == null || String(r.notti).trim() === '') return 'sconosciuto';
  const n = Number(r.notti);
  if (!Number.isFinite(n)) return 'sconosciuto';
  return n > 0 ? 'soggiorno' : 'dayuse';
}

function aggregaCumulativi(rows) {
  const tutte = rows || [];
  const tipo = new Map(tutte.map((r) => [r, classifica(r)]));
  const soggiorni = tutte.filter((r) => tipo.get(r) === 'soggiorno');
  const n = soggiorni.length;
  const arr = tutte.reduce((s, r) => s + (Number(r.arrangiamento) || 0), 0);
  const ext = tutte.reduce((s, r) => s + (Number(r.extra) || 0), 0);
  const notti = tutte.reduce((s, r) => s + (Number(r.notti) || 0), 0);
  const ltv = arr + ext;
  // Le date restano su TUTTE le righe: un day use è comunque una visita, e la
  // scheda le chiama così — "prima visita", "ultima visita". Le righe senza date
  // non hanno niente da portare qui, quindi si escludono da sole.
  const date = tutte.map((r) => r.dtarrivo).filter(Boolean).sort();
  const piuRecente = tutte.reduce((best, r) => (r.dtarrivo && (!best || r.dtarrivo > best.dtarrivo) ? r : best), null);
  const media = (t) => (n ? t / n : 0);
  return {
    nSoggiorni: n,
    nDayUse: tutte.filter((r) => tipo.get(r) === 'dayuse').length,
    // Le pratiche che non si sa cosa siano. Non entrano in nessun conteggio, ma
    // il numero esce da qui perché la scheda lo dichiara: senza, chi conta le
    // righe dell'elenco trova un totale diverso da quello del riquadro
    // Soggiorni e pensa a un guasto.
    nSenzaDate: tutte.filter((r) => tipo.get(r) === 'sconosciuto').length,
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
