const { test } = require('node:test');
const assert = require('node:assert');
const {
  arricchisciInCasa, calcolaBriefingInCasa, ordinaInCasa, numeroCamera, avanzamento, parteOggi,
} = require('../src/crm/incasa-brief');

test('parteOggi: chi lascia l\'hotel oggi include chi ha già fatto il check-out', () => {
  assert.strictEqual(parteOggi({ statoPartenza: 'partenza' }), true);
  assert.strictEqual(parteOggi({ statoPartenza: 'checkout' }), true);
  assert.strictEqual(parteOggi({ statoPartenza: 'incasa' }), false);
});

test('numeroCamera: prima camera della lista, non numeriche in fondo', () => {
  assert.strictEqual(numeroCamera('104'), 104);
  assert.strictEqual(numeroCamera('220, 222'), 220);
  assert.strictEqual(numeroCamera(''), Number.MAX_SAFE_INTEGER);
  assert.strictEqual(numeroCamera(null), Number.MAX_SAFE_INTEGER);
  assert.strictEqual(numeroCamera('SUITE'), Number.MAX_SAFE_INTEGER);
});

test('ordinaInCasa: per numero di camera, con i check-out in fondo', () => {
  const ordinati = ordinaInCasa([
    { camere: '221', statoPartenza: 'incasa' },
    { camere: '106', statoPartenza: 'checkout' },
    { camere: '104', statoPartenza: 'partenza' },
    { camere: '', statoPartenza: 'incasa' },
    { camere: '112, 115', statoPartenza: 'incasa' },
  ]);
  assert.deepStrictEqual(ordinati.map((c) => c.camere), ['104', '112, 115', '221', '', '106']);
});

test('ordinaInCasa non muta la lista originale', () => {
  const orig = [{ camere: '221', statoPartenza: 'incasa' }, { camere: '104', statoPartenza: 'incasa' }];
  ordinaInCasa(orig);
  assert.strictEqual(orig[0].camere, '221');
});

test('avanzamento: notte corrente, ultima notte, input incompleti', () => {
  const c = { dtarrivo: '2026-08-05', notti: 7 };
  assert.deepStrictEqual(avanzamento(c, '2026-08-07'), { notte: 3, notti: 7, ultimaNotte: false, restano: 4 });
  assert.deepStrictEqual(avanzamento(c, '2026-08-05'), { notte: 1, notti: 7, ultimaNotte: false, restano: 6 });
  // giorno della partenza: si resta sull'ultima notte, non si sfora
  assert.deepStrictEqual(avanzamento(c, '2026-08-12'), { notte: 7, notti: 7, ultimaNotte: true, restano: 0 });
  assert.strictEqual(avanzamento({ dtarrivo: null, notti: 5 }, '2026-08-07'), null);
  assert.strictEqual(avanzamento({ dtarrivo: '2026-08-05', notti: 0 }, '2026-08-07'), null); // day-use
});

test('calcolaBriefingInCasa: presenti esclude gli usciti, conta i segnali', () => {
  const b = calcolaBriefingInCasa([
    { statoPartenza: 'incasa', snapshot: { vip: { cod: 'V1' }, intolleranze: [], reclami: { totali: 0 }, compleanno: null } },
    { statoPartenza: 'partenza', snapshot: { vip: null, intolleranze: ['Lattosio'], reclami: { totali: 2, aperti: 1 }, compleanno: { data: '2026-08-07' } } },
    { statoPartenza: 'incasa', snapshot: { vip: null, indesiderato: true, intolleranze: [], reclami: { totali: 0 } } },
    { statoPartenza: 'checkout', snapshot: { vip: { cod: 'V1' }, intolleranze: [], reclami: { totali: 0 } } },
  ]);
  assert.strictEqual(b.presenti, 3);      // l'uscito non è "presente"
  assert.strictEqual(b.usciti, 1);
  assert.strictEqual(b.partonoOggi, 2);   // in partenza + chi ha già fatto il check-out
  assert.strictEqual(b.vip, 2);           // il VIP conta anche se già uscito
  assert.strictEqual(b.alert, 2);         // intolleranze OR indesiderato
  assert.strictEqual(b.reclami, 1);
  assert.strictEqual(b.ricorrenze, 1);
});

// --- Orchestratore con mock DB ---
function pmsMock() {
  return {
    async query(text) {
      if (/FROM Anagra a/.test(text)) return [
        { CodCli: 100, Cognome: 'ROSSI', Nome: 'MARIO', dtNascita: null, CodVip: 'V1', DesVip: 'BOLLICINE' },
        { CodCli: 200, Cognome: 'VERDI', Nome: 'ANNA', dtNascita: null, CodVip: null, DesVip: null },
      ];
      // `visite` = giornate concluse (SPA, piscina): contate a parte dai soggiorni.
      if (/FROM StorPrenota sp/.test(text)) return [{ codCli: 100, n: 4, ultima: '2024-08-09', visite: 2 }];
      return [];
    },
  };
}
const crmMock = () => ({ async query() { return []; } });

test('arricchisciInCasa: snapshot + storico + avanzamento, ordinato per camera', async () => {
  const clienti = [
    { codpratica: 2, codCliente: 200, camere: '221', dtarrivo: '2026-08-06', dtpartenza: '2026-08-08', notti: 2, statoPartenza: 'incasa', ospiti: [] },
    { codpratica: 1, codCliente: 100, camere: '104', dtarrivo: '2026-08-05', dtpartenza: '2026-08-12', notti: 7, statoPartenza: 'incasa', ospiti: [] },
  ];
  const enr = await arricchisciInCasa(pmsMock(), crmMock(), clienti, '2026-08-07');
  assert.deepStrictEqual(enr.clienti.map((c) => c.camere), ['104', '221']); // ordinati per camera
  const primo = enr.clienti[0];
  assert.deepStrictEqual(primo.storico, { n: 4, ultima: '2024-08-09', visite: 2 });
  assert.strictEqual(primo.avanzamento.notte, 3);
  assert.strictEqual(primo.snapshot.vip.descrizione, 'BOLLICINE');
  assert.strictEqual(enr.clienti[1].storico, null); // 200 non ha storico
  assert.strictEqual(enr.briefing.presenti, 2);
  assert.strictEqual(enr.briefing.vip, 1);
});

test('arricchisciInCasa: lista vuota → briefing a zero', async () => {
  const enr = await arricchisciInCasa(pmsMock(), crmMock(), [], '2026-08-07');
  assert.deepStrictEqual(enr.clienti, []);
  assert.strictEqual(enr.briefing.presenti, 0);
});

// --- Ospiti del giorno (day use) ---------------------------------------------
// Arrivo e partenza nello stesso giorno: gli esterni di SPA, piscina e serate.
// Circa 1.200 l'anno, e fino al 13/08/2026 non comparivano da nessuna parte
// perché il gestionale li marca "partiti" fin dalla prenotazione.

test('isDayUse riconosce solo gli ospiti del giorno', () => {
  const { isDayUse } = require('../src/crm/incasa-brief');
  assert.strictEqual(isDayUse({ statoPartenza: 'dayuse' }), true);
  assert.strictEqual(isDayUse({ statoPartenza: 'partenza' }), false);
  assert.strictEqual(isDayUse({ statoPartenza: 'checkout' }), false);
  assert.strictEqual(isDayUse({ statoPartenza: 'incasa' }), false);
});

test('un ospite del giorno non è una partenza da gestire', () => {
  // Se contasse come partenza gonfierebbe "Partono oggi", che la reception
  // confronta con il gestionale: il 14 agosto passerebbe da 12 a 22.
  assert.strictEqual(parteOggi({ statoPartenza: 'dayuse' }), false);
});

test('ordinaInCasa: gli ospiti del giorno stanno in fondo, sotto agli usciti', () => {
  const ordinati = ordinaInCasa([
    { camere: '', statoPartenza: 'dayuse' },
    { camere: '221', statoPartenza: 'incasa' },
    { camere: '106', statoPartenza: 'checkout' },
    { camere: '104', statoPartenza: 'partenza' },
  ]);
  assert.deepStrictEqual(ordinati.map((c) => c.statoPartenza),
    ['partenza', 'incasa', 'checkout', 'dayuse']);
});

test('calcolaBriefingInCasa: gli ospiti del giorno hanno un contatore loro', () => {
  const b = calcolaBriefingInCasa([
    { statoPartenza: 'incasa', snapshot: {} },
    { statoPartenza: 'checkout', snapshot: {} },
    { statoPartenza: 'dayuse', snapshot: { intolleranze: ['Glutine'] } },
    { statoPartenza: 'dayuse', snapshot: { vip: { cod: 'V1' } } },
  ]);
  assert.strictEqual(b.dayUse, 2);
  assert.strictEqual(b.presenti, 1);     // non occupano una camera
  assert.strictEqual(b.usciti, 1);       // e non hanno fatto check-in
  assert.strictEqual(b.partonoOggi, 1);  // solo il check-out vero
  // I segnali però contano come per tutti: è il motivo per cui li mostriamo.
  assert.strictEqual(b.alert, 1);
  assert.strictEqual(b.vip, 1);
});
