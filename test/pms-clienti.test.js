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
    camere: '109', stato: 'Concluso', source: 'DIRETTI', mercato: 'LEISURE INDIVIDUALI', arrangiamento: 855, extra: 40, pianificato: 900 }]);
  const [s] = await getSoggiorniCliente(pms, 47186);
  assert.strictEqual(s.codpratica, 60397);
  assert.strictEqual(s.camere, '109');
  assert.strictEqual(s.arrangiamento, 855);       // arrangiamento per pratica (Matura+StorMatura, codarr non nullo)
  assert.strictEqual(s.extra, 40);                // extra per pratica (city tax esclusa)
  assert.strictEqual(s.importo, 855);             // = arrangiamento (compat)
  assert.strictEqual(s.stato, 'Concluso');
  assert.strictEqual(s.source, 'DIRETTI');
  assert.strictEqual(s.mercato, 'LEISURE INDIVIDUALI');
  assert.strictEqual(s.pianificato, 900);          // tariffa pianificata (per il "previsto")
  assert.strictEqual(pms.calls[0].params.codCli, 47186);
});

test('getSoggiorniCliente: la query esclude la city tax dagli extra e decodifica la Source', async () => {
  const pms = fakePms([]);
  await getSoggiorniCliente(pms, 47186);
  const sql = pms.calls[0].text;
  assert.match(sql, /codser, ''\)+ <> 'IMP'/);         // city tax (codser=IMP) esclusa
  assert.match(sql, /FROM SourcePrenota src/);          // Source decodificata
  assert.match(sql, /FROM PrenotaProvenienze prov/);    // Mercato (tipologia viaggio) decodificato
  assert.match(sql, /> @dlav THEN 'Pianificata'/);      // prenotazioni future = Pianificata
});

test('getSoggiorniCliente: la query marca Eliminata le prenotazioni con DataEliminazione', async () => {
  const pms = fakePms([]);
  await getSoggiorniCliente(pms, 81304);
  const sql = pms.calls[0].text;
  // Il ramo StorPrenota deve etichettare 'Eliminata' (annullate) e non 'Concluso' fisso
  assert.match(sql, /sp\.DataEliminazione IS NOT NULL THEN 'Eliminata'/);
});

test('getSoggiorniCliente: mappa lo stato Eliminata senza alterarlo', async () => {
  const pms = fakePms([{ codpratica: 62152, dtarrivo: '2026-07-28', dtpartenza: '2026-08-04', notti: 7,
    camere: null, stato: 'Eliminata', camereJson: '[]' }]);
  const [s] = await getSoggiorniCliente(pms, 81304);
  assert.strictEqual(s.stato, 'Eliminata');
  assert.strictEqual(s.arrangiamento, 0);
  assert.strictEqual(s.extra, 0);
});
