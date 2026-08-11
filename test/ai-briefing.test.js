const { test } = require('node:test');
const assert = require('node:assert');
const {
  costruisciFatti, haFatti, buildRequest, estraiFonti, parseBriefing, briefing, SYSTEM,
  dominioAziendale, estraiIdentificazione,
} = require('../src/ai/briefing');

function clientConContenuto(content) {
  return { messages: { create: async () => ({ content }) } };
}

test('costruisciFatti: compone identità; senza nome → stringa vuota', () => {
  const f = costruisciFatti({ nominativo: 'Mario Rossi', citta: 'Milano', nazione: 'IT', vip: { descrizione: 'BOLLICINE' }, note: 'amico del direttore' });
  assert.match(f, /Ospite da preparare: Mario Rossi/);
  assert.match(f, /Milano, IT/);
  assert.match(f, /Classificazione interna VIP: BOLLICINE/);
  assert.match(f, /NON pubblicare/);
  assert.strictEqual(costruisciFatti({}), '');
  assert.strictEqual(haFatti(''), false);
  assert.strictEqual(haFatti('x'), true);
});

test('SYSTEM: tutele privacy, fonti autorevoli, formato asciutto, fallback esplicito', () => {
  assert.match(SYSTEM, /SOLO fonti web PUBBLICHE/i);
  assert.match(SYSTEM, /CITA sempre le fonti/i);
  assert.match(SYSTEM, /AUTOREVOLI/);
  assert.match(SYSTEM, /Nessuna informazione pubblica rilevante/);
  assert.match(SYSTEM, /omonimia/i);
  assert.match(SYSTEM, /PAROLE CHIAVE/); // sintesi per parole chiave, non prosa
  assert.match(SYSTEM, /Appellativo:/);  // riga finale su come rivolgersi
});

test('estraiFonti: scarta i domini non autorevoli (scraper di contatti/marketplace/foto)', () => {
  const fonti = estraiFonti([
    { type: 'text', text: 'x', citations: [
      { url: 'https://it.wikipedia.org/wiki/X', title: 'Wikipedia' },
      { url: 'https://rocketreach.co/x-email', title: 'contatti' },
      { url: 'https://www.1stdibs.com/art/y', title: 'quadro' },
      { url: 'https://www.gettyimages.com/photos/x', title: 'foto' },
      { url: 'https://www.alamy.com/x', title: 'foto' },
    ] },
  ]);
  assert.strictEqual(fonti.length, 1);
  assert.match(fonti[0].url, /wikipedia/);
});

test('buildRequest: senza indicazioni usa il modello più capace', () => {
  // Il briefing lo si chiede a mano poche volte al giorno e lo legge chi ha
  // l'ospite davanti: qui la qualità conta più del costo.
  assert.strictEqual(buildRequest('FATTI').model, 'claude-opus-5');
});

test('buildRequest: modello, web search tool, ragionamento e system', () => {
  const req = buildRequest('FATTI', { model: 'claude-sonnet-5' });
  assert.strictEqual(req.model, 'claude-sonnet-5');
  assert.strictEqual(req.tools[0].type, 'web_search_20260209');
  assert.strictEqual(req.tools[0].name, 'web_search');
  assert.match(req.system, /concierge/i);
  assert.match(req.messages[0].content, /FATTI/);
  // Il ragionamento serve a decidere se è la persona giusta e a riassumere invece
  // di ricopiare: senza, su ospiti stranieri il testo scivolava in traduzioni
  // parola per parola. Il tetto dei token deve stargli dietro.
  assert.deepStrictEqual(req.thinking, { type: 'adaptive' });
  assert.ok(req.max_tokens >= 4000, 'max_tokens troppo basso per il ragionamento');
});

test('senza citazioni: un solo link per sito, niente muro di omonimi', () => {
  // Caso vero (un CEO americano): la ricerca ha restituito sei profili LinkedIn
  // di sei persone diverse con lo stesso nome. Sei link, tutti probabilmente
  // sbagliati, che in card sembravano una conferma.
  const out = parseBriefing({ content: [
    { type: 'web_search_tool_result', content: [
      { url: 'https://www.linkedin.com/in/anthony-capuano/', title: 'uno' },
      { url: 'https://www.linkedin.com/in/anthony-capuano-0b07556/', title: 'un altro' },
      { url: 'https://it.linkedin.com/in/anthony-capuano-385772235/', title: 'un altro ancora' },
      { url: 'https://marriott.gcs-web.com/board-directors/x', title: 'Marriott' },
    ] },
    { type: 'text', text: 'Ruolo: CEO' }, // nessuna citazione → ripiego
  ] });
  assert.strictEqual(out.fonti.length, 3); // linkedin.com, it.linkedin.com, marriott
  assert.strictEqual(out.fonti.filter((f) => f.url.includes('www.linkedin.com')).length, 1);
});

test('estraiFonti: dedup delle citazioni; senza citazioni restano i risultati', () => {
  const fonti = estraiFonti([
    { type: 'text', text: 'x', citations: [{ url: 'https://a.it', title: 'A' }, { url: 'https://a.it', title: 'A dup' }] },
  ]);
  assert.strictEqual(fonti.length, 1);
  assert.deepStrictEqual(fonti[0], { url: 'https://a.it', titolo: 'A' });

  const ripiego = estraiFonti([
    { type: 'web_search_tool_result', content: [{ url: 'https://b.it', title: 'B' }, { url: '', title: 'vuota' }] },
  ]);
  assert.deepStrictEqual(ripiego, [{ url: 'https://b.it', titolo: 'B' }]);
});

test('estraiFonti: se il modello ha citato, i risultati grezzi non si mostrano', () => {
  // Il caso reale: 16 "fonti" per un ospite noto, quasi tutte mai lette. Nella
  // risposta i risultati arrivano PRIMA del testo che li cita: se la citazione
  // non sopravvive a questo ordine, l'elenco buono resta vuoto.
  const fonti = estraiFonti([
    { type: 'web_search_tool_result', content: [
      { url: 'https://it.wikipedia.org/x', title: 'Wikipedia' }, // trovata E citata
      { url: 'https://blog-qualsiasi.it/gossip', title: 'blog' },
      { url: 'https://altro-sito.it/tizio', title: 'altro' },
    ] },
    { type: 'text', text: 'Ruolo: imprenditore', citations: [{ url: 'https://it.wikipedia.org/x', title: 'Wikipedia' }] },
  ]);
  assert.deepStrictEqual(fonti, [{ url: 'https://it.wikipedia.org/x', titolo: 'Wikipedia' }]);
});

test('senza citazioni: pochi link e detto chiaramente che non sono fonti', () => {
  // Caso vero (Amelia Spencer): 0 citazioni e 30 risultati. Il modello ha
  // risposto da quello che sapeva, non dalla ricerca: quei link non sono le
  // fonti del briefing e non vanno mostrati a valanga.
  const molti = Array.from({ length: 30 }, (_, i) => ({ url: `https://sito${i}.it/x`, title: `S${i}` }));
  const out = parseBriefing({ content: [
    { type: 'web_search_tool_result', content: molti },
    { type: 'text', text: 'Ruolo: modella\nIdentificazione: pubblica' }, // nessuna citazione
  ] });
  assert.strictEqual(out.fontiCitate, false);
  assert.strictEqual(out.fonti.length, 6);
  // Con le citazioni invece l'elenco è quello vero e completo.
  const citato = parseBriefing({ content: [
    { type: 'web_search_tool_result', content: molti },
    { type: 'text', text: 'Ruolo: modella', citations: [{ url: 'https://it.wikipedia.org/x', title: 'W' }] },
  ] });
  assert.strictEqual(citato.fontiCitate, true);
  assert.deepStrictEqual(citato.fonti, [{ url: 'https://it.wikipedia.org/x', titolo: 'W' }]);
});

test('parseBriefing: risposta a pezzi — a capo solo davanti a una nuova etichetta', () => {
  // Due rotture opposte viste dal vivo sullo stesso ospite tedesco.
  // 1) Il pezzo dopo comincia con un'etichetta: senza a capo restava incollato
  //    alla riga precedente ("…Comitato EsecutivoRuolo: CEO…"). Ed era pure un
  //    doppione, che in cinque righe è sempre un errore.
  const incollato = parseBriefing({ content: [
    { type: 'text', text: 'Ruolo: CEO e presidente del Comitato Esecutivo' },
    { type: 'text', text: 'Ruolo: CEO e presidente del Comitato Esecutivo\nAzienda: SAP SE' },
  ] });
  assert.strictEqual(incollato.testo, 'Ruolo: CEO e presidente del Comitato Esecutivo\nAzienda: SAP SE');

  // 2) Il taglio cade fra l'etichetta e il suo valore: qui l'a capo NON ci vuole,
  //    altrimenti "Ruolo:" resta su una riga e il valore su quella dopo.
  const spezzato = parseBriefing({ content: [
    { type: 'text', text: 'Ruolo: ' },
    { type: 'text', text: 'CEO e presidente del Consiglio direttivo, SAP SE\nAmbito: software' },
  ] });
  assert.strictEqual(spezzato.testo, 'Ruolo: CEO e presidente del Consiglio direttivo, SAP SE\nAmbito: software');
});

test('parseBriefing: niente righe vuote fra le etichette', () => {
  // Il modello a volte intercala righe vuote: nella card, che è in pre-wrap, si
  // vedono tutte e sparpagliano un briefing che deve stare in cinque righe.
  const out = parseBriefing({ content: [
    { type: 'text', text: 'Ruolo: manager\n\nNotorietà: ex direttore generale\n\n\nAppellativo: "Direttore"', citations: [{ url: 'https://x.it', title: 'X' }] },
  ] });
  assert.strictEqual(out.testo, 'Ruolo: manager\nNotorietà: ex direttore generale\nAppellativo: "Direttore"');
});

test('SYSTEM: fuori i dati che alla reception non servono', () => {
  // Visto dal vivo su un imprenditore: "38 anni, di Cuneo, laureato in Economia,
  // la sua azienda vale 1 miliardo". Pubblico, ma inutile all'accoglienza — e la
  // riga era una frase copiata dalla fonte, col nome dell'ospite dentro.
  assert.match(SYSTEM, /VIETATI anche se pubblici/);
  for (const v of ['età', 'luogo di nascita', 'titoli di studio', 'patrimonio personale']) {
    assert.ok(SYSTEM.includes(v), `manca il divieto: ${v}`);
  }
  assert.match(SYSTEM, /NON copiare frasi dalle fonti/);
  assert.match(SYSTEM, /riga SBAGLIATA/); // l'esempio negativo accanto a quello giusto
});

test('SYSTEM: l\'appellativo segue la nazionalità dell\'ospite', () => {
  // Su un manager tedesco usciva "Mister Klein": in un cinque stelle chiamare
  // "Mister" un tedesco è una piccola figuraccia. Herr/Frau, Monsieur/Madame…
  assert.match(SYSTEM, /mai in inglese per abitudine/);
  for (const t of ['Herr/Frau', 'Monsieur/Madame', 'Dottore/Dottoressa']) {
    assert.ok(SYSTEM.includes(t), `manca la forma: ${t}`);
  }
  assert.match(SYSTEM, /Accorda al genere/);
});

test('SYSTEM: si scrive in italiano anche con fonti in inglese', () => {
  // Trovato dal vivo su un dirigente con pagine Wikipedia in inglese: il briefing
  // usciva in inglese, con frasi intere e il nome dell'ospite ripetuto.
  assert.match(SYSTEM, /SEMPRE in ITALIANO/);
  assert.match(SYSTEM, /traduci/i);
});

test('SYSTEM: le righe devono poggiare sulla ricerca, non sulla memoria del modello', () => {
  assert.match(SYSTEM, /NON sulla tua memoria/);
  // L'esempio di stile non nomina più una persona reale: era Lady Amelia Spencer,
  // e su un'ospite con quel nome il modello copiava l'esempio invece di cercare.
  assert.doesNotMatch(SYSTEM, /Spencer|Diana|Amelia/);
  assert.match(SYSTEM, /INVENTATA/);
});

test('estraiFonti: nessuna fonte utilizzabile → elenco vuoto', () => {
  assert.deepStrictEqual(estraiFonti([]), []);
  assert.deepStrictEqual(estraiFonti(null), []);
  // solo domini esclusi: meglio nessuna fonte che una fonte che non vale nulla
  assert.deepStrictEqual(estraiFonti([{ type: 'text', text: 'x', citations: [{ url: 'https://rocketreach.co/x' }] }]), []);
});

test('parseBriefing: personaggio pubblico → testo + fonti, pubblico=true', () => {
  const out = parseBriefing({ content: [
    { type: 'text', text: 'Noto imprenditore del settore vinicolo.', citations: [{ url: 'https://it.wikipedia.org/x', title: 'Wikipedia' }] },
  ] });
  assert.strictEqual(out.pubblico, true);
  assert.match(out.testo, /imprenditore/);
  assert.strictEqual(out.fonti.length, 1);
});

test('parseBriefing: non pubblico → nessuna fonte, pubblico=false', () => {
  const out = parseBriefing({ content: [
    { type: 'text', text: 'Nessuna informazione pubblica rilevante.', citations: [{ url: 'https://x.it', title: 'X' }] },
  ] });
  assert.strictEqual(out.pubblico, false);
  assert.deepStrictEqual(out.fonti, []);
});

test('parseBriefing: rimuove intestazione e grassetto, tiene le righe a etichetta', () => {
  const out = parseBriefing({ content: [
    { type: 'text', text: '**BRIEFING RECEPTION – Mario Rossi**\n\nRuolo: imprenditore\nAppellativo: "Dottore"', citations: [{ url: 'https://it.wikipedia.org/x', title: 'Wikipedia' }] },
  ] });
  assert.strictEqual(out.pubblico, true);
  assert.doesNotMatch(out.testo, /BRIEFING/);
  assert.doesNotMatch(out.testo, /\*\*/);
  assert.match(out.testo, /^Ruolo: imprenditore/);
  assert.match(out.testo, /Appellativo:/);
});

test('parseBriefing: rimuove preambolo incollato e coda "Fonti"', () => {
  const testo = "L'ospite corrisponde a Mario Rossi, noto imprenditore.Ruolo: imprenditore\nAppellativo: \"Dottore\"\n\nFonti: sito ufficiale…";
  const out = parseBriefing({ content: [{ type: 'text', text: testo, citations: [{ url: 'https://it.wikipedia.org/x', title: 'W' }] }] });
  assert.match(out.testo, /^Ruolo: imprenditore/);
  assert.match(out.testo, /Appellativo:/);
  assert.doesNotMatch(out.testo, /L'ospite corrisponde/);
  assert.doesNotMatch(out.testo, /Fonti:/);
});

test('parseBriefing: risposta vuota → fallback esplicito', () => {
  const out = parseBriefing({ content: [] });
  assert.strictEqual(out.pubblico, false);
  assert.strictEqual(out.testo, 'Nessuna informazione pubblica rilevante.');
});

test('dominioAziendale: tiene solo i domini che dicono qualcosa sull\'azienda', () => {
  assert.strictEqual(dominioAziendale('m.rossi@pirelli.com'), 'pirelli.com');
  assert.strictEqual(dominioAziendale('  M.Rossi@Pirelli.COM '), 'pirelli.com'); // normalizzato
  assert.strictEqual(dominioAziendale('info@studio-legale.co.uk'), 'studio-legale.co.uk');
  // Provider generici: il dominio non identifica nessuna azienda, non va passato.
  for (const e of ['x@gmail.com', 'x@libero.it', 'x@icloud.com', 'x@hotmail.it', 'x@yahoo.com', 'x@outlook.com']) {
    assert.strictEqual(dominioAziendale(e), '', e);
  }
  // Valori sporchi o assenti.
  for (const e of [null, undefined, '', 'non-una-mail', 'a@b', 'a@@b.com', 'x@dominio']) {
    assert.strictEqual(dominioAziendale(e), '', String(e));
  }
});

test('costruisciFatti: passa il dominio della mail, mai l\'indirizzo', () => {
  const f = costruisciFatti({ nominativo: 'Mario Rossi', email: 'mario.rossi@pirelli.com' });
  assert.match(f, /pirelli\.com/);
  assert.doesNotMatch(f, /mario\.rossi@/); // la parte prima della @ non serve e non esce
  assert.doesNotMatch(f, /@/);
  // Mail generica: nessuna riga in più, non aiuta a identificare nessuno.
  assert.doesNotMatch(costruisciFatti({ nominativo: 'Mario Rossi', email: 'mario.rossi@gmail.com' }), /gmail/);
});

test('SYSTEM: LinkedIn ammesso, social personali no, regola dei due riscontri', () => {
  assert.match(SYSTEM, /LinkedIn/);
  assert.match(SYSTEM, /Facebook, Instagram, TikTok, X/);
  assert.match(SYSTEM, /due riscontri/i);
  assert.match(SYSTEM, /SOLO ruolo, azienda\/organizzazione e settore/); // niente storia lavorativa, studi, post
  assert.match(SYSTEM, /Identificazione: pubblica/);
  assert.match(SYSTEM, /Identificazione: professionale/);
  assert.match(SYSTEM, /Identificazione: incerta/);
});

test('estraiIdentificazione: legge il marcatore, ignora i valori non previsti', () => {
  assert.strictEqual(estraiIdentificazione('Ruolo: x\nIdentificazione: professionale'), 'professionale');
  assert.strictEqual(estraiIdentificazione('Ruolo: x\nidentificazione : INCERTA'), 'incerta');
  assert.strictEqual(estraiIdentificazione('Identificazione: pubblica'), 'pubblica');
  assert.strictEqual(estraiIdentificazione('Ruolo: x'), '');            // marcatore assente
  assert.strictEqual(estraiIdentificazione('Identificazione: certa'), ''); // valore inventato
});

test('parseBriefing: profilo professionale → salvabile, marcatore fuori dal testo', () => {
  const out = parseBriefing({ content: [
    { type: 'text', text: 'Ruolo: Direttore Generale\nAzienda: Pirelli\nAppellativo: "Dottore"\nIdentificazione: professionale', citations: [{ url: 'https://www.linkedin.com/in/xyz', title: 'LinkedIn' }] },
  ] });
  assert.strictEqual(out.identificazione, 'professionale');
  assert.strictEqual(out.salvabile, true);
  assert.strictEqual(out.pubblico, true);
  assert.doesNotMatch(out.testo, /Identificazione/); // il marcatore diventa etichetta, non testo
  assert.match(out.testo, /Direttore Generale/);
  assert.strictEqual(out.fonti.length, 1); // LinkedIn NON è più scartato
});

test('parseBriefing: identità incerta → si mostra ma non si salva', () => {
  const out = parseBriefing({ content: [
    { type: 'text', text: 'Ruolo: consulente informatico\nAppellativo: "Signore"\nIdentificazione: incerta', citations: [{ url: 'https://www.linkedin.com/in/mrossi', title: 'LinkedIn' }] },
  ] });
  assert.strictEqual(out.identificazione, 'incerta');
  assert.strictEqual(out.salvabile, false); // il no all'omonimia in anagrafica
  assert.strictEqual(out.pubblico, true);   // ma le fonti si vedono, per poter verificare
  assert.strictEqual(out.fonti.length, 1);
});

test('parseBriefing: senza marcatore resta l\'esito storico; niente informazioni → nessuna', () => {
  const vecchio = parseBriefing({ content: [{ type: 'text', text: 'Ruolo: imprenditore', citations: [{ url: 'https://it.wikipedia.org/x', title: 'W' }] }] });
  assert.strictEqual(vecchio.identificazione, 'pubblica');
  assert.strictEqual(vecchio.salvabile, true);

  const niente = parseBriefing({ content: [{ type: 'text', text: 'Nessuna informazione pubblica rilevante.' }] });
  assert.strictEqual(niente.identificazione, 'nessuna');
  assert.strictEqual(niente.salvabile, false);
});

test('estraiFonti: di LinkedIn passa il profilo, non i post', () => {
  const fonti = estraiFonti([
    { type: 'text', text: 'x', citations: [
      { url: 'https://www.linkedin.com/in/mario-rossi', title: 'LinkedIn' },
      // Un post è contenuto personale, non la scheda professionale (visto dal vivo).
      { url: 'https://www.linkedin.com/posts/mario-rossi_valori-activity-7122626003847266305', title: 'post' },
      { url: 'https://www.facebook.com/mario.rossi', title: 'Facebook' },
      { url: 'https://www.instagram.com/mrossi', title: 'Instagram' },
    ] },
  ]);
  assert.strictEqual(fonti.length, 1);
  assert.match(fonti[0].url, /linkedin\.com\/in\//);
  // 'x.com' non è in elenco: scartarlo per sottostringa affosserebbe anche questi.
  const leciti = estraiFonti([{ type: 'text', text: 'x', citations: [{ url: 'https://www.linux.com/a', title: 'L' }, { url: 'https://essex.com/b', title: 'E' }] }]);
  assert.strictEqual(leciti.length, 2);
});

test('briefing: chiama il client; fatti vuoti → nessuna chiamata', async () => {
  const out = await briefing(clientConContenuto([{ type: 'text', text: 'Politico locale.', citations: [{ url: 'https://c.it', title: 'C' }] }]), 'FATTI');
  assert.strictEqual(out.pubblico, true);
  assert.strictEqual(out.fonti[0].url, 'https://c.it');

  let chiamato = false;
  const spia = { messages: { create: async () => { chiamato = true; return { content: [] }; } } };
  const vuoto = await briefing(spia, '');
  assert.strictEqual(chiamato, false);
  assert.strictEqual(vuoto.pubblico, false);
});
