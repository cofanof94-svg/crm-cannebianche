const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// web/export.js è uno script da browser: per le funzioni PURE si estrae il
// sorgente e lo si valuta, come già si fa per web/app.js. Qui la rete di
// sicurezza serve soprattutto a una cosa: che le ALLERGIE non finiscano mai
// mescolate alle preferenze, e che il CSV non si spezzi su un testo con
// virgolette o punto e virgola (le note dell'hotel ne sono piene).
const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'export.js'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

function estraiDa(src, nome) {
  const inizio = src.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovata`);
  const fine = src.indexOf('\n}', inizio);
  return src.slice(inizio, fine + 2);
}
function estraiConstDa(src, nome) {
  const riga = src.split('\n').find((l) => l.startsWith(`const ${nome} =`));
  assert.ok(riga, `const ${nome} non trovata`);
  return riga;
}
// Blocco `const NOME = { ... };` su più righe (le tabelle di colonne/viste).
function estraiOggetto(src, nome) {
  const inizio = src.indexOf(`const ${nome} = {`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovato`);
  const fine = src.indexOf('\n};', inizio);
  return src.slice(inizio, fine + 3);
}

// Ambiente minimo: le funzioni dell'export usano esc e fmtData di app.js — si
// prendono quelli veri, non copie, così il test verifica il comportamento reale.
const AMBIENTE = [
  estraiConstDa(APP, 'esc'),
  estraiDa(APP, 'fmtData'),
  estraiOggetto(SRC, 'COLONNE_EXPORT'),
  estraiOggetto(SRC, 'VISTE_EXPORT'),
  estraiDa(SRC, 'attenzioniDi'),
  estraiDa(SRC, 'accorcia'),
  estraiDa(SRC, 'rigaExport'),
  estraiDa(SRC, 'ordinaPerCamera'),
  estraiDa(SRC, 'costruisciExport'),
  estraiDa(SRC, 'campoCsv'),
  estraiDa(SRC, 'toCsv'),
  estraiDa(SRC, 'tabellaStampa'),
].join('\n');

// eslint-disable-next-line no-new-func
const E = new Function(`${AMBIENTE}
  return { COLONNE_EXPORT, VISTE_EXPORT, attenzioniDi, accorcia, rigaExport, ordinaPerCamera, costruisciExport, campoCsv, toCsv, tabellaStampa };`)();

const arrivo = {
  codpratica: 70104,
  nominativo: 'PAGLIUSO ROBERT RALPH',
  camere: '109, 218',
  dtarrivo: '2026-08-10',
  dtpartenza: '2026-08-14',
  notti: 4,
  trattamento: 'B&B',
  note: 'Camera alta, lontano ascensore.',
  ospiti: [{ nominativo: 'PAGLIUSO ROSEMARIE' }, { nominativo: 'PAGLIUSO NATALIA' }],
  snapshot: {
    vip: { descrizione: 'BOLLICINE + FRUTTA FRESCA' },
    intolleranze: ['Arachidi', 'Lattosio'],
    preferenzeTop: [{ testo: 'Coca-Cola Zero' }, { testo: 'Cuscino rigido' }],
    reclami: { aperti: 1, totali: 2 },
    compleanno: { data: '2026-08-12', nome: 'PAGLIUSO NATALIA' },
    indesiderato: false,
  },
};

test('rigaExport: allergie e preferenze restano in campi DIVERSI', () => {
  const r = E.rigaExport(arrivo);
  assert.strictEqual(r.allergie, 'Arachidi, Lattosio');
  assert.strictEqual(r.preferenze, 'Coca-Cola Zero · Cuscino rigido');
  assert.doesNotMatch(r.preferenze, /Arachidi/); // mai mescolate
  assert.doesNotMatch(r.allergie, /Coca/);
});

test('rigaExport: dati operativi sì, dati economici no', () => {
  const r = E.rigaExport({ ...arrivo, importo: 4200, extra: 380, tariffa: 'DIRETTO' });
  assert.strictEqual(r.camere, '109, 218');
  assert.strictEqual(r.arrivo, '10/08/2026');
  assert.strictEqual(r.vip, 'BOLLICINE + FRUTTA FRESCA');
  assert.strictEqual(r.inCamera, 'PAGLIUSO ROSEMARIE, PAGLIUSO NATALIA');
  assert.strictEqual(r.trattamento, 'B&B');
  // niente importi, extra o tariffa nel foglio che gira per i reparti
  assert.strictEqual(JSON.stringify(r).includes('4200'), false);
  assert.strictEqual(JSON.stringify(r).includes('DIRETTO'), false);
});

test('attenzioniDi: raccoglie ciò che richiede attenzione, in chiaro', () => {
  const a = E.attenzioniDi(arrivo);
  assert.ok(a.some((x) => /Reclamo aperto \(1\)/.test(x)));
  assert.ok(a.some((x) => /Compleanno 12\/08\/2026 — PAGLIUSO NATALIA/.test(x)));
  const b = E.attenzioniDi({ snapshot: { indesiderato: true, reclami: { aperti: 0 } }, statoPartenza: 'checkout' });
  assert.deepStrictEqual(b, ['Ospite indesiderato', 'Check-out effettuato']);
  assert.deepStrictEqual(E.attenzioniDi({}), []); // nessun allarme inventato
});

test('accorcia: taglia a parola intera, lascia intatto ciò che ci sta', () => {
  assert.strictEqual(E.accorcia('Camera alta.', 180), 'Camera alta.');
  assert.strictEqual(E.accorcia(null, 180), '');
  const lungo = E.accorcia('a'.repeat(30) + ' ' + 'b'.repeat(30), 40);
  assert.ok(lungo.endsWith('…'));
  assert.ok(lungo.length <= 41);
  assert.strictEqual(E.accorcia('riga uno\nriga due', 180), 'riga uno riga due'); // a capo appiattiti
});

test('ordinaPerCamera: ordine da rack, non alfabetico', () => {
  const r = E.ordinaPerCamera([{ camere: '218' }, { camere: '109' }, { camere: '—' }, { camere: '9' }]);
  assert.deepStrictEqual(r.map((x) => x.camere), ['9', '109', '218', '—']);
});

test('toCsv: intestazioni, separatore ; e BOM per Excel', () => {
  const righe = E.costruisciExport([arrivo]);
  const csv = E.toCsv(righe, ['camera', 'ospite', 'allergie', 'preferenze']);
  const linee = csv.split('\r\n');
  assert.ok(csv.startsWith('﻿'), 'senza BOM Excel sbaglia gli accenti');
  assert.strictEqual(linee[0], '﻿Camera;Ospite;Allergie;Preferenze');
  // Con il ';' come separatore la virgola è un carattere qualunque: niente
  // virgolette inutili attorno a "Arachidi, Lattosio".
  assert.strictEqual(linee[1], '109, 218;PAGLIUSO ROBERT RALPH;Arachidi, Lattosio;Coca-Cola Zero · Cuscino rigido');
});

test('toCsv: virgolette e punto e virgola nel testo non spezzano la riga', () => {
  const riga = E.rigaExport({ ...arrivo, note: 'Dice: "niente pesce"; allergica', snapshot: { ...arrivo.snapshot } });
  const csv = E.toCsv([riga], ['notePms']);
  const corpo = csv.split('\r\n')[1];
  assert.strictEqual(corpo, '"Dice: ""niente pesce""; allergica"');
  assert.strictEqual(corpo.split(';').length > 1, true); // il ; sta dentro le virgolette
});

test('tabellaStampa: la riga con allergie è marcata e il valore evidenziato', () => {
  const righe = E.costruisciExport([arrivo, { ...arrivo, camere: '300', snapshot: { intolleranze: [] } }]);
  const html = E.tabellaStampa(righe, ['camera', 'allergie']);
  assert.match(html, /<tr class="st-riga-allergia">/);
  assert.match(html, /<td class="st-allergie"><b>⚠ Arachidi, Lattosio<\/b><\/td>/);
  assert.strictEqual((html.match(/st-riga-allergia/g) || []).length, 1); // solo chi ne ha
});

test('tabellaStampa: il testo dell\'ospite passa per l\'escape', () => {
  const righe = E.costruisciExport([{ ...arrivo, nominativo: '<img src=x onerror=alert(1)>', snapshot: {} }]);
  const html = E.tabellaStampa(righe, ['ospite']);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('vista generale: colonne attese, e nessun campo economico', () => {
  const c = E.VISTE_EXPORT.generale.colonne;
  ['camera', 'ospite', 'arrivo', 'partenza', 'vip', 'allergie', 'attenzioni', 'preferenze'].forEach((k) => {
    assert.ok(c.includes(k), `manca la colonna ${k}`);
  });
  assert.ok(c.indexOf('allergie') < c.indexOf('preferenze'), 'le allergie vengono prima delle preferenze');
  ['importo', 'extra', 'tariffa'].forEach((k) => assert.ok(!c.includes(k)));
  // le colonne dichiarate devono esistere davvero
  [...c, ...E.VISTE_EXPORT.generale.colonneCsv].forEach((k) => assert.ok(E.COLONNE_EXPORT[k], `colonna ${k} non definita`));
});
