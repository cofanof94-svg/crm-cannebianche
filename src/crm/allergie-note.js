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
// Le note dell'hotel NON sono solo in italiano: sui 30.934 testi veri esaminati il
// 13/08, delle note che parlano di allergie 235 sono italiane, 76 inglesi, 8
// tedesche e 8 francesi. La maggior parte degli ospiti è straniera, quindi ogni
// voce porta anche le forme delle altre lingue: senza, "gluten free" — l'espressione
// straniera più frequente, 29 note — non produceva niente.
const SOSTANZE = [
  { re: /\bglutine\b|\bgluten\w*\b|\bfrumento\b|\bwheat\b|\bweizen\b|\bblé\b/i, termine: 'Glutine' },
  { re: /\blattosio\b|\blactose\b|\blaktose\w*/i, termine: 'Lattosio' },
  { re: /\blatticin\w*|\bdairy\b|\bmilchprodukt\w*|\bproduits laitiers\b/i, termine: 'Latticini' },
  { re: /\barachid\w*|\bpeanut\w*|\berdnuss\w*|\bcacahuèt\w*/i, termine: 'Arachidi' },
  { re: /\bfrutta a guscio\b|\bnoci\b|\bnocciol\w*|\bmandorl\w*|\bpistacch\w*|\banacard\w*|\btree ?nuts?\b|\bnuts?\b|\bnüsse\b|\bnuss\b|\bfruits à coque\b/i, termine: 'Frutta a guscio' },
  { re: /\bcrostace\w*|\bgamber\w*|\bscampi\b|\baragost\w*|\bshellfish\b|\bshrimps?\b|\bprawns?\b|\bkrustentier\w*|\bcrustacés\b/i, termine: 'Crostacei' },
  { re: /\bmollusch\w*|\bcozze\b|\bvongol\w*|\bmussels?\b|\bclams?\b|\boysters?\b|\bostrich\w*/i, termine: 'Molluschi' },
  { re: /\bpesce\b|\bpesci\b|\bfish\b|\bfisch\b|\bpoisson\b/i, termine: 'Pesce' },
  { re: /\buov\w+|\begg\w*|\beier\b|\bœufs?\b|\boeufs?\b/i, termine: 'Uova' },
  { re: /\bsoia\b|\bsoy\w*\b|\bsoja\b/i, termine: 'Soia' },
  { re: /\bsedano\b|\bcelery\b|\bsellerie\b|\bcéleri\b/i, termine: 'Sedano' },
  { re: /\bsesamo\b|\bsesame\b|\bsesam\b/i, termine: 'Sesamo' },
  { re: /\bsolfit\w*|\bsulphit\w*|\bsulfit\w*/i, termine: 'Solfiti' },
  { re: /\bfragol\w*|\bstrawberr\w*|\berdbeer\w*/i, termine: 'Fragole' },
  { re: /\bnichel\b|\bnickel\b/i, termine: 'Nichel' },
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
// `allerg\w*` copre già l'inglese (allergic, allergy, allergies) e il tedesco
// (Allergie, allergisch). Le altre forme vanno aggiunte.
const MARCATORE_FORTE = /\ballerg\w*|\bintolleran\w*|\bevita\w*|\bvietat\w*|\bnon può\b|\bnon puo\b|\bunverträglich\w*|\bintoleran\w*|\bcannot (?:eat|have)\b|\bmust avoid\b|\bdoit éviter\b/i;
const MARCATORE_DEBOLE = /\bno\b|\bniente\b|\bsenza\b|\bohne\b|\bsans\b|\bwithout\b/gi;
const PAROLE_FRA_DEBOLE_E_SOSTANZA = 2;

// "X free" è una restrizione dichiarata, non un gradimento: vale da sola come
// "senza X", e nelle note straniere è la forma più comune in assoluto ("gluten
// free" da solo compare in 29 note). Il trattino e l'attaccato sono la norma.
// La stessa cosa in tedesco è un suffisso: glutenfrei, laktosefrei.
const SENZA_STRANIERO = /\b(gluten|lactose|dairy|milk|nut|nuts|soy|soya|egg|eggs|wheat|fish|shellfish|sesame)[\s-]*free\b|\b(gluten|laktose|weizen|nuss)frei\b/i;

// Termini che valgono da soli, senza bisogno di marcatore.
const AUTONOMI = [
  { re: /\bceliac\w*|\bcoeliac\w*|\bzöliakie\b|\bzoeliakie\b|\bcœliaque\b|\bcoeliaque\b/i, termine: 'Celiachia' },
  { re: /\bfavismo\b|\bfavic\w*|\bfavism\b/i, termine: 'Favismo' },
];

// Negazione dell'allergia stessa ("non è allergico", "nessuna allergia").
// ATTENZIONE alla differenza: "no glutine" è una restrizione VERA (il no cade
// sulla sostanza), "no allergie" è una negazione (il no cade sull'allergia).
// L'aggettivo in mezzo ("non hanno ALTRE allergie", "non ha PARTICOLARI
// intolleranze") è frequente nel parlato della reception: senza, la frase
// scivolerebbe oltre il filtro e finirebbe nel ramo "sostanza fuori elenco".
const NEGAZIONE = /\bnon\s+(?:è|e|ha|sono|hanno|risulta|risultano)?\s*(?:altre?\s+|particolari\s+|alcun\w*\s+|nessun\w*\s+)?(?:allergic|allergi|intolleran|celiac)|\bnessun\w*\s+(?:allergi|intolleran)|\bniente\s+allergi|\bno\s+allergi|\bnon\s+ci\s+sono\s+allergi|\b(?:do\s+not|don'?t|does\s+not|doesn'?t)\s+have\s+(?:any\s+)?allerg|\bno\s+known\s+allerg|\bwithout\s+allerg/i;

// Coda dopo il marcatore, per i casi non in elenco: "allergica ai pollini".
// ATTENZIONE all'ordine delle alternative: in una regex vince la PRIMA che
// combacia, quindi le preposizioni lunghe vanno prima ("ai" prima di "a"),
// altrimenti "ai pollini" diventa "i pollini".
// ATTENZIONE al confine di parola dopo la preposizione (il `\b` in DOPO_MARCATORE):
// senza, "ALLERGIE ALIMENTARI" faceva combaciare `al` con le prime due lettere di
// ALIMENTARI e proponeva "Imentari"; "allergica agli ANIMALI" proponeva "NIMALI".
// Trovati nelle note vere il 13/08, 30.934 testi.
// L'inglese "to" sta qui e non altrove: "allergic to feathers" proponeva
// "To feathers", perché nessuna preposizione italiana combaciava.
// Le forme con l'apostrofo vanno PRIMA, o "alla" combacia con "all'" lasciando
// l'apostrofo attaccato al termine: "allergia ALL'AGLIO" dava "All'aglio".
const PREPOSIZIONI = "all'|dell'|dall'|nell'|sull'|della|delle|degli|dello|alla|alle|agli|allo|del|dei|ai|ad|al|a|to|the|gegen|aux|au|à";
// La cattura si ferma anche sui due punti: "allergica ai pollini: evitare i
// fiori" deve dare "pollini", non tutta la frase con le istruzioni operative.
// Il \b dopo \w* non è decorativo: senza, la regex tornava indietro dentro la
// parola stessa. Su "La signora è allergica" non trovando niente dopo si accontentava
// di "allergi" e proponeva "ca" come sostanza — e "Ca" finiva fra le allergie, in
// rosso, su un canale che deve restare credibile. Con il \b il ripiegamento a metà
// parola è impossibile: o c'è una sostanza dopo il marcatore, o non si propone nulla.
// `allerg\w*` invece di `allergi\w*`: prende anche l'inglese (allergic, allergy).
// Il trattino conta come separatore solo se ha uno spazio davanti ("allergie -
// crostacei"). Senza il controllo, in "allergy-friendly room" il trattino veniva
// mangiato come separatore e restava un allergene chiamato "Friendly room":
// il marcatore invece era solo metà di una parola composta.
// Il punto esclamativo e quello interrogativo chiudono la cattura come il punto:
// "allergia agli animali! cercare di…" lasciava "Animali!" con la lama attaccata.
const DOPO_MARCATORE = new RegExp(
  `\\b(?:allerg\\w*|intolleran\\w*|unverträglich\\w*)\\b\\s*(?:(?:${PREPOSIZIONI})\\b)?\\s*(?:[:—]|(?<=\\s)-)?\\s*([^.;,:!?\\n]{2,40})`,
  'i'
);
const CODA_MAX = 40;

// In queste note "OK" introduce sempre una nota amministrativa — "OK SALDO",
// "OK ODS", "OK TRACCE" — e mai un allergene: la coda si taglia lì.
// Da "FORTE ALLERGIA AL CETRIOLO OK TRACCE" deve restare "Cetriolo".
const CODA_AMMINISTRATIVA = /\s+OK\b.*$/i;

// Dopo i due punti la reception scrive quasi sempre cosa fare, non cosa evita:
// "allergica: verificare in cucina" non è un'allergia chiamata "verificare in
// cucina". Queste code si buttano.
// Le voci dopo `inserir` vengono dalle note vere del 13/08: "chiedere rooming e
// intolleranze - inserire prenotazioni al ristorante per il 26" proponeva
// "Inserire prenotazioni al ristorante per" come se fosse un allergene.
const VERBI_ISTRUZIONE = 'verificar|avvisar|avvertir|controllar|segnalar|informar|chieder|contattar|comunicar|ricordar|prepar|servir|evitar|eliminar|rimuover|escluder|confermar|inserir|prenotar|prenotat|assegnar|cercar|richieder';
const ISTRUZIONE = new RegExp(`^(?:${VERBI_ISTRUZIONE}|vedi\\b|come\\b|da\\s|please\\b|pls\\b|ok\\b)`, 'i');

// Lo stesso verbo può comparire DENTRO la coda, non solo all'inizio: da lì in
// poi non si parla più della sostanza ma di cosa farne. Sui dati veri del
// 13/08/2026, "FORTE ALLERGIA AL CETRIOLO EVITARE IN CIBI E BEVANDE" produceva
// un allergene chiamato "Cetriolo evitare in cibi e bevande" — che oltre a
// essere illeggibile in cucina non combaciava più con il "Cetriolo" trovato
// nella nota della prenotazione, quindi la stessa allergia usciva due volte.
const CODA_ISTRUZIONE = new RegExp(`\\s+(?:${VERBI_ISTRUZIONE})\\w*\\b.*$`, 'i');

// Un verbo coniugato apre un'altra frase: quello che segue non è più la
// sostanza. Da "allergici agli animali e volevano una camera pet-free garantita"
// (arrivo del 07/09/2026) usciva un allergene chiamato "Animali e volevano una
// camera pet-free". La lista è volutamente corta e fatta di forme intere: un
// elenco più largo comincerebbe a tagliare nomi di sostanze.
const CODA_ALTRA_FRASE = /\s+(?:e\s+)?(?:volev\w+|vogliono|vuole|chiedon?o|preferisc\w+|desider\w+|necessit\w+|richiedon?o|gradisc\w+)\b.*$/i;

// Congiunzione o preposizione rimasta appesa dopo un taglio: "animali e" → "animali".
const CONGIUNZIONE_FINALE = /\s+(?:e|ed|o|con|per|che|ma|piu|più)$/i;

// Un dimostrativo davanti al marcatore rimanda a un'allergia già detta altrove:
// "comunicare QUESTA allergia ai ristoranti prenotati per nostro conto" non ne
// dichiara una nuova, e la coda ("ai ristoranti…") non è una sostanza.
// Il primo tentativo era più grosso — saltare le frasi che si aprono con una
// cortesia ("si prega", "please") — e buttava via una nota vera: "please
// provide twin beds…, we are strictly non smokers and allergic to feather
// pillow" comincia con una cortesia ma un'allergia la dichiara eccome.
const MARCATORE_ANAFORICO = /\b(?:questa|questo|quest'|tale|the|this|his|her|their|la\s+sua|il\s+suo)\s+(?:allerg|intolleran)/i;

// Marcatore incollato a un'altra parola con il trattino: "allergy-friendly
// room" non dichiara un'allergia, chiede una camera. La coda comincia col
// trattino proprio perché il marcatore è metà di una parola composta.
const CODA_COMPOSTA = /^\s*-/;

// Code che dicono "ci sono allergie" senza dire QUALI: proporle come allergene
// significherebbe mettere in cucina una voce chiamata "Alimentari".
// "INTOLLERANZE NON COMUNICATE" dice che non si sa niente, non che l'ospite è
// intollerante a una cosa chiamata "Non comunicate". Stessa famiglia di
// "ALLERGIE ALIMENTARI": la nota annuncia allergie senza dire quali.
const GENERICO = /^(?:[/\\|]|alimentar\w*|food\b|alimentaires?\b|varie\b|vari\b|multiple\b|several\b|note\b|notes\b|in\s+nota|nelle\s+note|non\s+comunicat\w*|non\s+segnalat\w*|non\s+specificat\w*|da\s+comunicar\w*|da\s+chieder\w*|da\s+verificar\w*|sconosciut\w*)/i;

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
  // "gluten free", "laktosefrei": qui il marcatore viene DOPO la sostanza ed è
  // attaccato. Si guarda solo il pezzetto subito successivo, non tutta la frase,
  // per non far passare un "free" che parla d'altro (free upgrade, free wifi).
  // In tedesco il suffisso resta attaccato: "glutenfrei" è una parola sola.
  if (/(?:frei|free)$/i.test(m[0])) return true;
  if (/^[\s-]*free\b|^frei\b/i.test(frase.slice(inizio + m[0].length))) return true;
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
  const grezzo = String(t || '')
    .replace(CODA_AMMINISTRATIVA, '')
    .replace(CODA_ISTRUZIONE, '')
    .replace(CODA_ALTRA_FRASE, '')
    .replace(CONGIUNZIONE_FINALE, '');
  let s = grezzo.replace(/\s+/g, ' ').trim().replace(new RegExp(`^(?:${PREPOSIZIONI}|i|il|lo|la|le|gli|un|una)\\b\\s+`, 'i'), '');
  // Se la cattura è arrivata al limite, l'ultima parola è quasi certamente
  // tagliata a metà ("fiori fresch"): si butta invece di salvarla monca.
  // Il taglio non si applica se la coda amministrativa ha già accorciato il testo.
  if (grezzo.length >= CODA_MAX && String(t || '').trim().length >= CODA_MAX && s.includes(' ')) {
    s = s.slice(0, s.lastIndexOf(' ')).trim();
  }
  // Anche dopo aver buttato l'ultima parola può restare appesa una congiunzione.
  s = s.replace(CONGIUNZIONE_FINALE, '').trim();
  // Meno di tre lettere non è una sostanza: è un pezzo di frase rimasto dopo un
  // taglio. Da "ALLERGIE DA COMUNICARE" restava "Da".
  if (s.length < 3 || ISTRUZIONE.test(s) || GENERICO.test(s)) return null;
  // Le note del gestionale sono spesso scritte tutte in maiuscolo ("ALLERGIA AL
  // MAIALE"): ricopiandole si finiva con proposte che urlano in mezzo a termini
  // scritti normalmente. Se non c'è nemmeno una minuscola, il testo è del tutto
  // maiuscolo e va riportato alla forma normale; se le minuscole ci sono, non si
  // tocca niente, perché potrebbero esserci sigle volute.
  if (!/[a-zàèéìòù]/.test(s)) s = s.toLowerCase();
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
    // Non però quando il marcatore richiama un'allergia detta altrove ("questa
    // allergia"), o quando è metà di una parola composta ("allergy-friendly").
    if (!trovata && !MARCATORE_ANAFORICO.test(frase) && /\ballerg\w*|\bintolleran\w*/i.test(frase)) {
      const m = frase.match(DOPO_MARCATORE);
      if (m && !CODA_COMPOSTA.test(m[1])) aggiungi(ripulisci(m[1]), frase);
    }
  }
  return out;
}

// Le allergie già registrate arrivano in due forme: testi puri, oppure
// `{ testo, chi }` da quando ognuna porta il nome di chi la ha (decisione D2 del
// 12/08/2026). Reggere entrambe non è pigrizia: quel giorno la forma è cambiata
// nella card e qui no, e per un mese il confronto ha lavorato su
// "[object Object]" — cioè un'allergia già salvata veniva riproposta a ogni
// ricaricamento della pagina, proprio dove si chiede all'operatore di fidarsi.
function testiGiaPresenti(lista) {
  const out = new Set();
  for (const v of lista || []) {
    const testo = (v && typeof v === 'object') ? v.testo : v;
    const s = String(testo == null ? '' : testo).trim().toLowerCase();
    if (s) out.add(s);
  }
  return out;
}

// Proposte al netto di quelle già registrate sul cliente (confronto senza
// maiuscole): ciò che è già nella card non si ripropone.
function proponiDaNote(nota, giaPresenti) {
  const gia = testiGiaPresenti(giaPresenti);
  return estraiAllergie(nota).filter((p) => !gia.has(p.termine.toLowerCase()));
}

// Tutte le proposte di un soggiorno, dalle due fonti che il gestionale offre.
//
// Sono fonti diverse per natura, non due copie della stessa cosa:
// - `annotazioni` sta sull'ANAGRAFICA della singola persona, quindi si sa di chi
//   parla: l'operatore deve solo dire sì o no;
// - `nota` sta sulla PRATICA, che può avere quattro occupanti: "la signora è
//   allergica ai crostacei" non dice quale signora, e la persona la sceglie chi
//   sa leggerla.
//
// Quando lo stesso termine arriva da entrambe vince l'anagrafica, perché porta
// l'attribuzione certa. Caso reale del 13/08/2026: la pratica 63755 e
// l'anagrafica 81241 dicono tutte e due "cetriolo" dello stesso ospite.
//
// `annotazioni`: [{ codCli, nome, testo }] — di norma il referente e gli occupanti.
function proponiPerSoggiorno({ nota, annotazioni, giaPresenti } = {}) {
  const gia = testiGiaPresenti(giaPresenti);
  const out = [];
  const daAnagrafica = new Set();

  for (const a of annotazioni || []) {
    if (!a || !Number.isInteger(a.codCli) || !a.testo) continue;
    for (const p of estraiAllergie(a.testo)) {
      const chiave = p.termine.toLowerCase();
      if (gia.has(chiave)) continue;
      // Una persona sola non ha bisogno di due volte la stessa allergia, ma due
      // persone diverse con la stessa allergia restano due proposte distinte:
      // vanno registrate su entrambe.
      if (out.some((x) => x.codCli === a.codCli && x.termine.toLowerCase() === chiave)) continue;
      daAnagrafica.add(chiave);
      out.push({ termine: p.termine, frase: p.frase, fonte: 'anagrafica', codCli: a.codCli, nome: a.nome || null });
    }
  }

  for (const p of estraiAllergie(nota)) {
    const chiave = p.termine.toLowerCase();
    if (gia.has(chiave) || daAnagrafica.has(chiave)) continue;
    out.push({ termine: p.termine, frase: p.frase, fonte: 'prenotazione', codCli: null, nome: null });
  }
  return out;
}

module.exports = { estraiAllergie, proponiDaNote, proponiPerSoggiorno, frasi, SOSTANZE };
