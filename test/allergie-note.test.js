const { test } = require('node:test');
const assert = require('node:assert');
const { estraiAllergie, proponiDaNote, frasi } = require('../src/crm/allergie-note');

const termini = (nota) => estraiAllergie(nota).map((p) => p.termine);

test('riconosce le dichiarazioni esplicite', () => {
  assert.deepStrictEqual(termini('Allergia alle arachidi.'), ['Arachidi']);
  assert.deepStrictEqual(termini('La signora è celiaca.'), ['Celiachia']);
  assert.deepStrictEqual(termini('Ospite intollerante al lattosio'), ['Lattosio']);
  assert.deepStrictEqual(termini('SENZA GLUTINE per tutta la permanenza'), ['Glutine']);
  assert.deepStrictEqual(termini('Evitare crostacei e molluschi.'), ['Crostacei', 'Molluschi']);
});

test('una sostanza da sola NON è un\'allergia', () => {
  // Il caso che rende inutile una ricerca per sole parole chiave.
  assert.deepStrictEqual(termini('Gradisce la torta alle noci ogni mattina.'), []);
  assert.deepStrictEqual(termini('Cena a base di pesce prenotata per le 20:30.'), []);
  assert.deepStrictEqual(termini('Colazione con uova strapazzate.'), []);
});

test('la negazione non diventa un\'allergia', () => {
  assert.deepStrictEqual(termini('Il bambino non è allergico alle arachidi, mangia tutto.'), []);
  assert.deepStrictEqual(termini('Nessuna allergia segnalata.'), []);
  assert.deepStrictEqual(termini('No allergie.'), []);
  assert.deepStrictEqual(termini('Non ci sono allergie in famiglia.'), []);
  assert.deepStrictEqual(termini('Non risulta intollerante al lattosio.'), []);
  // Con un aggettivo in mezzo: è il modo in cui si scrive davvero in reception.
  assert.deepStrictEqual(termini('I genitori non hanno altre allergie.'), []);
  assert.deepStrictEqual(termini('Non ha particolari intolleranze.'), []);
  assert.deepStrictEqual(termini('Non ha alcuna allergia alimentare.'), []);
});

test('"no glutine" resta una restrizione: il no cade sulla sostanza', () => {
  // Differenza sottile ma decisiva rispetto a "no allergie".
  assert.deepStrictEqual(termini('No glutine per la signora.'), ['Glutine']);
  assert.deepStrictEqual(termini('Niente lattosio a colazione.'), ['Lattosio']);
});

test('la negazione vale solo per la sua frase, non contagia il resto', () => {
  const t = termini('Nessuna allergia per i genitori. La bambina è celiaca.');
  assert.deepStrictEqual(t, ['Celiachia']);
});

test('sostanze fuori elenco: si propone comunque il testo dopo il marcatore', () => {
  assert.deepStrictEqual(termini('La signora è allergica ai pollini di betulla.'), ['Pollini di betulla']);
  assert.deepStrictEqual(termini('Intolleranza al nichel.'), ['Nichel']); // questa è in elenco
});

test('la cattura si ferma ai due punti: la sostanza, non le istruzioni', () => {
  // Caso reale trovato con le fixture: senza lo stop sui ':' il termine
  // diventava "Pollini di betulla: evitare fiori fresch".
  assert.deepStrictEqual(
    termini('Ospite allergica ai pollini di betulla: evitare fiori freschi in camera.'),
    ['Pollini di betulla']
  );
});

test('coda lunghissima: nessun termine tagliato a metà parola', () => {
  const t = termini('È allergica alle graminacee spontanee mediterranee delle campagne pugliesi')[0];
  assert.ok(t.length <= 40);
  assert.doesNotMatch(t, /\s$/);
  // l'ultima parola c'è tutta: nessun troncone tipo "campagn"
  assert.ok(t.split(' ').every((w) => /^[\wàèéìòùÀÈÉÌÒÙ']+$/.test(w)));
  assert.ok('È allergica alle graminacee spontanee mediterranee delle campagne pugliesi'.toLowerCase().includes(t.toLowerCase()));
});

test('niente doppioni, né fra frasi né nella stessa', () => {
  assert.deepStrictEqual(termini('Allergia al glutine. Ricordare: senza glutine anche a cena.'), ['Glutine']);
});

test('la proposta porta con sé la frase da cui nasce', () => {
  const p = estraiAllergie('Transfer alle 14. La signora è celiaca, avvisare la cucina. Saldo con AMEX.');
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].termine, 'Celiachia');
  assert.strictEqual(p[0].frase, 'La signora è celiaca, avvisare la cucina');
  assert.doesNotMatch(p[0].frase, /AMEX/); // solo la frase pertinente, non tutta la nota
});

test('frasi lunghissime vengono accorciate, non troncate a metà parola', () => {
  const lunga = `Allergia alle arachidi ${'e alla frutta secca in generale '.repeat(8)}`;
  const p = estraiAllergie(lunga);
  assert.ok(p[0].frase.length <= 120);
  assert.ok(p[0].frase.endsWith('…'));
});

test('note vuote, nulle o senza allergie → nessuna proposta', () => {
  assert.deepStrictEqual(estraiAllergie(null), []);
  assert.deepStrictEqual(estraiAllergie(''), []);
  assert.deepStrictEqual(estraiAllergie('   \n  '), []);
  assert.deepStrictEqual(estraiAllergie('Camera alta, lontano ascensore. Cuscino rigido.'), []);
});

test('nota reale del PMS: rumore commerciale, nessun falso positivo', () => {
  const nota = `PAGANO TUTTO
4 camere: 1 MJS + 2 SUP + 1 CLS — 6AD + 2CH (under 10y) BB
€ 1.870,00 PER 2 NOTTI 1550 + €320 sofabed
Transfer da BRI il giorno dell'arrivo, volo AZ1613 ore 14:20.
Culla in camera 226. Tavolo riservato ristorante ore 20:30.
TOT: € 13.640,00 — saldo alla partenza con AMEX.`;
  assert.deepStrictEqual(termini(nota), []);
  // la stessa nota, con una riga di allergia in mezzo
  assert.deepStrictEqual(termini(`${nota}\nLa bambina è intollerante al lattosio.`), ['Lattosio']);
});

test('proponiDaNote: quello che è già in scheda non si ripropone', () => {
  const nota = 'Allergia alle arachidi. La signora è celiaca.';
  assert.deepStrictEqual(proponiDaNote(nota, []).map((p) => p.termine), ['Arachidi', 'Celiachia']);
  assert.deepStrictEqual(proponiDaNote(nota, ['arachidi']).map((p) => p.termine), ['Celiachia']);
  assert.deepStrictEqual(proponiDaNote(nota, ['ARACHIDI', 'Celiachia']), []);
  assert.deepStrictEqual(proponiDaNote(nota, [null, '  ']).length, 2); // valori sporchi ignorati
});

test('frasi: spezza su punti, punti e virgola e a capo', () => {
  assert.deepStrictEqual(frasi('Uno. Due; tre\nquattro'), ['Uno', 'Due', 'tre', 'quattro']);
  assert.deepStrictEqual(frasi('a. b'), []); // frammenti troppo corti per dire qualcosa
});

// --- Note VERE del gestionale, 13/08/2026 -----------------------------------
// Prese dalle 30.934 note reali dell'hotel. La maggior parte degli ospiti è
// straniera: delle note che parlano di allergie, 235 sono italiane, 76 inglesi,
// 8 tedesche, 8 francesi. Il vocabolario di sole parole italiane ne perdeva 56.

test('note in inglese: "gluten free" è la forma straniera più diffusa', () => {
  // Da sola, in 29 note. Prima non produceva niente: il "free" non era un marcatore.
  assert.deepStrictEqual(termini('Note Ms Attwood is gluten free.'), ['Glutine']);
  assert.deepStrictEqual(termini('Gluten Free Diet!'), ['Glutine']);
  assert.deepStrictEqual(termini('gluten-free baked goods available at breakfast'), ['Glutine']);
  assert.deepStrictEqual(termini('glutenfree food and vegan'), ['Glutine']);
  assert.deepStrictEqual(termini('Dairy-free milk'), ['Latticini']);
  // Ma "free" che parla d'altro non deve marcare niente.
  assert.deepStrictEqual(termini('free upgrade alla suite, servire pesce alla cena'), []);
});

test('note in inglese: allergic to / coeliac / nut allergy', () => {
  assert.deepStrictEqual(termini('I am coeliac (gluten free)'), ['Celiachia', 'Glutine']);
  assert.deepStrictEqual(termini('Client is Coeliac and has to have gluten free food'), ['Celiachia', 'Glutine']);
  assert.deepStrictEqual(termini('one of the guests has a nut allergy'), ['Frutta a guscio']);
  assert.deepStrictEqual(termini('Food Allergies include: dairy and gluten'), ['Glutine', 'Latticini']);
  // "allergic to X": prima usciva "To feathers", con il "to" attaccato, perché
  // fra le preposizioni c'erano solo quelle italiane. Ora le piume sono in
  // elenco, quindi la stessa allergia scritta in cinque modi diversi diventa
  // una voce sola invece di cinque.
  assert.deepStrictEqual(termini('the guest is allergic to feathers'), ['Piume']);
});

test('note in tedesco e francese: poche ma coperte', () => {
  assert.deepStrictEqual(termini('Kunde ist Zöliakie, bitte glutenfrei'), ['Celiachia', 'Glutine']);
  assert.deepStrictEqual(termini('allergique aux crustacés'), ['Crostacei']);
  assert.deepStrictEqual(termini('sans gluten pour une personne'), ['Glutine']);
});

test('la preposizione non si mangia le prime lettere della sostanza', () => {
  // Il difetto peggiore trovato sui dati veri: mancava il confine di parola dopo
  // la preposizione, quindi "al" combaciava con l'inizio di "ALIMENTARI".
  assert.deepStrictEqual(termini('allergica agli animali'), ['Animali']);
  assert.deepStrictEqual(termini("FORTE ALLERGIA ALL'AGLIO"), ['Aglio']);
  assert.deepStrictEqual(termini('allergia alle graminacee'), ['Graminacee']);
});

test('"ALLERGIE ALIMENTARI" non è un allergene di nome "Alimentari"', () => {
  // Dice che ci sono allergie senza dire quali: proporlo metterebbe in cucina
  // una voce che non significa niente.
  assert.deepStrictEqual(termini('ALLERGIE ALIMENTARI'), []);
  assert.deepStrictEqual(termini('Food allergies'), []);
  assert.deepStrictEqual(termini('ALLERGIE /PREFERENZE NELLE NOTE'), []);
});

test('la coda amministrativa dell\'hotel non entra nell\'allergene', () => {
  // In queste note "OK" introduce sempre una pratica amministrativa — OK SALDO,
  // OK ODS, OK TRACCE — e mai un allergene.
  assert.deepStrictEqual(termini('FORTE ALLERGIA AL CETRIOLO OK TRACCE'), ['Cetriolo']);
  assert.deepStrictEqual(termini('allergia al sedano OK SALDO'), ['Sedano']);
});

test('una nota scritta tutta in maiuscolo non produce proposte che urlano', () => {
  // Le note del gestionale sono spesso in maiuscolo. Ricopiandole, in mezzo ai
  // termini normali comparivano "CETRIOLO" e "MAIALE": visto sui dati veri il
  // 13/08/2026. Se invece qualche minuscola c'è, non si tocca niente — potrebbe
  // esserci una sigla voluta.
  assert.deepStrictEqual(termini('ALLERGIA AL MAIALE'), ['Maiale']);
  assert.deepStrictEqual(termini('FORTISSIMA ALLERGIA ALLE PIUME'), ['Piume']);
  assert.deepStrictEqual(termini('allergia ai pollini di BETULLA'), ['Pollini di BETULLA']);
});

test('istruzioni operative: non sono allergeni', () => {
  // "chiedere rooming e intolleranze - inserire prenotazioni al ristorante per il
  // 26" proponeva "Inserire prenotazioni al ristorante per", tre volte.
  assert.deepStrictEqual(termini('chiedere rooming e intolleranze - inserire prenotazioni al ristorante per il 26'), []);
  assert.deepStrictEqual(termini('allergie: please confirm with the kitchen'), []);
});

// --- I tre difetti trovati nel collaudo dell'11/08/2026 ---------------------

test('marcatore senza sostanza: nessuna proposta, nemmeno un troncone di parola', () => {
  // Proponeva "Ca" da "allergica" e "Te" da "intollerante": la regex ripiegava
  // dentro la parola stessa. Un clic e "Ca" finiva fra le allergie, in rosso.
  assert.deepStrictEqual(termini('La signora è allergica'), []);
  assert.deepStrictEqual(termini('Ospite allergico'), []);
  assert.deepStrictEqual(termini('Il cliente è intollerante'), []);
  assert.deepStrictEqual(termini('Cliente con allergie'), []);
});

test('dopo i due punti spesso c\'è un ordine di servizio, non un allergene', () => {
  assert.deepStrictEqual(termini('allergica: verificare in cucina'), []);
  assert.deepStrictEqual(termini('Intolleranza: avvisare lo chef'), []);
  assert.deepStrictEqual(termini('Allergia: segnalare al ristorante'), []);
  // Ma la sostanza vera, dopo i due punti, si prende ancora.
  assert.deepStrictEqual(termini('Allergia: pollini di betulla'), ['Pollini di betulla']);
});

test('un\'avversativa ribalta la negazione: l\'allergia che segue non si perde', () => {
  // Era il falso negativo peggiore: la frase comincia con una negazione, quindi
  // veniva scartata tutta, e l'allergia vera della seconda metà spariva in silenzio.
  assert.deepStrictEqual(termini('Il bambino non ha allergie ma la madre è allergica al lattosio'), ['Lattosio']);
  assert.deepStrictEqual(termini('Nessuna allergia, ma la signora è celiaca'), ['Celiachia']);
  assert.deepStrictEqual(termini('Non risulta intollerante però evitare i crostacei'), ['Crostacei']);
  // E funziona anche al contrario: quello che viene escluso dopo il "ma" resta escluso.
  assert.deepStrictEqual(termini('Allergia al glutine ma non al lattosio'), ['Glutine']);
});

test('gli elenchi restano interi: non si spezza sulla virgola', () => {
  // Spezzare sulla virgola avrebbe risolto il caso sopra, ma le sostanze dopo la
  // prima perderebbero il marcatore e si perderebbero gli elenchi — che sono il
  // modo più comune di scrivere più allergie insieme.
  assert.deepStrictEqual(
    termini('Allergia a noci, arachidi e lattosio'),
    ['Lattosio', 'Arachidi', 'Frutta a guscio']
  );
});

test('"no" e "senza" contano solo se attaccati alla sostanza', () => {
  // Sono parole comunissime: prese come marcatori a distanza qualsiasi
  // trasformavano una nota di servizio in un'allergia.
  assert.deepStrictEqual(termini('Camera no fumatori, servire crostacei alla cena di gala'), []);
  assert.deepStrictEqual(termini('Il cliente adora i gamberi, no problem per il menù'), []);
  assert.deepStrictEqual(termini('Camera senza vista mare, prevedere il pesce al ristorante'), []);
  // Restano validi i casi veri, che è il motivo per cui questi marcatori esistono.
  assert.deepStrictEqual(termini('No glutine per la signora'), ['Glutine']);
  assert.deepStrictEqual(termini('Niente lattosio a colazione'), ['Lattosio']);
  assert.deepStrictEqual(termini('Menù senza frutta a guscio'), ['Frutta a guscio']);
});

// --- Le due fonti del gestionale --------------------------------------------
// `Prenota.Note` sta sulla PRATICA (piu' occupanti, attribuzione da chiedere);
// `Anagra.Annotazioni` sta sulla PERSONA (attribuzione certa per costruzione).
const { proponiPerSoggiorno } = require('../src/crm/allergie-note');

test("l'allergia scritta in anagrafica arriva gia' attribuita", () => {
  const p = proponiPerSoggiorno({
    annotazioni: [{ codCli: 51030, nome: 'TRANQUILLI LUCIA', testo: 'ALLERGIA CROSTACEI, MITILI E COZZE' }],
  });
  assert.deepStrictEqual(p.map((x) => x.termine), ['Crostacei', 'Molluschi']);
  assert.ok(p.every((x) => x.fonte === 'anagrafica' && x.codCli === 51030 && x.nome === 'TRANQUILLI LUCIA'));
});

test("l'allergia scritta nella nota della prenotazione resta da attribuire", () => {
  const p = proponiPerSoggiorno({ nota: 'la signora e\' allergica ai crostacei' });
  assert.deepStrictEqual(p.map((x) => x.termine), ['Crostacei']);
  assert.strictEqual(p[0].fonte, 'prenotazione');
  assert.strictEqual(p[0].codCli, null); // la sceglie l'operatore: "la signora" quale?
});

test('lo stesso termine da entrambe le fonti produce una proposta sola, quella certa', () => {
  // Caso reale del 13/08/2026: il cetriolo dell'ospite in camera 214 e' scritto
  // sia nella nota della pratica sia nella sua anagrafica.
  const p = proponiPerSoggiorno({
    nota: 'FORTE ALLERGIA AL CETRIOLO OK TRACCE',
    annotazioni: [{ codCli: 81241, nome: 'SISON RAFAEL', testo: 'LUI HA FORTE ALLERGIA AL CETRIOLO' }],
  });
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].fonte, 'anagrafica');
  assert.strictEqual(p[0].codCli, 81241);
});

test('due persone con la stessa allergia restano due proposte: sono due piatti', () => {
  const p = proponiPerSoggiorno({
    annotazioni: [
      { codCli: 1, nome: 'ROSSI ANNA', testo: 'intollerante al glutine' },
      { codCli: 2, nome: 'ROSSI MARIO', testo: 'intollerante al glutine' },
    ],
  });
  assert.deepStrictEqual(p.map((x) => x.codCli), [1, 2]);
});

test("un'allergia gia' registrata non si ripropone, da nessuna delle due fonti", () => {
  const gia = [{ testo: 'Glutine', chi: 'ROSSI ANNA' }]; // forma con il nome (D2)
  const p = proponiPerSoggiorno({
    nota: 'ospite intollerante al glutine',
    annotazioni: [{ codCli: 1, nome: 'ROSSI ANNA', testo: 'intollerante al glutine' }],
    giaPresenti: gia,
  });
  assert.deepStrictEqual(p, []);
});

test('le allergie registrate si riconoscono anche nella vecchia forma a stringhe', () => {
  // Il 12/08/2026 la lista e' passata da testi a { testo, chi } in card e qui no:
  // il confronto lavorava su "[object Object]" e ogni ricaricamento riproponeva
  // un'allergia gia' salvata. Reggere le due forme evita che si ripeta.
  const p = proponiPerSoggiorno({ nota: 'ospite intollerante al glutine', giaPresenti: ['glutine'] });
  assert.deepStrictEqual(p, []);
});

test('annotazione senza codice cliente: si scarta, non si attribuisce a caso', () => {
  const p = proponiPerSoggiorno({ annotazioni: [{ codCli: null, nome: 'X', testo: 'allergia al sedano' }] });
  assert.deepStrictEqual(p, []);
});

test('la coda si ferma anche quando l\'istruzione e\' in mezzo, non solo in testa', () => {
  // Annotazione vera del 13/08/2026 (anagrafica 81241): senza questo taglio
  // usciva un allergene chiamato "Cetriolo evitare in cibi e bevande", che oltre
  // a essere illeggibile in cucina non combaciava piu' con il "Cetriolo" della
  // nota di prenotazione -- e la stessa allergia veniva proposta due volte.
  assert.deepStrictEqual(termini('FORTE ALLERGIA AL CETRIOLO EVITARE IN CIBI E BEVANDE'), ['Cetriolo']);
  assert.deepStrictEqual(termini('allergia alle piume rimuovere i cuscini dalla stanza'), ['Piume']);
});

test('le frasi rivolte al personale non diventano allergeni', () => {
  // Stessa annotazione: "...e di comunicare questa allergia ai ristoranti
  // prenotati per nostro conto" proponeva "Ristoranti prenotati per nostro conto)".
  assert.deepStrictEqual(termini('Si prega di comunicare questa allergia ai ristoranti prenotati per nostro conto'), []);
  assert.deepStrictEqual(termini('Please inform the restaurant about this allergy'), []);
  // Ma una sostanza vera resta valida anche dentro una formula di cortesia.
  assert.deepStrictEqual(termini('Si prega di preparare pasti senza glutine'), ['Glutine']);
});

// --- Casi trovati sugli arrivi di settembre 2026 ----------------------------

test('un verbo coniugato chiude la sostanza: quello che segue e\' un\'altra frase', () => {
  // Arrivo del 07/09: usciva "Animali e volevano una camera pet-free".
  assert.deepStrictEqual(termini('questi sono allergici agli animali e volevano una camera pet-free garantita'), ['Animali']);
  assert.deepStrictEqual(termini('allergia agli animali! cercare di assegnare camera al piano terra'), ['Animali']);
});

test('il marcatore dentro una parola composta non dichiara niente', () => {
  // "Please reserve an allergy-friendly room" proponeva "Friendly room": il
  // trattino veniva letto come separatore invece che come parte della parola.
  assert.deepStrictEqual(termini('Please reserve an allergy-friendly room'), []);
  // Ma il trattino con lo spazio davanti resta un separatore vero.
  assert.deepStrictEqual(termini('ALLERGIE - CROSTACEI'), ['Crostacei']);
});

test('"questa allergia" richiama, non dichiara', () => {
  assert.deepStrictEqual(termini('Si prega di comunicare questa allergia ai ristoranti prenotati per nostro conto'), []);
  // La cortesia da sola non basta a scartare: qui l'allergia c'e' davvero.
  // (nota vera: prima veniva persa da una regola troppo grossolana)
  assert.deepStrictEqual(
    termini('please provide twin beds in both rooms, we are strictly non smokers and allergic to feather pillow'),
    ['Piume']
  );
});

test('la negazione vale anche in inglese', () => {
  assert.deepStrictEqual(termini("Please note that they do not have allergies but the couple doesn't eat pork"), []);
  assert.deepStrictEqual(termini('no known allergies'), []);
});

test('note che annunciano allergie senza dirle: niente proposta', () => {
  assert.deepStrictEqual(termini('INTOLLERANZE NON COMUNICATE, Julie e peschetarian'), []);
  assert.deepStrictEqual(termini('ALLERGIE DA COMUNICARE'), []);
  assert.deepStrictEqual(termini('allergie non segnalate'), []);
});

test('la scheda di una persona legge le note di piu\' prenotazioni', () => {
  // Sulla card degli Arrivi c'e' UNA prenotazione davanti; sulla scheda di una
  // persona ce ne possono essere diverse, e la proposta deve dire da quale
  // arriva -- e' l'unico modo perche' chi guarda possa giudicare se e' sua.
  const p = proponiPerSoggiorno({
    note: [
      { codpratica: 60403, dtarrivo: '2026-09-07', dtpartenza: '2026-09-11', testo: 'questi sono allergici agli animali' },
      { codpratica: 61111, dtarrivo: '2026-05-02', dtpartenza: '2026-05-05', testo: 'la signora e\' celiaca' },
    ],
  });
  assert.deepStrictEqual(p.map((x) => x.termine), ['Animali', 'Celiachia']);
  assert.strictEqual(p[0].codpratica, 60403);
  assert.strictEqual(p[0].dtarrivo, '2026-09-07');
  assert.strictEqual(p[1].codpratica, 61111);
  assert.ok(p.every((x) => x.fonte === 'prenotazione'));
});

test('la stessa allergia su due prenotazioni e\' una proposta sola', () => {
  const p = proponiPerSoggiorno({
    note: [
      { codpratica: 1, testo: 'ospite celiaca' },
      { codpratica: 2, testo: 'la signora e\' celiaca, avvisare la cucina' },
    ],
  });
  assert.deepStrictEqual(p.map((x) => x.termine), ['Celiachia']);
  assert.strictEqual(p[0].codpratica, 1); // la prima incontrata
});

test("l'anagrafica batte la prenotazione anche quando le note sono piu' d'una", () => {
  const p = proponiPerSoggiorno({
    annotazioni: [{ codCli: 7, nome: 'ROSSI ANNA', testo: 'allergica ai crostacei' }],
    note: [{ codpratica: 9, testo: 'la signora e\' allergica ai crostacei' }],
  });
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].fonte, 'anagrafica');
  assert.strictEqual(p[0].codCli, 7);
});

test('le piume sono un allergene, e uno solo', () => {
  // Sul database dell'hotel la stessa allergia era scritta in cinque modi e
  // usciva come cinque voci diverse: "Piume d'oca", "Down feathers in pillows
  // and bedding", "Feathers pls request no feather pillows", "Feather pillow",
  // "Feathers". In cucina e in governante sono la stessa cosa.
  assert.deepStrictEqual(termini('NO CUSCINI IN PIUMA, GLI OSPITI SONO ALLERGICI'), ['Piume']);
  assert.deepStrictEqual(termini('FEATHER FREE ROOM PLEASE DUE TO ALLERGY'), ['Piume']);
  assert.deepStrictEqual(termini('asking for hypoallergenic bedding And NO down/feather pillows'), ['Piume']);
  assert.deepStrictEqual(termini("LA SIGNORA e' MOLTO ALLERGICA ALLE PIUME D'OCA"), ['Piume']);
  // Il piumino nominato senza marcatore resta un gradimento, non un'allergia.
  assert.deepStrictEqual(termini('gradisce un piumino leggero'), []);
  assert.deepStrictEqual(termini('camera con piumino, servire crostacei'), []);
});

test('una parentesi che si chiude senza essersi aperta chiude anche il termine', () => {
  assert.deepStrictEqual(termini('allergia alla frutta secca) CON MENu ALLA CARTA'), ['Frutta secca']);
  // Ma le parentesi del nome restano: fanno parte di come si chiama.
  assert.deepStrictEqual(termini('allergic to Penicillin (PCN)'), ['Penicillin (PCN)']);
});

// --- Già registrate: il confronto è per PERSONA dove la persona è certa -------
// Decisione del 19/08/2026. Con il confronto sul solo testo, un'allergia
// registrata su un occupante zittiva la stessa allergia di TUTTI gli altri: due
// celiaci nella stessa pratica diventavano un piatto solo, e la seconda proposta
// non nasceva più — senza nessun messaggio.

const dueCeliaci = [
  { codCli: 11, nome: 'Rossi Anna', testo: 'allergia al glutine' },
  { codCli: 22, nome: 'Rossi Marco', testo: 'allergia al glutine' },
];
const chiPropone = (p) => p.map((x) => `${x.termine}/${x.nome || x.fonte}`);

test("l'allergia registrata su uno non zittisce quella di un altro", () => {
  const p = proponiPerSoggiorno({
    annotazioni: dueCeliaci,
    giaPresenti: [{ codCli: 11, testo: 'Glutine', chi: 'Rossi Anna' }],
  });
  assert.deepStrictEqual(chiPropone(p), ['Glutine/Rossi Marco']);
});

test('registrate su entrambi: nessuna proposta, nessun rumore', () => {
  const p = proponiPerSoggiorno({
    annotazioni: dueCeliaci,
    giaPresenti: [{ codCli: 11, testo: 'Glutine' }, { codCli: 22, testo: 'Glutine' }],
  });
  assert.deepStrictEqual(p, []);
});

test("una riga registrata senza persona continua a zittire tutti", () => {
  // Di quella non si sa a chi appartenga: meglio una proposta in meno che
  // ripresentare all'infinito una riga che qualcuno ha già lavorato.
  const p = proponiPerSoggiorno({
    annotazioni: dueCeliaci,
    giaPresenti: [{ testo: 'Glutine', chi: null }],
  });
  assert.deepStrictEqual(p, []);
});

test("la nota della prenotazione resta zittita dal solo testo", () => {
  // Lì la persona non si sa — "la signora è celiaca" in una pratica da quattro
  // non dice quale — quindi il confronto per persona non si può fare, e
  // riproporla a ogni apertura sarebbe rumore.
  const senza = proponiPerSoggiorno({ nota: 'la signora è celiaca', giaPresenti: [] });
  assert.deepStrictEqual(chiPropone(senza), ['Celiachia/prenotazione']);
  const con = proponiPerSoggiorno({
    nota: 'la signora è celiaca',
    giaPresenti: [{ codCli: 11, testo: 'Celiachia' }],
  });
  assert.deepStrictEqual(con, []);
});

// --- Negazioni nelle quattro lingue — decisione del 19/08/2026 ---------------
// Prima erano un DANNO, non una mancanza: "keine Allergien gegen Nüsse" e "pas
// allergique aux noix" producevano l'allergene GIUSTO col significato RIBALTATO;
// "senza allergie particolari" e "aucune allergie connue" producevano un
// allergene inventato ("Particolari", "Connue").

test('una nota che dice "non ci sono allergie" tace, in tutte e quattro le lingue', () => {
  for (const nota of [
    'Ospite senza allergie particolari',
    'soggiorno tranquillo, senza allergie particolari da segnalare',
    'Allergie: nessuna',
    'Intolleranze: nulla da segnalare',
    'Allergies: none',
    'No known allergies',
    'The guest is not allergic to peanuts',
    'Keine Allergien gegen Nüsse',
    'Keine bekannten Allergien',
    'Das Kind ist nicht allergisch gegen Erdnüsse',
    'Ohne Allergien',
    'Aucune allergie connue',
    'Pas allergique aux noix',
    'Sans allergies particulières',
  ]) {
    assert.deepStrictEqual(termini(nota), [], `doveva tacere: ${nota}`);
  }
});

test('la negazione cade sull\'ALLERGIA, non sulla sostanza', () => {
  // È la distinzione che tiene in piedi tutto: "senza allergie" è una negazione,
  // "senza glutine" è una restrizione vera. Vale identica nelle quattro lingue.
  assert.deepStrictEqual(termini('Senza glutine per una persona'), ['Glutine']);
  assert.deepStrictEqual(termini('sans gluten pour une personne'), ['Glutine']);
  assert.deepStrictEqual(termini('Ohne Nüsse bitte.'), ['Frutta a guscio']);
  assert.deepStrictEqual(termini('No glutine'), ['Glutine']);
  // e la negazione non deve zittire una seconda proposizione che afferma
  assert.deepStrictEqual(termini('Non risulta intollerante però evitare i crostacei'), ['Crostacei']);
});

// --- Marcatori forti in due famiglie — decisione del 19/08/2026 --------------
// Prima valevano tutti in TUTTA la frase, senza il vincolo di vicinanza che i
// deboli hanno sempre avuto. La distanza DA SOLA non separa i due casi: per
// uccidere "Vietato fumare in camera, gradisce il pesce" serve una soglia
// stretta, e a quella soglia si perde "allergie: arachidi, noci, sedano, sesamo
// e solfiti", dove l'ultimo elemento sta a sette parole. Un elenco vero è più
// lungo di una frase amministrativa.

test('un verbo di divieto che parla d\'altro non è un\'allergia', () => {
  for (const nota of [
    'Vietato fumare in camera, gradisce il pesce a cena',
    'evitare rumori, servire il pesce alla griglia',
    'evitare piano terra, cliente con noci in valigia per regalo',
    'Non può salire le scale, camera al piano terra, gradisce le fragole a colazione',
    'il cliente non puo salire le scale, gradisce molto il pesce',
  ]) {
    assert.deepStrictEqual(termini(nota), [], `doveva tacere: ${nota}`);
  }
});

test('un verbo di divieto vicino alla sostanza resta un\'allergia', () => {
  assert.deepStrictEqual(termini('il cliente non può mangiare le noci'), ['Frutta a guscio']);
  assert.deepStrictEqual(termini('il cliente non puo mangiare le noci'), ['Frutta a guscio']);
  assert.deepStrictEqual(termini('evitare assolutamente le arachidi'), ['Arachidi']);
  assert.deepStrictEqual(termini('vietato il glutine'), ['Glutine']);
  assert.deepStrictEqual(termini('cannot eat shellfish'), ['Crostacei']);
});

test('"non può" con l\'accento vale quanto "non puo" senza', () => {
  // In JavaScript il confine di parola non riconosce le lettere accentate:
  // `\bnon può\b` non combaciava MAI, nemmeno da solo, e funzionava solo la
  // forma senza accento — cioè la nota scritta male.
  assert.deepStrictEqual(termini('non può mangiare il glutine'), termini('non puo mangiare il glutine'));
  assert.deepStrictEqual(termini('non può mangiare il glutine'), ['Glutine']);
});

test('gli elenchi lunghi non si perdono: la parola "allergia" vale a distanza', () => {
  assert.deepStrictEqual(
    termini('Allergie del gruppo: arachidi, noci, sedano, sesamo e solfiti'),
    ['Arachidi', 'Frutta a guscio', 'Sedano', 'Sesamo', 'Solfiti']
  );
  assert.deepStrictEqual(
    termini('La signora del 305 è fortemente allergica, non deve avere in tavola crostacei'),
    ['Crostacei']
  );
});

test('le forme francesi con accenti e legature combaciano', () => {
  // `œ` non è una lettera di parola, quindi `\bœufs\b` non combaciava mai; e la
  // preposizione `à` non veniva staccata, così l'allergene diventava
  // "À la fraise pour la petite".
  assert.deepStrictEqual(termini('Allergie aux œufs.'), ['Uova']);
  assert.deepStrictEqual(termini('Allergie aux oeufs.'), ['Uova']);
  assert.deepStrictEqual(termini('Allergie à la fraise pour la petite.'), ['Fraise pour la petite']);
  // controprove: l'apostrofo e il taglio delle prime lettere devono reggere
  assert.deepStrictEqual(termini("Allergia all'aglio"), ['Aglio']);
  assert.deepStrictEqual(termini('ALLERGIE ALIMENTARI'), []);
  assert.deepStrictEqual(termini('allergica agli animali'), ['Animali']);
});
