const { test } = require('node:test');
const assert = require('node:assert');
const {
  costruisciFatti, haFatti, buildRequest, parseSuggerimenti, suggerisci, SCHEMA, SYSTEM,
} = require('../src/ai/suggerisci');

// Client mock: ritorna una risposta con un blocco text contenente il JSON dato.
function clientConTesto(text) {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'text', text }] }),
    },
  };
}

test('costruisciFatti compone i blocchi e minimizza (nessun id/cognome)', () => {
  const fatti = costruisciFatti({
    gusti: { items: [{ nome: 'COCA COLA ZERO', categoria: 'Bevande', volte: 88 }] },
    notePms: 'Ama il piano alto',
    intolleranze: [{ testo: 'Lattosio' }],
    preferenze: [{ reparto: 'Rooms', categoria: 'Camera', testo: 'Vista mare' }],
  });
  assert.match(fatti, /CONSUMI F&B/);
  assert.match(fatti, /COCA COLA ZERO — 88x/);
  assert.match(fatti, /NOTE ANAGRAFICA \(PMS\)/);
  assert.match(fatti, /Ama il piano alto/);
  assert.match(fatti, /INTOLLERANZE GIÀ REGISTRATE/);
  assert.match(fatti, /Lattosio/);
  assert.match(fatti, /PREFERENZE GIÀ REGISTRATE/);
  assert.match(fatti, /Rooms\/Camera: Vista mare/);
});

test('costruisciFatti include note PMS e le proposte già mostrate in sessione', () => {
  const fatti = costruisciFatti({
    notePms: 'Ospite abituale, ama la vista mare',
    giaMostrate: ['Predilige la vista mare', 'Caffè leccese'],
  });
  assert.match(fatti, /NOTE ANAGRAFICA \(PMS\)/);
  assert.match(fatti, /ama la vista mare/);
  assert.match(fatti, /GIÀ PROPOSTE IN QUESTA SESSIONE/);
  assert.match(fatti, /Predilige la vista mare/);
  assert.match(fatti, /Caffè leccese/);
});

test('SYSTEM: modello di affidabilità a livelli, semantico, solo nuove', () => {
  assert.match(SYSTEM, /NOTE PMS/);
  assert.match(SYSTEM, /3-4 evidenze/);
  assert.match(SYSTEM, /molto alta/);
  assert.match(SYSTEM, /SEMANTICO/);
  assert.match(SYSTEM, /NUOVE/);
  assert.match(SYSTEM, /PERMANENTI/);          // permanente vs contestuale
  assert.match(SYSTEM, /late check-out/);      // richieste operative escluse
});

test('costruisciFatti senza dati → stringa vuota, haFatti false', () => {
  const fatti = costruisciFatti({});
  assert.strictEqual(fatti, '');
  assert.strictEqual(haFatti(fatti), false);
  assert.strictEqual(haFatti('x'), true);
});

test('buildRequest imposta modello, structured output e system', () => {
  const req = buildRequest('FATTI', { model: 'claude-opus-5' });
  assert.strictEqual(req.model, 'claude-opus-5');
  assert.strictEqual(req.output_config.format.schema, SCHEMA);
  assert.match(req.system, /5 stelle/);
  assert.match(req.messages[0].content, /FATTI/);
});

test('parseSuggerimenti: valida, scarta preferenze con reparto/categoria fuori lista', () => {
  const resp = { content: [{ type: 'text', text: JSON.stringify({ suggerimenti: [
    { tipo: 'preferenza', reparto: 'F&B', categoria: 'F&B', testo: 'Caffè: preferisce leccese', fonte: 'consumi F&B 4x', motivo: '4 evidenze', affidabilita: 'media' },
    { tipo: 'preferenza', reparto: 'Cucina', categoria: 'F&B', testo: 'reparto inventato', fonte: 'x', motivo: '', affidabilita: 'media' },
    { tipo: 'intolleranza', reparto: '', categoria: '', testo: 'Glutine', fonte: 'nota PMS', motivo: 'nota esplicita', affidabilita: 'alta' },
    { tipo: 'preferenza', reparto: 'Rooms', categoria: 'Camera', testo: '   ', fonte: 'x', motivo: 'vuoto', affidabilita: 'media' },
  ] }) }] };
  const out = parseSuggerimenti(resp);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0], { tipo: 'preferenza', reparto: 'F&B', categoria: 'F&B', testo: 'Caffè: preferisce leccese', fonte: 'consumi F&B 4x', motivo: '4 evidenze', affidabilita: 'media', ambito: 'nucleo' });
  assert.deepStrictEqual(out[1], { tipo: 'intolleranza', reparto: null, categoria: null, testo: 'Glutine', fonte: 'nota PMS', motivo: 'nota esplicita', affidabilita: 'alta', ambito: 'personale' });
});

test('parseSuggerimenti: JSON non valido o vuoto → []', () => {
  assert.deepStrictEqual(parseSuggerimenti({ content: [{ type: 'text', text: 'non-json' }] }), []);
  assert.deepStrictEqual(parseSuggerimenti({ content: [] }), []);
  assert.deepStrictEqual(parseSuggerimenti({}), []);
});

test('suggerisci: chiama il client e normalizza', async () => {
  const client = clientConTesto(JSON.stringify({ suggerimenti: [
    { tipo: 'preferenza', reparto: 'SPA', categoria: 'Persona', testo: 'Massaggio serale', fonte: 'consumi SPA 5x', motivo: 'x', affidabilita: 'media' },
  ] }));
  const out = await suggerisci(client, 'FATTI', { model: 'claude-opus-5' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].reparto, 'SPA');
  assert.strictEqual(out[0].affidabilita, 'media');
  assert.strictEqual(out[0].fonte, 'consumi SPA 5x');
});

test('suggerisci: fatti vuoti → nessuna chiamata al modello', async () => {
  let chiamato = false;
  const client = { messages: { create: async () => { chiamato = true; return { content: [] }; } } };
  const out = await suggerisci(client, '', {});
  assert.deepStrictEqual(out, []);
  assert.strictEqual(chiamato, false);
});
