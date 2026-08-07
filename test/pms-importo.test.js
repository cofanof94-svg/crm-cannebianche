const { test } = require('node:test');
const assert = require('node:assert');
const { sommaPratica, costruisciTracce, getImportiPrenotazioni } = require('../src/pms/importo');

const tp = (id, base, di, df, qta = 1) => ({ id, base, di, df, qta });
const ps = (id, gg, imp) => ({ id, GG: gg, impoEur: imp });

test('sommaPratica: tariffa base piatta quando non c\'è pianificazione', () => {
  assert.strictEqual(sommaPratica([tp(1, 100, '2026-01-01', '2026-01-04')], []), 300); // 3 notti × 100
});

test('sommaPratica: 62518 (una camera, override a gradini) → 5253', () => {
  const tpRows = [tp(69181, 1081.5, '2026-08-06', '2026-08-11')]; // 5 notti
  const psRows = [ps(69181, 2, 1030), ps(69181, 3, 1081.5), ps(69181, 4, 978.5), ps(69181, 5, 1081.5)];
  assert.strictEqual(sommaPratica(tpRows, psRows), 5253);
});

test('sommaPratica: 61178 (due camere PARALLELE) → 11700', () => {
  const tpRows = [tp(68139, 880, '2026-08-06', '2026-08-13'), tp(68140, 880, '2026-08-06', '2026-08-13')];
  const psRows = [];
  for (const id of [68139, 68140]) psRows.push(ps(id, 2, 790), ps(id, 3, 820), ps(id, 5, 860), ps(id, 7, 820));
  assert.strictEqual(sommaPratica(tpRows, psRows), 11700);
});

test('sommaPratica: 59645 (CAMBIO CAMERA, segmenti sequenziali) → 29725', () => {
  const tpRows = [tp(66485, 1325, '2026-08-06', '2026-08-07'), tp(68952, 1325, '2026-08-07', '2026-08-24')];
  const psRows = [ps(66485, 2, 1650), ps(66485, 3, 1700), ps(66485, 4, 1650), ps(66485, 5, 1650),
    ps(66485, 7, 1650), ps(66485, 8, 1800), ps(66485, 11, 1800), ps(66485, 12, 1650), ps(66485, 13, 1600), ps(66485, 17, 1600)];
  assert.strictEqual(sommaPratica(tpRows, psRows), 29725);
});

test('costruisciTracce: parallele = 2 tracce, sequenziali = 1 traccia', () => {
  const seg = (id, di, df) => ({ id, di, df, base: 0, qta: 1 });
  const parallele = costruisciTracce([seg(1, 100, 107), seg(2, 100, 107)]);
  assert.strictEqual(parallele.length, 2);
  const sequenziali = costruisciTracce([seg(1, 100, 101), seg(2, 101, 118)]);
  assert.strictEqual(sequenziali.length, 1);
});

test('getImportiPrenotazioni: aggrega TipoPre + PianificazioneSogg per pratica', async () => {
  const pms = {
    async query(text) {
      if (/FROM TipoPre WHERE codpratica IN/.test(text)) return [
        { codpratica: 61178, id: 68139, base: 880, di: '2026-08-06', df: '2026-08-13', qta: 1 },
        { codpratica: 61178, id: 68140, base: 880, di: '2026-08-06', df: '2026-08-13', qta: 1 },
      ];
      if (/FROM PianificazioneSogg/.test(text)) {
        const r = [];
        for (const id of [68139, 68140]) r.push({ codpratica: 61178, id, GG: 2, impoEur: 790 }, { codpratica: 61178, id, GG: 3, impoEur: 820 }, { codpratica: 61178, id, GG: 5, impoEur: 860 }, { codpratica: 61178, id, GG: 7, impoEur: 820 });
        return r;
      }
      return [];
    },
  };
  const m = await getImportiPrenotazioni(pms, [61178]);
  assert.strictEqual(m.get(61178), 11700);
});

test('getImportiPrenotazioni: check-in fatto (TipoPre svuotata) → maturato + residuo pianificato', async () => {
  // 61178 dopo il check-in: 1 notte maturata (1760 = 880×2 camere), 6 notti residue
  // dalla pianificazione (790,820,820,860,860,820) × 2 camere = 9940 → totale 11700.
  const pms = {
    async query(text) {
      if (/FROM TipoPre WHERE codpratica IN/.test(text)) return []; // svuotata al check-in
      if (/FROM PianificazioneSogg/.test(text)) {
        const r = [];
        for (const id of [68139, 68140]) r.push({ codpratica: 61178, id, GG: 2, impoEur: 790 }, { codpratica: 61178, id, GG: 3, impoEur: 820 }, { codpratica: 61178, id, GG: 5, impoEur: 860 }, { codpratica: 61178, id, GG: 7, impoEur: 820 });
        return r;
      }
      if (/FROM Prenota p WHERE p\.codpratica IN/.test(text)) return [{ codpratica: 61178, notti: 7, nottiFatte: 1, maturato: 1760, tariffaNotte: 1580 }];
      return [];
    },
  };
  const m = await getImportiPrenotazioni(pms, [61178]);
  assert.strictEqual(m.get(61178), 11700);
});

test('getImportiPrenotazioni: senza TipoPre né pianificazione → maturato + tariffa corrente', async () => {
  const pms = {
    async query(text) {
      if (/FROM TipoPre WHERE codpratica IN/.test(text)) return [];
      if (/FROM PianificazioneSogg/.test(text)) return [];
      if (/FROM Prenota p WHERE p\.codpratica IN/.test(text)) return [{ codpratica: 9, notti: 2, nottiFatte: 0, maturato: 0, tariffaNotte: 855 }];
      return [];
    },
  };
  const m = await getImportiPrenotazioni(pms, [9]);
  assert.strictEqual(m.get(9), 1710); // 855 × 2 notti
});
