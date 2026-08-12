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
