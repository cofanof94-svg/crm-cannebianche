const { test } = require('node:test');
const assert = require('node:assert');
const { cercaClienti, getCliente, getSoggiorniCliente } = require('../src/pms/clienti');

function fakePms(recordset) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('cercaClienti passa il termine come LIKE e mappa', async () => {
  const pms = fakePms([{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANTONELLA', email: 'a@b.it', Cellulare: '', Citta: 'TRANI' }]);
  const [r] = await cercaClienti(pms, 'bari');
  assert.strictEqual(r.codCli, 47186);
  assert.strictEqual(r.nominativo, 'DI BARI ANTONELLA');
  assert.strictEqual(r.citta, 'TRANI');
  assert.strictEqual(pms.calls[0].params.q, '%bari%');
});

test('getCliente mappa anagrafica e consensi', async () => {
  const pms = fakePms([{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANTONELLA', Telefono: '', Cellulare: '333',
    email: 'a@b.it', Citta: 'TRANI', CodNaz: 'I', dtNascita: '1964-10-17', CodFis: 'XXX', CodVip: '',
    Annotazioni: 'nota pms', Privacy: 'S', Privacy2: 'S', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' }]);
  const a = await getCliente(pms, 47186);
  assert.strictEqual(a.nominativo, 'DI BARI ANTONELLA');
  assert.strictEqual(a.nazione, 'I');
  assert.strictEqual(a.vip, false);
  // 'S' = NON autorizzato → consenso false; 'N'/vuoto = consenso true
  assert.deepStrictEqual(a.consensi, { marketing: false, telefonate: false, conservazione: true, cessione: true });
});

test('getCliente restituisce null se non trovato', async () => {
  const pms = fakePms([]);
  assert.strictEqual(await getCliente(pms, 1), null);
});

test('getSoggiorniCliente mappa le righe', async () => {
  const pms = fakePms([{ codpratica: 60397, dtarrivo: '2026-04-17', dtpartenza: '2026-04-19', notti: 2,
    camere: '109', stato: 'Concluso', camereJson: '[{"camera":"109","arrangiamento":855,"extra":40}]' }]);
  const [s] = await getSoggiorniCliente(pms, 47186);
  assert.strictEqual(s.codpratica, 60397);
  assert.strictEqual(s.camere, '109');
  assert.strictEqual(s.arrangiamento, 855);       // somma arrangiamenti per camera (Matura codarr non nullo)
  assert.strictEqual(s.extra, 40);                // somma extra per camera
  assert.strictEqual(s.importo, 855);             // = arrangiamento (compat)
  assert.deepStrictEqual(s.camereDett, [{ camera: '109', arrangiamento: 855, extra: 40 }]);
  assert.strictEqual(s.stato, 'Concluso');
  assert.strictEqual(pms.calls[0].params.codCli, 47186);
});
