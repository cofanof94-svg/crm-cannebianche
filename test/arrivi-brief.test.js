const { test } = require('node:test');
const assert = require('node:assert');
const {
  arricchisciArrivi, raccogliIds, costruisciSnapshot, calcolaBriefing,
  compleannoNelSoggiorno, idsPrenotazione, sintetizzaNota, MAX_PREF_CARD,
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
      // Doppione semantico (cambia solo la maiuscola) + una preferenza PERSONALE
      // di un'altra persona presente: dal 14/08 quest'ultima non si scarta più.
      [101, [
        { ambito: 'nucleo', reparto: 'F&B', categoria: 'F&B', testo: 'caffè leccese' },
        { ambito: 'personale', reparto: 'F&B', categoria: 'F&B', testo: 'Caffè decaffeinato', pms_customer_id: 200 },
      ]],
    ]),
    complBy: new Map([[100, [
      { stato: 'aperto', testo: 'Doccia fredda al terzo piano', reparto: 'Rooms', categoria: 'Manutenzione' },
      { stato: 'risolto', testo: 'Rumore in corridoio', reparto: 'Rooms', categoria: 'Rumore' },
    ]]]),
    // Due persone diverse, entrambe intolleranti al lattosio: sono due righe, non
    // un doppione — sono due piatti da preparare. Il dedup toglie solo la stessa
    // allergia ripetuta sulla stessa persona (qui il 100, che è fuso col 101).
    intolBy: new Map([
      [100, [{ pms_customer_id: 100, testo: 'Lattosio' }]],
      [101, [{ pms_customer_id: 100, testo: 'lattosio' }]],
      [200, [{ pms_customer_id: 200, testo: 'Lattosio' }]],
    ]),
    relBy: new Map([['100|200', 'Coniuge']]),
    // La nota sta sul 101, anagrafica FUSA col referente 100 = stessa persona.
    // Il 200 è un occupante: la sua nota non deve finire sulla card del referente.
    noteBy: new Map([
      [101, [{ pms_customer_id: 101, note_personali: 'Direttore LUISS · Economista' }]],
      [200, [{ pms_customer_id: 200, note_personali: 'Nota di un altro ospite' }]],
    ]),
  };
}

test('costruisciSnapshot: VIP, indesiderato, preferenze personali e di nucleo, intolleranze, reclami, relazioni, compleanno', () => {
  const arrivo = { codCliente: 100, dtarrivo: '2026-08-01', dtpartenza: '2026-08-10', ospiti: [{ codCli: 200 }, { codCli: 300 }] };
  const s = costruisciSnapshot(arrivo, ctxDiProva());
  assert.strictEqual(s.vip.descrizione, 'BOLLICINE'); // referente senza vip → primo vip del gruppo
  assert.strictEqual(s.indesiderato, true);           // un occupante è indesiderato
  // Entrambe: la personale davanti e col nome di chi la ha, quella di nucleo
  // nuda. Il doppione di sola maiuscola resta una riga.
  assert.deepStrictEqual(s.preferenzeTop.map((p) => [p.testo, p.ambito, p.chi]), [
    ['Caffè decaffeinato', 'personale', 'ROSSI ANNA'],
    ['Caffè leccese', 'nucleo', null],
  ]);
  assert.strictEqual(s.preferenzeAltre, 0);
  // Ogni allergia con il nome di chi la ha (decisione del 12/08, D2): la nota è
  // della prenotazione, il piatto si prepara per una persona. La stessa allergia
  // ripetuta sulla stessa persona resta una sola voce.
  // Dal 19/08 ogni riga porta anche il CODICE della persona, non solo il nome:
  // serve al controllo delle proposte, che deve sapere di chi è un'allergia già
  // registrata e non solo che esiste.
  assert.deepStrictEqual(s.intolleranze, [
    { codCli: 100, testo: 'Lattosio', chi: 'ROSSI MARIO' },
    { codCli: 200, testo: 'Lattosio', chi: 'ROSSI ANNA' },
  ]);
  assert.strictEqual(s.reclami.aperti, 1);
  assert.strictEqual(s.reclami.totali, 2);
  // il dettaglio degli aperti viaggia con lo snapshot: card ed export devono poter
  // dire QUALE è il reclamo e a chi gira, non solo quanti sono
  assert.deepStrictEqual(s.reclami.apertiDettaglio, [
    { testo: 'Doccia fredda al terzo piano', reparto: 'Rooms', categoria: 'Manutenzione' },
  ]);
  assert.strictEqual(s.relazioni[200], 'Coniuge');
  assert.strictEqual(s.relazioni[300], undefined);
  assert.strictEqual(s.compleanni.length, 1);
  assert.strictEqual(s.compleanni[0].data, '2026-08-05');
  assert.strictEqual(s.compleanni[0].nome, 'ROSSI MARIO');
  assert.strictEqual(s.compleanni[0].codCli, 100); // serve a rendere il nome cliccabile
});

test('costruisciSnapshot: se festeggiano in due si vedono tutti e due, in ordine di data', () => {
  // Misurato sul database dell'hotel il 14/08/2026: 41 prenotazioni su 1.482
  // hanno più di un compleanno durante il soggiorno. Fermarsi al primo faceva
  // preparare una torta sola.
  const ctx = ctxDiProva();
  ctx.anagra = new Map([
    [100, { nominativo: 'ROSSI MARIO', dtNascita: '1980-08-07', vip: null }],
    [200, { nominativo: 'ROSSI ANNA', dtNascita: '1982-08-03', vip: null }],
    [300, { nominativo: 'ROSSI LUCA', dtNascita: '1990-11-11', vip: null }], // fuori soggiorno
  ]);
  const arrivo = { codCliente: 100, dtarrivo: '2026-08-01', dtpartenza: '2026-08-10', ospiti: [{ codCli: 200 }, { codCli: 300 }] };
  const s = costruisciSnapshot(arrivo, ctx);
  assert.deepStrictEqual(s.compleanni.map((c) => `${c.data} ${c.nome}`),
    ['2026-08-03 ROSSI ANNA', '2026-08-07 ROSSI MARIO']);
});

test('costruisciSnapshot: la stessa persona con due codici fusi festeggia una volta sola', () => {
  // 100 e 101 sono la stessa persona (anagrafiche fuse): due voci identiche
  // sulla card sembrerebbero due festeggiati.
  const ctx = ctxDiProva();
  ctx.anagra = new Map([
    [100, { nominativo: 'ROSSI MARIO', dtNascita: '1980-08-05', vip: null }],
    [101, { nominativo: 'ROSSI MARIO', dtNascita: '1980-08-05', vip: null }],
  ]);
  const s = costruisciSnapshot({ codCliente: 100, dtarrivo: '2026-08-01', dtpartenza: '2026-08-10', ospiti: [] }, ctx);
  assert.strictEqual(s.compleanni.length, 1);
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

test('costruisciSnapshot: la card ne mostra al massimo cinque e conta le altre', () => {
  const ctx = {
    gruppi: new Map(), anagra: new Map(), complBy: new Map(), intolBy: new Map(), relBy: new Map(),
    prefBy: new Map([[100, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ ambito: 'nucleo', reparto: 'F&B', categoria: 'F&B', testo: `Pref ${n}` }))]]),
  };
  const s = costruisciSnapshot({ codCliente: 100, ospiti: [] }, ctx);
  assert.strictEqual(s.preferenzeTop.length, MAX_PREF_CARD);
  assert.strictEqual(s.preferenzeAltre, 3); // le altre non spariscono: si contano
});

test('calcolaBriefing: conta VIP, compleanni, reclami, alert', () => {
  const arriviArr = [
    // due festeggiati nella stessa prenotazione: la chip conta la PRENOTAZIONE,
    // non le persone, perché al clic filtra le righe e il numero deve tornare
    { snapshot: { vip: { cod: 'V1' }, compleanni: [{ data: 'x' }, { data: 'y' }], reclami: { aperti: 0, totali: 1 }, intolleranze: [], indesiderato: false } },
    { snapshot: { vip: null, compleanni: [], reclami: { aperti: 0, totali: 0 }, intolleranze: ['Glutine'], indesiderato: false } },
    { snapshot: { vip: null, compleanni: [], reclami: { aperti: 0, totali: 0 }, intolleranze: [], indesiderato: true } },
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
  assert.strictEqual(s.compleanni[0].data, '2026-08-05');
  assert.strictEqual(s.indesiderato, true);
  assert.strictEqual(s.notaPersonale.sintesi, 'Direttore LUISS · Economista');
  assert.strictEqual(enr.briefing.reclami, 1);
  assert.strictEqual(enr.briefing.alert, 1);
});

test('arricchisciArrivi: senza data di nascita nel PMS non c\'è compleanno', async () => {
  // 200 non ha dtNascita in Anagra: il PMS è l'unica fonte, quindi niente ricorrenza.
  const arrivi = [{ codCliente: 200, dtarrivo: '2026-09-01', dtpartenza: '2026-09-06', ospiti: [] }];
  const enr = await arricchisciArrivi(pmsMock(), crmMock(), arrivi);
  assert.deepStrictEqual(enr.arrivi[0].snapshot.compleanni, []);
  assert.strictEqual(enr.briefing.compleanni, 0);
});

test('arricchisciArrivi: lista vuota → briefing a zero, nessuna query', async () => {
  const enr = await arricchisciArrivi(pmsMock(), crmMock(), []);
  assert.deepStrictEqual(enr.arrivi, []);
  assert.strictEqual(enr.briefing.arrivi, 0);
});
