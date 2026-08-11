const { test } = require('node:test');
const assert = require('node:assert');
const {
  arricchisciArrivi, raccogliIds, costruisciSnapshot, calcolaBriefing,
  compleannoNelSoggiorno, idsPrenotazione, sintetizzaNota,
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

test('sintetizzaNota: nota corta → invariata e non troncata', () => {
  const n = sintetizzaNota('Direttore LUISS · Economista');
  assert.strictEqual(n.sintesi, 'Direttore LUISS · Economista');
  assert.strictEqual(n.troncata, false);
  assert.strictEqual(n.testo, 'Direttore LUISS · Economista');
});

test('sintetizzaNota: nota su più righe → prima riga, il resto resta nel testo pieno', () => {
  const n = sintetizzaNota('CEO settore Fashion\n\nPreferisce la scrivania in camera.');
  assert.strictEqual(n.sintesi, 'CEO settore Fashion');
  assert.strictEqual(n.troncata, true); // c'è dell'altro nell'anagrafica
  assert.match(n.testo, /scrivania/);
});

test('sintetizzaNota: riga lunga → taglio a fine frase, senza punto e virgola in coda', () => {
  const n = sintetizzaNota('Amministratore delegato di un gruppo del fashion; viaggia spesso per lavoro. '
    + 'Chiede una scrivania in camera e la stampante alla reception per i documenti. Cena presto, mai dopo le 21.');
  assert.strictEqual(n.sintesi, 'Amministratore delegato di un gruppo del fashion');
  assert.strictEqual(n.troncata, true);
  assert.match(n.testo, /Cena presto/); // il dettaglio non si perde: resta nell'anagrafica
});

test('sintetizzaNota: una riga sotto la soglia resta intera (soglia esplicita)', () => {
  const n = sintetizzaNota('Direttore Generale LUISS; membro CdA Pirelli.', 90);
  assert.strictEqual(n.sintesi, 'Direttore Generale LUISS; membro CdA Pirelli.');
  assert.strictEqual(n.troncata, false);
});

test('sintetizzaNota: senza fine frase taglia a parola intera, mai a metà', () => {
  const testo = 'Ospite abituale della struttura che ogni anno torna nello stesso periodo con la famiglia allargata';
  const n = sintetizzaNota(testo, 40);
  assert.ok(n.sintesi.length <= 40);
  assert.ok(testo.startsWith(n.sintesi), 'la sintesi è un prefisso della nota');
  assert.doesNotMatch(n.sintesi, /\s$/);
  assert.ok(!n.sintesi.endsWith('…'), 'i puntini li mette la card, non il server');
});

test('sintetizzaNota: vuoto, spazi e null → nessuna nota', () => {
  assert.strictEqual(sintetizzaNota(null), null);
  assert.strictEqual(sintetizzaNota(''), null);
  assert.strictEqual(sintetizzaNota('   \n  '), null);
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
    complBy: new Map([[100, [{ stato: 'aperto', testo: 'Doccia fredda al terzo piano' }, { stato: 'risolto', testo: 'Rumore in corridoio' }]]]),
    intolBy: new Map([[100, [{ testo: 'Lattosio' }]], [200, [{ testo: 'lattosio' }]]]), // dup case
    relBy: new Map([['100|200', 'Coniuge']]),
    // La nota sta sul 101, anagrafica FUSA col referente 100 = stessa persona.
    // Il 200 è un occupante: la sua nota non deve finire sulla card del referente.
    noteBy: new Map([
      [101, [{ pms_customer_id: 101, note_personali: 'Direttore LUISS · Economista' }]],
      [200, [{ pms_customer_id: 200, note_personali: 'Nota di un altro ospite' }]],
    ]),
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
  assert.strictEqual(s.reclami.aperti, 1);
  assert.strictEqual(s.reclami.totali, 2);
  // il testo degli aperti viaggia con lo snapshot: card ed export devono poter
  // dire QUALE è il reclamo, non solo quanti sono
  assert.deepStrictEqual(s.reclami.testiAperti, ['Doccia fredda al terzo piano']);
  assert.strictEqual(s.relazioni[200], 'Coniuge');
  assert.strictEqual(s.relazioni[300], undefined);
  assert.strictEqual(s.compleanno.data, '2026-08-05');
  assert.strictEqual(s.compleanno.nome, 'ROSSI MARIO');
  assert.strictEqual(s.compleanno.codCli, 100); // serve a rendere il nome cliccabile
});

test('costruisciSnapshot: la nota personale è quella del referente (anche fuso), non degli occupanti', () => {
  const arrivo = { codCliente: 100, dtarrivo: '2026-08-01', dtpartenza: '2026-08-10', ospiti: [{ codCli: 200 }] };
  const s = costruisciSnapshot(arrivo, ctxDiProva());
  assert.strictEqual(s.notaPersonale.sintesi, 'Direttore LUISS · Economista');
  assert.doesNotMatch(s.notaPersonale.testo, /un altro ospite/);
});

test('costruisciSnapshot: senza note personali il campo è null (card senza riga Nota)', () => {
  const ctx = ctxDiProva();
  ctx.noteBy = new Map();
  assert.strictEqual(costruisciSnapshot({ codCliente: 100, ospiti: [] }, ctx).notaPersonale, null);
  delete ctx.noteBy; // fonte non disponibile → degrada, non esplode
  assert.strictEqual(costruisciSnapshot({ codCliente: 100, ospiti: [] }, ctx).notaPersonale, null);
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
function crmMock() {
  return {
    async query(text) {
      if (/FROM customer_merge/.test(text)) return []; // nessuna fusione
      if (/FROM customer_preferences/.test(text)) return [{ pms_customer_id: 100, ambito: 'nucleo', reparto: 'F&B', categoria: 'F&B', testo: 'Caffè leccese' }];
      if (/FROM customer_complaints/.test(text)) return [{ pms_customer_id: 100, stato: 'aperto' }];
      if (/FROM customer_intolerances/.test(text)) return [{ pms_customer_id: 100, testo: 'Lattosio' }];
      if (/FROM customer_travel_party/.test(text)) return [{ pms_customer_id: 100, pms_occupant_id: 200, tipo_relazione: 'Coniuge' }];
      // Stessa colonna letta dall'anagrafica: la nota è una sola, la card la sintetizza.
      if (/FROM customer_profile/.test(text)) return [{ pms_customer_id: 100, note_personali: 'Direttore LUISS · Economista', updated_at: '2026-08-01T10:00:00Z' }];
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
  assert.strictEqual(s.notaPersonale.sintesi, 'Direttore LUISS · Economista');
  assert.strictEqual(enr.briefing.reclami, 1);
  assert.strictEqual(enr.briefing.alert, 1);
});

test('arricchisciArrivi: senza data di nascita nel PMS non c\'è compleanno', async () => {
  // 200 non ha dtNascita in Anagra: il PMS è l'unica fonte, quindi niente ricorrenza.
  const arrivi = [{ codCliente: 200, dtarrivo: '2026-09-01', dtpartenza: '2026-09-06', ospiti: [] }];
  const enr = await arricchisciArrivi(pmsMock(), crmMock(), arrivi);
  assert.strictEqual(enr.arrivi[0].snapshot.compleanno, null);
  assert.strictEqual(enr.briefing.compleanni, 0);
});

test('arricchisciArrivi: lista vuota → briefing a zero, nessuna query', async () => {
  const enr = await arricchisciArrivi(pmsMock(), crmMock(), []);
  assert.deepStrictEqual(enr.arrivi, []);
  assert.strictEqual(enr.briefing.arrivi, 0);
});
