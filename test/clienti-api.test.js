const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { calcolaStatistiche } = require('../src/api/clienti');
const { hashPassword } = require('../src/auth/password');

test('calcolaStatistiche conta solo i soggiorni avvenuti', () => {
  // Decisione del 12/08 (D5): fuori le eliminate, i no-show e le prenotazioni che
  // devono ancora cominciare. Quelle future hanno importi a zero perché non c'è
  // ancora nulla di maturato: contarle gonfiava il numero dei soggiorni e abbassava
  // tutte le medie. Restano dentro "In casa" e "Partito", dove i soldi sono veri.
  const s = calcolaStatistiche([
    { stato: 'Concluso', dtarrivo: '2026-04-17', arrangiamento: 855, extra: 40 },
    { stato: 'Eliminata', dtarrivo: '2026-01-01', arrangiamento: 0, extra: 0 },
    { stato: 'No-show', dtarrivo: '2025-05-05', arrangiamento: 0, extra: 0 },
    { stato: 'Confermato', dtarrivo: '2026-07-07', arrangiamento: 0, extra: 0 },   // arriva oggi, non ha ancora speso
    { stato: 'Pianificata', dtarrivo: '2027-06-01', arrangiamento: 0, extra: 0 },  // estate prossima
    { stato: 'Partito', dtarrivo: '2026-05-02', arrangiamento: 600, extra: 100 },  // appena uscito: conta
  ]);
  assert.strictEqual(s.nSoggiorni, 2);
  assert.strictEqual(s.totaleSpeso, 1595);          // 895 + 700
  assert.strictEqual(s.primaVisita, '2026-04-17');  // non 2026-01-01 dell'eliminata
  assert.strictEqual(s.ultimaVisita, '2026-05-02'); // non la prenotazione futura
});

test('calcolaStatistiche: cumulativi LTV, notti, medie e ultima Source', () => {
  const s = calcolaStatistiche([
    { stato: 'Concluso', dtarrivo: '2026-04-17', notti: 2, arrangiamento: 800, extra: 200, source: 'OTA', mercato: 'LEISURE INDIVIDUALI' },
    { stato: 'Partito', dtarrivo: '2026-07-07', notti: 8, arrangiamento: 2000, extra: 0, source: 'DIRETTI', mercato: 'MEETING' },
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
  const nucleoScartati = new Set(); // 'pms_customer_id|pms_occupant_id'
  let profilo = null;
  const crmDb = {
    async query(text, params) {
      // le letture di lista interpolano gli id nel gruppo come IN (a, b, …)
      const ids = (() => { const m = String(text).match(/IN \(([\d,\s]+)\)/); return m ? m[1].split(',').map((s) => Number(s.trim())) : []; })();
      if (/FROM users WHERE username/.test(text)) return params.username === 'admin' ? [admin] : [];
      if (/SELECT[\s\S]*FROM users WHERE id/.test(text)) return Number(params.id) === admin.id ? [admin] : [];
      if (/INSERT INTO customer_nucleo_scartati/.test(text)) { nucleoScartati.add(`${params.pmsCustomerId}|${params.pmsOccupantId}`); return []; }
      if (/FROM customer_nucleo_scartati/.test(text)) {
        return [...nucleoScartati].map((k) => k.split('|').map(Number))
          .filter(([c]) => ids.includes(c)).map(([, o]) => ({ pms_occupant_id: o }));
      }
      if (/customer_merge/.test(text)) {
        if (/MERGE customer_merge/.test(text)) { const ex = merges.find((m) => m.pms_customer_id === params.memberId); if (ex) ex.canonical_id = params.principale; else merges.push({ pms_customer_id: params.memberId, canonical_id: params.principale }); return []; }
        if (/UPDATE customer_merge SET canonical_id/.test(text)) { merges.forEach((m) => { if (m.canonical_id === params.memberId) m.canonical_id = params.principale; }); return []; }
        if (/DELETE FROM customer_merge/.test(text)) { const i = merges.findIndex((m) => m.pms_customer_id === params.memberId); if (i >= 0) { const id = merges[i].pms_customer_id; merges.splice(i, 1); return [{ pms_customer_id: id }]; } return []; }
        // Ricerca: risoluzione dei principali in blocco, e dimensione dei gruppi.
        if (/GROUP BY canonical_id/.test(text)) {
          const per = new Map();
          merges.filter((m) => ids.includes(m.canonical_id)).forEach((m) => per.set(m.canonical_id, (per.get(m.canonical_id) || 0) + 1));
          return [...per].map(([canonical_id, n]) => ({ canonical_id, n }));
        }
        if (/WHERE pms_customer_id IN /.test(text)) {
          return merges.filter((m) => ids.includes(m.pms_customer_id)).map((m) => ({ pms_customer_id: m.pms_customer_id, canonical_id: m.canonical_id }));
        }
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
      if (/SELECT TOP 1 id, pms_customer_id, pms_occupant_id FROM customer_travel_party/.test(text)) {
        const n = nucleo.find((x) => x.id === params.id && ids.includes(x.pmsCustomerId));
        return n ? [{ id: n.id, pms_customer_id: n.pmsCustomerId, pms_occupant_id: n.pmsOccupantId != null ? n.pmsOccupantId : null }] : [];
      }
      if (/pms_occupant_id AS c/.test(text)) { const s = new Set(); nucleo.forEach((n) => { if (n.pmsCustomerId === params.codCli && n.pmsOccupantId != null) s.add(n.pmsOccupantId); if (n.pmsOccupantId === params.codCli) s.add(n.pmsCustomerId); }); return [...s].map((c) => ({ c })); }
      if (/FROM customer_travel_party/.test(text)) return nucleo.filter((n) => ids.includes(n.pmsCustomerId)).map((n) => ({ id: n.id, tipo_relazione: n.tipoRelazione, nome: n.nome, cognome: n.cognome, nota: n.nota, pms_occupant_id: n.pmsOccupantId != null ? n.pmsOccupantId : null, autore: 'admin', created_at: 'x', autore_user_id: 1, pms_customer_id: n.pmsCustomerId }));
      if (/INSERT INTO customer_complaints/.test(text)) { const n = { id: complaints.length + 1, stato: 'aperto', ...params }; complaints.push(n); return [{ id: n.id }]; }
      if (/UPDATE customer_complaints/.test(text)) { const n = complaints.find((x) => x.id === params.id); if (n) { if (params.testo != null) n.testo = params.testo; if (params.stato != null) n.stato = params.stato; if (params.periodo !== undefined) n.periodo = params.periodo; if (params.followUp !== undefined) n.follow_up = params.followUp; if (params.reparto !== undefined) n.reparto = params.reparto; if (params.categoria !== undefined) n.categoria = params.categoria; return [{ id: n.id }]; } return []; }
      if (/DELETE FROM customer_complaints/.test(text)) { const i = complaints.findIndex((x) => x.id === params.id); if (i >= 0) { const id = complaints[i].id; complaints.splice(i, 1); return [{ id }]; } return []; }
      if (/FROM customer_complaints/.test(text)) return complaints.filter((n) => ids.includes(n.pmsCustomerId)).map((n) => ({ id: n.id, testo: n.testo, stato: n.stato, periodo: n.periodo || null, reparto: n.reparto || null, categoria: n.categoria || null, follow_up: n.follow_up || null, autore: 'admin', created_at: 'x', resolved_at: null, autore_user_id: 1, pms_customer_id: n.pmsCustomerId }));
      return [];
    },
  };
  const pmsDb = {
    async query(text, params) {
      if (/a\.CodCli <> @codCli/.test(text)) return [{ codCli: 55491, Cognome: 'DI BARI', Nome: 'ANNA', dtNascita: '1964-10-17', codiceFiscale: '', match: 'anagrafica', nPrenotazioni: 0 }];
      if (/STRING_AGG/.test(text)) return [{ tipo: 'CF', cognome: 'DI BARI', nome: 'ANNA', chiave: 'X', n: 2, membri: '47186,55491' }];
      // Ricerca ospiti. La stessa query serve per testo e per codice: quella per
      // codice porta un IN, e il doppio deve restituire proprio quei codici,
      // altrimenti il principale letto al posto di una collegata non arriverebbe.
      // Ricerca ospiti. La stessa query serve per testo e per codice.
      // `ricerca` = cosa intercetta il TERMINE cercato; `catalogo` = cosa esiste
      // nel gestionale. Sono cose diverse: cercando un nome vecchio si trova solo
      // la collegata, ma il principale esiste lo stesso e va potuto leggere.
      if (/cameraInCasa/.test(text)) {
        const base = [{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANNA', email: 'a@b.it', Cellulare: '', Telefono: '080123', Citta: 'TRANI', cameraInCasa: null }];
        const m = String(text).match(/a\.CodCli IN \(([\d,\s]+)\)/);
        if (m) {
          const voluti = m[1].split(',').map((s) => Number(s.trim()));
          return (opts.catalogo || opts.ricerca || base).filter((r) => voluti.includes(r.CodCli));
        }
        return opts.ricerca || base;
      }
      if (/AS nPrenotazioni[\s\S]*a\.CodCli IN/.test(text)) return [
        { codCli: 47186, Cognome: 'DI BARI', Nome: 'ANNA', dtNascita: '1964-10-17', codiceFiscale: 'X', Citta: 'TRANI', CodNaz: 'I', email: 'a@b.it', Telefono: '080', Cellulare: '', CodVip: '', DesVip: null, nPrenotazioni: 5 },
        { codCli: 55491, Cognome: 'DI BARI', Nome: 'ANNA', dtNascita: '1964-10-17', codiceFiscale: 'Y', Citta: 'TRANI', CodNaz: 'I', email: 'a@b.it', Telefono: '080', Cellulare: '', CodVip: '', DesVip: null, nPrenotazioni: 2 },
      ];
      if (/FROM Anagra a\b/.test(text)) { if (params && params.codCli === 999) return []; return [{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANNA', Telefono: '', Cellulare: '', email: 'a@b.it', Citta: 'TRANI', CodNaz: 'I', dtNascita: '1964-10-17', CodFis: 'X', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'S', Privacy2: 'S', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' }]; }
      if (/StorAddebitiComanda/.test(text)) return [{ codArt: 'COCAZ', nome: 'COCA COLA ZERO', fb: 'B', grp: 'BEV.BI', volte: 5, qta: 5, eur: 30 }];
      if (/codgrpmerCAT LIKE 'SPA/.test(text)) return [{ nome: 'SERENITY', grp: 'SPA', volte: 12, qta: 12, eur: 1200 }];
      // co-occupanti del nucleo: servono all'auto-popolamento e, da lì in poi, a
      // dire da quanto tempo quelle persone viaggiano insieme
      if (/AS nShared/.test(text)) {
        if (opts.coOccRotto) throw new Error('co-occupanti non disponibili');
        return opts.coOcc || [];
      }
      // soggiorni (arrangiamento/extra da camereJson)
      // Due soggiorni avvenuti più una prenotazione futura: quest'ultima ha importi
      // a zero, come nella realtà, e dal 12/08 non conta nelle statistiche (D5).
      return [{ codpratica: 1, dtarrivo: '2026-04-17', dtpartenza: '2026-04-19', notti: 2, camere: '109', stato: 'Concluso', source: 'OTA', mercato: 'LEISURE INDIVIDUALI', arrangiamento: 855, extra: 0 },
              { codpratica: 2, dtarrivo: '2026-07-07', dtpartenza: '2026-07-19', notti: 12, camere: '102', stato: 'Partito', source: 'DIRETTI', mercato: 'MEETING', arrangiamento: 2300, extra: 0 },
              { codpratica: 3, dtarrivo: '2027-06-01', dtpartenza: '2027-06-08', notti: 7, camere: '', stato: 'Pianificata', source: 'DIRETTI', mercato: 'LEISURE INDIVIDUALI', arrangiamento: 0, extra: 0 }];
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
  // La prenotazione futura resta VISIBILE nello storico: non conta nei numeri, ma
  // sapere che l'ospite torna a giugno serve a chi lo accoglie.
  assert.strictEqual(res.body.soggiorni.length, 3);
  assert.ok(res.body.soggiorni.some((s) => s.stato === 'Pianificata'));
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
  assert.strictEqual(res.body.gestiti, 0);
});

// Ciclo di vita della coda: possibile duplicato → associazione → esce dalla lista;
// se l'associazione viene sciolta il gruppo torna da solo fra quelli da gestire.
test('GET /api/duplicati: il gruppo associato esce dalla coda e torna dopo lo scollegamento', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  assert.strictEqual((await ag.get('/api/duplicati')).body.gruppi.length, 1);

  const merge = await ag.post('/api/clienti/47186/merge').send({ memberId: 55491, canonicalId: 47186 });
  assert.strictEqual(merge.status, 201);
  const dopo = await ag.get('/api/duplicati');
  assert.deepStrictEqual(dopo.body.gruppi, []);   // fuori dalla coda
  assert.strictEqual(dopo.body.gestiti, 1);       // ma dichiarato, non sparito

  assert.strictEqual((await ag.delete('/api/merge/55491')).status, 200);
  const riaperto = await ag.get('/api/duplicati');
  assert.strictEqual(riaperto.body.gruppi.length, 1); // rilevato di nuovo
  assert.strictEqual(riaperto.body.gestiti, 0);
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
  // Decisione del 12/08 (D13): le scritture vanno sul PRINCIPALE, non sul codice
  // che si sta guardando. Quindi scollegare il duplicato non porta via niente:
  // l'allergia era stata scritta su 47186 fin dall'inizio, anche se in quel momento
  // si stava guardando la scheda di 55491.
  const del = await ag.delete('/api/merge/55491');
  assert.strictEqual(del.status, 200);
  res = await ag.get('/api/clienti/47186/intolleranze');
  assert.strictEqual(res.body.intolleranze.length, 1, 'lo scollegamento non deve portare via il dato');
  // E sul duplicato scollegato non resta niente: non ci è mai stato scritto nulla.
  res = await ag.get('/api/clienti/55491/intolleranze');
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

test('POST briefing → credito esaurito: 503 con il motivo, non un 500 muto', async () => {
  // Successo dal vivo: a credito finito la card diceva "Errore durante la
  // generazione". Qui si finge la stessa eccezione dell'SDK e si verifica che il
  // motivo arrivi fino alla risposta.
  process.env.ANTHROPIC_API_KEY = 'chiave-finta-per-il-test';
  const modulo = require('../src/ai/client');
  modulo._reset();
  const ai = modulo.getAiClient();
  assert.ok(ai, 'con la chiave impostata il client deve esistere');
  ai.client = { messages: { create: async () => {
    throw Object.assign(new Error('400'), {
      status: 400,
      error: { error: { message: 'Your credit balance is too low to access the Anthropic API.' } },
    });
  } } };
  try {
    const app = await makeApp();
    const ag = await agente(app);
    const res = await ag.post('/api/clienti/47186/briefing');
    assert.strictEqual(res.status, 503);
    assert.match(res.body.error, /Credito AI esaurito/);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    modulo._reset();
  }
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
  const c = await ag.post('/api/clienti/47186/complaints').send({ testo: 'reclamo camera', reparto: 'Rooms', categoria: 'Pulizia' });
  assert.strictEqual(c.status, 201);
  const id = c.body.complaint.id;
  const l = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l.body.complaints[0].testo, 'reclamo camera');
  assert.strictEqual(l.body.complaints[0].stato, 'aperto');
  const risolvi = await ag.patch(`/api/clienti/47186/complaints/${id}`).send({ stato: 'risolto', followUp: 'Cambio camera effettuato' });
  assert.strictEqual(risolvi.status, 200);
  const l2 = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l2.body.complaints[0].stato, 'risolto');
  const patch404 = await ag.patch('/api/clienti/47186/complaints/9999').send({ stato: 'risolto', followUp: 'x' });
  assert.strictEqual(patch404.status, 404);
  const del = await ag.delete(`/api/clienti/47186/complaints/${id}`);
  assert.strictEqual(del.status, 200);
});

test('complaint: risolvere senza follow-up → 400 e il complaint resta aperto', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/complaints').send({ testo: 'doccia fredda', reparto: 'Rooms', categoria: 'Manutenzione' });
  const id = c.body.complaint.id;
  for (const corpo of [{ stato: 'risolto' }, { stato: 'risolto', followUp: '   ' }]) {
    const res = await ag.patch(`/api/clienti/47186/complaints/${id}`).send(corpo);
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Follow-up/);
  }
  const l = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l.body.complaints[0].stato, 'aperto'); // nessuna risoluzione a metà
});

test('complaint: il follow-up si salva risolvendo, si rilegge e sopravvive alla riapertura', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/complaints').send({ testo: 'rumore', periodo: 'ago 2025', reparto: 'Rooms', categoria: 'Rumore' });
  const id = c.body.complaint.id;
  await ag.patch(`/api/clienti/47186/complaints/${id}`).send({ stato: 'risolto', followUp: 'Omaggio SPA offerto' });
  const l = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l.body.complaints[0].follow_up, 'Omaggio SPA offerto');
  assert.strictEqual(l.body.complaints[0].periodo, 'ago 2025'); // il resto non si perde
  // Riaperto: resta scritto cosa era già stato fatto.
  assert.strictEqual((await ag.patch(`/api/clienti/47186/complaints/${id}`).send({ stato: 'aperto' })).status, 200);
  const l2 = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l2.body.complaints[0].stato, 'aperto');
  assert.strictEqual(l2.body.complaints[0].follow_up, 'Omaggio SPA offerto');
});

test('complaint: il follow-up si corregge da solo, e troppo lungo → 400', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/complaints').send({ testo: 'x', reparto: 'F&B', categoria: 'Altro' });
  const id = c.body.complaint.id;
  await ag.patch(`/api/clienti/47186/complaints/${id}`).send({ stato: 'risolto', followUp: 'Cambio camra' });
  assert.strictEqual((await ag.patch(`/api/clienti/47186/complaints/${id}`).send({ followUp: 'Cambio camera' })).status, 200);
  const l = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l.body.complaints[0].follow_up, 'Cambio camera');
  assert.strictEqual(l.body.complaints[0].stato, 'risolto'); // correggere non riapre
  const lungo = await ag.patch(`/api/clienti/47186/complaints/${id}`).send({ followUp: 'x'.repeat(501) });
  assert.strictEqual(lungo.status, 400);
});

test('complaint: periodo salvato in creazione e modificabile', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/complaints').send({ testo: 'rumore', periodo: 'ago 2025', reparto: 'Rooms', categoria: 'Rumore' });
  assert.strictEqual(c.status, 201);
  const l = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l.body.complaints[0].periodo, 'ago 2025');
  const patch = await ag.patch(`/api/clienti/47186/complaints/${c.body.complaint.id}`).send({ periodo: 'set 2025' });
  assert.strictEqual(patch.status, 200);
  const l2 = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l2.body.complaints[0].periodo, 'set 2025');
});

test('complaint: reparto e categoria obbligatori alla creazione, e liste chiuse', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const senza = await ag.post('/api/clienti/47186/complaints').send({ testo: 'rumore' });
  assert.strictEqual(senza.status, 400);
  assert.match(senza.body.error, /Reparto/);
  const repartoInventato = await ag.post('/api/clienti/47186/complaints').send({ testo: 'x', reparto: 'Piscina', categoria: 'Pulizia' });
  assert.strictEqual(repartoInventato.status, 400);
  // Le categorie delle PREFERENZE non valgono per i complaint: liste distinte.
  const categoriaPref = await ag.post('/api/clienti/47186/complaints').send({ testo: 'x', reparto: 'Rooms', categoria: 'Occasioni' });
  assert.strictEqual(categoriaPref.status, 400);
  assert.match(categoriaPref.body.error, /Categoria/);
});

test('complaint: classificazione salvata, rileggibile e correggibile', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/complaints').send({ testo: 'doccia fredda', reparto: 'Rooms', categoria: 'Manutenzione' });
  assert.strictEqual(c.status, 201);
  const l = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l.body.complaints[0].reparto, 'Rooms');
  assert.strictEqual(l.body.complaints[0].categoria, 'Manutenzione');
  // Riclassificazione (serve ai reclami vecchi, che nascono senza)
  const patch = await ag.patch(`/api/clienti/47186/complaints/${c.body.complaint.id}`).send({ reparto: 'F&B', categoria: 'Servizio' });
  assert.strictEqual(patch.status, 200);
  const l2 = await ag.get('/api/clienti/47186/complaints');
  assert.strictEqual(l2.body.complaints[0].reparto, 'F&B');
  assert.strictEqual(l2.body.complaints[0].categoria, 'Servizio');
  assert.strictEqual(l2.body.complaints[0].testo, 'doccia fredda'); // il resto non si tocca
  const invalido = await ag.patch(`/api/clienti/47186/complaints/${c.body.complaint.id}`).send({ reparto: 'Portineria' });
  assert.strictEqual(invalido.status, 400);
});

test('complaint: stato non valido → 400', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/complaints').send({ testo: 'x', reparto: 'F&B', categoria: 'Altro' });
  const res = await ag.patch(`/api/clienti/47186/complaints/${c.body.complaint.id}`).send({ stato: 'boh' });
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
  const del = await ag.delete(`/api/clienti/47186/intolleranze/${id}`);
  assert.strictEqual(del.status, 200);
  const del404 = await ag.delete('/api/clienti/47186/intolleranze/9999');
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

test('data di nascita: esposta dal PMS, non modificabile dal CRM', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/47186');
  assert.strictEqual(res.body.anagrafica.dtNascita, '1964-10-17'); // dato del gestionale
  // Una sola fonte: nessun override CRM, quindi nessun campo "fonte" da disambiguare.
  assert.strictEqual(res.body.anagrafica.dtNascitaFonte, undefined);
  // La rotta di scrittura non esiste più: si corregge nel PMS.
  const put = await ag.put('/api/clienti/47186/data-nascita').send({ dataNascita: '1965-01-02' });
  assert.strictEqual(put.status, 404);
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
  const del = await ag.delete(`/api/clienti/47186/preferenze/${c.body.preferenza.id}`);
  assert.strictEqual(del.status, 200);
});

test('preferenze: ambito default nucleo, PATCH lo cambia, validazione ambito', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/preferenze').send({ reparto: 'F&B', categoria: 'F&B', testo: 'Coca Zero' });
  assert.strictEqual(c.status, 201);
  let l = await ag.get('/api/clienti/47186/preferenze');
  assert.strictEqual(l.body.preferenze[0].ambito, 'nucleo'); // default
  const upd = await ag.patch(`/api/clienti/47186/preferenze/${c.body.preferenza.id}`).send({ ambito: 'personale' });
  assert.strictEqual(upd.status, 200);
  l = await ag.get('/api/clienti/47186/preferenze');
  assert.strictEqual(l.body.preferenze[0].ambito, 'personale');
  const bad = await ag.patch(`/api/clienti/47186/preferenze/${c.body.preferenza.id}`).send({ ambito: 'globale' });
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
  const del = await ag.delete(`/api/clienti/47186/nucleo/${c.body.membro.id}`);
  assert.strictEqual(del.status, 200);
});

test('nucleo: precompilazione dai co-occupanti; badge auto; non raddoppia', async () => {
  const app = await makeApp({ coOcc: [{ codCli: 900, Cognome: 'BEBIE', Nome: 'ADRIAN', nShared: 1, totPrat: 2 }] });
  const ag = await agente(app);
  const l = await ag.get('/api/clienti/47186/nucleo'); // prima apertura → precompila
  assert.strictEqual(l.body.nucleo.length, 1);
  assert.strictEqual(l.body.nucleo[0].nome, 'ADRIAN');
  assert.strictEqual(l.body.nucleo[0].tipo_relazione, 'Altro');
  assert.strictEqual(l.body.nucleo[0].pms_occupant_id, 900); // provenienza PMS → badge "auto"
  const l2 = await ag.get('/api/clienti/47186/nucleo'); // seconda apertura → NON raddoppia
  assert.strictEqual(l2.body.nucleo.length, 1);
});

test('nucleo: chi arriva dopo la prima apertura entra comunque', async () => {
  // Il caso vero del 14/08: la scheda 81866 è stata aperta il 07/08 preparando
  // l'arrivo, e i tre accompagnatori registrati al check-in poche ore dopo non
  // vi erano mai entrati, perché il controllo girava una volta sola.
  const app = await makeApp({ coOcc: [{ codCli: 900, Cognome: 'GINSBERG', Nome: 'NICOLA', nShared: 1, totPrat: 2 }] });
  const ag = await agente(app);
  const prima = await ag.get('/api/clienti/47186/nucleo');
  assert.strictEqual(prima.body.nucleo.length, 1);
  // Il check-in registra gli altri due occupanti: da qui in poi il gestionale
  // ne restituisce tre.
  const app2 = await makeApp({ coOcc: [
    { codCli: 900, Cognome: 'GINSBERG', Nome: 'NICOLA', nShared: 1, totPrat: 2 },
    { codCli: 901, Cognome: 'KEIDAN', Nome: 'ELIZABETH', nShared: 1, totPrat: 2 },
    { codCli: 902, Cognome: 'CONTRERAS', Nome: 'MARIA ELENA', nShared: 1, totPrat: 2 },
  ] });
  const ag2 = await agente(app2);
  await ag2.get('/api/clienti/47186/nucleo');
  const dopo = await ag2.get('/api/clienti/47186/nucleo');
  assert.strictEqual(dopo.body.nucleo.length, 3);
  assert.deepStrictEqual(dopo.body.nucleo.map((m) => m.cognome).sort(), ['CONTRERAS', 'GINSBERG', 'KEIDAN']);
});

test('nucleo: chi è stato tolto a mano non torna alla riapertura', async () => {
  // È il prezzo del controllo continuo: senza memoria delle esclusioni,
  // correggere il nucleo sarebbe una fatica che si disfa da sola.
  const app = await makeApp({ coOcc: [
    { codCli: 900, Cognome: 'BEBIE', Nome: 'ADRIAN', nShared: 1, totPrat: 2 },
    { codCli: 901, Cognome: 'GYGAX', Nome: 'MARKUS', nShared: 1, totPrat: 2 },
  ] });
  const ag = await agente(app);
  const l = await ag.get('/api/clienti/47186/nucleo');
  assert.strictEqual(l.body.nucleo.length, 2);
  const gygax = l.body.nucleo.find((m) => m.cognome === 'GYGAX');
  assert.strictEqual((await ag.delete(`/api/clienti/47186/nucleo/${gygax.id}`)).status, 200);
  const dopo = await ag.get('/api/clienti/47186/nucleo'); // riapertura: non deve tornare
  assert.deepStrictEqual(dopo.body.nucleo.map((m) => m.cognome), ['BEBIE']);
});

test('nucleo: le correzioni a mano non vengono sovrascritte dal controllo', async () => {
  // Chi è già in elenco non si tocca: relazione, nome e nota restano quelli
  // scritti da chi accoglie, anche se il gestionale continua a proporlo.
  const app = await makeApp({ coOcc: [{ codCli: 900, Cognome: 'BEBIE', Nome: 'ADRIAN', nShared: 1, totPrat: 2 }] });
  const ag = await agente(app);
  const l = await ag.get('/api/clienti/47186/nucleo');
  const id = l.body.nucleo[0].id;
  await ag.patch(`/api/clienti/47186/nucleo/${id}`).send({ tipoRelazione: 'Figlio-a', nota: 'Celiaco' });
  const dopo = await ag.get('/api/clienti/47186/nucleo');
  assert.strictEqual(dopo.body.nucleo.length, 1);
  assert.strictEqual(dopo.body.nucleo[0].tipo_relazione, 'Figlio-a');
  assert.strictEqual(dopo.body.nucleo[0].nota, 'Celiaco');
});

test('nucleo: togliere un accompagnatore scritto a mano non annota nessuna esclusione', async () => {
  // Non è agganciato al gestionale: non può tornare da solo, e ricordarselo
  // sarebbe una riga inutile in una tabella che deve restare piccola.
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/nucleo').send({ tipoRelazione: 'Amico-a', nome: 'Luca' });
  assert.strictEqual((await ag.delete(`/api/clienti/47186/nucleo/${c.body.membro.id}`)).status, 200);
  const l = await ag.get('/api/clienti/47186/nucleo');
  assert.strictEqual(l.body.nucleo.length, 0);
});

test('nucleo: ogni riga dice quante volte e quando hanno soggiornato insieme', async () => {
  // Sui dati veri il 94% delle righe porta la relazione predefinita "Altro":
  // l'etichetta da sola non distingue un accompagnatore di ieri da uno del 2016.
  const app = await makeApp({ coOcc: [{ codCli: 900, Cognome: 'DESIATI', Nome: 'RAFFAELLA', nShared: 2, ultima: '2016-06-03', totPrat: 2 }] });
  const ag = await agente(app);
  const l = await ag.get('/api/clienti/47186/nucleo');
  assert.strictEqual(l.body.nucleo[0].insieme, 2);
  assert.strictEqual(l.body.nucleo[0].ultimaInsieme, '2016-06-03');
});

test('nucleo: un accompagnatore scritto a mano non porta date inventate', async () => {
  // Non è agganciato a nessun codice del gestionale: di lui non risultano
  // soggiorni, e uno zero al posto del silenzio sembrerebbe un giudizio.
  const app = await makeApp();
  const ag = await agente(app);
  await ag.post('/api/clienti/47186/nucleo').send({ tipoRelazione: 'Amico-a', nome: 'Luca' });
  const l = await ag.get('/api/clienti/47186/nucleo');
  const luca = l.body.nucleo.find((m) => m.nome === 'Luca');
  assert.strictEqual(luca.insieme, null);
  assert.strictEqual(luca.ultimaInsieme, null);
});

test('nucleo: se il gestionale non risponde, la sezione si apre lo stesso', async () => {
  // Le date sono un contorno: perdere l'intero nucleo per non poterle calcolare
  // sarebbe sproporzionato. Senza co-occupanti non si auto-popola nemmeno, ma
  // ciò che è già scritto nel CRM si continua a leggere.
  const app = await makeApp({ coOccRotto: true });
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/nucleo').send({ tipoRelazione: 'Coniuge', nome: 'Maria' });
  assert.strictEqual(c.status, 201);
  const l = await ag.get('/api/clienti/47186/nucleo');
  assert.strictEqual(l.status, 200);
  assert.strictEqual(l.body.nucleo.length, 1);
  assert.strictEqual(l.body.nucleo[0].insieme, null);
});

test('nucleo: PATCH modifica la relazione (e 404 su id inesistente)', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/nucleo').send({ tipoRelazione: 'Altro', nome: 'Luca' });
  const upd = await ag.patch(`/api/clienti/47186/nucleo/${c.body.membro.id}`).send({ tipoRelazione: 'Figlio-a', nota: 'celiaco' });
  assert.strictEqual(upd.status, 200);
  const l = await ag.get('/api/clienti/47186/nucleo');
  const m = l.body.nucleo.find((x) => x.id === c.body.membro.id);
  assert.strictEqual(m.tipo_relazione, 'Figlio-a');
  const bad = await ag.patch('/api/clienti/47186/nucleo/999').send({ tipoRelazione: 'Coniuge' });
  assert.strictEqual(bad.status, 404);
});

// --- Ricerca: un ospite, un risultato -----------------------------------------

const DUE_ANAGRAFICHE = [
  { CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANNA', email: 'a@b.it', Cellulare: '', Telefono: '080123', Citta: 'TRANI', cameraInCasa: null },
  { CodCli: 55491, Cognome: 'DI BARI', Nome: 'ANNA MARIA', email: 'a@b.it', Cellulare: '', Telefono: '', Citta: 'TRANI', cameraInCasa: null },
];

test('ricerca: due anagrafiche fuse compaiono come un ospite solo', async () => {
  const app = await makeApp({ ricerca: DUE_ANAGRAFICHE });
  const ag = await agente(app);
  const prima = await ag.get('/api/clienti?q=bari');
  assert.strictEqual(prima.body.risultati.length, 2, 'prima della fusione sono due profili distinti');

  assert.strictEqual((await ag.post('/api/clienti/47186/merge').send({ memberId: 55491, canonicalId: 47186 })).status, 201);

  const dopo = await ag.get('/api/clienti?q=bari');
  assert.strictEqual(dopo.body.risultati.length, 1);
  assert.strictEqual(dopo.body.risultati[0].codCli, 47186, 'resta il principale');
  assert.strictEqual(dopo.body.risultati[0].collegate, 1, 'e dichiara quante ne ha dietro');
});

test('ricerca: il nome vecchio porta al profilo principale, non a un vicolo cieco', async () => {
  // Chi cerca "ANNA MARIA" intercetta solo la collegata. Scartarla e basta
  // farebbe dire al CRM che quell'ospite non esiste.
  const app = await makeApp({ ricerca: DUE_ANAGRAFICHE });
  const ag = await agente(app);
  await ag.post('/api/clienti/47186/merge').send({ memberId: 55491, canonicalId: 47186 });

  // il doppio del PMS filtra per token: qui simulo la ricerca che trova la sola collegata
  const soloCollegata = await makeApp({ ricerca: [DUE_ANAGRAFICHE[1]], catalogo: DUE_ANAGRAFICHE });
  const ag2 = await agente(soloCollegata);
  assert.strictEqual((await ag2.post('/api/clienti/47186/merge').send({ memberId: 55491, canonicalId: 47186 })).status, 201);
  const res = await ag2.get('/api/clienti?q=anna');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.risultati.length, 1);
  assert.strictEqual(res.body.risultati[0].codCli, 47186, 'al suo posto compare il principale');
  assert.strictEqual(res.body.risultati[0].collegate, 1);
});

test('ricerca: sciolta la fusione, tornano due profili', async () => {
  // L operazione resta reversibile: scollegando, la ricerca torna come prima.
  const app = await makeApp({ ricerca: DUE_ANAGRAFICHE });
  const ag = await agente(app);
  await ag.post('/api/clienti/47186/merge').send({ memberId: 55491, canonicalId: 47186 });
  assert.strictEqual((await ag.get('/api/clienti?q=bari')).body.risultati.length, 1);
  assert.strictEqual((await ag.delete('/api/merge/55491')).status, 200);
  assert.strictEqual((await ag.get('/api/clienti?q=bari')).body.risultati.length, 2);
});

test('ricerca: chi non è fuso non porta la pastiglia delle collegate', async () => {
  const app = await makeApp({ ricerca: DUE_ANAGRAFICHE });
  const ag = await agente(app);
  const res = await ag.get('/api/clienti?q=bari');
  assert.deepStrictEqual(res.body.risultati.map((r) => r.collegate), [0, 0]);
});
