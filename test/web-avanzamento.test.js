const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// web/app.js è uno script da browser: per le funzioni PURE si estrae il sorgente
// e lo si valuta (stessa tecnica di web-ricerca.test.js). renderAvanzamento la
// merita perché disegna tre situazioni che alla reception significano cose
// diverse — resto ancora, è l'ultima sera, se ne va oggi — e nel collaudo in
// hotel dell'11/08 le ultime due risultavano identiche a schermo.
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

const renderAvanzamento = new Function(`
  ${estraiConst('MAX_PALLINI')}
  ${estrai('fmtData')}
  ${estrai('progressoSoggiorno')}
  ${estrai('parteDomani')}
  ${estrai('renderAvanzamento')}
  return renderAvanzamento;`)();

// Conta i pallini per stato, così le asserzioni parlano di notti e non di HTML.
function pallini(html) {
  return {
    fatte: (html.match(/class="ic-dot on"/g) || []).length,
    corso: (html.match(/class="ic-dot corso"/g) || []).length,
    future: (html.match(/class="ic-dot"/g) || []).length,
  };
}

const OGGI = '2026-08-13';

test('a metà soggiorno la notte in corso è un anello, non una notte già dormita', () => {
  const html = renderAvanzamento({
    avanzamento: { notte: 3, notti: 7, ultimaNotte: false },
    dtpartenza: '2026-08-17',
  }, OGGI);
  assert.deepStrictEqual(pallini(html), { fatte: 2, corso: 1, future: 4 });
  assert.match(html, /Notte 3 di 7/);
});

test("l'ultima sera è dichiarata, non lasciata dedurre da «Notte 2 di 2»", () => {
  const html = renderAvanzamento({
    avanzamento: { notte: 2, notti: 2, ultimaNotte: true },
    dtpartenza: '2026-08-14',
  }, OGGI);
  assert.match(html, /Ultima notte/);
  assert.match(html, /parte domani/);
  // Stanotte l'ospite c'è ancora: l'ultimo pallino non può essere già pieno.
  assert.deepStrictEqual(pallini(html), { fatte: 1, corso: 1, future: 0 });
});

test('chi parte oggi ha la fila spenta e nessuna notte in corso', () => {
  const html = renderAvanzamento({
    avanzamento: { notte: 2, notti: 2, ultimaNotte: true },
    statoPartenza: 'partenza',
    dtpartenza: OGGI,
  }, OGGI);
  assert.match(html, /ic-prog-fine/);
  assert.deepStrictEqual(pallini(html), { fatte: 2, corso: 0, future: 0 });
  assert.match(html, /2 notti · <b>parte oggi<\/b>/);
});

test("l'ultima notte e la partenza di oggi non si disegnano più uguali", () => {
  const av = { notte: 2, notti: 2, ultimaNotte: true };
  const resta = renderAvanzamento({ avanzamento: av, dtpartenza: '2026-08-14' }, OGGI);
  const parte = renderAvanzamento({ avanzamento: av, statoPartenza: 'partenza', dtpartenza: OGGI }, OGGI);
  // Non basta che cambi il testo: deve cambiare anche il disegno.
  const soloProgresso = (h) => h.slice(0, h.indexOf('<span>', 1));
  assert.notStrictEqual(soloProgresso(resta), soloProgresso(parte));
});

// Le due settimane sono il soggiorno lungo normale dell'hotel: devono restare
// leggibili a pallini, altrimenti la barra diventa la regola e non l'eccezione.
test('un soggiorno di due settimane si legge ancora a pallini', () => {
  const html = renderAvanzamento({
    avanzamento: { notte: 12, notti: 15, ultimaNotte: false },
    dtpartenza: '2026-08-17',
  }, OGGI);
  assert.doesNotMatch(html, /ic-bar/);
  assert.deepStrictEqual(pallini(html), { fatte: 11, corso: 1, future: 3 });
});

test('oltre la soglia il soggiorno non resta senza avanzamento: barra al posto dei pallini', () => {
  const html = renderAvanzamento({
    avanzamento: { notte: 12, notti: 21, ultimaNotte: false },
    dtpartenza: '2026-08-23',
  }, OGGI);
  assert.match(html, /class="ic-bar"/);
  assert.deepStrictEqual(pallini(html), { fatte: 0, corso: 0, future: 0 });
  // 11 notti dormite su 21 = 52%, più la tacca della notte in corso.
  assert.match(html, /ic-bar-fatte" style="width:52%"/);
  assert.match(html, /ic-bar-corso" style="width:5%"/);
  assert.match(html, /Notte 12 di 21/);
});

test('un soggiorno lungo che parte oggi ha la barra piena e spenta', () => {
  const html = renderAvanzamento({
    avanzamento: { notte: 21, notti: 21, ultimaNotte: true },
    statoPartenza: 'partenza',
    dtpartenza: OGGI,
  }, OGGI);
  assert.match(html, /ic-prog-fine/);
  assert.match(html, /ic-bar-fatte" style="width:100%"/);
  assert.match(html, /ic-bar-corso" style="width:0%"/);
});

test('«domani» solo se la partenza è davvero il giorno dopo: altrimenti la data esplicita', () => {
  const html = renderAvanzamento({
    avanzamento: { notte: 3, notti: 3, ultimaNotte: true },
    dtpartenza: '2026-08-20',
  }, OGGI);
  assert.doesNotMatch(html, /parte domani/);
  assert.match(html, /Notte 3 di 3 · parte 20\/08\/2026/);
});

test('chi ha già fatto il check-out resta senza avanzamento', () => {
  const html = renderAvanzamento({
    statoPartenza: 'checkout', notti: 4,
    avanzamento: { notte: 4, notti: 4, ultimaNotte: true },
  }, OGGI);
  assert.strictEqual(html, '<span>Soggiorno concluso · 4 notti</span>');
});

test('senza avanzamento calcolabile si dice almeno quando parte', () => {
  const html = renderAvanzamento({ dtpartenza: '2026-08-20' }, OGGI);
  assert.strictEqual(html, '<span>Parte il 20/08/2026</span>');
});

test("l'ospite del giorno non ha un soggiorno da far avanzare", () => {
  const html = renderAvanzamento({
    statoPartenza: 'dayuse', dtarrivo: OGGI, dtpartenza: OGGI, notti: 0,
    paxAdulti: 2, paxBambini: 1, avanzamento: null,
  }, OGGI);
  // Niente pallini, niente "parte il…": parte in giornata per definizione.
  assert.doesNotMatch(html, /ic-dot|ic-bar|Parte il/);
  assert.strictEqual(html, '<span>In hotel per la giornata · 3 persone</span>');
});

test("l'ospite del giorno senza pax dichiarati non inventa un numero", () => {
  const html = renderAvanzamento({ statoPartenza: 'dayuse', dtpartenza: OGGI }, OGGI);
  assert.strictEqual(html, '<span>In hotel per la giornata</span>');
});

// --- Badge "Nª volta" --------------------------------------------------------
// Il conteggio dei soggiorni e quello delle giornate sono due cose diverse e
// devono restare due badge diversi: sui dati veri dell'hotel, sommandoli,
// 5.363 ospiti risultavano di ritorno senza aver mai dormito qui.
const badgeStorico = new Function(`
  ${estrai('fmtData')}
  ${estrai('badgeStorico')}
  return badgeStorico;`)();

test('badge: chi ha dormito qui una volta e poi e\' tornato per la SPA e\' alla 2ª volta', () => {
  const html = badgeStorico({ n: 1, ultima: '2025-08-10', visite: 6 });
  assert.match(html, /2ª volta/);
  assert.doesNotMatch(html, /8ª volta|7ª volta/);
  assert.match(html, /6 in giornata/);
});

test('badge: chi e\' venuto solo in giornata non risulta un ospite di ritorno', () => {
  const html = badgeStorico({ n: 0, ultima: null, visite: 3 });
  assert.doesNotMatch(html, /volta/);
  assert.match(html, /3 in giornata/);
});

test('badge: senza giornate resta il solo conteggio dei soggiorni', () => {
  const html = badgeStorico({ n: 4, ultima: '2024-08-09', visite: 0 });
  assert.match(html, /5ª volta · ultima 09\/08\/2024/);
  assert.doesNotMatch(html, /giornata/);
});

test('badge: chi non e\' mai stato qui non ha badge', () => {
  assert.strictEqual(badgeStorico({ n: 0, visite: 0 }), '');
  assert.strictEqual(badgeStorico(null), '');
});
