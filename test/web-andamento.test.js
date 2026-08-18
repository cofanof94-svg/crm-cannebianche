const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Il grafico dell'andamento scrive un'etichetta per punto. Finché i punti sono i
// mesi di un anno vanno bene "08/26" e tredici scritte; su tutto lo storico i
// punti diventano gli ANNI, e l'etichetta va scritta in un altro modo — se no
// "2026".slice(5) è vuoto e sotto il grafico compaiono tredici "/20".
const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'analytics.js'), 'utf8');

function estrai(nome) {
  const inizio = SRC.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovata in web/analytics.js`);
  return SRC.slice(inizio, SRC.indexOf('\n}', inizio) + 2);
}

const anAndamento = new Function(`
  const esc = (s) => String(s == null ? '' : s);
  ${estrai('anAndamento')}
  return anAndamento;`)();

const etichette = (html) => [...html.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]);

test('a mesi: etichetta mese/anno breve', () => {
  const h = anAndamento([{ mese: '2026-07', n: 85 }, { mese: '2026-08', n: 38 }], false);
  assert.deepStrictEqual(etichette(h), ['07/26', '08/26']);
  assert.match(h, /aria-label="Soggiorni conclusi per mese"/);
});

test('ad anni: l\'etichetta è l\'anno, non un pezzo di data', () => {
  const h = anAndamento([{ mese: '2024', n: 360 }, { mese: '2025', n: 385 }, { mese: '2026', n: 322 }], true);
  assert.deepStrictEqual(etichette(h), ['2024', '2025', '2026']);
  assert.match(h, /aria-label="Soggiorni conclusi per anno"/);
});

test('con un punto solo non si disegna niente', () => {
  // Un grafico con un punto non aggiunge nulla a quel punto, e la sezione che lo
  // conterrebbe sparisce insieme a lui.
  assert.strictEqual(anAndamento([{ mese: '2026-08', n: 15 }], false), '');
  assert.strictEqual(anAndamento([], false), '');
  assert.strictEqual(anAndamento(null, true), '');
});

test('la linea sta dentro il riquadro anche quando un anno è molto più alto', () => {
  // Le coordinate sono calcolate a mano: se il massimo non normalizzasse, il
  // punto più alto uscirebbe dal viewBox e la linea verrebbe tagliata.
  const h = anAndamento([{ mese: '2018', n: 53 }, { mese: '2025', n: 385 }], true);
  const punti = h.match(/class="an-trend-linea" points="([^"]+)"/)[1]
    .split(' ').map((p) => p.split(',').map(Number));
  for (const [x, y] of punti) {
    assert.ok(x >= 0 && x <= 640, `x fuori dal riquadro: ${x}`);
    assert.ok(y >= 0 && y <= 120, `y fuori dal riquadro: ${y}`);
  }
});
