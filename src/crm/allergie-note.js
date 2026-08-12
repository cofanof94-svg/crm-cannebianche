// Allergie e intolleranze riconosciute nelle note del PMS.
//
// COSA FA: legge la nota libera di una prenotazione e propone i termini che
// sembrano allergie/intolleranze. NON scrive niente: restituisce proposte che
// l'operatore conferma con un clic, scegliendo anche A CHI attribuirle.
//
// PERCHÉ NON SCRIVE DA SOLO — due motivi trovati nelle note vere:
//  1) la nota è della PRENOTAZIONE, non della persona. "La signora è celiaca"
//     in una pratica con quattro ospiti non dice quale signora: scriverla
//     sull'intestatario significherebbe mettere l'allergia sulla persona
//     sbagliata, che è peggio del non averla (sposta l'attenzione della cucina).
//  2) "il bambino NON è allergico alle arachidi" è una frase che si scrive
//     davvero, ed è l'opposto di quello che una ricerca per parole capirebbe.
//
// PERCHÉ REGOLE E NON AI: il vocabolario è di venti termini, la risposta deve
// essere immediata e soprattutto SPIEGABILE — la proposta mostra la frase da cui
// nasce, così l'operatore giudica in due secondi invece di fidarsi.

// Sostanze: da sole non vogliono dire niente ("torta alle noci" è un dolce, non
// un'allergia). Contano solo se nella stessa frase c'è un marcatore.
const SOSTANZE = [
  { re: /\bglutine\b|\bgluten\b/i, termine: 'Glutine' },
  { re: /\blattosio\b|\blactose\b/i, termine: 'Lattosio' },
  { re: /\blatticin\w*/i, termine: 'Latticini' },
  { re: /\barachid\w*|\bpeanut\w*/i, termine: 'Arachidi' },
  { re: /\bfrutta a guscio\b|\bnoci\b|\bnocciol\w*|\bmandorl\w*|\bpistacch\w*|\banacard\w*/i, termine: 'Frutta a guscio' },
  { re: /\bcrostace\w*|\bgamber\w*|\bscampi\b|\baragost\w*/i, termine: 'Crostacei' },
  { re: /\bmollusch\w*|\bcozze\b|\bvongol\w*/i, termine: 'Molluschi' },
  { re: /\bpesce\b|\bpesci\b/i, termine: 'Pesce' },
  { re: /\buov\w+/i, termine: 'Uova' },
  { re: /\bsoia\b/i, termine: 'Soia' },
  { re: /\bsedano\b/i, termine: 'Sedano' },
  { re: /\bsesamo\b/i, termine: 'Sesamo' },
  { re: /\bsolfit\w*/i, termine: 'Solfiti' },
  { re: /\bfragol\w*/i, termine: 'Fragole' },
  { re: /\bnichel\b/i, termine: 'Nichel' },
  { re: /\blattice\b|\blatex\b/i, termine: 'Lattice' },
];

// Marcatori: dicono che quella sostanza è un problema, non un gradimento.
//
// Sono di due forze diverse, e trattarli allo stesso modo produceva falsi positivi.
// I FORTI parlano di allergie e basta: se compaiono nella frase, qualunque sostanza
// citata lì dentro è sospetta. I DEBOLI sono parole comunissime — "no", "niente",
// "senza" — che diventano marcatori solo se stanno attaccate alla sostanza:
//   "no glutine"                              → restrizione vera
//   "camera no fumatori, servire crostacei"   → non c'entra niente
// Da qui la regola di vicinanza: fra un marcatore debole e la sua sostanza ci
// possono stare al massimo due parole, e nessuna virgola — la virgola vuol dire
// che si sta già parlando d'altro.
const MARCATORE_FORTE = /\ballerg\w*|\bintolleran\w*|\bevita\w*|\bvietat\w*|\bnon può\b|\bnon puo\b/i;
const MARCATORE_DEBOLE = /\bno\b|\bniente\b|\bsenza\b/gi;
const PAROLE_FRA_DEBOLE_E_SOSTANZA = 2;

// Termini che valgono da soli, senza bisogno di marcatore.
const AUTONOMI = [
  { re: /\bceliac\w*/i, termine: 'Celiachia' },
  { re: /\bfavismo\b|\bfavic\w*/i, termine: 'Favismo' },
];

// Negazione dell'allergia stessa ("non è allergico", "nessuna allergia").
// ATTENZIONE alla differenza: "no glutine" è una restrizione VERA (il no cade
// sulla sostanza), "no allergie" è una negazione (il no cade sull'allergia).
// L'aggettivo in mezzo ("non hanno ALTRE allergie", "non ha PARTICOLARI
// intolleranze") è frequente nel parlato della reception: senza, la frase
// scivolerebbe oltre il filtro e finirebbe nel ramo "sostanza fuori elenco".
const NEGAZIONE = /\bnon\s+(?:è|e|ha|sono|hanno|risulta|risultano)?\s*(?:altre?\s+|particolari\s+|alcun\w*\s+|nessun\w*\s+)?(?:allergic|allergi|intolleran|celiac)|\bnessun\w*\s+(?:allergi|intolleran)|\bniente\s+allergi|\bno\s+allergi|\bnon\s+ci\s+sono\s+allergi/i;

// Coda dopo il marcatore, per i casi non in elenco: "allergica ai pollini".
// ATTENZIONE all'ordine delle alternative: in una regex vince la PRIMA che
// combacia, quindi le preposizioni lunghe vanno prima ("ai" prima di "a"),
// altrimenti "ai pollini" diventa "i pollini".
const PREPOSIZIONI = 'della|delle|degli|dello|alla|alle|agli|allo|del|dei|ai|ad|al|a';
// La cattura si ferma anche sui due punti: "allergica ai pollini: evitare i
// fiori" deve dare "pollini", non tutta la frase con le istruzioni operative.
// Il \b dopo \w* non è decorativo: senza, la regex tornava indietro dentro la
// parola stessa. Su "La signora è allergica" non trovando niente dopo si accontentava
// di "allergi" e proponeva "ca" come sostanza — e "Ca" finiva fra le allergie, in
// rosso, su un canale che deve restare credibile. Con il \b il ripiegamento a metà
// parola è impossibile: o c'è una sostanza dopo il marcatore, o non si propone nulla.
const DOPO_MARCATORE = new RegExp(`\\b(?:allergi\\w*|intolleran\\w*)\\b\\s*(?:${PREPOSIZIONI})?\\s*[:\\-—]?\\s*([^.;,:\\n]{2,40})`, 'i');
const CODA_MAX = 40;

// Dopo i due punti la reception scrive quasi sempre cosa fare, non cosa evita:
// "allergica: verificare in cucina" non è un'allergia chiamata "verificare in
// cucina". Queste code si buttano.
const ISTRUZIONE = /^(?:verificar|avvisar|avvertir|controllar|segnalar|informar|chieder|contattar|comunicar|ricordar|prepar|servir|evitar|confermar|vedi\b|come\b|da\s)/i;

// La nota è testo libero scritto a mano: si spezza su punti, punti e virgola e
// a capo. Ogni pezzo si valuta da solo, così una negazione non "contagia" il
// resto della nota e viceversa.
//
// Si spezza ANCHE sulle congiunzioni avversative, perché ribaltano il senso di
// quello che segue e senza di loro un'allergia vera spariva:
//   "Il bambino non ha allergie ma la madre è allergica al lattosio"
// era una frase sola, la negazione all'inizio la escludeva tutta, e il lattosio
// non veniva mai proposto. Nessuno se ne accorgeva.
//
// NON si spezza sulla virgola, benché sembri naturale: "Allergia a noci, arachidi
// e mandorle" diventerebbe tre pezzi, e "arachidi" da sola non ha più il marcatore
// che la rende un'allergia. Si perderebbero proprio gli elenchi, che sono il modo
// più comune di scrivere più allergie insieme.
const AVVERSATIVE = /\s+(?:ma|però|pero|mentre|invece|tuttavia)\s+/i;

function frasi(testo) {
  return String(testo == null ? '' : testo)
    .split(new RegExp(`[.;\\n\\r]+|${AVVERSATIVE.source}`, 'i'))
    .map((f) => String(f == null ? '' : f).replace(/\s+/g, ' ').trim())
    .filter((f) => f.length > 2);
}

// Quella sostanza è segnalata come problema, in questa frase?
// Marcatore forte ovunque nella frase, oppure marcatore debole attaccato davanti.
function marcata(frase, reSostanza) {
  if (MARCATORE_FORTE.test(frase)) return true;
  const m = frase.match(reSostanza);
  if (!m) return false;
  const inizio = m.index;
  MARCATORE_DEBOLE.lastIndex = 0; // la regex è globale: lo stato va azzerato a ogni giro
  let d;
  while ((d = MARCATORE_DEBOLE.exec(frase)) !== null) {
    const fine = d.index + d[0].length;
    if (fine > inizio) break; // il marcatore viene dopo la sostanza: non la qualifica
    const fra = frase.slice(fine, inizio);
    if (/[,;:]/.test(fra)) continue; // c'è di mezzo una pausa: sono due cose diverse
    if (fra.split(/\s+/).filter(Boolean).length <= PAROLE_FRA_DEBOLE_E_SOSTANZA) return true;
  }
  return false;
}

// Frase accorciata da mostrare nella proposta: si tiene il contorno del termine,
// perché è quello che permette all'operatore di dire sì o no in due secondi.
function ritaglia(frase, max = 120) {
  if (frase.length <= max) return frase;
  return `${frase.slice(0, max - 1).trim()}…`;
}

// Ripulisce la coda catturata ("ai pollini di betulla" → "Pollini di betulla").
function ripulisci(t) {
  let s = String(t || '').replace(/\s+/g, ' ').trim().replace(new RegExp(`^(?:${PREPOSIZIONI}|i|il|lo|la|le|gli|un|una)\\s+`, 'i'), '');
  // Se la cattura è arrivata al limite, l'ultima parola è quasi certamente
  // tagliata a metà ("fiori fresch"): si butta invece di salvarla monca.
  if (String(t || '').trim().length >= CODA_MAX && s.includes(' ')) s = s.slice(0, s.lastIndexOf(' ')).trim();
  if (!s || ISTRUZIONE.test(s)) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Proposte trovate in una nota: [{ termine, frase }], senza doppioni.
function estraiAllergie(nota) {
  const out = [];
  const visti = new Set();
  const aggiungi = (termine, frase) => {
    // Il controllo sul termine viene PRIMA di usarlo: `ripulisci` può tornare null
    // (coda vuota, o istruzione operativa scartata) e questa riga esplodeva.
    if (!termine) return;
    const chiave = termine.toLowerCase();
    if (visti.has(chiave)) return;
    visti.add(chiave);
    out.push({ termine, frase: ritaglia(frase) });
  };

  for (const frase of frasi(nota)) {
    if (NEGAZIONE.test(frase)) continue; // qui l'allergia viene esclusa, non dichiarata
    for (const a of AUTONOMI) if (a.re.test(frase)) aggiungi(a.termine, frase);
    let trovata = false;
    for (const s of SOSTANZE) {
      if (!s.re.test(frase)) continue;
      if (!marcata(frase, s.re)) continue; // sostanza nominata, ma non come problema
      aggiungi(s.termine, frase);
      trovata = true;
    }
    // Marcatore esplicito ma sostanza fuori elenco: si propone comunque il testo
    // che segue, perché "allergica ai pollini" è un'informazione da non perdere.
    if (!trovata && /\ballerg\w*|\bintolleran\w*/i.test(frase)) {
      const m = frase.match(DOPO_MARCATORE);
      if (m) aggiungi(ripulisci(m[1]), frase);
    }
  }
  return out;
}

// Proposte al netto di quelle già registrate sul cliente (confronto senza
// maiuscole): ciò che è già nella card non si ripropone.
function proponiDaNote(nota, giaPresenti) {
  const gia = new Set((giaPresenti || []).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean));
  return estraiAllergie(nota).filter((p) => !gia.has(p.termine.toLowerCase()));
}

module.exports = { estraiAllergie, proponiDaNote, frasi, SOSTANZE };
