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

test('personaggio pubblico: etichetta dedicata e salvataggio nel profilo', () => {
  const h = risultato({ testo: 'Ruolo: imprenditore', fonti: [{ url: 'https://it.wikipedia.org/x', titolo: 'Wikipedia' }], pubblico: true, identificazione: 'pubblica', salvabile: true });
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

test('identità incerta: niente pulsante di salvataggio, e si dice perché', () => {
  const h = risultato({ testo: 'Ruolo: consulente', fonti: [{ url: 'https://www.linkedin.com/in/mrossi', titolo: 'LinkedIn' }], pubblico: true, identificazione: 'incerta', salvabile: false });
  assert.match(h, /brief-esito-inc/);
  assert.doesNotMatch(h, /brief-save/); // la regola che conta
  assert.match(h, /brief-avviso/);
  assert.match(h, /verifica/i);
  assert.match(h, /linkedin/); // la fonte resta, serve proprio a verificare
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
