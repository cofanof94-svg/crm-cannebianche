const { test } = require('node:test');
const assert = require('node:assert');
const { mapStato, isSpazzatura, isValidoCumulativi, num, buildSnapshotRow, calcolaCumulativiCliente } = require('../src/import/trasforma');

test('mapStato: cancellata/completata/confermata', () => {
  assert.strictEqual(mapStato({ dataEliminazione: '2026-05-24' }), 'Cancellata');
  assert.strictEqual(mapStato({ isStorico: true }), 'Completata');
  assert.strictEqual(mapStato({ isStorico: false, flgincasa: 'P' }), 'Completata'); // corrente partito
  assert.strictEqual(mapStato({ isStorico: false, flgincasa: 'N' }), 'Confermata');
  assert.strictEqual(mapStato({ isStorico: false, flgincasa: 'S' }), 'Confermata'); // in casa
  // l'eliminazione vince su tutto
  assert.strictEqual(mapStato({ dataEliminazione: '2026-01-01', isStorico: true, flgincasa: 'P' }), 'Cancellata');
});

test('isSpazzatura riconosce i motivi di servizio', () => {
  ['DOPPIA', 'test', 'prova', 'fittizia', 'ERRORE', 'edit', 'già inserita', 'non confermata', 'opzione scaduta', '.', '-']
    .forEach((m) => assert.strictEqual(isSpazzatura(m), true, `atteso spazzatura: "${m}"`));
  ['', null, 'CXL con penale', 'ospite VIP', 'anniversario'].forEach((m) => assert.strictEqual(isSpazzatura(m), false, `atteso valido: "${m}"`));
});

test('num normalizza e arrotonda a 2 decimali', () => {
  assert.strictEqual(num('41.999999999'), 42);
  assert.strictEqual(num(null), 0);
  assert.strictEqual(num('abc'), 0);
  assert.strictEqual(num(1234.567), 1234.57);
});

test('isValidoCumulativi: cancellata/spazzatura escluse, servono sostanza', () => {
  assert.strictEqual(isValidoCumulativi({ stato: 'Cancellata', impArrangiamento: 1000 }), false);
  assert.strictEqual(isValidoCumulativi({ stato: 'Completata', motivo: 'DOPPIA', impArrangiamento: 1000 }), false);
  assert.strictEqual(isValidoCumulativi({ stato: 'Completata', impArrangiamento: 0, impExtra: 0, hasOccupanti: false }), false);
  assert.strictEqual(isValidoCumulativi({ stato: 'Completata', impArrangiamento: 500 }), true);
  assert.strictEqual(isValidoCumulativi({ stato: 'Confermata', impArrangiamento: 0, impExtra: 0, hasOccupanti: true }), true);
});

test('buildSnapshotRow costruisce la riga con stato/validità/importi normalizzati', () => {
  const r = buildSnapshotRow({
    codpratica: 62152, pmsCustomerId: 81304, dtarrivo: '2026-07-28', dtpartenza: '2026-08-04', notti: 7,
    isStorico: true, dataEliminazione: '2026-05-24', motivo: 'CXL', flgincasa: 'N',
    source: 'OTA', mercato: 'LEISURE INDIVIDUALI', camere: '108', tipologia: 'Junior Suite', trattamento: 'BB', pax: 2,
    impArrangiamento: '1120.00', impExtra: '41.999999', cityTax: '10', vipSnapshot: 'V1', amenitiesSnapshot: 'Prosecco',
  });
  assert.strictEqual(r.stato, 'Cancellata');
  assert.strictEqual(r.validoCumulativi, false);      // cancellata
  assert.strictEqual(r.impExtra, 42);                 // arrotondato
  assert.strictEqual(r.cityTax, 10);
  assert.strictEqual(r.vipSnapshot, 'V1');
  assert.strictEqual(r.source, 'OTA');
});

test('buildSnapshotRow: soggiorno concluso valido', () => {
  const r = buildSnapshotRow({ codpratica: 1, pmsCustomerId: 9, isStorico: true, dataEliminazione: null,
    impArrangiamento: 800, impExtra: 200, hasOccupanti: true, source: 'DIRETTI' });
  assert.strictEqual(r.stato, 'Completata');
  assert.strictEqual(r.validoCumulativi, true);
});

test('calcolaCumulativiCliente somma solo le righe passate (valide)', () => {
  const c = calcolaCumulativiCliente([
    { dtarrivo: '2026-04-17', notti: 2, impArrangiamento: 800, impExtra: 200, source: 'OTA' },
    { dtarrivo: '2026-07-07', notti: 8, impArrangiamento: 2000, impExtra: 0, source: 'DIRETTI' },
  ]);
  assert.strictEqual(c.nSoggiorni, 2);
  assert.strictEqual(c.nottiTotali, 10);
  assert.strictEqual(c.ltv, 3000);
  assert.strictEqual(c.spesaMediaSoggiorno, 1500);
  assert.strictEqual(c.spesaMediaServizi, 100);
  assert.strictEqual(c.ultimaSource, 'DIRETTI');       // più recente
  assert.strictEqual(c.primaVisita, '2026-04-17');
  assert.strictEqual(c.ultimaVisita, '2026-07-07');
});

test('calcolaCumulativiCliente: nessuna riga → zeri senza NaN', () => {
  const c = calcolaCumulativiCliente([]);
  assert.strictEqual(c.nSoggiorni, 0);
  assert.strictEqual(c.ltv, 0);
  assert.strictEqual(c.spesaMediaSoggiorno, 0);
  assert.strictEqual(c.ultimaSource, null);
});
