const { test } = require('node:test');
const assert = require('node:assert');
const { costruisciFatti, haFatti, buildRequest, estraiFonti, parseBriefing, briefing, SYSTEM } = require('../src/ai/briefing');

function clientConContenuto(content) {
  return { messages: { create: async () => ({ content }) } };
}

test('costruisciFatti: compone identità; senza nome → stringa vuota', () => {
  const f = costruisciFatti({ nominativo: 'Mario Rossi', citta: 'Milano', nazione: 'IT', vip: { descrizione: 'BOLLICINE' }, note: 'amico del direttore' });
  assert.match(f, /Ospite da preparare: Mario Rossi/);
  assert.match(f, /Milano, IT/);
  assert.match(f, /Classificazione interna VIP: BOLLICINE/);
  assert.match(f, /NON pubblicare/);
  assert.strictEqual(costruisciFatti({}), '');
  assert.strictEqual(haFatti(''), false);
  assert.strictEqual(haFatti('x'), true);
});

test('SYSTEM: tutele privacy, fonti autorevoli, formato asciutto, fallback esplicito', () => {
  assert.match(SYSTEM, /SOLO fonti web PUBBLICHE/i);
  assert.match(SYSTEM, /CITA sempre le fonti/i);
  assert.match(SYSTEM, /AUTOREVOLI/);
  assert.match(SYSTEM, /Nessuna informazione pubblica rilevante/);
  assert.match(SYSTEM, /omonimia/i);
  assert.match(SYSTEM, /PAROLE CHIAVE/); // sintesi per parole chiave, non prosa
  assert.match(SYSTEM, /Appellativo:/);  // riga finale su come rivolgersi
});

test('estraiFonti: scarta i domini non autorevoli (scraper di contatti/marketplace)', () => {
  const fonti = estraiFonti([
    { type: 'text', text: 'x', citations: [
      { url: 'https://it.wikipedia.org/wiki/X', title: 'Wikipedia' },
      { url: 'https://rocketreach.co/x-email', title: 'contatti' },
      { url: 'https://www.1stdibs.com/art/y', title: 'quadro' },
    ] },
  ]);
  assert.strictEqual(fonti.length, 1);
  assert.match(fonti[0].url, /wikipedia/);
});

test('buildRequest: modello, web search tool e system', () => {
  const req = buildRequest('FATTI', { model: 'claude-sonnet-5' });
  assert.strictEqual(req.model, 'claude-sonnet-5');
  assert.strictEqual(req.tools[0].type, 'web_search_20260209');
  assert.strictEqual(req.tools[0].name, 'web_search');
  assert.match(req.system, /concierge/i);
  assert.match(req.messages[0].content, /FATTI/);
});

test('estraiFonti: dedup da citazioni testo e risultati tool', () => {
  const fonti = estraiFonti([
    { type: 'text', text: 'x', citations: [{ url: 'https://a.it', title: 'A' }, { url: 'https://a.it', title: 'A dup' }] },
    { type: 'web_search_tool_result', content: [{ url: 'https://b.it', title: 'B' }, { url: '', title: 'vuota' }] },
  ]);
  assert.strictEqual(fonti.length, 2);
  assert.deepStrictEqual(fonti[0], { url: 'https://a.it', titolo: 'A' });
  assert.deepStrictEqual(fonti[1], { url: 'https://b.it', titolo: 'B' });
});

test('parseBriefing: personaggio pubblico → testo + fonti, pubblico=true', () => {
  const out = parseBriefing({ content: [
    { type: 'text', text: 'Noto imprenditore del settore vinicolo.', citations: [{ url: 'https://it.wikipedia.org/x', title: 'Wikipedia' }] },
  ] });
  assert.strictEqual(out.pubblico, true);
  assert.match(out.testo, /imprenditore/);
  assert.strictEqual(out.fonti.length, 1);
});

test('parseBriefing: non pubblico → nessuna fonte, pubblico=false', () => {
  const out = parseBriefing({ content: [
    { type: 'text', text: 'Nessuna informazione pubblica rilevante.', citations: [{ url: 'https://x.it', title: 'X' }] },
  ] });
  assert.strictEqual(out.pubblico, false);
  assert.deepStrictEqual(out.fonti, []);
});

test('parseBriefing: rimuove intestazione e grassetto, tiene le righe a etichetta', () => {
  const out = parseBriefing({ content: [
    { type: 'text', text: '**BRIEFING RECEPTION – Mario Rossi**\n\nRuolo: imprenditore\nAppellativo: "Dottore"', citations: [{ url: 'https://it.wikipedia.org/x', title: 'Wikipedia' }] },
  ] });
  assert.strictEqual(out.pubblico, true);
  assert.doesNotMatch(out.testo, /BRIEFING/);
  assert.doesNotMatch(out.testo, /\*\*/);
  assert.match(out.testo, /^Ruolo: imprenditore/);
  assert.match(out.testo, /Appellativo:/);
});

test('parseBriefing: rimuove preambolo incollato e coda "Fonti"', () => {
  const testo = "L'ospite corrisponde a Mario Rossi, noto imprenditore.Ruolo: imprenditore\nAppellativo: \"Dottore\"\n\nFonti: sito ufficiale…";
  const out = parseBriefing({ content: [{ type: 'text', text: testo, citations: [{ url: 'https://it.wikipedia.org/x', title: 'W' }] }] });
  assert.match(out.testo, /^Ruolo: imprenditore/);
  assert.match(out.testo, /Appellativo:/);
  assert.doesNotMatch(out.testo, /L'ospite corrisponde/);
  assert.doesNotMatch(out.testo, /Fonti:/);
});

test('parseBriefing: risposta vuota → fallback esplicito', () => {
  const out = parseBriefing({ content: [] });
  assert.strictEqual(out.pubblico, false);
  assert.strictEqual(out.testo, 'Nessuna informazione pubblica rilevante.');
});

test('briefing: chiama il client; fatti vuoti → nessuna chiamata', async () => {
  const out = await briefing(clientConContenuto([{ type: 'text', text: 'Politico locale.', citations: [{ url: 'https://c.it', title: 'C' }] }]), 'FATTI');
  assert.strictEqual(out.pubblico, true);
  assert.strictEqual(out.fonti[0].url, 'https://c.it');

  let chiamato = false;
  const spia = { messages: { create: async () => { chiamato = true; return { content: [] }; } } };
  const vuoto = await briefing(spia, '');
  assert.strictEqual(chiamato, false);
  assert.strictEqual(vuoto.pubblico, false);
});
