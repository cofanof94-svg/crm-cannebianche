const { test } = require('node:test');
const assert = require('node:assert');
const {
  arricchisciArrivi, raccogliIds, costruisciSnapshot, calcolaBriefing,
  compleannoNelSoggiorno, idsPrenotazione, applicaDateNascitaCrm,
} = require('../src/crm/arrivi-brief');

test('raccogliIds: referenti + occupanti, deduplicati, solo interi', () => {
  const ids = raccogliIds([
    { codCliente: 100, ospiti: [{ codCli: 200 }, { codCli: 300 }] },
    { codCliente: 100, ospiti: [{ codCli: null }, {}] }, // dup referente + occupanti non validi
  ]);
  assert.deepStrictEqual(ids.sort((a, b) => a - b), [100, 200, 300]);
});

test('compleannoNelSoggiorno: dentro, fuori, a cavallo del capodanno, input nulli', () => {
  assert.strictEqual(compleannoNelSoggiorno('1980-08-05', '2026-08-01', '2026-08-10'), '2026-08-05');
  assert.strictEqual(compleannoNelSoggiorno('1980-07-05', '2026-08-01', '2026-08-10'), null);
  assert.strictEqual(compleannoNelSoggiorno('1980-01-02', '2026-12-30', '2027-01-05'), '2027-01-02');
  assert.strictEqual(compleannoNelSoggiorno(null, '2026-08-01', '2026-08-10'), null);
});

test('idsPrenotazione: espande referente e occupanti ai gruppi di fusione', () => {
  const gruppi = new Map([[100, [100, 101]]]); // 100 fuso con 101; 200/300 standalone
  const ids = idsPrenotazione({ codCliente: 100, ospiti: [{ codCli: 200 }, { codCli: 300 }] }, gruppi);
  assert.deepStrictEqual(ids.sort((a, b) => a - b), [100, 101, 200, 300]);
});

function ctxDiProva() {
  return {
    gruppi: new Map([[100, [100, 101]]]),
    anagra: new Map([
      [100, { nominativo: 'ROSSI MARIO', dtNascita: '1980-08-05', vip: null }],
      [101, { nominativo: 'ROSSI MARIO', dtNascita: null, vip: { cod: 'V1', descrizione: 'BOLLICINE', indesiderato: false } }],
      [200, { nominativo: 'ROSSI ANNA', dtNascita: null, vip: { cod: 'IN', descrizione: 'OSPITE INDESIDERATO', indesiderato: true } }],
      [300, { nominativo: 'ROSSI LUCA', dtNascita: null, vip: null }],
    ]),
    prefBy: new Map([
      [100, [{ ambito: 'nucleo', reparto: 'F&B', categoria: 'F&B', testo: 'Caffè leccese' }]],
      [101, [{ ambito: 'nucleo', reparto: 'F&B', categoria: 'F&B', testo: 'caffè leccese' }, { ambito: 'personale', testo: 'roba personale' }]], // dup semantico (case) + personale scartata
    ]),
    complBy: new Map([[100, [{ stato: 'aperto' }, { stato: 'risolto' }]]]),
    intolBy: new Map([[100, [{ testo: 'Lattosio' }]], [200, [{ testo: 'lattosio' }]]]), // dup case
    relBy: new Map([['100|200', 'Coniuge']]),
  };
}

test('costruisciSnapshot: VIP, indesiderato, preferenze nucleo dedup, intolleranze, reclami, relazioni, compleanno', () => {
  const arrivo = { codCliente: 100, dtarrivo: '2026-08-01', dtpartenza: '2026-08-10', ospiti: [{ codCli: 200 }, { codCli: 300 }] };
  const s = costruisciSnapshot(arrivo, ctxDiProva());
  assert.strictEqual(s.vip.descrizione, 'BOLLICINE'); // referente senza vip → primo vip del gruppo
  assert.strictEqual(s.indesiderato, true);           // un occupante è indesiderato
  assert.strictEqual(s.preferenzeTop.length, 1);
  assert.strictEqual(s.preferenzeTop[0].testo, 'Caffè leccese');
  assert.deepStrictEqual(s.intolleranze, ['Lattosio']);
  assert.deepStrictEqual(s.reclami, { aperti: 1, totali: 2 });
  assert.strictEqual(s.relazioni[200], 'Coniuge');
  assert.strictEqual(s.relazioni[300], undefined);
  assert.strictEqual(s.compleanno.data, '2026-08-05');
  assert.strictEqual(s.compleanno.nome, 'ROSSI MARIO');
});

test('costruisciSnapshot: preferenzeTop limitato a 3', () => {
  const ctx = {
    gruppi: new Map(), anagra: new Map(), complBy: new Map(), intolBy: new Map(), relBy: new Map(),
    prefBy: new Map([[100, [1, 2, 3, 4, 5].map((n) => ({ ambito: 'nucleo', reparto: 'F&B', categoria: 'F&B', testo: `Pref ${n}` }))]]),
  };
  const s = costruisciSnapshot({ codCliente: 100, ospiti: [] }, ctx);
  assert.strictEqual(s.preferenzeTop.length, 3);
});

test('calcolaBriefing: conta VIP, compleanni, reclami, alert', () => {
  const arriviArr = [
    { snapshot: { vip: { cod: 'V1' }, compleanno: { data: 'x' }, reclami: { aperti: 0, totali: 1 }, intolleranze: [], indesiderato: false } },
    { snapshot: { vip: null, compleanno: null, reclami: { aperti: 0, totali: 0 }, intolleranze: ['Glutine'], indesiderato: false } },
    { snapshot: { vip: null, compleanno: null, reclami: { aperti: 0, totali: 0 }, intolleranze: [], indesiderato: true } },
  ];
  const b = calcolaBriefing(arriviArr);
  assert.strictEqual(b.arrivi, 3);
  assert.strictEqual(b.vip, 1);
  assert.strictEqual(b.compleanni, 1);
  assert.strictEqual(b.reclami, 1);
  assert.strictEqual(b.alert, 2); // intolleranze OR indesiderato
});

test('applicaDateNascitaCrm: l\'override CRM vince e si propaga al gruppo di fusione', () => {
  const anagra = new Map([
    [100, { dtNascita: null }],   // manca nel PMS, la reception l'ha inserita nel CRM
    [101, { dtNascita: null }],   // stesso gruppo di 100 → eredita l'override
    [200, { dtNascita: '1970-01-01' }], // il PMS ha la data, il CRM la corregge
    [300, { dtNascita: '1990-05-05' }], // nessun override → resta il dato PMS
  ]);
  const gruppi = new Map([[100, [100, 101]], [101, [100, 101]]]);
  applicaDateNascitaCrm(anagra, gruppi, new Map([[100, '1980-08-05'], [200, '1971-02-02']]));
  assert.strictEqual(anagra.get(100).dtNascita, '1980-08-05');
  assert.strictEqual(anagra.get(101).dtNascita, '1980-08-05');
  assert.strictEqual(anagra.get(200).dtNascita, '1971-02-02');
  assert.strictEqual(anagra.get(300).dtNascita, '1990-05-05');
});

test('applicaDateNascitaCrm: nessun override → anagrafiche invariate', () => {
  const anagra = new Map([[100, { dtNascita: '1980-08-05' }]]);
  applicaDateNascitaCrm(anagra, new Map(), new Map());
  assert.strictEqual(anagra.get(100).dtNascita, '1980-08-05');
});

// --- Orchestratore end-to-end con mock DB ---
function pmsMock() {
  return {
    async query(text) {
      if (/FROM Anagra a/.test(text)) return [
        { CodCli: 100, Cognome: 'ROSSI', Nome: 'MARIO', dtNascita: '1980-08-05', CodVip: null, DesVip: null },
        { CodCli: 200, Cognome: 'ROSSI', Nome: 'ANNA', dtNascita: null, CodVip: 'IN', DesVip: 'OSPITE INDESIDERATO' },
      ];
      return [];
    },
  };
}
function crmMock(dateNascita = []) {
  return {
    async query(text) {
      if (/FROM customer_profile/.test(text)) return dateNascita;
      if (/FROM customer_merge/.test(text)) return []; // nessuna fusione
      if (/FROM customer_preferences/.test(text)) return [{ pms_customer_id: 100, ambito: 'nucleo', reparto: 'F&B', categoria: 'F&B', testo: 'Caffè leccese' }];
      if (/FROM customer_complaints/.test(text)) return [{ pms_customer_id: 100, stato: 'aperto' }];
      if (/FROM customer_intolerances/.test(text)) return [{ pms_customer_id: 100, testo: 'Lattosio' }];
      if (/FROM customer_travel_party/.test(text)) return [{ pms_customer_id: 100, pms_occupant_id: 200, tipo_relazione: 'Coniuge' }];
      return [];
    },
  };
}

test('arricchisciArrivi: allega snapshot e calcola il briefing', async () => {
  const arrivi = [{ codCliente: 100, dtarrivo: '2026-08-01', dtpartenza: '2026-08-10', ospiti: [{ codCli: 200 }] }];
  const enr = await arricchisciArrivi(pmsMock(), crmMock(), arrivi);
  const s = enr.arrivi[0].snapshot;
  assert.strictEqual(s.preferenzeTop[0].testo, 'Caffè leccese');
  assert.strictEqual(s.reclami.totali, 1);
  assert.strictEqual(s.relazioni[200], 'Coniuge');
  assert.strictEqual(s.compleanno.data, '2026-08-05');
  assert.strictEqual(s.indesiderato, true);
  assert.strictEqual(enr.briefing.reclami, 1);
  assert.strictEqual(enr.briefing.alert, 1);
});

test('arricchisciArrivi: compleanno anche da data inserita in CRM (assente nel PMS)', async () => {
  // 200 non ha dtNascita nel PMS: la data arriva dall'override CRM.
  const arrivi = [{ codCliente: 200, dtarrivo: '2026-09-01', dtpartenza: '2026-09-06', ospiti: [] }];
  const crm = crmMock([{ pms_customer_id: 200, data_nascita: '1975-09-03' }]);
  const enr = await arricchisciArrivi(pmsMock(), crm, arrivi);
  assert.strictEqual(enr.arrivi[0].snapshot.compleanno.data, '2026-09-03');
  assert.strictEqual(enr.arrivi[0].snapshot.compleanno.nome, 'ROSSI ANNA');
  assert.strictEqual(enr.briefing.compleanni, 1);
});

test('arricchisciArrivi: lista vuota → briefing a zero, nessuna query', async () => {
  const enr = await arricchisciArrivi(pmsMock(), crmMock(), []);
  assert.deepStrictEqual(enr.arrivi, []);
  assert.strictEqual(enr.briefing.arrivi, 0);
});
