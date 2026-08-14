const { test } = require('node:test');
const assert = require('node:assert');
const { scegliPreferenze, MAX_PREF_CARD } = require('../src/crm/arrivi-brief');

// Quali preferenze finiscono in card. La regola è stata scritta guardando le 64
// preferenze vere del 14/08/2026: nessun segnale di importanza esiste nei dati
// (niente conferme, niente fonte da pesare, niente campo "critica") e 50 su 64
// sono dello stesso reparto. Quindi si sceglie su due cose sole: le personali
// prima, e poi si varia invece di ripetere.

const nomi = { 10: 'MARIO ROSSI', 20: 'ANNA BIANCHI', 30: 'LUCA VERDI' };
const nomeDi = (c) => nomi[c] || null;
const p = (o) => ({ ambito: 'nucleo', reparto: 'F&B', categoria: 'F&B', created_at: '2026-08-01', ...o });

test('una preferenza personale non si perde più dietro a quelle del nucleo', () => {
  // È il caso del ticket: Mario e Anna nella stessa prenotazione, il nucleo ha
  // due preferenze condivise e Anna una sua. Prima la sua non usciva affatto.
  const { mostrate } = scegliPreferenze([
    p({ testo: 'Preferisce camere ai piani alti', reparto: 'Rooms', categoria: 'Camera', pms_customer_id: 10 }),
    p({ testo: 'Coca-Cola Zero', pms_customer_id: 10 }),
    p({ testo: 'Caffè decaffeinato', ambito: 'personale', pms_customer_id: 20 }),
  ], nomeDi);
  const testi = mostrate.map((x) => x.testo);
  assert.ok(testi.includes('Caffè decaffeinato'), 'la preferenza personale deve esserci');
  assert.strictEqual(mostrate[0].testo, 'Caffè decaffeinato', 'e viene prima: riguarda una persona sola');
});

test('la preferenza personale porta il nome, quella di nucleo no', () => {
  // Senza il nome, su una prenotazione da quattro persone, non è servibile.
  // Attribuire un nome a una preferenza di nucleo sarebbe invece falso.
  const { mostrate } = scegliPreferenze([
    p({ testo: 'Caffè decaffeinato', ambito: 'personale', pms_customer_id: 20 }),
    p({ testo: 'Coca-Cola Zero', pms_customer_id: 10 }),
  ], nomeDi);
  const anna = mostrate.find((x) => x.testo === 'Caffè decaffeinato');
  const cola = mostrate.find((x) => x.testo === 'Coca-Cola Zero');
  assert.strictEqual(anna.chi, 'ANNA BIANCHI');
  assert.strictEqual(anna.ambito, 'personale');
  assert.strictEqual(cola.chi, null);
  assert.strictEqual(cola.ambito, 'nucleo');
});

test('non si mostrano tre volte le bevande: si varia il reparto', () => {
  // Caso reale 2117 DE IACO: cinque preferenze, tre di camera. Prendendo le
  // prime tre si otterrebbero tre righe di cucina e si seppellirebbe l'unica
  // istruzione da eseguire al check-in.
  const { mostrate, altre } = scegliPreferenze([
    p({ testo: 'Gradisce Coca Cola Zero' }),
    p({ testo: 'Predilige il caffè leccese' }),
    p({ testo: 'Gradisce la birra Nastro Azzurro' }),
    p({ testo: 'Se la camera dispone di divano letto, aggiungere topper', reparto: 'Rooms', categoria: 'Camera' }),
    p({ testo: 'Predilige il massaggio Serenity', reparto: 'SPA', categoria: 'Persona' }),
  ], nomeDi);
  assert.deepStrictEqual(mostrate.map((x) => x.reparto), ['F&B', 'Rooms', 'SPA']);
  assert.strictEqual(altre, 2);
});

test('se il reparto è uno solo si mostrano comunque tre preferenze', () => {
  // 50 preferenze su 64 sono di F&B: il vincolo sulla varietà deve cedere,
  // altrimenti la card di chi ha solo preferenze di cucina resterebbe quasi vuota.
  const { mostrate, altre } = scegliPreferenze([
    p({ testo: 'Acqua naturale' }), p({ testo: 'Caffè leccese' }),
    p({ testo: 'Aperol Spritz' }), p({ testo: 'Gelato a fine pasto' }),
  ], nomeDi);
  assert.strictEqual(mostrate.length, MAX_PREF_CARD);
  assert.strictEqual(altre, 1);
});

test('due persone diverse prima che due volte la stessa persona', () => {
  const { mostrate } = scegliPreferenze([
    p({ testo: 'Tè freddo', ambito: 'personale', pms_customer_id: 20 }),
    p({ testo: 'Cuscino rigido', ambito: 'personale', pms_customer_id: 20, reparto: 'Rooms', categoria: 'Camera' }),
    p({ testo: 'Massaggio serale', ambito: 'personale', pms_customer_id: 30, reparto: 'SPA', categoria: 'Persona' }),
  ], nomeDi);
  assert.deepStrictEqual(mostrate.map((x) => x.chi), ['ANNA BIANCHI', 'LUCA VERDI', 'ANNA BIANCHI']);
});

test('lo stesso testo non si ripete, e vince la versione che dice di chi è', () => {
  // Due occupanti con la stessa preferenza di nucleo sono una riga sola; ma se
  // lo stesso testo esiste anche come personale, resta quello col nome.
  const { mostrate, altre } = scegliPreferenze([
    p({ testo: 'Coca-Cola Zero', pms_customer_id: 10 }),
    p({ testo: 'coca-cola zero', pms_customer_id: 30 }),
    p({ testo: 'Coca-Cola Zero', ambito: 'personale', pms_customer_id: 20 }),
  ], nomeDi);
  assert.strictEqual(mostrate.length, 1);
  assert.strictEqual(mostrate[0].chi, 'ANNA BIANCHI');
  assert.strictEqual(altre, 0, 'i doppioni non si contano fra le "altre"');
});

test('a parità, la più recente', () => {
  const { mostrate } = scegliPreferenze([
    p({ testo: 'Vecchia', created_at: '2026-01-01' }),
    p({ testo: 'Nuova', created_at: '2026-08-10' }),
  ], nomeDi, 1);
  assert.strictEqual(mostrate[0].testo, 'Nuova');
});

test('testi vuoti e liste vuote non producono righe fantasma', () => {
  assert.deepStrictEqual(scegliPreferenze([], nomeDi), { mostrate: [], altre: 0 });
  assert.deepStrictEqual(scegliPreferenze(null, nomeDi), { mostrate: [], altre: 0 });
  const { mostrate } = scegliPreferenze([p({ testo: '   ' }), p({ testo: 'Vera' })], nomeDi);
  assert.deepStrictEqual(mostrate.map((x) => x.testo), ['Vera']);
});

test("se il nome di chi ha la preferenza non si trova, la preferenza resta", () => {
  // Un'anagrafica non leggibile non deve far sparire un'informazione utile:
  // si perde il "di chi", non il "cosa".
  const { mostrate } = scegliPreferenze(
    [p({ testo: 'Caffè decaffeinato', ambito: 'personale', pms_customer_id: 999 })], nomeDi);
  assert.strictEqual(mostrate.length, 1);
  assert.strictEqual(mostrate[0].chi, null);
  assert.strictEqual(mostrate[0].ambito, 'personale');
});
