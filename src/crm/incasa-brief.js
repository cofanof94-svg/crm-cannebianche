// Pagina "In Casa" — arricchimento e ordinamento degli ospiti presenti.
//
// Riusa lo snapshot CRM degli Arrivi (VIP, allergie, preferenze, reclami, relazioni,
// ricorrenze) ma cambia la DOMANDA a cui la pagina risponde: gli Arrivi preparano
// l'accoglienza, In Casa gestisce l'ospite durante il soggiorno. Quindi qui si
// aggiungono due cose che negli Arrivi non servirebbero:
// - avanzamento del soggiorno (a che notte siamo, quando parte);
// - "ospite di ritorno" (soggiorni conclusi + ultima visita), utile a personalizzare.
//
// L'ordinamento è pensato come il rack della reception: per numero di camera, con
// chi ha già fatto il check-out in fondo (resta consultabile ma non toglie attenzione).

const { arricchisciArrivi } = require('./arrivi-brief');

function briefingInCasaVuoto(n) {
  return { presenti: n || 0, partonoOggi: 0, vip: 0, alert: 0, reclami: 0, ricorrenze: 0, usciti: 0, dayUse: 0 };
}

// Ospite del giorno: entra e esce in giornata, non dorme qui (SPA, piscina,
// cene, serate). Non ha camera né notti, quindi quasi tutto ciò che la pagina
// dice di un soggiorno non lo riguarda.
const isDayUse = (c) => c.statoPartenza === 'dayuse';

// Numero della prima camera, per l'ordinamento ("104, 106" → 104). Le camere non
// numeriche (o assenti) finiscono in fondo mantenendo l'ordine alfabetico.
function numeroCamera(camere) {
  const prima = String(camere || '').split(',')[0].trim();
  const n = parseInt(prima, 10);
  return Number.isInteger(n) ? n : Number.MAX_SAFE_INTEGER;
}

// Ordine di reception: chi è in casa, poi gli ospiti del giorno, in fondo chi ha
// già fatto il check-out.
//
// Il criterio è "chi è in hotel adesso". Un ospite del giorno non ha camera, ma
// è una persona presente: può chiedere qualcosa, va servita, e sta davanti a chi
// se n'è già andato. Chi ha fatto il check-out resta consultabile — serve a chi
// deve chiudere conti e ritrovare una pratica — ma non toglie posto in cima.
//
// Cambiato il 14/08/2026: fino al giorno prima gli ospiti del giorno stavano in
// fondo, sotto agli usciti, perché senza camera nel rack non saprebbero dove
// stare. Vale ancora, ma dentro il gruppo: fra i presenti non ci sono più.
const rango = (c) => (isDayUse(c) ? 1 : (c.statoPartenza === 'checkout' ? 2 : 0));

function ordinaInCasa(clienti) {
  return (clienti || []).slice().sort((a, b) => {
    const outA = rango(a);
    const outB = rango(b);
    if (outA !== outB) return outA - outB;
    const ca = numeroCamera(a.camere);
    const cb = numeroCamera(b.camere);
    if (ca !== cb) return ca - cb;
    return String(a.camere || '').localeCompare(String(b.camere || ''));
  });
}

// Avanzamento del soggiorno alla data di lavoro: a che notte siamo e quante ne restano.
// `notte` è 1-based (il giorno dell'arrivo è la notte 1); alla partenza vale `notti`.
function avanzamento(c, data) {
  const notti = Number(c.notti);
  if (!c.dtarrivo || !data || !Number.isInteger(notti) || notti <= 0) return null;
  const g = (iso) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 86400000);
  const fatte = g(data) - g(c.dtarrivo);
  if (!Number.isFinite(fatte)) return null;
  const notte = Math.min(Math.max(fatte + 1, 1), notti);
  return { notte, notti, ultimaNotte: notte >= notti, restano: Math.max(notti - notte, 0) };
}

// Chi lascia l'hotel oggi: sia chi è ancora in camera con partenza odierna
// ('partenza'), sia chi ha già fatto il check-out ('checkout'). È il numero che
// la Home mostra come "Partenze oggi".
const parteOggi = (c) => c.statoPartenza === 'partenza' || c.statoPartenza === 'checkout';

// Riepilogo della giornata per le chip filtranti (contatori della lista mostrata).
function calcolaBriefingInCasa(clienti) {
  const b = briefingInCasaVuoto(0);
  for (const c of clienti || []) {
    const s = c.snapshot || {};
    // Gli ospiti del giorno hanno un contatore tutto loro: non sono "presenti"
    // (non occupano una camera) e non sono "usciti" (non hanno fatto check-in).
    if (isDayUse(c)) b.dayUse += 1;
    else if (c.statoPartenza === 'checkout') { b.usciti += 1; } else { b.presenti += 1; }
    if (parteOggi(c)) b.partonoOggi += 1;
    if (s.vip) b.vip += 1;
    if ((s.intolleranze && s.intolleranze.length) || s.indesiderato) b.alert += 1;
    if (s.reclami && s.reclami.totali) b.reclami += 1;
    if (s.compleanni && s.compleanni.length) b.ricorrenze += 1;
  }
  return b;
}

// Orchestratore: snapshot CRM (condiviso con gli Arrivi) + storico + avanzamento,
// il tutto ordinato per la reception.
async function arricchisciInCasa(pmsDb, crmDb, clienti, data) {
  if (!clienti || !clienti.length) return { briefing: briefingInCasaVuoto(0), clienti: clienti || [] };

  // Lo storico arriva già da arricchisciArrivi (stessa domanda su entrambe le
  // pagine): qui si aggiunge solo l'avanzamento del soggiorno, che negli arrivi
  // non avrebbe senso.
  const { arrivi: conSnapshot } = await arricchisciArrivi(pmsDb, crmDb, clienti);

  const arricchiti = conSnapshot.map((c) => ({
    ...c,
    avanzamento: avanzamento(c, data),
  }));

  return { briefing: calcolaBriefingInCasa(arricchiti), clienti: ordinaInCasa(arricchiti) };
}

module.exports = {
  arricchisciInCasa, briefingInCasaVuoto, calcolaBriefingInCasa,
  ordinaInCasa, numeroCamera, avanzamento, parteOggi, isDayUse,
};
