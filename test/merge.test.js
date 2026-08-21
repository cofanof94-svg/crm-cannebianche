const { test } = require('node:test');
const assert = require('node:assert');
const { inClause } = require('../src/db/query');
const { getGruppo, mergeInto, unmerge, separaGruppiDuplicati } = require('../src/crm/merge');
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

// --- separaGruppiDuplicati: la coda di lavoro della pagina Duplicati ---
const gr = (nome, membri) => ({ tipo: 'CF', nominativo: nome, membri, n: membri.length });

test('separaGruppiDuplicati: gestito solo quando TUTTI i codici convergono sullo stesso principale', () => {
  const gruppi = [
    gr('ROSSI', [10, 11]),          // fusi fra loro → gestito
    gr('BIANCHI', [20, 21, 22]),    // solo 21 fuso in 20, 22 sciolto → da gestire
    gr('VERDI', [30, 31]),          // nessuna fusione → da gestire
    gr('NERI', [40, 41]),           // entrambi fusi in un principale ESTERNO al gruppo → gestito
  ];
  const mappature = [
    { pms_customer_id: 11, canonical_id: 10 },
    { pms_customer_id: 21, canonical_id: 20 },
    { pms_customer_id: 40, canonical_id: 99 },
    { pms_customer_id: 41, canonical_id: 99 },
  ];
  const { daGestire, gestiti } = separaGruppiDuplicati(gruppi, mappature);
  assert.deepStrictEqual(daGestire.map((g) => g.nominativo), ['BIANCHI', 'VERDI']);
  assert.deepStrictEqual(gestiti.map((g) => g.nominativo), ['ROSSI', 'NERI']);
});

test('separaGruppiDuplicati: fusiCount conta i membri già associati', () => {
  const { daGestire } = separaGruppiDuplicati([gr('BIANCHI', [20, 21, 22])], [{ pms_customer_id: 21, canonical_id: 20 }]);
  assert.strictEqual(daGestire[0].fusiCount, 1);
});

test('separaGruppiDuplicati: senza mappature resta tutto da gestire', () => {
  const gruppi = [gr('ROSSI', [10, 11]), gr('VERDI', [30, 31])];
  assert.strictEqual(separaGruppiDuplicati(gruppi, []).daGestire.length, 2);
  assert.strictEqual(separaGruppiDuplicati(gruppi, undefined).gestiti.length, 0);
  assert.deepStrictEqual(separaGruppiDuplicati([], []), { daGestire: [], gestiti: [] });
});

test('separaGruppiDuplicati: non muta i gruppi in ingresso', () => {
  const gruppi = [gr('ROSSI', [10, 11])];
  separaGruppiDuplicati(gruppi, [{ pms_customer_id: 11, canonical_id: 10 }]);
  assert.strictEqual(gruppi[0].fusiCount, undefined);
});

// --- Due rifiuti diversi, due messaggi diversi — 20/08/2026 -----------------
// Uscivano tutti e due come "auto-fusione". Il secondo però non è un errore di
// chi lo chiede: "rendi principale questo codice" è sensato, ed è il server che
// risalendo la catena lo trasforma in "collegalo a sé stesso". L'operatore
// leggeva un nome che non spiegava niente e restava fermo.

// mergeInto risolve il principale con `WHERE pms_customer_id = @canonicalId`:
// serve un finto che risponda a QUELLA domanda.
function crmRisolvi(rows) {
  return {
    async query(text, params) {
      if (/WHERE pms_customer_id = @canonicalId/.test(text)) {
        return rows.filter((r) => r.pms_customer_id === params.canonicalId).map((r) => ({ canonical_id: r.canonical_id }));
      }
      return [];
    },
  };
}

test('mergeInto distingue "stessa anagrafica" da "principale già collegato"', async () => {
  const stessa = await mergeInto(crmRisolvi([]), { memberId: 1001, canonicalId: 1001 });
  assert.strictEqual(stessa.ok, false);
  assert.strictEqual(stessa.motivo, 'stessa-anagrafica');

  // 1201 è già collegata a 1001; si prova a farne il principale.
  const gia = await mergeInto(crmRisolvi([{ pms_customer_id: 1201, canonical_id: 1001 }]), { memberId: 1001, canonicalId: 1201 });
  assert.strictEqual(gia.ok, false);
  assert.strictEqual(gia.motivo, 'principale-gia-collegato');
  assert.strictEqual(gia.principale, 1001, 'il messaggio deve poter dire A CHI è collegata');
});

// --- Il codice fiscale segnaposto (21/08/2026) ------------------------------
// Nell'anagrafica vera ci sono schede salvate con un PUNTO al posto del codice
// fiscale, messo solo per far passare il salvataggio. Due schede con lo stesso
// punto risultavano "stesso codice fiscale, alta confidenza": il 3 agosto due
// ospiti diversi — uno svizzero e uno di Dubai — sono stati fusi davvero, e da
// quel momento soggiorni, spesa, preferenze e ALLERGIE dell'uno comparivano
// sulla scheda dell'altro.
//
// Misurato su tutta l'anagrafica: 91 gruppi "stesso CF", uno solo segnaposto.

test('un codice fiscale troppo corto non fa "stesso CF"', async () => {
  const pms = fakePms([]);
  await getDuplicatiCandidati(pms, 20438);
  const sql = pms.calls[0].text;
  // Non basta "diverso da vuoto": serve una lunghezza minima.
  assert.doesNotMatch(sql, /ISNULL\(a\.CodFis,''\) <> ''/, 'il solo controllo sul vuoto lascia passare i segnaposto');
  assert.match(sql, /LEN\(LTRIM\(RTRIM\(a\.CodFis\)\)\) >= \d+/);
});

test('anche l\'elenco di tutti i gruppi scarta i segnaposto', async () => {
  const pms = fakePms([]);
  await getTuttiGruppiDuplicati(pms);
  const sql = pms.calls[0].text;
  assert.match(sql, /LEN\(LTRIM\(RTRIM\(CodFis\)\)\) >= \d+/);
  assert.doesNotMatch(sql, /WHERE ISNULL\(CodFis,''\) <> '' GROUP BY CodFis/);
  // Il criterio per nome+data di nascita resta com'era: non c'entra col CF.
  assert.match(sql, /GROUP BY Cognome, Nome, dtNascita/);
});
