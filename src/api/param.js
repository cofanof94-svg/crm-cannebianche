// Lettura dei parametri che arrivano da fuori (rotte e corpo delle richieste).
//
// Sta in un modulo suo perché la stessa difesa deve valere per tutte le rotte.
// Era nata dentro il router dei clienti dopo un incidente — una fusione con
// `memberId: true` che aveva creato un gruppo col codice 1, impossibile da
// scollegare — e per un po' è rimasta solo lì: il router degli utenti continuava a
// usare `Number()`. Una difesa applicata a metà è una difesa che qualcuno crede di
// avere.

// Intero da un parametro, o null se non è un intero scritto in cifre.
//
// `Number.isInteger(Number(v))` non basta: Number(true) è 1, Number('') e
// Number([]) sono 0, e passavano tutti per interi validi. Qui si accetta solo un
// numero vero o una stringa di sole cifre: niente '1e3', '0x10', '1.0', ''.
function intParam(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

module.exports = { intParam };
