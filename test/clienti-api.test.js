const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { calcolaStatistiche } = require('../src/api/clienti');
const { hashPassword } = require('../src/auth/password');

test('calcolaStatistiche esclude le prenotazioni Eliminata dai conteggi', () => {
  const s = calcolaStatistiche([
    { stato: 'Concluso', dtarrivo: '2026-04-17', arrangiamento: 855, extra: 40 },
    { stato: 'Eliminata', dtarrivo: '2026-01-01', arrangiamento: 0, extra: 0 },
    { stato: 'No-show', dtarrivo: '2025-05-05', arrangiamento: 0, extra: 0 },
    { stato: 'Confermato', dtarrivo: '2026-07-07', arrangiamento: 2300, extra: 0 },
  ]);
  assert.strictEqual(s.nSoggiorni, 2);              // eliminata e no-show non contano
  assert.strictEqual(s.totaleSpeso, 3195);
  assert.strictEqual(s.primaVisita, '2026-04-17');  // non 2026-01-01 dell'eliminata
  assert.strictEqual(s.ultimaVisita, '2026-07-07');
});

test('calcolaStatistiche: cumulativi LTV, notti, medie e ultima Source', () => {
  const s = calcolaStatistiche([
    { stato: 'Concluso', dtarrivo: '2026-04-17', notti: 2, arrangiamento: 800, extra: 200, source: 'OTA', mercato: 'LEISURE INDIVIDUALI' },
    { stato: 'Confermato', dtarrivo: '2026-07-07', notti: 8, arrangiamento: 2000, extra: 0, source: 'DIRETTI', mercato: 'MEETING' },
    { stato: 'Eliminata', dtarrivo: '2026-08-01', notti: 5, arrangiamento: 0, extra: 0, source: 'OTA', mercato: 'SPA' }, // esclusa
  ]);
  assert.strictEqual(s.nSoggiorni, 2);
  assert.strictEqual(s.nottiTotali, 10);            // 2+8, esclusa l'eliminata
  assert.strictEqual(s.ltv, 3000);                  // 800+200+2000
  assert.strictEqual(s.spesaMediaSoggiorno, 1500);  // 3000/2
  assert.strictEqual(s.spesaMediaRooms, 1400);      // 2800/2
  assert.strictEqual(s.spesaMediaServizi, 100);     // 200/2
  assert.strictEqual(s.ultimaSource, 'DIRETTI');    // soggiorno valido più recente (2026-07-07)
  assert.strictEqual(s.ultimoMercato, 'MEETING');   // idem, dal più recente
});

async function makeApp(opts = {}) {
  const admin = { id: 1, username: 'admin', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const complaints = [];
  const intolleranze = [];
  const preferenze = [];
  const nucleo = [];
  const merges = []; // { pms_customer_id, canonical_id }
  const nucleoInit = new Set();
  let profilo = null;
  const crmDb = {
    async query(text, params) {
      // le letture di lista interpolano gli id nel gruppo come IN (a, b, …)
      const ids = (() => { const m = String(text).match(/IN \(([\d,\s]+)\)/); return m ? m[1].split(',').map((s) => Number(s.trim())) : []; })();
      if (/FROM users WHERE username/.test(text)) return params.username === 'admin' ? [admin] : [];
      if (/INSERT INTO customer_nucleo_init/.test(text)) { nucleoInit.add(params.pmsCustomerId); return []; }
      if (/FROM customer_nucleo_init/.test(text)) return nucleoInit.has(params.pmsCustomerId) ? [{ x: 1 }] : [];
      if (/customer_merge/.test(text)) {
        if (/MERGE customer_merge/.test(text)) { const ex = merges.find((m) => m.pms_customer_id === params.memberId); if (ex) ex.canonical_id = params.principale; else merges.push({ pms_customer_id: params.memberId, canonical_id: params.principale }); return []; }
        if (/UPDATE customer_merge SET canonical_id/.test(text)) { merges.forEach((m) => { if (m.canonical_id === params.memberId) m.canonical_id = params.principale; }); return []; }
        if (/DELETE FROM customer_merge/.test(text)) { const i = merges.findIndex((m) => m.pms_customer_id === params.memberId); if (i >= 0) { const id = merges[i].pms_customer_id; merges.splice(i, 1); return [{ pms_customer_id: id }]; } return []; }
        if (/WHERE pms_customer_id = @codCli/.test(text)) return merges.filter((m) => m.pms_customer_id === params.codCli).map((m) => ({ canonical_id: m.canonical_id }));
        if (/WHERE pms_customer_id = @canonicalId/.test(text)) return merges.filter((m) => m.pms_customer_id === params.canonicalId).map((m) => ({ canonical_id: m.canonical_id }));
        if (/WHERE canonical_id = @canonicalId/.test(text)) return merges.filter((m) => m.canonical_id === params.canonicalId).map((m) => ({ pms_customer_id: m.pms_customer_id }));
        if (/ORDER BY canonical_id/.test(text)) return merges.map((m) => ({ pms_customer_id: m.pms_customer_id, canonical_id: m.canonical_id }));
        return [];
      }
      if (/INSERT INTO customer_intolerances/.test(text)) { const n = { id: intolleranze.length + 1, ...params }; intolleranze.push(n); return [{ id: n.id }]; }
      if (/DELETE FROM customer_intolerances/.test(text)) { const i = intolleranze.findIndex((x) => x.id === params.id); if (i >= 0) { const id = intolleranze[i].id; intolleranze.splice(i, 1); return [{ id }]; } return []; }
      if (/FROM customer_intolerances/.test(text)) return intolleranze.filter((n) => ids.includes(n.pmsCustomerId)).map((n) => ({ id: n.id, testo: n.testo, autore: 'admin', created_at: 'x', autore_user_id: 1, pms_customer_id: n.pmsCustomerId }));
      if (/MERGE customer_profile/.test(text)) {
        profilo = profilo || { pms_customer_id: params.pmsCustomerId, lingua: null, note_personali: null };
        profilo.pms_customer_id = params.pmsCustomerId;
        if (params.lingua !== undefined) profilo.lingua = params.lingua;
        if (params.notePersonali !== undefined) profilo.note_personali = params.notePersonali;
        return [];
      }
      if (/FROM customer_profile/.test(text)) return profilo && ids.includes(profilo.pms_customer_id) ? [profilo] : [];
      if (/INSERT INTO customer_preferences/.test(text)) { const n = { id: preferenze.length + 1, ...params }; preferenze.push(n); return [{ id: n.id }]; }
      if (/UPDATE customer_preferences/.test(text)) { const n = preferenze.find((x) => x.id === params.id); if (n) { if (params.ambito !== undefined) n.ambito = params.ambito; if (params.testo !== undefined) n.testo = params.testo; if (params.reparto !== undefined) n.reparto = params.reparto; if (params.categoria !== undefined) n.categoria = params.categoria; return [{ id: n.id }]; } return []; }
      if (/DELETE FROM customer_preferences/.test(text)) { const i = preferenze.findIndex((x) => x.id === params.id); if (i >= 0) { const id = preferenze[i].id; preferenze.splice(i, 1); return [{ id }]; } return []; }
      if (/FROM customer_preferences/.test(text)) { const soloNucleo = /ambito = 'nucleo'/.test(text); return preferenze.filter((n) => ids.includes(n.pmsCustomerId) && (!soloNucleo || (n.ambito || 'nucleo') === 'nucleo')).map((n) => ({ id: n.id, reparto: n.reparto, categoria: n.categoria, testo: n.testo, ambito: n.ambito || 'nucleo', autore: 'admin', created_at: 'x', autore_user_id: 1, pms_customer_id: n.pmsCustomerId })); }
      if (/INSERT INTO customer_travel_party/.test(text)) { const n = { id: nucleo.length + 1, ...params }; nucleo.push(n); return [{ id: n.id }]; }
      if (/UPDATE customer_travel_party/.test(text)) { const n = nucleo.find((x) => x.id === params.id); if (n) { if (params.tipoRelazione !== undefined) n.tipoRelazione = params.tipoRelazione; if (params.nome !== undefined) n.nome = params.nome; if (params.cognome !== undefined) n.cognome = params.cognome; if (params.nota !== undefined) n.nota = params.nota; return [{ id: n.id }]; } return []; }
      if (/DELETE FROM customer_travel_party/.test(text)) { const i = nucleo.findIndex((x) => x.id === params.id); if (i >= 0) { const id = nucleo[i].id; nucleo.splice(i, 1); return [{ id }]; } return []; }
      if (/pms_occupant_id AS c/.test(text)) { const s = new Set(); nucleo.forEach((n) => { if (n.pmsCustomerId === params.codCli && n.pmsOccupantId != null) s.add(n.pmsOccupantId); if (n.pmsOccupantId === params.codCli) s.add(n.pmsCustomerId); }); return [...s].map((c) => ({ c })); }
      if (/FROM customer_travel_party/.test(text)) return nucleo.filter((n) => ids.includes(n.pmsCustomerId)).map((n) => ({ id: n.id, tipo_relazione: n.tipoRelazione, nome: n.nome, cognome: n.cognome, nota: n.nota, pms_occupant_id: n.pmsOccupantId != null ? n.pmsOccupantId : null, autore: 'admin', created_at: 'x', autore_user_id: 1, pms_customer_id: n.pmsCustomerId }));
      if (/INSERT INTO customer_complaints/.test(text)) { const n = { id: complaints.length + 1, stato: 'aperto', ...params }; complaints.push(n); return [{ id: n.id }]; }
      if (/UPDATE customer_complaints/.test(text)) { const n = complaints.find((x) => x.id === params.id); if (n) { if (params.testo != null) n.testo = params.testo; if (params.stato != null) n.stato = params.stato; if (params.periodo !== undefined) n.periodo = params.periodo; return [{ id: n.id }]; } return []; }
      if (/DELETE FROM customer_complaints/.test(text)) { const i = complaints.findIndex((x) => x.id === params.id); if (i >= 0) { const id = complaints[i].id; complaints.splice(i, 1); return [{ id }]; } return []; }
      if (/FROM customer_complaints/.test(text)) return complaints.filter((n) => ids.includes(n.pmsCustomerId)).map((n) => ({ id: n.id, testo: n.testo, stato: n.stato, periodo: n.periodo || null, autore: 'admin', created_at: 'x', resolved_at: null, autore_user_id: 1, pms_customer_id: n.pmsCustomerId }));
      return [];
    },
  };
  const pmsDb = {
    async query(text, params) {
      if (/a\.CodCli <> @codCli/.test(text)) return [{ codCli: 55491, Cognome: 'DI BARI', Nome: 'ANNA', dtNascita: '1964-10-17', codiceFiscale: '', match: 'anagrafica', nPrenotazioni: 0 }];
      if (/STRING_AGG/.test(text)) return [{ tipo: 'CF', cognome: 'DI BARI', nome: 'ANNA', chiave: 'X', n: 2, membri: '47186,55491' }];
      if (/cameraInCasa/.test(text)) return [{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANNA', email: 'a@b.it', Cellulare: '', Telefono: '080123', Citta: 'TRANI', cameraInCasa: null }];
      if (/AS nPrenotazioni[\s\S]*a\.CodCli IN/.test(text)) return [
        { codCli: 47186, Cognome: 'DI BARI', Nome: 'ANNA', dtNascita: '1964-10-17', codiceFiscale: 'X', Citta: 'TRANI', CodNaz: 'I', email: 'a@b.it', Telefono: '080', Cellulare: '', CodVip: '', DesVip: null, nPrenotazioni: 5 },
        { codCli: 55491, Cognome: 'DI BARI', Nome: 'ANNA', dtNascita: '1964-10-17', codiceFiscale: 'Y', Citta: 'TRANI', CodNaz: 'I', email: 'a@b.it', Telefono: '080', Cellulare: '', CodVip: '', DesVip: null, nPrenotazioni: 2 },
      ];
      if (/FROM Anagra a\b/.test(text)) { if (params && params.codCli === 999) return []; return [{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANNA', Telefono: '', Cellulare: '', email: 'a@b.it', Citta: 'TRANI', CodNaz: 'I', dtNascita: '1964-10-17', CodFis: 'X', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'S', Privacy2: 'S', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' }]; }
      if (/StorAddebitiComanda/.test(text)) return [{ codArt: 'COCAZ', nome: 'COCA COLA ZERO', fb: 'B', grp: 'BEV.BI', volte: 5, qta: 5, eur: 30 }];
      if (/codgrpmerCAT LIKE 'SPA/.test(text)) return [{ nome: 'SERENITY', grp: 'SPA', volte: 12, qta: 12, eur: 1200 }];
      if (/AS nShared/.test(text)) return opts.coOcc || []; // co-occupanti nucleo (auto-popolamento)
      // soggiorni (arrangiamento/extra da camereJson)
      return [{ codpratica: 1, dtarrivo: '2026-04-17', dtpartenza: '2026-04-19', notti: 2, camere: '109', stato: 'Concluso', source: 'OTA', mercato: 'LEISURE INDIVIDUALI', arrangiamento: 855, extra: 0 },
              { codpratica: 2, dtarrivo: '2026-07-07', dtpartenza: '2026-07-19', notti: 12, camere: '102', stato: 'Confermato', source: 'DIRETTI', mercato: 'MEETING', arrangiamento: 2300, extra: 0 }];
    },
  };
  return createApp({ crmDb, pmsDb, sessionSecret: 'test' });
}

async function agente(app) {
  const ag = request.agent(app);
  await ag.post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return ag;
}

test('senza login GET /api/clienti/47186 → 401', async () => {
  const app = await makeApp();
  const res = await request(app).get('/api/clienti/47186');
  assert.strictEqual(res.status, 401);
});

test('GET /api/clienti?q= → risultati', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti?q=bari');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.risultati[0].nominativo, 'DI BARI ANNA');
});

test('GET /api/clienti/:codCli → anagrafica+statistiche+soggiorni', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/47186');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.anagrafica.nominativo, 'DI BARI ANNA');
  assert.strictEqual(res.body.statistiche.nSoggiorni, 2);
  assert.strictEqual(res.body.statistiche.totaleSpeso, 3155);
  assert.strictEqual(res.body.statistiche.ltv, 3155);
  assert.strictEqual(res.body.statistiche.nottiTotali, 14);
  assert.strictEqual(res.body.statistiche.ultimaSource, 'DIRETTI');
  assert.strictEqual(res.body.statistiche.ultimoMercato, 'MEETING');
  assert.strictEqual(res.body.statistiche.primaVisita, '2026-04-17');
  assert.strictEqual(res.body.statistiche.ultimaVisita, '2026-07-07');
});

test('GET /api/clienti/:codCli/gusti → consumi F&B aggregati', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/47186/gusti');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.gusti.totVoci, 1);
  assert.strictEqual(res.body.gusti.items[0].nome, 'COCA COLA ZERO');
  assert.strictEqual(res.body.gusti.items[0].categoria, 'Bevande');
  const noauth = await request(app).get('/api/clienti/47186/gusti');
  assert.strictEqual(noauth.status, 401);
});

test('GET /api/clienti/:codCli/spa → trattamenti benessere aggregati', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/47186/spa');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.spa.totVoci, 1);
  assert.strictEqual(res.body.spa.items[0].nome, 'SERENITY');
  assert.strictEqual(res.body.spa.items[0].categoria, 'Trattamento');
  const noauth = await request(app).get('/api/clienti/47186/spa');
  assert.strictEqual(noauth.status, 401);
});

test('GET /api/clienti/:codCli/duplicati → candidati', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/47186/duplicati');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.candidati[0].codCli, 55491);
  assert.strictEqual(res.body.candidati[0].match, 'anagrafica');
});

test('GET /api/duplicati → gruppi con conteggio fusi', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/duplicati');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.gruppi[0].membri, [47186, 55491]);
  assert.strictEqual(res.body.gruppi[0].fusiCount, 0);
});

test('POST /api/clienti/:codCli/merge rifiuta auto-fusione', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.post('/api/clienti/47186/merge').send({ memberId: 47186, canonicalId: 47186 });
  assert.strictEqual(res.status, 400);
});

test('merge: dato CRM di un duplicato appare nel gruppo; unmerge lo scollega', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  // fondo 55491 in 47186, poi scrivo un'intolleranza sul duplicato 55491
  const m = await ag.post('/api/clienti/47186/merge').send({ memberId: 55491, canonicalId: 47186 });
  assert.strictEqual(m.status, 201);
  await ag.post('/api/clienti/55491/intolleranze').send({ testo: 'Glutine' });
  // vista dalla scheda 47186 (principale) il dato del gruppo compare
  let res = await ag.get('/api/clienti/47186/intolleranze');
  assert.strictEqual(res.body.intolleranze.length, 1);
  assert.strictEqual(res.body.intolleranze[0].testo, 'Glutine');
  // la scheda 47186 espone l'info di fusione
  const scheda = await ag.get('/api/clienti/47186');
  assert.ok(scheda.body.merge);
  assert.deepStrictEqual([...scheda.body.merge.membri].sort((a, b) => a - b), [47186, 55491]);
  // annullo la fusione → il dato non è più nel gruppo di 47186
  const del = await ag.delete('/api/merge/55491');
  assert.strictEqual(del.status, 200);
  res = await ag.get('/api/clienti/47186/intolleranze');
  assert.strictEqual(res.body.intolleranze.length, 0);
});

test('POST /api/clienti/:codCli/suggerimenti → 503 se AI non configurata', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  require('../src/ai/client')._reset();
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.post('/api/clienti/47186/suggerimenti');
  assert.strictEqual(res.status, 503);
  assert.match(res.body.error, /AI non configurata/);
});

test('POST /api/clienti/:codCli/briefing → 503 se AI non configurata', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  require('../src/ai/client')._reset();
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.post('/api/clienti/47186/briefing');
  assert.strictEqual(res.status, 503);
  assert.match(res.body.error, /AI non configurata/);
});

test('GET /api/clienti/:codCli/confronto → anagrafiche, conflitti e principale suggerito', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/47186/confronto?ids=47186,55491');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.anagrafiche.length, 2);
  assert.strictEqual(res.body.suggerito, 47186); // più prenotazioni
  assert.deepStrictEqual(res.body.conflitti.map((c) => c.campo), ['codiceFiscale']);
});

test('GET /api/clienti/abc → 400', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/abc');
  assert.strictEqual(res.status, 400);
});

test('GET /api/clienti/999 (inesistente) → 404', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/999');
  assert.strictEqual(res.status, 404);
});

test('consensi invertiti (S = non autorizzato) esposti dall\'API', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/47186');
  assert.deepStrictEqual(res.body.anagrafica.consensi, { marketing: false, telefonate: false, conservazione: true, cessione: true });
});

test('complaints: crea/elenca/risolvi (PATCH stato)/404/elimina', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/complaints').send({ testo: 'reclamo camera' });
  assert.strictEqual(c.status, 201);
  const id = c.body.complaint.id;
  const l = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l.body.complaints[0].testo, 'reclamo camera');
  assert.strictEqual(l.body.complaints[0].stato, 'aperto');
  const risolvi = await ag.patch(`/api/complaints/${id}`).send({ stato: 'risolto' });
  assert.strictEqual(risolvi.status, 200);
  const l2 = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l2.body.complaints[0].stato, 'risolto');
  const patch404 = await ag.patch('/api/complaints/9999').send({ stato: 'risolto' });
  assert.strictEqual(patch404.status, 404);
  const del = await ag.delete(`/api/complaints/${id}`);
  assert.strictEqual(del.status, 200);
});

test('complaint: periodo salvato in creazione e modificabile', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/complaints').send({ testo: 'rumore', periodo: 'ago 2025' });
  assert.strictEqual(c.status, 201);
  const l = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l.body.complaints[0].periodo, 'ago 2025');
  const patch = await ag.patch(`/api/complaints/${c.body.complaint.id}`).send({ periodo: 'set 2025' });
  assert.strictEqual(patch.status, 200);
  const l2 = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l2.body.complaints[0].periodo, 'set 2025');
});

test('complaint: stato non valido → 400', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/complaints').send({ testo: 'x' });
  const res = await ag.patch(`/api/complaints/${c.body.complaint.id}`).send({ stato: 'boh' });
  assert.strictEqual(res.status, 400);
});

test('intolleranze: crea, elenca, elimina', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/intolleranze').send({ testo: 'Celiachia' });
  assert.strictEqual(c.status, 201);
  const id = c.body.intolleranza.id;
  const l = await ag.get('/api/clienti/47186/intolleranze');
  assert.strictEqual(l.body.intolleranze[0].testo, 'Celiachia');
  const del = await ag.delete(`/api/intolleranze/${id}`);
  assert.strictEqual(del.status, 200);
  const del404 = await ag.delete('/api/intolleranze/9999');
  assert.strictEqual(del404.status, 404);
});

test('intolleranze: testo mancante → 400, senza login → 401', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const vuoto = await ag.post('/api/clienti/47186/intolleranze').send({ testo: '  ' });
  assert.strictEqual(vuoto.status, 400);
  const noauth = await request(app).get('/api/clienti/47186/intolleranze');
  assert.strictEqual(noauth.status, 401);
});

test('profilo/lingua: PUT salva e GET rilegge (upsert)', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const vuoto = await ag.get('/api/clienti/47186/profilo');
  assert.strictEqual(vuoto.body.profilo, null);
  const put = await ag.put('/api/clienti/47186/profilo').send({ lingua: 'EN' });
  assert.strictEqual(put.status, 200);
  const get = await ag.get('/api/clienti/47186/profilo');
  assert.strictEqual(get.body.profilo.lingua, 'EN');
});

test('note personali: PUT set salva e GET profilo rilegge; append accoda', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const set = await ag.put('/api/clienti/47186/note-personali').send({ testo: 'Direttore LUISS', mode: 'set' });
  assert.strictEqual(set.status, 200);
  const get = await ag.get('/api/clienti/47186/profilo');
  assert.strictEqual(get.body.profilo.note_personali, 'Direttore LUISS');
  const app2 = await ag.put('/api/clienti/47186/note-personali').send({ testo: 'Membro CdA Pirelli', mode: 'append' });
  assert.strictEqual(app2.status, 200);
  assert.match(app2.body.notePersonali, /Direttore LUISS/);
  assert.match(app2.body.notePersonali, /Membro CdA Pirelli/);
});

test('preferenze: crea/elenca/elimina + validazione liste chiuse', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const bad = await ag.post('/api/clienti/47186/preferenze').send({ reparto: 'Cucina', categoria: 'F&B', testo: 'x' });
  assert.strictEqual(bad.status, 400); // reparto non valido
  const c = await ag.post('/api/clienti/47186/preferenze').send({ reparto: 'F&B', categoria: 'F&B', testo: 'Amarone' });
  assert.strictEqual(c.status, 201);
  const l = await ag.get('/api/clienti/47186/preferenze');
  assert.strictEqual(l.body.preferenze[0].testo, 'Amarone');
  const del = await ag.delete(`/api/preferenze/${c.body.preferenza.id}`);
  assert.strictEqual(del.status, 200);
});

test('preferenze: ambito default nucleo, PATCH lo cambia, validazione ambito', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/preferenze').send({ reparto: 'F&B', categoria: 'F&B', testo: 'Coca Zero' });
  assert.strictEqual(c.status, 201);
  let l = await ag.get('/api/clienti/47186/preferenze');
  assert.strictEqual(l.body.preferenze[0].ambito, 'nucleo'); // default
  const upd = await ag.patch(`/api/preferenze/${c.body.preferenza.id}`).send({ ambito: 'personale' });
  assert.strictEqual(upd.status, 200);
  l = await ag.get('/api/clienti/47186/preferenze');
  assert.strictEqual(l.body.preferenze[0].ambito, 'personale');
  const bad = await ag.patch(`/api/preferenze/${c.body.preferenza.id}`).send({ ambito: 'globale' });
  assert.strictEqual(bad.status, 400); // ambito non valido
});

test('preferenze: le "nucleo" di un altro membro compaiono come condivise (sola lettura); le "personale" no', async () => {
  const app = await makeApp({ coOcc: [{ codCli: 55491, Cognome: 'BEBIE', Nome: 'ADRIAN', nShared: 1, totPrat: 2 }] });
  const ag = await agente(app);
  await ag.get('/api/clienti/47186/nucleo'); // auto-popola → lega 55491 nel nucleo di 47186
  await ag.post('/api/clienti/55491/preferenze').send({ reparto: 'Rooms', categoria: 'Camera', testo: 'Vista mare', ambito: 'nucleo' });
  await ag.post('/api/clienti/55491/preferenze').send({ reparto: 'F&B', categoria: 'Persona', testo: 'vegetariana', ambito: 'personale' });
  const l = await ag.get('/api/clienti/47186/preferenze');
  assert.strictEqual(l.body.preferenze.length, 0);           // 47186 non ha preferenze proprie
  assert.strictEqual(l.body.condivise.length, 1);            // solo la 'nucleo' di 55491
  assert.strictEqual(l.body.condivise[0].testo, 'Vista mare');
  assert.ok(l.body.condivise[0].proprietario);              // proprietario risolto (nome)
});

test('nucleo: crea/elenca/elimina + validazioni', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const badRel = await ag.post('/api/clienti/47186/nucleo').send({ tipoRelazione: 'Cugino', nome: 'X' });
  assert.strictEqual(badRel.status, 400); // relazione non valida
  const noName = await ag.post('/api/clienti/47186/nucleo').send({ tipoRelazione: 'Coniuge' });
  assert.strictEqual(noName.status, 400); // né nome né cognome
  const c = await ag.post('/api/clienti/47186/nucleo').send({ tipoRelazione: 'Coniuge', nome: 'Maria', nota: 'Celiaca' });
  assert.strictEqual(c.status, 201);
  const l = await ag.get('/api/clienti/47186/nucleo');
  assert.strictEqual(l.body.nucleo[0].nome, 'Maria');
  assert.strictEqual(l.body.nucleo[0].tipo_relazione, 'Coniuge');
  const del = await ag.delete(`/api/nucleo/${c.body.membro.id}`);
  assert.strictEqual(del.status, 200);
});

test('nucleo: auto-popolamento one-shot dai co-occupanti; badge auto; non si ripete', async () => {
  const app = await makeApp({ coOcc: [{ codCli: 900, Cognome: 'BEBIE', Nome: 'ADRIAN', nShared: 1, totPrat: 2 }] });
  const ag = await agente(app);
  const l = await ag.get('/api/clienti/47186/nucleo'); // prima apertura → auto-popola
  assert.strictEqual(l.body.nucleo.length, 1);
  assert.strictEqual(l.body.nucleo[0].nome, 'ADRIAN');
  assert.strictEqual(l.body.nucleo[0].tipo_relazione, 'Altro');
  assert.strictEqual(l.body.nucleo[0].pms_occupant_id, 900); // provenienza PMS → badge "auto"
  const l2 = await ag.get('/api/clienti/47186/nucleo'); // seconda apertura → NON raddoppia
  assert.strictEqual(l2.body.nucleo.length, 1);
});

test('nucleo: PATCH modifica la relazione (e 404 su id inesistente)', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/nucleo').send({ tipoRelazione: 'Altro', nome: 'Luca' });
  const upd = await ag.patch(`/api/nucleo/${c.body.membro.id}`).send({ tipoRelazione: 'Figlio-a', nota: 'celiaco' });
  assert.strictEqual(upd.status, 200);
  const l = await ag.get('/api/clienti/47186/nucleo');
  const m = l.body.nucleo.find((x) => x.id === c.body.membro.id);
  assert.strictEqual(m.tipo_relazione, 'Figlio-a');
  const bad = await ag.patch('/api/nucleo/999').send({ tipoRelazione: 'Coniuge' });
  assert.strictEqual(bad.status, 404);
});
