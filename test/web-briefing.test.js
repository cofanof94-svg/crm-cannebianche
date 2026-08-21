const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// La regola "un'identità incerta non si scrive in anagrafica" vive nel frontend:
// è lì che si decide se mostrare il pulsante "Salva nel profilo". Vale un test,
// perché è l'unica difesa contro l'omonimia dopo il prompt — e un prompt non è
// una garanzia. Stessa tecnica degli altri test del frontend: web/app.js è uno
// script da browser, quindi si estrae il sorgente delle funzioni pure e lo si
// valuta (vedi test/web-ricerca.test.js).
const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

function estrai(nome) {
  const inizio = SRC.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovata in web/app.js`);
  const fine = SRC.indexOf('\n}', inizio);
  assert.notStrictEqual(fine, -1, `fine di ${nome} non trovata`);
  return SRC.slice(inizio, fine + 2);
}

function estraiConst(nome) {
  const riga = SRC.split('\n').find((l) => l.startsWith(`const ${nome} =`));
  assert.ok(riga, `const ${nome} non trovata in web/app.js`);
  return riga;
}

// ESITI_BRIEF è un oggetto su più righe: si preleva quello vero, non una copia.
function estraiOggetto(nome) {
  const inizio = SRC.indexOf(`const ${nome} = {`);
  assert.notStrictEqual(inizio, -1, `const ${nome} non trovato in web/app.js`);
  const fine = SRC.indexOf('\n};', inizio);
  assert.notStrictEqual(fine, -1, `fine di ${nome} non trovata`);
  return SRC.slice(inizio, fine + 3);
}

// aiGiaFatto serve solo a sapere se il salvataggio è già avvenuto: qui non lo è mai.
const renderBriefResult = new Function(`
  ${estraiConst('esc')}
  ${estraiConst('chiaveSalvaBrief')}
  const aiGiaFatto = () => false;
  ${estraiOggetto('ESITI_BRIEF')}
  ${estrai('renderBriefResult')}
  return renderBriefResult;
`)();

const risultato = (b) => renderBriefResult(b, 1234);

test('link citati e link solo trovati non si chiamano allo stesso modo', () => {
  const citate = risultato({ testo: 'Ruolo: x', fonti: [{ url: 'https://it.wikipedia.org/x', titolo: 'W' }], fontiCitate: true, pubblico: true, identificazione: 'pubblica', salvabile: true });
  assert.match(citate, /Fonti \(1\)/);
  assert.doesNotMatch(citate, /non citati/);

  const trovate = risultato({ testo: 'Ruolo: x', fonti: [{ url: 'https://it.wikipedia.org/x', titolo: 'W' }], fontiCitate: false, pubblico: true, identificazione: 'pubblica', salvabile: true });
  assert.match(trovate, /Risultati della ricerca \(1\)/);
  assert.match(trovate, /non citati dall&#39;AI/); // passato da esc(), quindi con entità
});

test('personaggio pubblico: etichetta dedicata e salvataggio nel profilo', () => {
  const h = risultato({ testo: 'Ruolo: imprenditore', fonti: [{ url: 'https://it.wikipedia.org/x', titolo: 'Wikipedia' }], fontiCitate: true, pubblico: true, identificazione: 'pubblica', salvabile: true });
  assert.match(h, /brief-esito-pub/);
  assert.match(h, /Personaggio pubblico/);
  assert.match(h, /brief-save/);
  assert.doesNotMatch(h, /brief-avviso/);
});

test('profilo professionale: si vede da dove viene il dato, e si può salvare', () => {
  const h = risultato({ testo: 'Ruolo: Direttore Generale', fonti: [{ url: 'https://www.linkedin.com/in/x', titolo: 'LinkedIn' }], pubblico: true, identificazione: 'professionale', salvabile: true });
  assert.match(h, /brief-esito-pro/);
  assert.match(h, /Profilo professionale/);
  assert.match(h, /brief-save/);
  assert.match(h, /linkedin/);
});

test('identità incerta: si salva solo dopo aver confermato, e si dice perché', () => {
  // Regola cambiata il 21/08/2026, in hotel. Prima il pulsante non c'era del
  // tutto: l'applicazione chiedeva di aprire le fonti e verificare, e poi non
  // lasciava concludere la verifica. Chi aveva controllato doveva ricopiare la
  // nota a mano sulla scheda, o rifare (e ripagare) la stessa ricerca da li'.
  //
  // Adesso il pulsante c'e' ma nasce SPENTO, e lo accende una spunta: l'AI
  // continua a non scrivere da sola in anagrafica, la persona che ha guardato le
  // fonti si'.
  const h = risultato({ testo: 'Ruolo: consulente', fonti: [{ url: 'https://www.linkedin.com/in/mrossi', titolo: 'LinkedIn' }], pubblico: true, identificazione: 'incerta', salvabile: false });
  assert.match(h, /brief-esito-inc/);
  assert.match(h, /brief-avviso/);
  assert.match(h, /verifica/i);
  assert.match(h, /linkedin/); // la fonte resta, serve proprio a verificare

  // La regola che conta: il pulsante non e' premibile finche' non si conferma.
  assert.match(h, /data-conferma-cli/, 'serve la spunta di conferma');
  const bottone = /<button[^>]*data-save-cli[^>]*>/.exec(h);
  assert.ok(bottone, 'il pulsante deve esistere');
  assert.match(bottone[0], /\bdisabled\b/, 'deve nascere spento');
  assert.match(bottone[0], /data-incerta/, 'e deve sapere di essere un caso incerto');
});

test('identità certa: nessuna spunta da mettere, il pulsante è già attivo', () => {
  const h = risultato({ testo: 'Ruolo: imprenditore', fonti: [], pubblico: true, identificazione: 'pubblica', salvabile: true });
  assert.doesNotMatch(h, /data-conferma-cli/, 'attrito solo dove serve');
  const bottone = /<button[^>]*data-save-cli[^>]*>/.exec(h);
  assert.ok(bottone);
  assert.doesNotMatch(bottone[0], /\bdisabled\b/);
  assert.doesNotMatch(bottone[0], /data-incerta/);
});

test('una nota confermata a mano lo dichiara', () => {
  // Senza, fra sei mesi chi legge "Head UHNW at UBS" non sa se fosse
  // un'identificazione sicura o il giudizio di qualcuno in reception.
  assert.match(SRC, /const NOTA_CONFERMATA = /);
  assert.match(SRC, /identità confermata in reception, non dall/);
  // e viene aggiunta SOLO nel caso incerto
  assert.match(SRC, /btn\.dataset\.incerta \? `\$\{b\.testo\}\\n\$\{NOTA_CONFERMATA\}` : b\.testo/);
});

test('nessuna informazione: nessuna etichetta, nessun salvataggio', () => {
  const h = risultato({ testo: 'Nessuna informazione pubblica rilevante.', fonti: [], pubblico: false, identificazione: 'nessuna', salvabile: false });
  assert.doesNotMatch(h, /brief-esito/);
  assert.doesNotMatch(h, /brief-save/);
  assert.doesNotMatch(h, /brief-fonti/);
});

test('il testo del briefing arriva dall\'AI: va sempre con escape', () => {
  const h = risultato({ testo: 'Ruolo: <script>alert(1)</script>', fonti: [], pubblico: true, identificazione: 'pubblica', salvabile: true });
  assert.doesNotMatch(h, /<script>/);
  assert.match(h, /&lt;script&gt;/);
});

test('anche titolo e url delle fonti vanno con escape', () => {
  const h = risultato({ testo: 'Ruolo: x', fonti: [{ url: 'https://x.it/"onmouseover="alert(1)', titolo: '<b>fonte</b>' }], pubblico: true, identificazione: 'pubblica', salvabile: true });
  assert.doesNotMatch(h, /onmouseover="alert/);
  assert.doesNotMatch(h, /<b>fonte<\/b>/);
});

// --- L'attesa dichiarata — 20/08/2026 ---------------------------------------
// Il cerchietto che gira significa "qualche secondo" nel linguaggio di
// chiunque, e il briefing cerca sul web: è la funzione più lenta
// dell'applicazione (misurati oltre due minuti). Senza avvisare, dopo un minuto
// l'operatore crede che si sia bloccata e ricarica — buttando via una chiamata
// già pagata.

test('l\'attesa del briefing è scritta in un posto solo', () => {
  // Compare in due punti: la card degli arrivi e le note personali della
  // scheda. Se il testo fosse copiato, prima o poi direbbero cose diverse.
  const occorrenze = (SRC.match(/Ricerca su fonti pubbliche in corso/g) || []).length;
  assert.strictEqual(occorrenze, 1, 'il messaggio dev\'essere in una funzione condivisa');
  assert.match(SRC, /const attesaBriefing = \(\)/);
  // ed entrambi i punti devono usarla
  assert.strictEqual((SRC.match(/\$\{attesaBriefing\(\)\}/g) || []).length, 2);
});

test('l\'attesa avvisa che ci vuole tempo, senza promettere un numero', () => {
  // Niente `\n` nel motivo: i file del progetto hanno fine-riga Windows, e un
  // controllo che ci inciampa fallisce per il motivo sbagliato.
  const m = SRC.match(/const attesaBriefing = \(\)[\s\S]*?<\/span>';/);
  assert.ok(m, 'attesaBriefing non trovata');
  const testo = m[0];
  assert.match(testo, /internet/i, 'va detto perché è lenta');
  assert.match(testo, /senza ricaricare/i, 'va detto cosa NON fare');
  // Nessuna cifra promessa: non è stata misurata abbastanza da poterla
  // garantire, e un'attesa dichiarata e non rispettata è peggio di nessuna.
  assert.doesNotMatch(testo, /\d+\s*(secondi|minuti|s\b)/i);
});
