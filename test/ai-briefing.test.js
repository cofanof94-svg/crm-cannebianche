const { test } = require('node:test');
const assert = require('node:assert');
const {
  costruisciFatti, haFatti, buildRequest, estraiFonti, parseBriefing, briefing, SYSTEM,
  dominioAziendale, estraiIdentificazione,
} = require('../src/ai/briefing');

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

test('dominioAziendale: tiene solo i domini che dicono qualcosa sull\'azienda', () => {
  assert.strictEqual(dominioAziendale('m.rossi@pirelli.com'), 'pirelli.com');
  assert.strictEqual(dominioAziendale('  M.Rossi@Pirelli.COM '), 'pirelli.com'); // normalizzato
  assert.strictEqual(dominioAziendale('info@studio-legale.co.uk'), 'studio-legale.co.uk');
  // Provider generici: il dominio non identifica nessuna azienda, non va passato.
  for (const e of ['x@gmail.com', 'x@libero.it', 'x@icloud.com', 'x@hotmail.it', 'x@yahoo.com', 'x@outlook.com']) {
    assert.strictEqual(dominioAziendale(e), '', e);
  }
  // Valori sporchi o assenti.
  for (const e of [null, undefined, '', 'non-una-mail', 'a@b', 'a@@b.com', 'x@dominio']) {
    assert.strictEqual(dominioAziendale(e), '', String(e));
  }
});

test('costruisciFatti: passa il dominio della mail, mai l\'indirizzo', () => {
  const f = costruisciFatti({ nominativo: 'Mario Rossi', email: 'mario.rossi@pirelli.com' });
  assert.match(f, /pirelli\.com/);
  assert.doesNotMatch(f, /mario\.rossi@/); // la parte prima della @ non serve e non esce
  assert.doesNotMatch(f, /@/);
  // Mail generica: nessuna riga in più, non aiuta a identificare nessuno.
  assert.doesNotMatch(costruisciFatti({ nominativo: 'Mario Rossi', email: 'mario.rossi@gmail.com' }), /gmail/);
});

test('SYSTEM: LinkedIn ammesso, social personali no, regola dei due riscontri', () => {
  assert.match(SYSTEM, /LinkedIn/);
  assert.match(SYSTEM, /Facebook, Instagram, TikTok, X/);
  assert.match(SYSTEM, /due riscontri/i);
  assert.match(SYSTEM, /SOLO ruolo, azienda\/organizzazione e settore/); // niente storia lavorativa, studi, post
  assert.match(SYSTEM, /Identificazione: pubblica/);
  assert.match(SYSTEM, /Identificazione: professionale/);
  assert.match(SYSTEM, /Identificazione: incerta/);
});

test('estraiIdentificazione: legge il marcatore, ignora i valori non previsti', () => {
  assert.strictEqual(estraiIdentificazione('Ruolo: x\nIdentificazione: professionale'), 'professionale');
  assert.strictEqual(estraiIdentificazione('Ruolo: x\nidentificazione : INCERTA'), 'incerta');
  assert.strictEqual(estraiIdentificazione('Identificazione: pubblica'), 'pubblica');
  assert.strictEqual(estraiIdentificazione('Ruolo: x'), '');            // marcatore assente
  assert.strictEqual(estraiIdentificazione('Identificazione: certa'), ''); // valore inventato
});

test('parseBriefing: profilo professionale → salvabile, marcatore fuori dal testo', () => {
  const out = parseBriefing({ content: [
    { type: 'text', text: 'Ruolo: Direttore Generale\nAzienda: Pirelli\nAppellativo: "Dottore"\nIdentificazione: professionale', citations: [{ url: 'https://www.linkedin.com/in/xyz', title: 'LinkedIn' }] },
  ] });
  assert.strictEqual(out.identificazione, 'professionale');
  assert.strictEqual(out.salvabile, true);
  assert.strictEqual(out.pubblico, true);
  assert.doesNotMatch(out.testo, /Identificazione/); // il marcatore diventa etichetta, non testo
  assert.match(out.testo, /Direttore Generale/);
  assert.strictEqual(out.fonti.length, 1); // LinkedIn NON è più scartato
});

test('parseBriefing: identità incerta → si mostra ma non si salva', () => {
  const out = parseBriefing({ content: [
    { type: 'text', text: 'Ruolo: consulente informatico\nAppellativo: "Signore"\nIdentificazione: incerta', citations: [{ url: 'https://www.linkedin.com/in/mrossi', title: 'LinkedIn' }] },
  ] });
  assert.strictEqual(out.identificazione, 'incerta');
  assert.strictEqual(out.salvabile, false); // il no all'omonimia in anagrafica
  assert.strictEqual(out.pubblico, true);   // ma le fonti si vedono, per poter verificare
  assert.strictEqual(out.fonti.length, 1);
});

test('parseBriefing: senza marcatore resta l\'esito storico; niente informazioni → nessuna', () => {
  const vecchio = parseBriefing({ content: [{ type: 'text', text: 'Ruolo: imprenditore', citations: [{ url: 'https://it.wikipedia.org/x', title: 'W' }] }] });
  assert.strictEqual(vecchio.identificazione, 'pubblica');
  assert.strictEqual(vecchio.salvabile, true);

  const niente = parseBriefing({ content: [{ type: 'text', text: 'Nessuna informazione pubblica rilevante.' }] });
  assert.strictEqual(niente.identificazione, 'nessuna');
  assert.strictEqual(niente.salvabile, false);
});

test('estraiFonti: LinkedIn ammesso, social personali scartati', () => {
  const fonti = estraiFonti([
    { type: 'text', text: 'x', citations: [
      { url: 'https://www.linkedin.com/in/mario-rossi', title: 'LinkedIn' },
      { url: 'https://www.facebook.com/mario.rossi', title: 'Facebook' },
      { url: 'https://www.instagram.com/mrossi', title: 'Instagram' },
    ] },
  ]);
  assert.strictEqual(fonti.length, 1);
  assert.match(fonti[0].url, /linkedin/);
  // 'x.com' non è in elenco: scartarlo per sottostringa affosserebbe anche questi.
  const leciti = estraiFonti([{ type: 'text', text: 'x', citations: [{ url: 'https://www.linux.com/a', title: 'L' }, { url: 'https://essex.com/b', title: 'E' }] }]);
  assert.strictEqual(leciti.length, 2);
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
