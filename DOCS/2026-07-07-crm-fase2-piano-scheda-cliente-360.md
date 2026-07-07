# CRM Direct Holiday — Scheda cliente 360° — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere una scheda cliente 360° (anagrafica, statistiche, storico soggiorni, note CRM, consensi), raggiungibile cliccando un ospite in Arrivi/In casa e da una ricerca globale in topbar.

**Architecture:** Nuovo livello dati `src/pms/clienti.js` (SOLO SELECT sul PMS: anagrafica + storico soggiorni Prenota∪StorPrenota) e `src/crm/note.js` (CRUD su `customer_notes`, DB CRM read/write), esposti da `src/api/clienti.js`. Frontend: nuova pagina `#cliente/<CodCli>` + ricerca in topbar + link dal nome ospite.

**Tech Stack:** Node 20, Express 5, `mssql`, `bcryptjs`, test `node:test` + `supertest`. Frontend vanilla, `<dialog>`.

## Riferimenti

- SPEC: `DOCS/2026-07-07-crm-fase2-scheda-cliente-360-specs.md`
- Fonti dati verificate su dati reali (cliente DI BARI CodCli 47186: 14 soggiorni). Camera/importo correnti da `Alberg`/`AlbergDay`/`TipoPre`; storici da `StorAlberg`/`StorAlbergDay`. Ospite = `codclinterm` (vedi memoria `pms-arrivi-data-sources`).

## Global Constraints

- Node.js 20, JavaScript CommonJS (`require`), no TypeScript.
- **PMS read-only**: `pms/` esegue solo SELECT. Le note CRM stanno nel DB CRM (`customer_notes`).
- Tutte le risposte API in JSON; messaggi d'errore in italiano.
- Ogni query parametrizzata.
- Rotte protette da `requireAuth`. Note modificabili/eliminabili da chiunque autenticato.
- Cliente identificato da `Anagra.CodCli`; ospite di una prenotazione = `codclinterm`.
- Frontend HTML5/CSS/vanilla, nessun framework; stringhe PMS/utente escapate prima di `innerHTML` (helper `esc` esistente).

## File Structure

```
src/pms/clienti.js          (nuovo)  cercaClienti, getCliente, getSoggiorniCliente
src/crm/note.js             (nuovo)  listNote, createNota, updateNota, deleteNota
src/api/clienti.js          (nuovo)  createClientiRouter(pmsDb, crmDb)
src/app.js                  (mod)    monta il router clienti
src/pms/prenotazioni.js     (mod)    espone codCliente (=codclinterm) nelle righe arrivi/in casa
web/index.html              (mod)    vista #view-cliente, ricerca topbar
web/app.js                  (mod)    routing #cliente/<id>, pagina cliente, ricerca, link ospite
web/styles.css              (mod)    stile scheda cliente, ricerca topbar
test/pms-clienti.test.js    (nuovo)
test/crm-note.test.js       (nuovo)
test/clienti-api.test.js    (nuovo)
```

---

### Task 1: Livello dati PMS clienti — `src/pms/clienti.js`

**Files:**
- Create: `src/pms/clienti.js`, `test/pms-clienti.test.js`

**Interfaces:**
- Consumes: `pmsDb` con `query(text, params) -> Promise<rows[]>`.
- Produces:
  - `cercaClienti(pmsDb, termine) -> Promise<Array<{ codCli, nominativo, email, cellulare, citta }>>`
  - `getCliente(pmsDb, codCli) -> Promise<anagrafica|null>` — `{ codCli, cognome, nome, nominativo, telefono, cellulare, email, citta, nazione, dtNascita, codiceFiscale, vip:boolean, note, consensi:{ generale, conservazione, cessione } }`
  - `getSoggiorniCliente(pmsDb, codCli) -> Promise<Array<{ codpratica, dtarrivo, dtpartenza, notti, camere, importo, stato }>>` (ordine dtarrivo desc)

- [ ] **Step 1: Scrivi il test con `pmsDb` finto**

`test/pms-clienti.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { cercaClienti, getCliente, getSoggiorniCliente } = require('../src/pms/clienti');

function fakePms(recordset) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('cercaClienti passa il termine come LIKE e mappa', async () => {
  const pms = fakePms([{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANTONELLA', email: 'a@b.it', Cellulare: '', Citta: 'TRANI' }]);
  const [r] = await cercaClienti(pms, 'bari');
  assert.strictEqual(r.codCli, 47186);
  assert.strictEqual(r.nominativo, 'DI BARI ANTONELLA');
  assert.strictEqual(r.citta, 'TRANI');
  assert.strictEqual(pms.calls[0].params.q, '%bari%');
});

test('getCliente mappa anagrafica e consensi', async () => {
  const pms = fakePms([{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANTONELLA', Telefono: '', Cellulare: '333',
    email: 'a@b.it', Citta: 'TRANI', CodNaz: 'I', dtNascita: '1964-10-17', CodFis: 'XXX', CodVip: '',
    Annotazioni: 'nota pms', Privacy: 'S', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' }]);
  const a = await getCliente(pms, 47186);
  assert.strictEqual(a.nominativo, 'DI BARI ANTONELLA');
  assert.strictEqual(a.nazione, 'I');
  assert.strictEqual(a.vip, false);
  assert.deepStrictEqual(a.consensi, { generale: true, conservazione: false, cessione: false });
});

test('getCliente restituisce null se non trovato', async () => {
  const pms = fakePms([]);
  assert.strictEqual(await getCliente(pms, 1), null);
});

test('getSoggiorniCliente mappa le righe', async () => {
  const pms = fakePms([{ codpratica: 60397, dtarrivo: '2026-04-17', dtpartenza: '2026-04-19', notti: 2,
    camere: '109', importo: 855, stato: 'Concluso' }]);
  const [s] = await getSoggiorniCliente(pms, 47186);
  assert.strictEqual(s.codpratica, 60397);
  assert.strictEqual(s.camere, '109');
  assert.strictEqual(s.importo, 855);
  assert.strictEqual(s.stato, 'Concluso');
  assert.strictEqual(pms.calls[0].params.codCli, 47186);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test test/pms-clienti.test.js`
Expected: FAIL (`Cannot find module '../src/pms/clienti'`).

- [ ] **Step 3: Implementa `src/pms/clienti.js`**

```js
const SQL_CERCA = `
SELECT TOP 20 CodCli, Cognome, Nome, email, Cellulare, Citta
FROM Anagra
WHERE Cognome LIKE @q OR Nome LIKE @q OR email LIKE @q OR Cellulare LIKE @q
   OR (ISNULL(Cognome,'') + ' ' + ISNULL(Nome,'')) LIKE @q
ORDER BY Cognome, Nome`;

const SQL_CLIENTE = `
SELECT CodCli, Cognome, Nome, Telefono, Cellulare, email, Citta, CodNaz,
       CONVERT(varchar(10), dtNascita, 23) AS dtNascita, CodFis, CodVip, Annotazioni,
       Privacy, PrivacyConservaDati, PrivacyCessioneDati
FROM Anagra WHERE CodCli = @codCli`;

// Storico soggiorni: correnti (Prenota + Alberg/TipoPre) UNION storici (StorPrenota + StorAlberg).
const SQL_SOGGIORNI = `
SELECT t.codpratica,
  CONVERT(varchar(10), t.dtarrivo, 23) AS dtarrivo,
  CONVERT(varchar(10), t.dtpartenza, 23) AS dtpartenza,
  DATEDIFF(day, t.dtarrivo, t.dtpartenza) AS notti,
  t.camere, t.importo, t.stato
FROM (
  SELECT p.codpratica, p.dtarrivo, p.dtpartenza,
    COALESCE(
      (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb
         WHERE al.codpratica = p.codpratica AND ISNULL(ad.codcam,'') <> '' FOR XML PATH('')), 1, 2, '')),
      (SELECT STUFF((SELECT DISTINCT ', ' + tp.codcam FROM TipoPre tp
         WHERE tp.codpratica = p.codpratica AND ISNULL(tp.codcam,'') <> '' FOR XML PATH('')), 1, 2, ''))
    ) AS camere,
    COALESCE(
      (SELECT SUM(al.impoeur) FROM Alberg al WHERE al.codpratica = p.codpratica),
      (SELECT SUM(tp.ImpoEur) FROM TipoPre tp WHERE tp.codpratica = p.codpratica)
    ) AS importo,
    CASE WHEN p.flgincasa = 'S' THEN 'In casa' WHEN p.flgincasa = 'P' THEN 'Partito' ELSE 'Confermato' END AS stato
  FROM Prenota p
  WHERE p.codclinterm = @codCli AND p.DataEliminazione IS NULL
  UNION ALL
  SELECT sp.codpratica, sp.dtarrivo, sp.dtpartenza,
    (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam FROM StorAlberg al JOIN StorAlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = sp.codpratica AND ISNULL(ad.codcam,'') <> '' FOR XML PATH('')), 1, 2, '')) AS camere,
    (SELECT SUM(al.impoeur) FROM StorAlberg al WHERE al.codpratica = sp.codpratica) AS importo,
    'Concluso' AS stato
  FROM StorPrenota sp
  WHERE sp.codclinterm = @codCli
) t
ORDER BY t.dtarrivo DESC`;

function pulisci(v) {
  const s = (v == null ? '' : String(v)).trim();
  return s === '' ? null : s;
}

function nominativo(cognome, nome) {
  return [cognome, nome].map((s) => (s == null ? '' : String(s)).trim()).filter(Boolean).join(' ') || null;
}

async function cercaClienti(pmsDb, termine) {
  const rows = await pmsDb.query(SQL_CERCA, { q: `%${(termine || '').trim()}%` });
  return rows.map((r) => ({
    codCli: r.CodCli,
    nominativo: nominativo(r.Cognome, r.Nome),
    email: pulisci(r.email),
    cellulare: pulisci(r.Cellulare),
    citta: pulisci(r.Citta),
  }));
}

async function getCliente(pmsDb, codCli) {
  const rows = await pmsDb.query(SQL_CLIENTE, { codCli });
  const r = rows[0];
  if (!r) return null;
  return {
    codCli: r.CodCli,
    cognome: pulisci(r.Cognome),
    nome: pulisci(r.Nome),
    nominativo: nominativo(r.Cognome, r.Nome),
    telefono: pulisci(r.Telefono),
    cellulare: pulisci(r.Cellulare),
    email: pulisci(r.email),
    citta: pulisci(r.Citta),
    nazione: pulisci(r.CodNaz),
    dtNascita: pulisci(r.dtNascita),
    codiceFiscale: pulisci(r.CodFis),
    vip: pulisci(r.CodVip) != null,
    note: pulisci(r.Annotazioni),
    consensi: {
      generale: r.Privacy === 'S',
      conservazione: r.PrivacyConservaDati === 'S',
      cessione: r.PrivacyCessioneDati === 'S',
    },
  };
}

async function getSoggiorniCliente(pmsDb, codCli) {
  const rows = await pmsDb.query(SQL_SOGGIORNI, { codCli });
  return rows.map((r) => ({
    codpratica: r.codpratica,
    dtarrivo: r.dtarrivo,
    dtpartenza: r.dtpartenza,
    notti: r.notti,
    camere: pulisci(r.camere),
    importo: r.importo == null ? null : Number(r.importo),
    stato: r.stato,
  }));
}

module.exports = { cercaClienti, getCliente, getSoggiorniCliente };
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `node --test test/pms-clienti.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/pms/clienti.js test/pms-clienti.test.js
git commit -m "feat(pms): data-access clienti (ricerca, anagrafica, storico soggiorni)"
```

> **Verifica end-to-end (controller):** chiamare `getSoggiorniCliente(pmsDb, 47186)` contro il DB reale e confermare ~14 soggiorni (1 attivo + 13 storici), importi coerenti.

---

### Task 2: Note CRM — `src/crm/note.js`

**Files:**
- Create: `src/crm/note.js`, `test/crm-note.test.js`

**Interfaces:**
- Consumes: un `db` con `query(text, params)`.
- Produces:
  - `listNote(db, pmsCustomerId) -> Promise<Array<{ id, pms_customer_id, testo, created_at, autore_user_id, autore }>>`
  - `createNota(db, { pmsCustomerId, autoreUserId, testo }) -> Promise<{ id }>`
  - `updateNota(db, id, testo) -> Promise<void>`
  - `deleteNota(db, id) -> Promise<void>`

- [ ] **Step 1: Scrivi il test con `db` finto**

`test/crm-note.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const note = require('../src/crm/note');

function fakeDb(recordset = []) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('listNote filtra per cliente e unisce l\\'autore', async () => {
  const db = fakeDb([{ id: 1, pms_customer_id: 47186, testo: 'ciao', created_at: 'x', autore_user_id: 1, autore: 'admin' }]);
  const r = await note.listNote(db, 47186);
  assert.strictEqual(r[0].autore, 'admin');
  assert.strictEqual(db.calls[0].params.pmsCustomerId, 47186);
  assert.match(db.calls[0].text, /FROM customer_notes/);
});

test('createNota passa cliente, autore e testo', async () => {
  const db = fakeDb([{ id: 9 }]);
  const r = await note.createNota(db, { pmsCustomerId: 47186, autoreUserId: 1, testo: 'nota' });
  assert.strictEqual(r.id, 9);
  assert.strictEqual(db.calls[0].params.testo, 'nota');
  assert.strictEqual(db.calls[0].params.autoreUserId, 1);
});

test('updateNota aggiorna il testo per id', async () => {
  const db = fakeDb([]);
  await note.updateNota(db, 9, 'nuovo');
  assert.match(db.calls[0].text, /UPDATE customer_notes SET testo = @testo WHERE id = @id/);
  assert.strictEqual(db.calls[0].params.testo, 'nuovo');
});

test('deleteNota elimina per id', async () => {
  const db = fakeDb([]);
  await note.deleteNota(db, 9);
  assert.match(db.calls[0].text, /DELETE FROM customer_notes WHERE id = @id/);
  assert.strictEqual(db.calls[0].params.id, 9);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test test/crm-note.test.js`
Expected: FAIL (modulo mancante).

- [ ] **Step 3: Implementa `src/crm/note.js`**

```js
async function listNote(db, pmsCustomerId) {
  return db.query(
    `SELECT n.id, n.pms_customer_id, n.testo, n.created_at, n.autore_user_id, u.username AS autore
     FROM customer_notes n LEFT JOIN users u ON u.id = n.autore_user_id
     WHERE n.pms_customer_id = @pmsCustomerId
     ORDER BY n.created_at DESC`,
    { pmsCustomerId }
  );
}

async function createNota(db, { pmsCustomerId, autoreUserId, testo }) {
  const rows = await db.query(
    `INSERT INTO customer_notes (pms_customer_id, autore_user_id, testo, created_at)
     OUTPUT INSERTED.id
     VALUES (@pmsCustomerId, @autoreUserId, @testo, SYSUTCDATETIME())`,
    { pmsCustomerId, autoreUserId, testo }
  );
  return rows[0];
}

async function updateNota(db, id, testo) {
  await db.query('UPDATE customer_notes SET testo = @testo WHERE id = @id', { id, testo });
}

async function deleteNota(db, id) {
  await db.query('DELETE FROM customer_notes WHERE id = @id', { id });
}

module.exports = { listNote, createNota, updateNota, deleteNota };
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `node --test test/crm-note.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/crm/note.js test/crm-note.test.js
git commit -m "feat(crm): CRUD note cliente (customer_notes)"
```

---

### Task 3: API clienti — `src/api/clienti.js` + mount

**Files:**
- Create: `src/api/clienti.js`, `test/clienti-api.test.js`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `cercaClienti/getCliente/getSoggiorniCliente` (Task 1), `listNote/createNota/updateNota/deleteNota` (Task 2), `requireAuth`.
- Produces: `createClientiRouter(pmsDb, crmDb) -> Router` con `GET /clienti`, `GET /clienti/:codCli`, `GET|POST /clienti/:codCli/note`, `PATCH|DELETE /note/:id`. Esporta `calcolaStatistiche(soggiorni)`.
- Montato in `src/app.js`: `app.use('/api', createClientiRouter(pmsDb, crmDb))` (dopo `/api/me`, prima dello statico).

- [ ] **Step 1: Scrivi il test (supertest + login)**

`test/clienti-api.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');

async function makeApp() {
  const admin = { id: 1, username: 'admin', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const note = [];
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) return params.username === 'admin' ? [admin] : [];
      if (/INSERT INTO customer_notes/.test(text)) { const n = { id: note.length + 1, ...params }; note.push(n); return [{ id: n.id }]; }
      if (/FROM customer_notes/.test(text)) return note.filter((n) => n.pmsCustomerId === params.pmsCustomerId).map((n) => ({ id: n.id, testo: n.testo, autore: 'admin', created_at: 'x', autore_user_id: 1, pms_customer_id: n.pmsCustomerId }));
      if (/UPDATE customer_notes/.test(text) || /DELETE FROM customer_notes/.test(text)) return [];
      return [];
    },
  };
  const pmsDb = {
    async query(text) {
      if (/TOP 20 CodCli/.test(text)) return [{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANNA', email: 'a@b.it', Cellulare: '', Citta: 'TRANI' }];
      if (/FROM Anagra WHERE CodCli/.test(text)) return [{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANNA', Telefono: '', Cellulare: '', email: 'a@b.it', Citta: 'TRANI', CodNaz: 'I', dtNascita: '1964-10-17', CodFis: 'X', CodVip: '', Annotazioni: '', Privacy: 'S', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' }];
      // soggiorni
      return [{ codpratica: 1, dtarrivo: '2026-04-17', dtpartenza: '2026-04-19', notti: 2, camere: '109', importo: 855, stato: 'Concluso' },
              { codpratica: 2, dtarrivo: '2026-07-07', dtpartenza: '2026-07-19', notti: 12, camere: '102', importo: 2300, stato: 'Confermato' }];
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
  assert.strictEqual(res.body.statistiche.primaVisita, '2026-04-17');
  assert.strictEqual(res.body.statistiche.ultimaVisita, '2026-07-07');
});

test('GET /api/clienti/abc → 400', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/clienti/abc');
  assert.strictEqual(res.status, 400);
});

test('note: crea, elenca, elimina', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const c = await ag.post('/api/clienti/47186/note').send({ testo: 'prima nota' });
  assert.strictEqual(c.status, 201);
  const l = await ag.get('/api/clienti/47186/note');
  assert.strictEqual(l.body.note[0].testo, 'prima nota');
  const d = await ag.delete('/api/note/1');
  assert.strictEqual(d.status, 200);
});

test('nota vuota → 400', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.post('/api/clienti/47186/note').send({ testo: '   ' });
  assert.strictEqual(res.status, 400);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test test/clienti-api.test.js`
Expected: FAIL (`Cannot find module '../src/api/clienti'`).

- [ ] **Step 3: Implementa `src/api/clienti.js`**

```js
const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { cercaClienti, getCliente, getSoggiorniCliente } = require('../pms/clienti');
const { listNote, createNota, updateNota, deleteNota } = require('../crm/note');

function calcolaStatistiche(soggiorni) {
  const nSoggiorni = soggiorni.length;
  const totaleSpeso = soggiorni.reduce((s, x) => s + (x.importo || 0), 0);
  const date = soggiorni.map((x) => x.dtarrivo).filter(Boolean).sort();
  return {
    nSoggiorni,
    totaleSpeso,
    primaVisita: date[0] || null,
    ultimaVisita: date[date.length - 1] || null,
  };
}

function createClientiRouter(pmsDb, crmDb) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/clienti', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ risultati: [] });
    const risultati = await cercaClienti(pmsDb, q);
    res.json({ risultati });
  });

  router.get('/clienti/:codCli', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    const anagrafica = await getCliente(pmsDb, codCli);
    if (!anagrafica) return res.status(404).json({ error: 'Cliente non trovato' });
    const soggiorni = await getSoggiorniCliente(pmsDb, codCli);
    res.json({ anagrafica, statistiche: calcolaStatistiche(soggiorni), soggiorni });
  });

  router.get('/clienti/:codCli/note', async (req, res) => {
    const codCli = Number(req.params.codCli);
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    res.json({ note: await listNote(crmDb, codCli) });
  });

  router.post('/clienti/:codCli/note', async (req, res) => {
    const codCli = Number(req.params.codCli);
    const testo = (req.body && req.body.testo ? String(req.body.testo) : '').trim();
    if (!Number.isInteger(codCli)) return res.status(400).json({ error: 'ID non valido' });
    if (!testo) return res.status(400).json({ error: 'Testo mancante' });
    const nota = await createNota(crmDb, { pmsCustomerId: codCli, autoreUserId: req.session.user.id, testo });
    res.status(201).json({ nota });
  });

  router.patch('/note/:id', async (req, res) => {
    const id = Number(req.params.id);
    const testo = (req.body && req.body.testo ? String(req.body.testo) : '').trim();
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    if (!testo) return res.status(400).json({ error: 'Testo mancante' });
    await updateNota(crmDb, id, testo);
    res.json({ ok: true });
  });

  router.delete('/note/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    await deleteNota(crmDb, id);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createClientiRouter, calcolaStatistiche };
```

- [ ] **Step 4: Monta in `src/app.js`**

Aggiungi l'import in cima con gli altri:
```js
const { createClientiRouter } = require('./api/clienti');
```
E monta DOPO `app.use('/api', createArriviRouter(pmsDb));` e PRIMA di `app.use(express.static(...))`:
```js
  app.use('/api', createClientiRouter(pmsDb, crmDb));
```

- [ ] **Step 5: Esegui la suite e verifica che passi**

Run: `npm test`
Expected: PASS (preesistenti + nuovi di `clienti-api`).

- [ ] **Step 6: Commit**

```bash
git add src/api/clienti.js src/app.js test/clienti-api.test.js
git commit -m "feat(api): rotte clienti (ricerca, scheda, note) autenticate"
```

---

### Task 4: Espone `codCliente` nelle righe Arrivi / In casa

**Files:**
- Modify: `src/pms/prenotazioni.js`
- Test: `test/pms-prenotazioni.test.js`

**Interfaces:**
- Produces: ogni riga di `getArriviByData`/`getInCasaByData` include `codCliente` (= `Prenota.codclinterm`), per linkare il nome ospite alla scheda.

- [ ] **Step 1: Aggiorna il test esistente**

In `test/pms-prenotazioni.test.js`, nel test `getArriviByData mappa e normalizza le righe`, aggiungi al record finto `codclinterm: 47186` e l'asserzione:
```js
  assert.strictEqual(a.codCliente, 47186);
```
(La riga finta del primo test diventa: `{ codpratica: 60176, codclinterm: 47186, cognome: 'HILTON', ... }`.)

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `node --test test/pms-prenotazioni.test.js`
Expected: FAIL (`a.codCliente` undefined).

- [ ] **Step 3: Aggiorna `src/pms/prenotazioni.js`**

Nel `SELECT` sia di `SQL_ARRIVI` sia di `SQL_INCASA`, aggiungi dopo `p.codpratica,`:
```sql
  p.codclinterm AS codCliente,
```
E nel `mapRiga`, aggiungi al risultato:
```js
    codCliente: r.codCliente,
```
(subito dopo `codpratica: r.codpratica,`).

- [ ] **Step 4: Esegui e verifica il successo**

Run: `npm test`
Expected: PASS (tutta la suite).

- [ ] **Step 5: Commit**

```bash
git add src/pms/prenotazioni.js test/pms-prenotazioni.test.js
git commit -m "feat(pms): espone codCliente (codclinterm) nelle righe arrivi/in casa"
```

---

### Task 5: Frontend — pagina cliente + ricerca topbar + link

**Files:**
- Modify: `web/index.html`, `web/app.js`, `web/styles.css`

**Interfaces:**
- Consumes: `GET /api/clienti?q=`, `GET /api/clienti/:codCli`, `GET|POST /api/clienti/:codCli/note`, `PATCH|DELETE /api/note/:id`; `codCliente` nelle righe arrivi/in casa.

> Nessun test automatico (frontend statico). Verifica: `npm start`, aprire la scheda di DI BARI (14 soggiorni), aggiungere/modificare/eliminare una nota, e il link dal nome ospite.

- [ ] **Step 1: `web/index.html` — ricerca in topbar**

Dentro `<header class="topbar">`, PRIMA di `<div class="user">`, inserisci:
```html
        <div class="cli-search">
          <input type="search" id="cli-search-input" placeholder="Cerca cliente…" autocomplete="off" />
          <div id="cli-search-results" class="cli-results" hidden></div>
        </div>
```

- [ ] **Step 2: `web/index.html` — vista scheda cliente**

Dopo la sezione `<!-- UTENTI (admin) -->` (dentro `.content`, prima della chiusura `</div>` del content), aggiungi:
```html
        <!-- SCHEDA CLIENTE -->
        <section id="view-cliente" class="view" hidden>
          <div id="cliente-msg" class="state" hidden></div>
          <div id="cliente-body" hidden>
            <div class="page-head">
              <div>
                <h1 id="cli-nome"></h1>
                <p class="sub" id="cli-contatti"></p>
              </div>
              <span id="cli-vip" class="pill pill-vip" hidden>VIP</span>
            </div>

            <div class="kpi-row">
              <div class="kpi"><span class="kpi-n" id="cli-nsogg">–</span><span class="kpi-l">Soggiorni</span></div>
              <div class="kpi"><span class="kpi-n" id="cli-speso">–</span><span class="kpi-l">Totale speso</span></div>
              <div class="kpi"><span class="kpi-n small" id="cli-visite">–</span><span class="kpi-l">Prima / ultima visita</span></div>
            </div>

            <h2 class="sez">Storico soggiorni</h2>
            <div class="card table-wrap">
              <table>
                <thead><tr><th>Num.pratica</th><th>Arrivo</th><th>Partenza</th><th>Notti</th><th>Camera</th><th>Importo</th><th>Stato</th></tr></thead>
                <tbody id="cli-soggiorni"></tbody>
              </table>
            </div>

            <h2 class="sez">Note CRM</h2>
            <div class="card note-box">
              <form id="nota-form" class="nota-form">
                <input name="testo" placeholder="Aggiungi una nota…" required />
                <button type="submit" class="btn btn-primary">Aggiungi</button>
              </form>
              <ul id="cli-note" class="note-list"></ul>
            </div>

            <h2 class="sez">Consensi privacy</h2>
            <div class="card consensi" id="cli-consensi"></div>

            <div id="cli-anagrafica-note" class="card anag-note" hidden></div>
          </div>
        </section>
```

- [ ] **Step 3: `web/app.js` — routing `#cliente/<id>`**

Nel `route()`, sostituisci la riga che calcola `view`/`v` e la gestione, per riconoscere `#cliente/<id>`. Sostituisci l'inizio di `route()`:
```js
function route() {
  const hash = (location.hash || '#home').slice(1);
  // scheda cliente: #cliente/<codCli>
  if (hash.startsWith('cliente/')) {
    const codCli = hash.split('/')[1];
    $('#topbar-title').textContent = 'Cliente';
    document.querySelectorAll('.view').forEach((el) => { el.hidden = true; });
    document.querySelectorAll('.sidebar a').forEach((a) => a.classList.remove('active'));
    $('#view-cliente').hidden = false;
    loadCliente(codCli);
    return;
  }
  const view = hash;
  const known = ['home', 'arrivi', 'incasa', 'utenti'];
  let v = known.includes(view) ? view : 'home';
```
(Il resto di `route()` resta invariato.)

- [ ] **Step 4: `web/app.js` — logica scheda cliente + ricerca + link**

Aggiungi in fondo al file (prima della chiamata finale `refresh();`):
```js
// --- Scheda cliente ---
function apriCliente(codCli) { location.hash = `#cliente/${codCli}`; }

async function loadCliente(codCli) {
  const body = $('#cliente-body');
  const msg = $('#cliente-msg');
  body.hidden = true; msg.hidden = false; msg.textContent = 'Caricamento…';
  const { status, body: data } = await api(`/api/clienti/${encodeURIComponent(codCli)}`);
  if (status === 404) { msg.textContent = 'Cliente non trovato.'; return; }
  if (status !== 200) { msg.textContent = 'Errore nel leggere il cliente dal PMS.'; return; }
  const a = data.anagrafica;
  const s = data.statistiche;
  $('#cli-nome').textContent = a.nominativo || '(senza nominativo)';
  const contatti = [a.telefono, a.cellulare, a.email, [a.citta, a.nazione].filter(Boolean).join(' · ')].filter(Boolean).join('  ·  ');
  $('#cli-contatti').textContent = contatti;
  $('#cli-vip').hidden = !a.vip;
  $('#cli-nsogg').textContent = s.nSoggiorni;
  $('#cli-speso').textContent = euro(s.totaleSpeso || 0);
  const fmt = (d) => (d ? d.split('-').reverse().join('/') : '—');
  $('#cli-visite').textContent = `${fmt(s.primaVisita)} → ${fmt(s.ultimaVisita)}`;
  $('#cli-soggiorni').innerHTML = (data.soggiorni || []).map((x) => `
    <tr>
      <td class="prat">${esc(x.codpratica)}</td>
      <td class="cell-muted">${x.dtarrivo ? esc(x.dtarrivo.split('-').reverse().join('/')) : '—'}</td>
      <td class="cell-muted">${x.dtpartenza ? esc(x.dtpartenza.split('-').reverse().join('/')) : '—'}</td>
      <td class="cell-muted">${x.notti}</td>
      <td>${x.camere ? `<span class="room">${esc(x.camere)}</span>` : dash}</td>
      <td class="cell-num">${x.importo != null ? euro(x.importo) : dash}</td>
      <td class="cell-muted">${esc(x.stato)}</td>
    </tr>`).join('') || `<tr><td colspan="7" class="cell-muted">Nessun soggiorno.</td></tr>`;
  const c = a.consensi;
  const cbadge = (ok, label) => `<span class="cons ${ok ? 'si' : 'no'}">${label}: ${ok ? 'Sì' : 'No'}</span>`;
  $('#cli-consensi').innerHTML = cbadge(c.generale, 'Trattamento') + cbadge(c.conservazione, 'Conservazione') + cbadge(c.cessione, 'Cessione');
  const an = $('#cli-anagrafica-note');
  if (a.note) { an.hidden = false; an.innerHTML = `<strong>Note anagrafica (PMS):</strong> ${esc(a.note)}`; } else { an.hidden = true; }
  clienteCorrente = codCli;
  await caricaNote(codCli);
  msg.hidden = true; body.hidden = false;
}

let clienteCorrente = null;

async function caricaNote(codCli) {
  const { body } = await api(`/api/clienti/${encodeURIComponent(codCli)}/note`);
  const note = body.note || [];
  $('#cli-note').innerHTML = note.map((n) => `
    <li data-nota="${n.id}">
      <div class="nota-testo">${esc(n.testo)}</div>
      <div class="nota-meta">${esc(n.autore || '?')} · ${new Date(n.created_at).toLocaleString('it-IT')}
        <button class="btn-icon" data-edit-nota="${n.id}">Modifica</button>
        <button class="btn-icon danger" data-del-nota="${n.id}">Elimina</button>
      </div>
    </li>`).join('') || '<li class="cell-muted">Nessuna nota. Aggiungine una qui sopra.</li>';
}

$('#nota-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const testo = f.testo.value.trim();
  if (!testo || !clienteCorrente) return;
  const { status } = await api(`/api/clienti/${encodeURIComponent(clienteCorrente)}/note`, { method: 'POST', body: JSON.stringify({ testo }) });
  if (status === 201) { f.reset(); caricaNote(clienteCorrente); }
});

$('#cli-note').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del-nota]');
  const edit = e.target.closest('[data-edit-nota]');
  if (del) {
    await api(`/api/note/${del.dataset.delNota}`, { method: 'DELETE' });
    caricaNote(clienteCorrente);
  } else if (edit) {
    const li = edit.closest('[data-nota]');
    const attuale = li.querySelector('.nota-testo').textContent;
    const nuovo = prompt('Modifica nota:', attuale);
    if (nuovo != null && nuovo.trim()) {
      await api(`/api/note/${edit.dataset.editNota}`, { method: 'PATCH', body: JSON.stringify({ testo: nuovo.trim() }) });
      caricaNote(clienteCorrente);
    }
  }
});

// --- Ricerca cliente in topbar ---
let cliSearchTimer = null;
$('#cli-search-input').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(cliSearchTimer);
  const box = $('#cli-search-results');
  if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  cliSearchTimer = setTimeout(async () => {
    const { body } = await api(`/api/clienti?q=${encodeURIComponent(q)}`);
    const r = body.risultati || [];
    box.innerHTML = r.length
      ? r.map((c) => `<a href="#cliente/${c.codCli}" data-cli>${esc(c.nominativo || '(senza nome)')}<span>${esc([c.citta, c.email].filter(Boolean).join(' · '))}</span></a>`).join('')
      : '<div class="cli-vuoto">Nessun cliente</div>';
    box.hidden = false;
  }, 250);
});
$('#cli-search-results').addEventListener('click', (e) => {
  if (e.target.closest('[data-cli]')) {
    $('#cli-search-results').hidden = true;
    $('#cli-search-input').value = '';
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.cli-search')) $('#cli-search-results').hidden = true;
});
```

- [ ] **Step 5: `web/app.js` — nome ospite cliccabile in Arrivi/In casa**

In `rigaArrivo` e `rigaInCasa`, sostituisci la cella nominativo:
```js
      <td class="cell-name">${a.nominativo ? esc(a.nominativo) : '<span class="dash">(senza nominativo)</span>'}</td>
```
con (vale per entrambe le funzioni):
```js
      <td class="cell-name">${a.nominativo && a.codCliente ? `<a class="cli-link" href="#cliente/${a.codCliente}">${esc(a.nominativo)}</a>` : (a.nominativo ? esc(a.nominativo) : '<span class="dash">(senza nominativo)</span>')}</td>
```

- [ ] **Step 6: `web/styles.css` — stile scheda + ricerca**

Aggiungi in fondo (prima del blocco `@media (prefers-reduced-motion...)`):
```css
/* Ricerca cliente topbar */
.cli-search { position: relative; margin-right: auto; margin-left: 24px; }
.cli-search .search, .cli-search input { min-width: 240px; }
.cli-results { position: absolute; top: 42px; left: 0; right: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow-md); max-height: 320px; overflow-y: auto; z-index: 20; }
.cli-results a { display: flex; flex-direction: column; padding: 9px 14px; text-decoration: none; color: var(--text); font-weight: 600; font-size: 13.5px; border-bottom: 1px solid var(--border); }
.cli-results a span { font-weight: 400; font-size: 12px; color: var(--muted); }
.cli-results a:hover { background: var(--surface-2); }
.cli-vuoto { padding: 12px 14px; color: var(--muted); font-size: 13px; }

/* Link cliente nelle liste */
.cli-link { color: var(--brand); text-decoration: none; }
.cli-link:hover { text-decoration: underline; }

/* Scheda cliente */
.sez { font-family: var(--font-display); font-size: 16px; font-weight: 600; margin: 26px 0 12px; }
.pill-vip { background: #f6ecd6; color: #96700f; align-self: center; }
.kpi-n.small { font-size: 20px; }
.note-box { padding: 16px; }
.nota-form { display: flex; gap: 10px; margin-bottom: 14px; }
.nota-form input { flex: 1; }
.note-list { list-style: none; margin: 0; padding: 0; }
.note-list li { padding: 11px 0; border-bottom: 1px solid var(--border); }
.note-list li:last-child { border-bottom: none; }
.nota-testo { font-size: 14px; }
.nota-meta { font-size: 12px; color: var(--muted); margin-top: 4px; display: flex; align-items: center; gap: 10px; }
.consensi { padding: 16px; display: flex; gap: 10px; flex-wrap: wrap; }
.cons { padding: 4px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600; }
.cons.si { background: var(--sea-050); color: var(--sea-700); }
.cons.no { background: #f3e6e4; color: var(--danger); }
.anag-note { padding: 14px 16px; font-size: 13.5px; color: var(--muted); margin-top: 14px; }
```

- [ ] **Step 7: Verifica servita (controller)**

Run: `npm start` → login. Cerca "bari" nella topbar → apri **DI BARI ANTONELLA** → deve mostrare anagrafica, statistiche (14 soggiorni, totale ~€… ), storico soggiorni, consensi. Aggiungi una nota, modificala, eliminala. Da Arrivi/In casa, clic sul nome ospite → apre la sua scheda.

- [ ] **Step 8: Commit**

```bash
git add web/index.html web/app.js web/styles.css
git commit -m "feat(web): scheda cliente 360 (pagina, ricerca topbar, note, link ospite)"
```

---

## Self-Review (copertura spec)

- **Anagrafica** → Task 1 `getCliente` + Task 5 intestazione/consensi/note PMS. ✅
- **Statistiche (n°, totale speso, prima/ultima)** → `calcolaStatistiche` (Task 3) + Task 5 card. ✅
- **Storico soggiorni (Prenota∪StorPrenota per codclinterm; correnti+storici)** → `getSoggiorniCliente` (Task 1) + Task 5 tabella. ✅
- **Note CRM CRUD** → Task 2 (`crm/note.js`) + Task 3 (API) + Task 5 (UI). ✅
- **Consensi privacy** → Task 1 mapping + Task 5 badge. ✅
- **Ingressi (clic ospite + ricerca topbar)** → Task 4 (`codCliente`) + Task 5 (link + ricerca). ✅
- **Testing** → unit `pms/clienti`, `crm/note`; API supertest; frontend servito. ✅

## Note di esecuzione

- Prerequisito verifica end-to-end: DB `TSASS,2022` raggiungibile. Unit/API non dipendono dal DB reale.
- La tabella `customer_notes` esiste già (Fase 1) — nessuna migrazione.
- La ricerca cliente è debounced (250ms) e richiede ≥2 caratteri.
- La modifica nota usa `prompt()` (semplice); si può evolvere in modale in seguito.
- Dopo i 5 task: review finale whole-branch + `finishing-a-development-branch` (merge su `main`).
```
