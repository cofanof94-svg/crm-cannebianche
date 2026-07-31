// Trasformazione PURA (nessun DB) delle righe grezze estratte dal PMS in righe
// per booking_snapshot. È il cuore logico dell'import: qui si decide lo stato,
// la validità per i cumulativi e la normalizzazione degli importi.
// Testabile al 100% offline (vedi test/import-trasforma.test.js).
//
// ⚠️ Le euristiche (mapStato per i correnti partiti, pattern "spazzatura") vanno
// affinate sui dati veri in hotel: sono isolate qui apposta.

const { aggregaCumulativi } = require('../stats');

// Motivi "di servizio" in StorPrenota che NON sono soggiorni reali. Il grosso di
// questi record è comunque già eliminato (→ Cancellata → escluso); questo è un
// filtro di sicurezza aggiuntivo per gli eventuali non eliminati.
const MOTIVO_SPAZZATURA = /(doppia|doppio|test|prova|fittiz|errore|edit|gia'?\s*inser|già\s*inser|non\s*confermat|opzione|scadut|rilasciat|zero)/i;

function isSpazzatura(motivo) {
  const m = (motivo == null ? '' : String(motivo)).trim();
  if (!m) return false;
  if (m === '.' || m === '-') return true;
  return MOTIVO_SPAZZATURA.test(m);
}

// Stato desiderata: Confermata | Completata | Cancellata.
function mapStato({ dataEliminazione, isStorico, flgincasa }) {
  if (dataEliminazione) return 'Cancellata';
  if (isStorico) return 'Completata';                 // archiviata, non eliminata
  if (String(flgincasa || '').toUpperCase() === 'P') return 'Completata'; // corrente ma già partito
  return 'Confermata';                                // corrente in corso / futura
}

function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// Una prenotazione conta nei cumulativi se non è cancellata, non è spazzatura, e
// ha sostanza (importo maturato oppure occupanti reali in camera).
function isValidoCumulativi({ stato, motivo, impArrangiamento, impExtra, hasOccupanti }) {
  if (stato === 'Cancellata') return false;
  if (isSpazzatura(motivo)) return false;
  return num(impArrangiamento) > 0 || num(impExtra) > 0 || !!hasOccupanti;
}

function pulisci(v) {
  const s = (v == null ? '' : String(v)).trim();
  return s === '' ? null : s;
}

// raw: riga grezza da estrai.js. Ritorna la riga pronta per booking_snapshot.
function buildSnapshotRow(raw) {
  const stato = mapStato({ dataEliminazione: raw.dataEliminazione, isStorico: !!raw.isStorico, flgincasa: raw.flgincasa });
  const impArrangiamento = num(raw.impArrangiamento);
  const impExtra = num(raw.impExtra);
  const cityTax = num(raw.cityTax);
  return {
    codpratica: raw.codpratica,
    pmsCustomerId: raw.pmsCustomerId,
    dtarrivo: raw.dtarrivo || null,
    dtpartenza: raw.dtpartenza || null,
    notti: raw.notti == null ? null : Number(raw.notti),
    stato,
    source: pulisci(raw.source),
    mercato: pulisci(raw.mercato),
    camere: pulisci(raw.camere),
    tipologia: pulisci(raw.tipologia),
    trattamento: pulisci(raw.trattamento),
    pax: raw.pax == null ? null : Number(raw.pax),
    impArrangiamento,
    impExtra,
    cityTax,
    vipSnapshot: pulisci(raw.vipSnapshot),
    amenitiesSnapshot: pulisci(raw.amenitiesSnapshot),
    validoCumulativi: isValidoCumulativi({ stato, motivo: raw.motivo, impArrangiamento, impExtra, hasOccupanti: raw.hasOccupanti }),
    pmsUpdatedAt: raw.pmsUpdatedAt || null,
  };
}

// Cumulativi per cliente dalle sole righe snapshot valide. Delega al modulo
// condiviso src/stats.js mappando i nomi campo (imp* → arrangiamento/extra).
function calcolaCumulativiCliente(righeValide) {
  return aggregaCumulativi(righeValide.map((r) => ({
    arrangiamento: r.impArrangiamento, extra: r.impExtra, notti: r.notti, dtarrivo: r.dtarrivo, source: r.source, mercato: r.mercato,
  })));
}

module.exports = { mapStato, isSpazzatura, isValidoCumulativi, num, buildSnapshotRow, calcolaCumulativiCliente };
