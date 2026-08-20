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
  // `milch` da sola serve al composto tedesco (Milchallergie): senza, restava
  // fuori proprio la parola più comune per il latte.
  { re: /\blatticin\w*|\bdairy\b|\bmilch\b|\bmilchprodukt\w*|\bproduits laitiers\b/i, termine: 'Latticini' },
  { re: /\barachid\w*|\bpeanut\w*|\berdnuss\w*|\bcacahuèt\w*/i, termine: 'Arachidi' },
  { re: /\bfrutta a guscio\b|\bnoci\b|\bnocciol\w*|\bmandorl\w*|\bpistacch\w*|\banacard\w*|\btree ?nuts?\b|\bnuts?\b|\bnüsse\b|\bnuss\b|\bfruits à coque\b/i, termine: 'Frutta a guscio' },
  { re: /\bcrostace\w*|\bgamber\w*|\bscampi\b|\baragost\w*|\bshellfish\b|\bshrimps?\b|\bprawns?\b|\bkrustentier\w*|\bcrustacés\b/i, termine: 'Crostacei' },
  { re: /\bmollusch\w*|\bcozze\b|\bvongol\w*|\bmussels?\b|\bclams?\b|\boysters?\b|\bostrich\w*/i, termine: 'Molluschi' },
  { re: /\bpesce\b|\bpesci\b|\bfish\b|\bfisch\b|\bpoisson\b/i, termine: 'Pesce' },
  // `œ` non è una lettera di parola per JavaScript, quindi `\bœufs\b` non
  // combaciava MAI: al posto del confine iniziale, "non preceduto da una
  // lettera". La forma senza legatura (`oeufs`) funzionava già.
  { re: /\buov\w+|\begg\w*|\beier\b|(?<![a-zà-öø-ÿ])œufs?\b|\boeufs?\b/i, termine: 'Uova' },
  { re: /\bsoia\b|\bsoy\w*\b|\bsoja\b/i, termine: 'Soia' },
  { re: /\bsedano\b|\bcelery\b|\bsellerie\b|\bcéleri\b/i, termine: 'Sedano' },
  { re: /\bsesamo\b|\bsesame\b|\bsesam\b/i, termine: 'Sesamo' },
  { re: /\bsolfit\w*|\bsulphit\w*|\bsulfit\w*/i, termine: 'Solfiti' },
  { re: /\bfragol\w*|\bstrawberr\w*|\berdbeer\w*/i, termine: 'Fragole' },
  { re: /\bnichel\b|\bnickel\b/i, termine: 'Nichel' },
  { re: /\blattice\b|\blatex\b/i, termine: 'Lattice' },
  // Le piume non si mangiano, ma qui sono l'allergene più ricorrente dopo il
  // glutine: cuscini, piumini, coperte. Restavano fuori dall'elenco e uscivano
  // come code di testo libero, ogni volta scritte diversamente — "Piume d'oca",
  // "Down feathers in pillows and bedding", "Feathers pls request no feather
  // pillows" — cioè tre voci diverse in cucina e in governante per la stessa
  // cosa. Con la sostanza in elenco diventano tutte "Piume".
  // `pium\w*` prendeva anche PIUMINO e PIUMONE, che in un albergo di mare sono
  // la coperta: "camera senza piumino, fa caldo" diventava un allarme piume
  // (20/08/2026). Ora si elencano le forme che sono davvero l'allergene —
  // piuma, piume, piumaggio — e restano fuori quelle che sono un oggetto.
  { re: /\bpium[ae]\b|\bpiumagg\w*|\bfeather\w*|\bdown\s+(?:pillow|feather|duvet)\w*|\bdaunen\w*|\bfeder(?:n|kissen)\b|\bplume[sn]?\b/i, termine: 'Piume' },
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
// I marcatori forti erano UNO SOLO e valevano in TUTTA la frase, senza il
// vincolo di vicinanza che i deboli hanno sempre avuto. Dal 19/08/2026 sono due
// famiglie, perché misurando si è visto che non si comportano allo stesso modo.
//
//   "Vietato fumare in camera, gradisce il pesce a cena"  → proponeva Pesce
//   "Allergie del gruppo: arachidi, noci, sedano, sesamo e solfiti"  → giusta
//
// La distanza DA SOLA non separa i due casi: per uccidere il primo serve una
// soglia stretta, e a quella soglia si perde il secondo, dove l'ultimo elemento
// dell'elenco sta a sette parole dal marcatore. Un elenco vero è più lungo di
// una frase amministrativa.
//
// Quindi: le parole che parlano SOLO di allergie restano valide anche a
// distanza; i verbi di divieto, che nelle note dell'hotel parlano di scale,
// fumo, piscina e camere molto più spesso che di cibo, valgono solo se vicini.
const MARCATORE_ALLERGIA = /\ballerg\w*|\bintolleran\w*|\bintoleran\w*|\bunverträglich\w*/i;
// `non può` finiva con una vocale accentata seguita da `\b`: in JavaScript il
// confine di parola non riconosce le lettere accentate, quindi non combaciava
// MAI — nemmeno da solo. Funzionava solo `non puo` senza accento, cioè la nota
// scritta male. Al posto del confine, "non seguito da una lettera".
const MARCATORE_DIVIETO = /\bevita\w*|\bvietat\w*|\bnon pu(?:ò|o)(?![a-zà-öø-ÿ])|\bcannot (?:eat|have)\b|\bmust avoid\b|\bdoit éviter\b/i;
// Quante parole possono stare fra il marcatore e la sostanza. Misurate: sotto le
// otto la famiglia "allergia" comincia a perdere gli elenchi; sopra le quattro
// la famiglia "divieto" ricomincia a raccogliere frasi che parlano d'altro.
const PAROLE_FRA_ALLERGIA_E_SOSTANZA = 10;
const PAROLE_FRA_DIVIETO_E_SOSTANZA = 4;
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
// Le forme in altre lingue sono state aggiunte il 19/08/2026, decisione di Mik.
// Prima erano un DANNO, non una mancanza: "keine Allergien gegen Nüsse" e "pas
// allergique aux noix" producevano l'allergene GIUSTO con il significato
// RIBALTATO, cioè un allarme in cucina su una nota che dice l'opposto; "senza
// allergie particolari" e "aucune allergie connue" producevano addirittura un
// allergene inventato ("Particolari", "Connue"), che sul foglio dei reparti è il
// genere di voce che fa smettere di fidarsi del canale.
//
// LA REGOLA CHE TIENE INSIEME TUTTO: la negazione scatta solo davanti alle
// parole ALLERGIA / INTOLLERANZA, mai davanti a una sostanza. "Senza glutine"
// resta una restrizione vera, "senza allergie" è una negazione. Vale identica
// nelle quattro lingue: `ohne Nüsse` e `sans gluten` restano allarmi, `ohne
// Allergien` e `sans allergies` no.
const NEGAZIONE = new RegExp([
  // italiano
  /\bnon\s+(?:è|e|ha|sono|hanno|risulta|risultano)?\s*(?:altre?\s+|particolari\s+|alcun\w*\s+|nessun\w*\s+)?(?:allergic|allergi|intolleran|celiac)/,
  /\bnessun\w*\s+(?:allergi|intolleran)/,
  /\bniente\s+allergi/,
  /\bno\s+allergi/,
  /\bnon\s+ci\s+sono\s+allergi/,
  /\bsenza\s+(?:altre?\s+|particolari\s+|alcun\w*\s+)?(?:allergi|intolleran)/,
  /\b(?:allergi\w*|intolleran\w*)\s*[:\-]\s*(?:nessun\w*|niente|nulla|no\b|n\/?a\b)/,
  // inglese
  /\b(?:do\s+not|don'?t|does\s+not|doesn'?t)\s+have\s+(?:any\s+)?allerg/,
  /\bno\s+known\s+allerg/,
  /\bwithout\s+allerg/,
  /\b(?:not|isn'?t|aren'?t)\s+allergic/,
  /\ballergies?\s*[:\-]\s*(?:none|no\b|n\/?a\b)/,
  // tedesco — `keine Allergien`, `nicht allergisch`, `ohne Allergien`
  /\bkeine\w*\s+(?:bekannten\s+|weiteren\s+|besonderen\s+)?(?:allergi|unverträglich|lebensmittelallergi)/,
  // In tedesco la forma normale è la parola composta: `keine Nussallergie`, non
  // `keine Allergie gegen Nüsse`. Qui il composto è già stato scomposto
  // (`keine Nuss allergie`), quindi fra la negazione e il marcatore c'è la
  // sostanza: una parola sola, senza pause in mezzo, perché `keine Nüsse,
  // Allergie gegen Fisch` sono due affermazioni diverse e la seconda va tenuta.
  /\b(?:keine\w*|ohne)\s+\w+\s+(?:allergi|intoleranz|unverträglichkeit)/,
  /\bnicht\s+allergisch/,
  /\bohne\s+allergi/,
  // francese — `aucune allergie`, `pas allergique`, `sans allergie`
  /\baucune?\w*\s+(?:autre\s+|particulière\s+)?(?:allergi|intoléran)/,
  /\bpas\s+allergique/,
  /\bsans\s+allergi/,
  // `pas d'allergie au gluten` è il modo più comune di negare in francese ed era
  // l'unico che mancava: senza questa riga la frase proponeva il glutine, cioè
  // il contrario di quello che c'è scritto. L'apostrofo tipografico conta:
  // arriva così da chi scrive su Word e lo incolla nel gestionale.
  /\bpas\s+d['’]\s*(?:allergi|intol[ée]ran)/,
].map((r) => r.source).join('|'), 'i');

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
// Le preposizioni stanno in due gruppi perché finiscono in modo diverso, e la
// fine decide come si chiude il confronto.
//
// Quelle con l'apostrofo non hanno bisogno di nessun confine: dopo `all'` viene
// subito la parola ("all'aglio").
// Quelle che finiscono con una lettera devono NON essere seguite da un'altra
// lettera, altrimenti `al` si mangerebbe le prime due lettere di ALIMENTARI.
// Qui prima c'era `\b`, che però con la francese `à` non funziona mai: il
// confine di parola non riconosce le lettere accentate, quindi "allergie À LA
// FRAISE" non si accorciava e proponeva un allergene chiamato "À la fraise pour
// la petite" (corretto il 19/08/2026).
const PREP_APOSTROFO = "all'|dell'|dall'|nell'|sull'";
const PREP_PAROLA = 'della|delle|degli|dello|alla|alle|agli|allo|del|dei|ai|ad|al|a|to|the|gegen|aux|au|à';
const NON_LETTERA = '(?![a-zà-öø-ÿ])';
const PREPOSIZIONI = `(?:${PREP_APOSTROFO}|(?:${PREP_PAROLA})${NON_LETTERA})`;
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
  `\\b(?:allerg\\w*|intolleran\\w*|unverträglich\\w*)\\b\\s*(?:${PREPOSIZIONI})?\\s*(?:[:—]|(?<=\\s)-)?\\s*([^.;,:!?\\n]{2,40})`,
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
// Gli AGGETTIVI DI GRAVITÀ e i PARTICIPI PASSATI sono stati aggiunti il
// 20/08/2026. Producevano allergeni che non sono sostanze: "ALLERGIA GRAVE"
// diventava un allergene chiamato «Grave», "Allergia segnalata dal cliente"
// diventava «Segnalata dal cliente». Il danno non è il singolo caso: una voce
// del genere su un foglio che va in cucina fa smettere di fidarsi anche di
// quelle vere.
// I participi non erano coperti da VERBI_ISTRUZIONE, che è fatta di temi
// (`segnalar`, `comunicar`) e non prende le forme concordate.
const GENERICO = /^(?:[/\\|]|alimentar\w*|food\b|alimentaires?\b|varie\b|vari\b|multiple\b|several\b|note\b|notes\b|in\s+nota|nelle\s+note|non\s+comunicat\w*|non\s+segnalat\w*|non\s+specificat\w*|da\s+comunicar\w*|da\s+chieder\w*|da\s+verificar\w*|sconosciut\w*|grav\w*|seri[ao]\b|important\w*|liev[ei]\b|leggier\w*|forte\b|nota\b|not[ae]\s+da\b|segnalat\w*|comunicat\w*|confermat\w*|verificat\w*|richiest\w*|riferit\w*|dichiarat\w*|indicat\w*|present[ei]\b|conosciut\w*|noted?\b|severe\b|serious\b|mild\b|bekannt\w*|schwer\w*|connue?s?\b|grave?s?\b)/i;

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
// Quante parole ci sono fra un marcatore e la sostanza. Il marcatore può stare
// prima ("allergia al glutine") o dopo ("glutine, allergia nota"): si guardano
// tutte le occorrenze e basta che UNA sia abbastanza vicina.
// `rompiSuPausa`: una virgola o due punti fra il marcatore e la sostanza dicono
// che sono due cose diverse. Vale per i DIVIETI — "evitare rumori, servire il
// pesce alla griglia" sono due istruzioni, non un'allergia al pesce — ed è la
// stessa regola che i marcatori deboli hanno sempre avuto.
// NON vale per la famiglia "allergia": lì la virgola è proprio il modo in cui si
// scrive un elenco ("allergie: arachidi, noci, sedano"), e romperci sopra
// perderebbe tutto tranne il primo.
function marcatoreVicino(frase, re, inizio, fine, maxParole, rompiSuPausa) {
  const g = new RegExp(re.source, 'gi');
  let m;
  while ((m = g.exec(frase)) !== null) {
    const a = m.index;
    const b = a + m[0].length;
    if (m[0].length === 0) { g.lastIndex += 1; continue; }
    if (b > inizio && a < fine) return true; // marcatore e sostanza si sovrappongono
    const fra = b <= inizio ? frase.slice(b, inizio) : frase.slice(fine, a);
    if (rompiSuPausa && /[,;:]/.test(fra)) continue;
    if (fra.split(/\s+/).filter(Boolean).length <= maxParole) return true;
  }
  return false;
}

// La stessa sostanza può comparire più volte nella frase, e solo una delle volte
// essere quella che conta: "servire il pesce al tavolo 4, la moglie non può
// mangiare pesce". Guardando solo la prima occorrenza — quella innocua — il
// divieto vero spariva senza lasciare traccia. Si provano tutte: basta che UNA
// sia marcata.
function marcata(frase, reSostanza) {
  const g = new RegExp(reSostanza.source, 'gi');
  let m;
  while ((m = g.exec(frase)) !== null) {
    if (m[0].length === 0) { g.lastIndex += 1; continue; }
    if (marcataQui(frase, m)) return true;
  }
  return false;
}

function marcataQui(frase, m) {
  const inizio = m.index;
  const fineSostanza = inizio + m[0].length;
  if (marcatoreVicino(frase, MARCATORE_ALLERGIA, inizio, fineSostanza, PAROLE_FRA_ALLERGIA_E_SOSTANZA, false)) return true;
  if (marcatoreVicino(frase, MARCATORE_DIVIETO, inizio, fineSostanza, PAROLE_FRA_DIVIETO_E_SOSTANZA, true)) return true;
  // "gluten free", "laktosefrei": qui il marcatore viene DOPO la sostanza ed è
  // attaccato. Si guarda solo il pezzetto subito successivo, non tutta la frase,
  // per non far passare un "free" che parla d'altro (free upgrade, free wifi).
  // In tedesco il suffisso resta attaccato: "glutenfrei" è una parola sola.
  if (/(?:frei|free)$/i.test(m[0])) return true;
  // `frei` va accettato anche staccato: i composti tedeschi arrivano qui già
  // scomposti ("weizenfrei" diventa "weizen frei"), e prima solo `free` poteva
  // avere uno spazio davanti.
  if (/^[\s-]*(?:free|frei)\b/i.test(frase.slice(inizio + m[0].length))) return true;
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
  let s = grezzo.replace(/\s+/g, ' ').trim()
    // Un inciso o le virgolette in testa: "Allergia (grave) ai pollini" dava un
    // allergene chiamato «(grave) ai pollini», perché la guardia sulle parentesi
    // scatta solo su quella CHIUSA e lo stacco della preposizione non partiva,
    // visto che il termine cominciava con la parentesi (20/08/2026).
    // Si toglie l'inciso e si riparte: quello che resta è la sostanza vera.
    .replace(/^\((?:[^)]{0,30})\)\s*/, '')
    .replace(/^\[(?:[^\]]{0,30})\]\s*/, '')
    .replace(/^["“”«»']+\s*/, '')
    .replace(/\s*["“”«»']+$/, '')
    .replace(new RegExp(`^(?:${PREPOSIZIONI}|(?:i|il|lo|la|le|gli|un|una)${NON_LETTERA})\\s+`, 'i'), '');
  // Se la cattura è arrivata al limite, l'ultima parola è quasi certamente
  // tagliata a metà ("fiori fresch"): si butta invece di salvarla monca.
  // Il taglio non si applica se la coda amministrativa ha già accorciato il testo.
  if (grezzo.length >= CODA_MAX && String(t || '').trim().length >= CODA_MAX && s.includes(' ')) {
    s = s.slice(0, s.lastIndexOf(' ')).trim();
  }
  // Anche dopo aver buttato l'ultima parola può restare appesa una congiunzione.
  // Parentesi che si chiude senza essersi mai aperta: la cattura è entrata in
  // un inciso cominciato prima del marcatore. "Frutta secca) CON MENù ALLA
  // CARTA" finisce a "Frutta secca". Se invece la parentesi è aperta dentro il
  // termine — "Penicillin (PCN)" — è parte del nome e non si tocca.
  const chiusa = s.indexOf(')');
  if (chiusa > -1 && s.lastIndexOf('(', chiusa) === -1) s = s.slice(0, chiusa);
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
// Il tedesco incolla la sostanza al marcatore in una parola sola —
// Nussallergie, Laktoseintoleranz, Weizenallergie, weizenfrei — e il
// riconoscimento cercava `allerg` all'INIZIO di una parola: la forma composta,
// che in tedesco è la regola, non arrivava mai in cucina (20/08/2026).
//
// La correzione ovvia sarebbe cercare `allerg` anche dentro le parole, ma
// farebbe scattare il marcatore su "cuscino ANALLERGICO", che significa
// l'opposto. Quindi si va al contrario: si riconosce la parola che FINISCE col
// marcatore e si stacca il pezzo davanti SOLO se è una sostanza già conosciuta.
// Così "anallergico" resta fuori per costruzione (il pezzo davanti sarebbe
// "an", che non è una sostanza), e lo stesso vale per "Sonnenallergie" o
// "Lebensmittelallergie": il marcatore da solo, senza una sostanza scritta, non
// deve proporre niente.
const COMPOSTO_TEDESCO = /\b([a-zäöüß]{3,}?)(allergien?|intoleranz(?:en)?|unverträglichkeit(?:en)?|frei)\b/gi;

function scomponiCompostiTedeschi(testo) {
  return String(testo == null ? '' : testo).replace(
    COMPOSTO_TEDESCO,
    (tutto, prefisso, marcatore) => (SOSTANZE.some((s) => s.re.test(prefisso)) ? `${prefisso} ${marcatore}` : tutto)
  );
}

// Una negazione vale per il pezzo di frase in cui è scritta, non per tutta la
// frase. "Allergica al pesce, non ha altre allergie" dichiara un'allergia e poi
// dice che non ce ne sono altre: saltando tutto, il pesce non arrivava in cucina.
// Si spezza sulla virgola SOLO qui e SOLO quando una negazione c'è davvero: un
// elenco ("allergie: arachidi, noci, sedano") non ne contiene nessuna e resta
// intero, che è il motivo per cui `frasi` non spezza sulla virgola.
function senzaNegazioni(frase) {
  if (!NEGAZIONE.test(frase)) return frase;
  return frase.split(',').filter((p) => !NEGAZIONE.test(p)).join(',').trim();
}

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

  // Si riconoscono le allergie sul testo lavorato (composti tedeschi scomposti,
  // pezzi negati tolti), ma si MOSTRA la frase come è scritta nel gestionale:
  // chi decide in due secondi deve leggere la nota vera, non una sua versione
  // interna che nel PMS non esiste.
  for (const originale of frasi(nota)) {
    const frase = senzaNegazioni(scomponiCompostiTedeschi(originale));
    if (!frase) continue; // la frase diceva solo che allergie non ce ne sono
    for (const a of AUTONOMI) if (a.re.test(frase)) aggiungi(a.termine, originale);
    let trovata = false;
    for (const s of SOSTANZE) {
      if (!s.re.test(frase)) continue;
      if (!marcata(frase, s.re)) continue; // sostanza nominata, ma non come problema
      aggiungi(s.termine, originale);
      trovata = true;
    }
    // Marcatore esplicito ma sostanza fuori elenco: si propone comunque il testo
    // che segue, perché "allergica ai pollini" è un'informazione da non perdere.
    // Non però quando il marcatore richiama un'allergia detta altrove ("questa
    // allergia"), o quando è metà di una parola composta ("allergy-friendly").
    if (!trovata && !MARCATORE_ANAFORICO.test(frase) && /\ballerg\w*|\bintolleran\w*/i.test(frase)) {
      const m = frase.match(DOPO_MARCATORE);
      if (m && !CODA_COMPOSTA.test(m[1])) aggiungi(ripulisci(m[1]), originale);
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

// Le allergie già registrate, ma sapendo DI CHI sono: chiave `codice|testo`.
//
// Serve al ramo delle annotazioni di anagrafica, dove la persona è certa. Con il
// solo testo, un'allergia registrata su un occupante zittiva la stessa allergia
// di TUTTI gli altri: due celiaci nella stessa pratica diventavano un piatto
// solo, e la seconda proposta non nasceva più — in silenzio, che è il modo
// peggiore di perdere un dato di sicurezza (decisione del 19/08/2026).
//
// Le righe senza un codice riconoscibile finiscono in `senzaPersona`: di quelle
// non si sa a chi appartengano, quindi continuano a zittire tutti. Meglio una
// proposta in meno che ripresentare all'infinito una riga già lavorata.
function giaPresentiPerPersona(lista) {
  const perPersona = new Set();
  const senzaPersona = new Set();
  for (const v of lista || []) {
    if (!v || typeof v !== 'object') { continue; }
    const s = String(v.testo == null ? '' : v.testo).trim().toLowerCase();
    if (!s) continue;
    if (Number.isInteger(v.codCli)) perPersona.add(`${v.codCli}|${s}`);
    else senzaPersona.add(s);
  }
  return { perPersona, senzaPersona };
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
function proponiPerSoggiorno({ nota, note, annotazioni, giaPresenti } = {}) {
  const gia = testiGiaPresenti(giaPresenti);
  // Sulle annotazioni di anagrafica si sa di chi è l'allergia, quindi il
  // confronto con ciò che è già registrato è per PERSONA. Sulla nota della
  // prenotazione la persona non si sa — "la signora è celiaca" in una pratica da
  // quattro non dice quale — e lì resta il confronto per solo testo: riproporla
  // a ogni apertura sarebbe rumore su una riga che qualcuno ha già letto.
  const { perPersona, senzaPersona } = giaPresentiPerPersona(giaPresenti);
  const out = [];
  const daAnagrafica = new Set();

  for (const a of annotazioni || []) {
    if (!a || !Number.isInteger(a.codCli) || !a.testo) continue;
    for (const p of estraiAllergie(a.testo)) {
      const chiave = p.termine.toLowerCase();
      if (perPersona.has(`${a.codCli}|${chiave}`) || senzaPersona.has(chiave)) continue;
      // Una persona sola non ha bisogno di due volte la stessa allergia, ma due
      // persone diverse con la stessa allergia restano due proposte distinte:
      // vanno registrate su entrambe.
      if (out.some((x) => x.codCli === a.codCli && x.termine.toLowerCase() === chiave)) continue;
      daAnagrafica.add(chiave);
      out.push({ termine: p.termine, frase: p.frase, fonte: 'anagrafica', codCli: a.codCli, nome: a.nome || null });
    }
  }

  // `nota` è la nota della prenotazione che si sta guardando (card di Arrivi e
  // In casa); `note` sono le note di più prenotazioni della stessa persona, che
  // servono alla sua scheda — lì non c'è una prenotazione sola davanti.
  const daPrenotazione = [];
  if (nota) daPrenotazione.push({ testo: nota });
  for (const n of note || []) if (n && n.testo) daPrenotazione.push(n);

  for (const n of daPrenotazione) {
    for (const p of estraiAllergie(n.testo)) {
      const chiave = p.termine.toLowerCase();
      if (gia.has(chiave) || daAnagrafica.has(chiave)) continue;
      // La stessa allergia ripetuta su due prenotazioni della stessa persona è
      // una proposta sola: chi guarda deve decidere una volta.
      if (out.some((x) => x.fonte === 'prenotazione' && x.termine.toLowerCase() === chiave)) continue;
      out.push({
        termine: p.termine,
        frase: p.frase,
        fonte: 'prenotazione',
        codCli: null,
        nome: null,
        codpratica: n.codpratica == null ? null : n.codpratica,
        dtarrivo: n.dtarrivo || null,
        dtpartenza: n.dtpartenza || null,
      });
    }
  }
  return out;
}

module.exports = { estraiAllergie, proponiDaNote, proponiPerSoggiorno, frasi, SOSTANZE };
