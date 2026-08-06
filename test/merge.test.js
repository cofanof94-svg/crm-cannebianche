const { test } = require('node:test');
const assert = require('node:assert');
const { inClause } = require('../src/db/query');
const { getGruppo, mergeInto, unmerge } = require('../src/crm/merge');
const { getDuplicatiCandidati, getTuttiGruppiDuplicati, getAnagreConfronto, calcolaConflitti } = require('../src/pms/duplicati');

// --- inClause ---
test('inClause: interi → lista, non-interi → throw', () => {
  assert.strictEqual(inClause([1, 2, 3]), '(1, 2, 3)');
  assert.strictEqual(inClause(42), '(42)');
  assert.strictEqual(inClause([]), '(NULL)');
  assert.throws(() => inClause(['x']), /non intero/);
  assert.throws(() => inClause([1, 2.5]), /non intero/);
});

// --- getGruppo: mock crmDb che risponde alle due query ---
function crmMerge(rows) {
  // rows: array di { pms_customer_id, canonical_id }
  return {
    async query(text, params) {
      if (/WHERE pms_customer_id = @codCli/.test(text)) return rows.filter((r) => r.pms_customer_id === params.codCli).map((r) => ({ canonical_id: r.canonical_id }));
      if (/WHERE canonical_id = @canonicalId/.test(text)) return rows.filter((r) => r.canonical_id === params.canonicalId).map((r) => ({ pms_customer_id: r.pms_customer_id }));
      return [];
    },
  };
}

test('getGruppo: standalone → solo sé stesso', async () => {
  const g = await getGruppo(crmMerge([]), 100);
  assert.deepStrictEqual(g, { canonicalId: 100, membri: [100] });
});

test('getGruppo: membro → risolve al principale e include tutti', async () => {
  const rows = [{ pms_customer_id: 48758, canonical_id: 31355 }, { pms_customer_id: 55491, canonical_id: 31355 }];
  const g = await getGruppo(crmMerge(rows), 48758);
  assert.strictEqual(g.canonicalId, 31355);
  assert.deepStrictEqual([...g.membri].sort((a, b) => a - b), [31355, 48758, 55491]);
});

test('getGruppo: principale → include i suoi membri', async () => {
  const rows = [{ pms_customer_id: 48758, canonical_id: 31355 }];
  const g = await getGruppo(crmMerge(rows), 31355);
  assert.strictEqual(g.canonicalId, 31355);
  assert.deepStrictEqual([...g.membri].sort((a, b) => a - b), [31355, 48758]);
});

// --- getGruppiByIds (batch): mock che risponde alle query IN(...) ---
const { getGruppiByIds } = require('../src/crm/merge');
function crmMergeBatch(rows) {
  return {
    async query(text) {
      // entrambe le query (pms_customer_id IN / canonical_id IN) leggono la stessa tabella:
      // ritorno tutte le righe, la logica in memoria filtra correttamente.
      if (/customer_merge WHERE (pms_customer_id|canonical_id) IN/.test(text)) {
        return rows.map((r) => ({ pms_customer_id: r.pms_customer_id, canonical_id: r.canonical_id }));
      }
      return [];
    },
  };
}

test('getGruppiByIds: standalone e membro nello stesso batch', async () => {
  const rows = [{ pms_customer_id: 48758, canonical_id: 31355 }, { pms_customer_id: 55491, canonical_id: 31355 }];
  const map = await getGruppiByIds(crmMergeBatch(rows), [48758, 100]);
  assert.deepStrictEqual(map.get(48758).sort((a, b) => a - b), [31355, 48758, 55491]);
  assert.deepStrictEqual(map.get(100), [100]); // non nel merge → gruppo di sé stesso
});

test('getGruppiByIds: lista vuota → Map vuota', async () => {
  const map = await getGruppiByIds(crmMergeBatch([]), []);
  assert.strictEqual(map.size, 0);
});

test('mergeInto: rifiuta auto-fusione', async () => {
  const db = { async query() { return []; } };
  const r = await mergeInto(db, { memberId: 5, canonicalId: 5 });
  assert.strictEqual(r.ok, false);
});

test('mergeInto: risolve la catena (target già membro)', async () => {
  const calls = [];
  const db = {
    async query(text, params) {
      calls.push({ text, params });
      if (/SELECT canonical_id FROM customer_merge WHERE pms_customer_id = @canonicalId/.test(text)) return [{ canonical_id: 99 }]; // canonicalId=7 è membro di 99
      return [];
    },
  };
  const r = await mergeInto(db, { memberId: 8, canonicalId: 7 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.canonicalId, 99); // agganciato al principale reale, non a 7
});

test('unmerge: true se una riga è stata rimossa', async () => {
  const db = { async query() { return [{ pms_customer_id: 8 }]; } };
  assert.strictEqual(await unmerge(db, 8), true);
  const db0 = { async query() { return []; } };
  assert.strictEqual(await unmerge(db0, 8), false);
});

// --- duplicati (PMS) ---
function fakePms(recordset) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('getDuplicatiCandidati: mappa match e conteggi', async () => {
  const pms = fakePms([
    { codCli: 55491, Cognome: 'BROLIN', Nome: 'THOMAS', dtNascita: '1963-04-28', codiceFiscale: '', match: 'anagrafica', nPrenotazioni: 0 },
    { codCli: 31355, Cognome: 'BROLIN', Nome: 'TOMAS JOHAN', dtNascita: '1963-04-28', codiceFiscale: 'BRLTSJ63D28L781N', match: 'anagrafica', nPrenotazioni: 3 },
  ]);
  const out = await getDuplicatiCandidati(pms, 48758);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].nominativo, 'BROLIN THOMAS');
  assert.strictEqual(out[1].match, 'anagrafica');
  assert.strictEqual(pms.calls[0].params.codCli, 48758);
  assert.match(pms.calls[0].text, /a\.CodCli <> @codCli/);
});

// --- confronto anagrafiche (merge guidato) ---
test('calcolaConflitti: segnala solo i campi con valori diversi non nulli', () => {
  const anagrafiche = [
    { codCli: 1, codiceFiscale: 'AAA', email: 'x@a.it', telefono: '111', citta: 'Roma', dtNascita: '1980-01-01' },
    { codCli: 2, codiceFiscale: 'BBB', email: null, telefono: '111', citta: 'roma', dtNascita: '1980-01-01' },
  ];
  const c = calcolaConflitti(anagrafiche);
  const campi = c.map((x) => x.campo);
  assert.deepStrictEqual(campi, ['codiceFiscale']); // email ha un solo valore; tel/citta(=case)/dob uguali
  assert.deepStrictEqual(c[0].valori, { 1: 'AAA', 2: 'BBB' });
});

test('getAnagreConfronto: mappa i campi e nPrenotazioni, preserva l\'ordine', async () => {
  const pms = fakePms([
    { codCli: 20, Cognome: 'ROSSI', Nome: 'B', dtNascita: '1980-01-01', codiceFiscale: 'B', Citta: 'Bari', CodNaz: 'IT', email: 'b@x', Telefono: null, Cellulare: '2', CodVip: null, DesVip: null, nPrenotazioni: 3 },
    { codCli: 10, Cognome: 'ROSSI', Nome: 'A', dtNascita: '1980-01-01', codiceFiscale: 'A', Citta: 'Bari', CodNaz: 'IT', email: 'a@x', Telefono: '1', Cellulare: null, CodVip: 'V1', DesVip: 'BOLLICINE', nPrenotazioni: 5 },
  ]);
  const out = await getAnagreConfronto(pms, [10, 20]);
  assert.deepStrictEqual(out.map((a) => a.codCli), [10, 20]); // ordine richiesto
  assert.strictEqual(out[0].nominativo, 'ROSSI A');
  assert.strictEqual(out[0].vip.descrizione, 'BOLLICINE');
  assert.strictEqual(out[1].nPrenotazioni, 3);
  assert.match(pms.calls[0].text, /FROM Anagra a/);
});

test('getTuttiGruppiDuplicati: splitta i membri STRING_AGG', async () => {
  const pms = fakePms([
    { tipo: 'CF', cognome: 'ROSSI', nome: 'MARIO', chiave: 'RSSMRA', n: 2, membri: '10,20' },
    { tipo: 'anagrafica', cognome: 'BROLIN', nome: 'THOMAS', chiave: 'BROLIN|THOMAS|1963-04-28', n: 3, membri: '48758,55491,31355' },
  ]);
  const out = await getTuttiGruppiDuplicati(pms);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0].membri, [10, 20]);
  assert.deepStrictEqual(out[1].membri, [48758, 55491, 31355]);
  assert.strictEqual(out[1].tipo, 'anagrafica');
});
