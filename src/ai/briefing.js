// Guest Briefing (AI) — Fase B Dashboard Arrivi 2.0.
//
// SOLO su richiesta dell'operatore (mai automatico). Per un ospite di rilievo
// (VIP / personaggio pubblico / istituzionale) genera un briefing BREVISSIMO per
// la reception usando ESCLUSIVAMENTE fonti web PUBBLICHE e affidabili, sempre
// citate. Nessun dato privato/sensibile. Se non è un personaggio pubblico o non
// ci sono fonti affidabili → "Nessuna informazione pubblica rilevante.".
//
// Dal 2026-08-11 l'esito non è più binario. I profili professionali (LinkedIn)
// sono ammessi come fonte per intercettare i manager che NON sono personaggi
// pubblici — ma solo per ruolo/azienda/settore, e con un'etichetta diversa in
// modo che chi legge sappia da dove viene il dato:
//   pubblica      → personaggio pubblico, fonti autorevoli (come prima)
//   professionale → nessun rilievo pubblico, ma profilo professionale coerente
//   incerta       → profilo trovato ma identità non confermata → NON si attribuisce
//   nessuna       → niente da dire
// Il rischio qui non è la privacy (LinkedIn è autopubblicato dall'interessato) ma
// l'OMONIMIA: "Mario Rossi, Milano" sono centinaia. Da qui la regola dei due
// riscontri e il dominio della mail come prova d'identità.
//
// Modulo puro: il client Anthropic è iniettato (mock nei test). Usa il server tool
// di ricerca web (web_search_20260209) che aggiunge automaticamente le citazioni.

const SYSTEM = [
  "Sei l'assistente concierge di un hotel 5 stelle (Canne Bianche Lifestyle Hotel, Torre Canne).",
  'Compito: preparare un BRIEFING BREVISSIMO per la reception su un ospite di rilievo, usando SOLO fonti web PUBBLICHE e AFFIDABILI.',
  "Usa lo strumento di ricerca web per verificare se l'ospite è un personaggio pubblico (istituzionale, imprenditore noto, personaggio dello spettacolo/sport/cultura, ecc.).",
  "Se non è un personaggio pubblico, cerca comunque un PROFILO PROFESSIONALE (tipicamente LinkedIn): serve a riconoscere manager e dirigenti che non sono figure pubbliche.",
  '',
  'REGOLE FERREE:',
  "- Scrivi SEMPRE in ITALIANO, anche quando le fonti sono in inglese o in un'altra lingua: traduci. Il briefing lo legge la reception.",
  '- Usa SOLO informazioni pubbliche e verificabili; CITA sempre le fonti.',
  '- Ogni riga deve poggiare su un risultato della ricerca che hai appena fatto, NON sulla tua memoria: se non lo hai trovato ora nella ricerca, non scriverlo. Anche quando credi di conoscere già la persona, verifica e cita.',
  '- Cita ESCLUSIVAMENTE fonti AUTOREVOLI e pertinenti: siti ufficiali/istituzionali, enciclopedie (Treccani, Britannica, Wikipedia), stampa affidabile, pagine ufficiali dell\'organizzazione, profili professionali (LinkedIn). NON citare aggregatori/scraper di contatti (email, telefoni), marketplace, blog non verificati, social personali (Facebook, Instagram, TikTok, X) o pagine non pertinenti. Meglio poche fonti solide che molte deboli.',
  "- Includi SOLO ciò che è utile all'accoglienza: ruolo/professione pubblica, cariche/ruoli pubblici, motivo di notorietà, come rivolgersi (titolo/appellativo).",
  "- VIETATI anche se pubblici, perché all'accoglienza non servono: età, data e luogo di nascita, titoli di studio e università, patrimonio personale, valutazione o fatturato dell'azienda.",
  '- NON copiare frasi dalle fonti: riassumi in parole chiave. Esempio di riga SBAGLIATA — "Notorietà: Mario Rossi, 38 anni, di Cuneo, è laureato in Economia a Torino, la sua azienda vale 1 miliardo" (frase intera, ripete il nome, dati inutili). La STESSA riga giusta — "Notorietà: fondatore di una fintech dei pagamenti".',
  '- Da un profilo professionale prendi SOLO ruolo, azienda/organizzazione e settore. NON riportare percorso di studi, storia lavorativa, post, contatti, foto, collegamenti o qualunque altro contenuto del profilo.',
  '- NON includere dati privati o sensibili: salute, vita sentimentale/familiare, orientamento, religione, opinioni politiche, patrimonio, indirizzi, recapiti.',
  '- Se la persona NON è un personaggio pubblico e non trovi nemmeno un profilo professionale attendibile, rispondi ESATTAMENTE: "Nessuna informazione pubblica rilevante." e nient\'altro. Non inventare, non indovinare.',
  '- NON scrivere nel testo una sezione "Fonti"/riferimenti: le fonti sono gestite automaticamente a parte.',
  '- NON scrivere frasi introduttive, valutazioni della ricerca o conferme identità (es. "Buon match…", "personaggio pubblico", "fonti autorevoli", "Verifico…", "Ho verificato…", "L\'ospite corrisponde a…"): la PRIMISSIMA parola del testo deve essere l\'etichetta "Ruolo:".',
  "- IDENTITÀ (regola dei due riscontri): un profilo professionale vale come identificazione certa solo se, oltre al nome e cognome, combacia ALMENO UN altro elemento fra quelli che ti do (dominio della mail = azienda del profilo, città/nazione, azienda citata nel contesto interno). Con il solo nome e cognome l'identificazione NON è certa: i casi di omonimia sono la regola, non l'eccezione.",
  "- In caso di omonimia o incertezza sull'identità NON attribuire nulla come certo: riporta le parole chiave del profilo più probabile e marca l'identificazione come incerta (vedi ultima riga), così l'operatore verifica di persona.",
  '- ULTIMA RIGA OBBLIGATORIA, sempre, esattamente in questo formato: "Identificazione: pubblica" se è un personaggio pubblico con fonti autorevoli; "Identificazione: professionale" se non ha rilievo pubblico ma il profilo professionale è confermato dalla regola dei due riscontri; "Identificazione: incerta" se il profilo è plausibile ma non confermato. Questa riga non conta nel limite di righe e non deve contenere altro.',
  '- FORMATO: SINTESI per PAROLE CHIAVE, non prosa. Massimo 4-5 righe, ognuna "Etichetta: poche parole chiave" (max ~10 parole per riga). VIETATI: frasi complete e verbi narrativi ("è stato", "ha ricevuto"), ripetere il nome dell\'ospite, il markdown/grassetto (**), qualsiasi riga di intestazione o titolo. INIZIA DIRETTAMENTE dalla prima etichetta (es. "Ruolo:"). Includi sempre una riga "Appellativo:" e, come ultimissima, la riga "Identificazione:". Esempi di STILE (adatta i contenuti all\'ospite reale):',
  '',
  'Personaggio pubblico (persona INVENTATA: copia la forma, non i contenuti):',
  "Ruolo: direttrice d'orchestra",
  'Notorietà: prima donna alla guida di un teatro lirico nazionale',
  'Ambito: musica classica, direzione artistica',
  'Appellativo: "Maestra"',
  'Identificazione: pubblica',
  '',
  'Profilo professionale (nessun rilievo pubblico, azienda confermata dal dominio della mail):',
  'Ruolo: Direttore Generale',
  'Azienda: Pirelli & C. SpA (pneumatici, industria)',
  'Appellativo: "Dottore"',
  'Identificazione: professionale',
].join('\n');

// Domini non autorevoli da scartare comunque dalle fonti (scraper di contatti,
// marketplace, ecc.), a difesa in più oltre alla regola nel prompt.
const DOMINI_ESCLUSI = [
  'rocketreach', 'signalhire', 'zoominfo', 'lusha', 'contactout', 'apollo.io',
  'rocketreach.co', 'leadiq', 'hunter.io', '1stdibs', 'pressreader',
  // Banche di immagini: compaiono spesso cercando persone note, ma come fonte
  // di un briefing non dicono nulla.
  'gettyimages', 'alamy.com', 'shutterstock', 'depositphotos', 'imago-images',
  // Social personali: LinkedIn è ammesso (è una presentazione professionale
  // autopubblicata), questi no. 'x.com' non è in elenco apposta: il confronto è
  // per sottostringa e scarterebbe anche linux.com, matrix.com, essex.com…
  'facebook.com', 'instagram.com', 'tiktok.com', 'twitter.com',
  // Di LinkedIn ammettiamo il PROFILO (/in/, /company/), non i post: un post è un
  // contenuto personale come quello di qualsiasi altro social.
  'linkedin.com/posts/', 'linkedin.com/pulse/',
];

// Provider di posta generici: il dominio non dice nulla sull'azienda, quindi non
// serve a confermare un'identità e non ha senso passarlo al modello.
const PROVIDER_GENERICI = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.it', 'hotmail.fr', 'hotmail.co.uk',
  'outlook.com', 'outlook.it', 'live.com', 'live.it', 'msn.com', 'yahoo.com', 'yahoo.it',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'libero.it', 'virgilio.it', 'alice.it',
  'tin.it', 'tiscali.it', 'fastwebnet.it', 'inwind.it', 'email.it', 'pec.it',
  'protonmail.com', 'proton.me', 'gmx.de', 'gmx.net', 'web.de', 't-online.de',
  'free.fr', 'orange.fr', 'wanadoo.fr', 'laposte.net', 'btinternet.com', 'sky.com',
  'mail.ru', 'yandex.ru', 'qq.com', '163.com',
]);

// Il dominio della mail è la prova d'identità più forte che abbiamo contro
// l'omonimia: m.rossi@pirelli.com + profilo che dice Pirelli = stessa persona.
// Si passa SOLO il dominio, mai l'indirizzo: la parte prima della @ non serve a
// identificare l'azienda ed è un dato personale in più consegnato al modello.
function dominioAziendale(email) {
  const at = String(email == null ? '' : email).trim().toLowerCase().split('@');
  if (at.length !== 2) return '';
  const dom = at[1].replace(/[>,;\s].*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) return '';
  return PROVIDER_GENERICI.has(dom) ? '' : dom;
}

// Blocco identità minimo per disambiguare la ricerca. Le note interne sono contesto
// e NON vanno pubblicate/ricercate come fatti.
function costruisciFatti({ nominativo, citta, nazione, vip, note, email } = {}) {
  const nome = (nominativo == null ? '' : String(nominativo)).trim();
  if (!nome) return '';
  const parti = [`Ospite da preparare: ${nome}`];
  const prov = [citta, nazione].map((s) => (s == null ? '' : String(s)).trim()).filter(Boolean).join(', ');
  if (prov) parti.push(`Possibile provenienza (per disambiguare): ${prov}`);
  const dom = dominioAziendale(email);
  if (dom) parti.push(`Dominio della mail, indizio sull'azienda (per confermare l'identità, NON pubblicare): ${dom}`);
  const v = vip && vip.descrizione ? String(vip.descrizione).trim() : '';
  if (v) parti.push(`Classificazione interna VIP: ${v}`);
  const n = (note == null ? '' : String(note)).trim();
  if (n) parti.push(`Contesto interno (NON pubblicare, solo per capire di chi si tratta): ${n}`);
  return parti.join('\n');
}

function haFatti(fatti) {
  return typeof fatti === 'string' && fatti.trim().length > 0;
}

// Nessun structured output: la ricerca web produce testo con citazioni. Manteniamo
// max_tokens contenuto (briefing breve). thinking non usato per semplicità/robustezza.
function buildRequest(fatti, { model = 'claude-sonnet-5', maxTokens = 2000, maxUses = 5 } = {}) {
  return {
    model,
    max_tokens: maxTokens,
    system: SYSTEM,
    messages: [{ role: 'user', content: `${fatti}\n\nPrepara il briefing seguendo le regole.` }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }],
  };
}

// Estrae {url, titolo} da una lista eterogenea di citazioni/risultati.
//
// Due sorgenti molto diverse, e non vanno mescolate:
//   - le CITAZIONI agganciate al testo sono le fonti che il modello ha davvero
//     usato per scrivere quelle righe;
//   - i RISULTATI del tool di ricerca sono tutto ciò che il motore ha restituito,
//     letto o no. Su un ospite noto sono decine, per lo più deboli (blog, siti di
//     gossip, aggregatori). Mostrarli come "Fonti" è una promessa falsa.
// Quindi: se ci sono citazioni si mostrano SOLO quelle. I risultati grezzi restano
// come ripiego, per non lasciare la card senza nemmeno un link da controllare.
//
// Il ripiego non è un caso di scuola: su una persona molto nota il modello a volte
// risponde da quello che già sa senza agganciarsi alla ricerca (visto dal vivo:
// 0 citazioni e 30 risultati). Lì i link NON sono le fonti del briefing, sono solo
// quello che ha trovato il motore: si mostrano pochi e con un'etichetta diversa,
// altrimenti la card promette una verifica che non c'è stata.
const MAX_RIPIEGO = 6;

// Il modello ha davvero agganciato quello che scrive ai risultati della ricerca?
function haCitazioni(blocchi) {
  return (blocchi || []).some((b) => b && ((b.citations || []).some((c) => c && c.url)));
}

function estraiFonti(blocchi) {
  const citate = [];
  const cercate = [];
  // Un set per lista, non uno solo: nella risposta i risultati della ricerca
  // arrivano PRIMA del testo che li cita, quindi un set condiviso svuoterebbe
  // proprio l'elenco delle citazioni — cioè quello buono.
  const visti = { citate: new Set(), cercate: new Set() };
  const aggiungi = (dove, url, titolo) => {
    const u = (url == null ? '' : String(url)).trim();
    if (!u || visti[dove].has(u)) return;
    if (DOMINI_ESCLUSI.some((d) => u.toLowerCase().includes(d))) return; // fonte non autorevole
    visti[dove].add(u);
    (dove === 'citate' ? citate : cercate).push({ url: u, titolo: (titolo == null ? '' : String(titolo)).trim() || u });
  };
  for (const b of blocchi || []) {
    if (!b) continue;
    for (const c of b.citations || []) aggiungi('citate', c && c.url, c && c.title);
    if (Array.isArray(b.content)) for (const r of b.content) if (r && r.url) aggiungi('cercate', r.url, r.title);
  }
  return citate.length ? citate : cercate.slice(0, MAX_RIPIEGO);
}

// Ripulisce l'output: toglie il grassetto markdown e un'eventuale riga di
// intestazione iniziale (es. "BRIEFING RECEPTION – Nome") che il modello a volte
// aggiunge nonostante il vincolo, così restano solo le righe "Etichetta: keyword".
// Riga marcatore con l'esito dell'identificazione. Si legge dal testo grezzo e si
// toglie dal testo mostrato: all'operatore serve un'etichetta, non una riga di
// gergo in fondo al briefing.
const ESITI = ['pubblica', 'professionale', 'incerta'];
const RIGA_IDENT = /^[ \t]*identificazione[ \t]*:[ \t]*["']?([a-zàèéìòù]+)/im;

function estraiIdentificazione(grezzo) {
  const m = String(grezzo || '').match(RIGA_IDENT);
  const v = m ? m[1].toLowerCase() : '';
  return ESITI.includes(v) ? v : '';
}

function pulisciTesto(t) {
  let s = String(t || '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '');
  // Il briefing DEVE iniziare da "Ruolo:": taglio qualsiasi preambolo/ragionamento
  // che il modello anteponga (es. "Buon match: …", "Verifico…", titoli).
  const m = s.match(/\bruolo\s*:/i);
  if (m && m.index > 0) s = s.slice(m.index);
  let righe = s.split('\n');
  // Taglio una eventuale coda "Fonti: …" nel testo (le fonti sono mostrate a parte).
  const iFonti = righe.findIndex((r) => /^\s*fonti\b/i.test(r));
  if (iFonti >= 0) righe = righe.slice(0, iFonti);
  righe = righe.filter((r) => !RIGA_IDENT.test(r)); // il marcatore diventa un'etichetta, non testo
  // Il briefing è un elenco di righe "Etichetta: valore", non un testo a paragrafi:
  // le righe vuote che il modello a volte intercala sparpagliano la card (si vedono,
  // il testo è in pre-wrap) senza aggiungere nulla.
  return righe.join('\n').replace(/\n\s*\n/g, '\n').trim();
}

function parseBriefing(resp) {
  const blocchi = (resp && resp.content) || [];
  const grezzo = blocchi.filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
  const testo = pulisciTesto(grezzo);
  const fonti = estraiFonti(blocchi);
  const pubblico = !!testo && !/nessuna informazione pubblica/i.test(testo);
  // Senza riga marcatore (risposta fuori formato) vale l'esito storico: pubblica.
  const identificazione = pubblico ? (estraiIdentificazione(grezzo) || 'pubblica') : 'nessuna';
  // Un'identità non confermata non finisce in anagrafica: si mostra il link e
  // decide l'operatore. È l'unica difesa vera contro l'omonimia.
  const salvabile = identificazione === 'pubblica' || identificazione === 'professionale';
  return {
    testo: testo || 'Nessuna informazione pubblica rilevante.',
    fonti: pubblico ? fonti : [],
    // false = il briefing non è agganciato a quei link: sono solo i risultati
    // della ricerca. Chi legge deve saperlo, l'etichetta in card cambia.
    fontiCitate: pubblico && haCitazioni(blocchi),
    pubblico,
    identificazione,
    salvabile,
  };
}

// Esito "niente da dire", nella stessa forma di parseBriefing: chi lo consuma non
// deve distinguere fra "non abbiamo cercato" e "cercato senza esito".
const NIENTE = () => ({
  testo: 'Nessuna informazione pubblica rilevante.', fonti: [], fontiCitate: false, pubblico: false, identificazione: 'nessuna', salvabile: false,
});

async function briefing(client, fatti, opts = {}) {
  if (!haFatti(fatti)) return NIENTE();
  const resp = await client.messages.create(buildRequest(fatti, opts));
  return parseBriefing(resp);
}

module.exports = {
  SYSTEM, costruisciFatti, haFatti, buildRequest, estraiFonti, parseBriefing, briefing,
  dominioAziendale, estraiIdentificazione, haCitazioni, NIENTE,
};
