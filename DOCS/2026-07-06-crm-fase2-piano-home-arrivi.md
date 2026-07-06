# CRM Direct Holiday — Fase 2 (parte 1): Home + Arrivi del giorno — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere al CRM una home dashboard presentabile (3 KPI del giorno) e una pagina "Arrivi del giorno" che legge in sola lettura dal PMS, dentro un app-shell con menù.

**Architecture:** Nuovo livello dati `src/pms/` (SOLO SELECT sul pool PMS già presente in `createApp`), esposto da rotte REST autenticate in `src/api/arrivi.js`; il frontend HTML5 vanilla evolve in un app-shell con routing `#hash` (viste Home/Arrivi/Utenti). Nessuna scrittura sul PMS.

**Tech Stack:** Node 20, Express 5, `mssql`, `express-session`, `bcryptjs`, test `node:test` + `supertest`. Frontend vanilla (no framework).

## Riferimenti

- SPEC: `DOCS/2026-07-06-crm-fase2-home-arrivi-specs.md`
- Fonti dati PMS verificate: memoria `pms-arrivi-data-sources` (camera = COALESCE(AlbergDay, TipoPre), ora da `TipoPre.EstTimeArr`, ecc.).
- Base: Fase 1 completa su `main` (config, due pool DB, auth, ruoli, API utenti, app-shell minimale).

## Global Constraints

- Node.js 20, JavaScript CommonJS (`require`), no TypeScript.
- **PMS in sola lettura**: il livello `pms/` esegue SOLO `SELECT`. Nessuna azione di scrittura sul PMS.
- Tutte le risposte API in JSON; messaggi d'errore in italiano.
- Ogni query parametrizzata (valori via `pmsDb.query(text, params)`).
- Frontend HTML5 + CSS + JS vanilla, nessun framework, nessun build step.
- Rotte dati protette da `requireAuth`.
- `pmsDb` è già passato a `createApp({ crmDb, pmsDb, sessionSecret })` e finora inutilizzato.

## File Structure

```
src/pms/prenotazioni.js       (nuovo)  getArriviByData, getRiepilogoGiorno (+ mapper)
src/api/arrivi.js             (nuovo)  createArriviRouter(pmsDb): /arrivi, /dashboard
src/app.js                    (mod)    monta createArriviRouter su /api
web/index.html                (mod)    app-shell: header + nav + viste (login/home/arrivi/utenti)
web/app.js                    (mod)    routing hash + logica viste
web/styles.css                (mod)    stile app-shell, card KPI, tabella
test/pms-prenotazioni.test.js (nuovo)
test/arrivi-api.test.js       (nuovo)
```

---

### Task 1: Livello dati PMS — `src/pms/prenotazioni.js`

**Files:**
- Create: `src/pms/prenotazioni.js`, `test/pms-prenotazioni.test.js`

**Interfaces:**
- Consumes: un `pmsDb` con `query(text, params) -> Promise<rows[]>` (dal Fase 1, `src/db/query.js`).
- Produces:
  - `getArriviByData(pmsDb, data) -> Promise<Arrivo[]>` dove `Arrivo = { codpratica, nominativo|null, camere|null, paxAdulti, paxBambini, dtpartenza, notti, oraArrivo|null, inCasa:boolean, provenienza|null, trattamento|null, note|null }`.
  - `getRiepilogoGiorno(pmsDb, data) -> Promise<{ arrivi, partenze, presenti }>`.
  - `data` è una stringa `'YYYY-MM-DD'`.

- [ ] **Step 1: Scrivi il test con `pmsDb` finto**

`test/pms-prenotazioni.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { getArriviByData, getRiepilogoGiorno } = require('../src/pms/prenotazioni');

function fakePms(recordset) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('getArriviByData mappa e normalizza le righe', async () => {
  const pms = fakePms([{
    codpratica: 60176, cognome: 'HILTON', nome: '', camere: '211',
    paxAdulti: 2, paxBambini: 0, dtpartenza: '2026-07-11', notti: 5,
    oraArrivo: '__.__', inCasa: 'N', provenienza: 'Booking.com', trattamento: 'Mezza Pensione', note: '  ',
  }]);
  const [a] = await getArriviByData(pms, '2026-07-06');
  assert.strictEqual(a.codpratica, 60176);
  assert.strictEqual(a.nominativo, 'HILTON');       // nome vuoto ignorato
  assert.strictEqual(a.camere, '211');
  assert.strictEqual(a.oraArrivo, null);            // '__.__' -> null
  assert.strictEqual(a.inCasa, false);              // 'N' -> false
  assert.strictEqual(a.note, null);                 // solo spazi -> null
  assert.strictEqual(pms.calls[0].params.data, '2026-07-06');
});

test('getArriviByData: nominativo assente -> null', async () => {
  const pms = fakePms([{ codpratica: 1, cognome: '', nome: '', camere: '202',
    paxAdulti: 2, paxBambini: 0, dtpartenza: '2026-07-10', notti: 4, oraArrivo: '', inCasa: 'S',
    provenienza: null, trattamento: null, note: null }]);
  const [a] = await getArriviByData(pms, '2026-07-06');
  assert.strictEqual(a.nominativo, null);
  assert.strictEqual(a.inCasa, true);
});

test('getRiepilogoGiorno restituisce i tre conteggi', async () => {
  const pms = fakePms([{ arrivi: 8, partenze: 3, presenti: 21 }]);
  const r = await getRiepilogoGiorno(pms, '2026-07-06');
  assert.deepStrictEqual(r, { arrivi: 8, partenze: 3, presenti: 21 });
  assert.strictEqual(pms.calls[0].params.data, '2026-07-06');
});

test('getRiepilogoGiorno: nessuna riga -> zeri', async () => {
  const pms = fakePms([]);
  const r = await getRiepilogoGiorno(pms, '2026-07-06');
  assert.deepStrictEqual(r, { arrivi: 0, partenze: 0, presenti: 0 });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test test/pms-prenotazioni.test.js`
Expected: FAIL (`Cannot find module '../src/pms/prenotazioni'`).

- [ ] **Step 3: Implementa `src/pms/prenotazioni.js`**

```js
// Arrivi di una data. Camera = COALESCE(assegnazione roomlist in AlbergDay, pianificata in TipoPre).
// Trattamento/provenienza via subquery TOP 1 per evitare fan-out. Una riga per prenotazione.
const SQL_ARRIVI = `
SELECT
  p.codpratica,
  a.Cognome AS cognome,
  a.Nome AS nome,
  COALESCE(
    (SELECT STUFF((SELECT DISTINCT ', ' + ad.codcam
       FROM Alberg al JOIN AlbergDay ad ON ad.codalb = al.codalb
       WHERE al.codpratica = p.codpratica AND ISNULL(ad.codcam,'') <> ''
         AND CAST(p.dtarrivo AS date) >= CAST(ad.dtarrivo AS date)
         AND CAST(p.dtarrivo AS date) <  CAST(ad.dtpartenza AS date)
       FOR XML PATH('')), 1, 2, '')),
    (SELECT STUFF((SELECT DISTINCT ', ' + tp.codcam
       FROM TipoPre tp WHERE tp.codpratica = p.codpratica AND ISNULL(tp.codcam,'') <> ''
       FOR XML PATH('')), 1, 2, ''))
  ) AS camere,
  p.paxadulti AS paxAdulti,
  p.paxbambini AS paxBambini,
  CONVERT(varchar(10), p.dtpartenza, 23) AS dtpartenza,
  DATEDIFF(day, p.dtarrivo, p.dtpartenza) AS notti,
  (SELECT MIN(NULLIF(LTRIM(RTRIM(tp.EstTimeArr)), '')) FROM TipoPre tp WHERE tp.codpratica = p.codpratica) AS oraArrivo,
  p.flgincasa AS inCasa,
  (SELECT DesProvenienza FROM PrenotaProvenienze WHERE CodProvenienza = p.CodProvenienza) AS provenienza,
  (SELECT TOP 1 desarra FROM Arrangia WHERE codarra = p.codarr) AS trattamento,
  p.Note AS note
FROM Prenota p
LEFT JOIN Anagra a ON a.CodCli = p.codcli
WHERE p.DataEliminazione IS NULL AND CAST(p.dtarrivo AS date) = CAST(@data AS date)
ORDER BY a.Cognome, p.codpratica`;

const SQL_RIEPILOGO = `
SELECT
  (SELECT COUNT(*) FROM Prenota WHERE DataEliminazione IS NULL AND CAST(dtarrivo AS date) = CAST(@data AS date)) AS arrivi,
  (SELECT COUNT(*) FROM Prenota WHERE DataEliminazione IS NULL AND CAST(dtpartenza AS date) = CAST(@data AS date)) AS partenze,
  (SELECT COUNT(*) FROM Prenota WHERE DataEliminazione IS NULL AND flgincasa = 'S'
     AND CAST(dtarrivo AS date) <= CAST(@data AS date) AND CAST(dtpartenza AS date) > CAST(@data AS date)) AS presenti`;

function pulisci(v) {
  const s = (v == null ? '' : String(v)).trim();
  return s === '' ? null : s;
}

function normalizzaOra(v) {
  const s = (v == null ? '' : String(v)).trim();
  if (s === '') return null;
  if (/^[_.\s:]+$/.test(s)) return null; // placeholder tipo '__.__' o '__:__'
  return s;
}

function mapArrivo(r) {
  const nominativo = [r.cognome, r.nome]
    .map((s) => (s == null ? '' : String(s)).trim())
    .filter(Boolean)
    .join(' ') || null;
  return {
    codpratica: r.codpratica,
    nominativo,
    camere: pulisci(r.camere),
    paxAdulti: r.paxAdulti,
    paxBambini: r.paxBambini,
    dtpartenza: r.dtpartenza,
    notti: r.notti,
    oraArrivo: normalizzaOra(r.oraArrivo),
    inCasa: r.inCasa === 'S',
    provenienza: pulisci(r.provenienza),
    trattamento: pulisci(r.trattamento),
    note: pulisci(r.note),
  };
}

async function getArriviByData(pmsDb, data) {
  const rows = await pmsDb.query(SQL_ARRIVI, { data });
  return rows.map(mapArrivo);
}

async function getRiepilogoGiorno(pmsDb, data) {
  const rows = await pmsDb.query(SQL_RIEPILOGO, { data });
  const r = rows[0] || {};
  return {
    arrivi: r.arrivi || 0,
    partenze: r.partenze || 0,
    presenti: r.presenti || 0,
  };
}

module.exports = { getArriviByData, getRiepilogoGiorno };
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `node --test test/pms-prenotazioni.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/pms/prenotazioni.js test/pms-prenotazioni.test.js
git commit -m "feat(pms): data-access arrivi e riepilogo del giorno (sola lettura)"
```

> **Verifica end-to-end (controller, contro DB reale):** eseguire un piccolo script che chiama `getArriviByData(pmsDb, '<data odierna>')` e stampa righe/conteggi, per confermare la SQL contro il PMS (oggi ~8 arrivi con camere da TipoPre). Nessun test automatico dipende dal DB di produzione.

---

### Task 2: Rotte API — `src/api/arrivi.js` + mount in `src/app.js`

**Files:**
- Create: `src/api/arrivi.js`, `test/arrivi-api.test.js`
- Modify: `src/app.js` (montare il router)

**Interfaces:**
- Consumes: `getArriviByData`, `getRiepilogoGiorno` (Task 1); `requireAuth` (`src/auth/middleware.js`).
- Produces: `createArriviRouter(pmsDb) -> Router` con `GET /arrivi` e `GET /dashboard`; export anche `dataValida(s) -> boolean`.
- Montato in `src/app.js` con `app.use('/api', createArriviRouter(pmsDb))` → endpoint finali `GET /api/arrivi`, `GET /api/dashboard`.

- [ ] **Step 1: Scrivi il test (supertest + login)**

`test/arrivi-api.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');

async function makeApp() {
  const admin = { id: 1, username: 'admin', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) return params.username === 'admin' ? [admin] : [];
      return [];
    },
  };
  const pmsDb = {
    async query(text) {
      if (/AS arrivi/.test(text)) return [{ arrivi: 8, partenze: 3, presenti: 21 }];
      // query arrivi
      return [{ codpratica: 1, cognome: 'ROSSI', nome: 'MARIO', camere: '101',
        paxAdulti: 2, paxBambini: 0, dtpartenza: '2026-07-10', notti: 4,
        oraArrivo: '15:00', inCasa: 'N', provenienza: 'Diretto', trattamento: 'BB', note: null }];
    },
  };
  return createApp({ crmDb, pmsDb, sessionSecret: 'test' });
}

async function agente(app) {
  const ag = request.agent(app);
  await ag.post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return ag;
}

test('senza login GET /api/arrivi → 401', async () => {
  const app = await makeApp();
  const res = await request(app).get('/api/arrivi?data=2026-07-06');
  assert.strictEqual(res.status, 401);
});

test('GET /api/arrivi con data valida → 200 con lista', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/arrivi?data=2026-07-06');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data, '2026-07-06');
  assert.strictEqual(res.body.arrivi[0].nominativo, 'ROSSI MARIO');
});

test('GET /api/arrivi con data non valida → 400', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/arrivi?data=nonvalida');
  assert.strictEqual(res.status, 400);
});

test('GET /api/arrivi senza data → 200 e usa oggi (formato ISO)', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/arrivi');
  assert.strictEqual(res.status, 200);
  assert.match(res.body.data, /^\d{4}-\d{2}-\d{2}$/);
});

test('GET /api/dashboard → 200 con i tre conteggi', async () => {
  const app = await makeApp();
  const ag = await agente(app);
  const res = await ag.get('/api/dashboard?data=2026-07-06');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.arrivi, 8);
  assert.strictEqual(res.body.partenze, 3);
  assert.strictEqual(res.body.presenti, 21);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test test/arrivi-api.test.js`
Expected: FAIL (`Cannot find module '../src/api/arrivi'`).

- [ ] **Step 3: Implementa `src/api/arrivi.js`**

```js
const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { getArriviByData, getRiepilogoGiorno } = require('../pms/prenotazioni');

function oggiISO() {
  return new Date().toISOString().slice(0, 10);
}

function dataValida(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime());
}

function createArriviRouter(pmsDb) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/arrivi', async (req, res) => {
    const data = req.query.data || oggiISO();
    if (!dataValida(data)) return res.status(400).json({ error: 'Data non valida' });
    const arrivi = await getArriviByData(pmsDb, data);
    res.json({ data, arrivi });
  });

  router.get('/dashboard', async (req, res) => {
    const data = req.query.data || oggiISO();
    if (!dataValida(data)) return res.status(400).json({ error: 'Data non valida' });
    const riepilogo = await getRiepilogoGiorno(pmsDb, data);
    res.json({ data, ...riepilogo });
  });

  return router;
}

module.exports = { createArriviRouter, dataValida };
```

- [ ] **Step 4: Monta il router in `src/app.js`**

In `src/app.js`, aggiungi l'import in cima insieme agli altri:
```js
const { createArriviRouter } = require('./api/arrivi');
```
E monta il router DOPO `app.get('/api/me', ...)` e PRIMA di `app.use(express.static(...))`:
```js
  app.use('/api', createArriviRouter(pmsDb));
```

- [ ] **Step 5: Esegui la suite e verifica che passi**

Run: `npm test`
Expected: PASS (tutti i test preesistenti + 5 nuovi di `arrivi-api`).

- [ ] **Step 6: Commit**

```bash
git add src/api/arrivi.js src/app.js test/arrivi-api.test.js
git commit -m "feat(api): rotte /api/arrivi e /api/dashboard (autenticate, sola lettura)"
```

---

### Task 3: Frontend app-shell + viste Home / Arrivi / Utenti

**Files:**
- Modify: `web/index.html`, `web/app.js`, `web/styles.css` (riscrittura completa dei tre file)

**Interfaces:**
- Consumes: `GET /api/me`, `GET /api/dashboard?data=`, `GET /api/arrivi?data=`, `GET/POST /api/admin/users`, `POST /api/auth/login`, `POST /api/auth/logout`.
- Produces: app-shell HTML5 con header + menù laterale (Home, Arrivi, Utenti[solo admin]) e routing `#hash`.

> Nessun test automatico (frontend statico). Verifica: servire con `npm start` e controllare login → home KPI → pagina Arrivi con dati reali → pannello Utenti (admin).

- [ ] **Step 1: Riscrivi `web/index.html`**

```html
<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CRM Direct Holiday</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <!-- LOGIN -->
  <section id="login-view" class="login" hidden>
    <form id="login-form" class="login-card">
      <h1>CRM Direct Holiday</h1>
      <label>Utente <input name="username" required autocomplete="username" /></label>
      <label>Password <input name="password" type="password" required autocomplete="current-password" /></label>
      <button type="submit">Accedi</button>
      <p id="login-error" class="error"></p>
    </form>
  </section>

  <!-- APP -->
  <div id="app" hidden>
    <header class="topbar">
      <div class="brand">CRM Direct Holiday</div>
      <div class="user"><span id="welcome"></span><button id="logout-btn">Esci</button></div>
    </header>
    <div class="layout">
      <nav class="sidebar">
        <a href="#home" data-nav="home">Home</a>
        <a href="#arrivi" data-nav="arrivi">Arrivi</a>
        <a href="#utenti" data-nav="utenti" id="nav-utenti" hidden>Utenti</a>
      </nav>
      <main class="content">
        <!-- HOME -->
        <section id="view-home" class="view" hidden>
          <h2>Oggi</h2>
          <div class="kpi-row">
            <a class="kpi" href="#arrivi"><span class="kpi-n" id="kpi-arrivi">–</span><span class="kpi-l">Arrivi</span></a>
            <div class="kpi"><span class="kpi-n" id="kpi-partenze">–</span><span class="kpi-l">Partenze</span></div>
            <div class="kpi"><span class="kpi-n" id="kpi-presenti">–</span><span class="kpi-l">Presenti</span></div>
          </div>
          <p id="home-error" class="error"></p>
        </section>

        <!-- ARRIVI -->
        <section id="view-arrivi" class="view" hidden>
          <div class="view-head">
            <h2>Arrivi</h2>
            <label>Data <input type="date" id="arrivi-data" /></label>
          </div>
          <div id="arrivi-stato" class="stato"></div>
          <div class="table-wrap">
            <table id="arrivi-tab" hidden>
              <thead><tr>
                <th>Nominativo</th><th>Camera</th><th>Pax</th><th>Notti</th>
                <th>Partenza</th><th>Ora</th><th>Stato</th><th>Provenienza</th><th>Trattamento</th><th>Note</th>
              </tr></thead>
              <tbody id="arrivi-body"></tbody>
            </table>
          </div>
        </section>

        <!-- UTENTI (admin) -->
        <section id="view-utenti" class="view" hidden>
          <h2>Utenti</h2>
          <ul id="user-list"></ul>
          <form id="new-user-form" class="inline-form">
            <input name="username" placeholder="username" required />
            <input name="password" type="password" placeholder="password" required />
            <select name="role">
              <option value="reception">reception</option>
              <option value="marketing">marketing</option>
              <option value="admin">admin</option>
            </select>
            <button type="submit">Crea utente</button>
            <p id="new-user-error" class="error"></p>
          </form>
        </section>
      </main>
    </div>
  </div>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Riscrivi `web/styles.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #1a2b3c; background: #f4f6f8; }
.error { color: #b00020; min-height: 1.2em; }
button { cursor: pointer; background: #1a5c8c; color: #fff; border: none; border-radius: 4px; padding: .5rem .8rem; }
button:hover { background: #14496e; }
input, select { padding: .5rem; font-size: 1rem; border: 1px solid #c4ccd4; border-radius: 4px; }

/* Login */
.login { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
.login-card { display: flex; flex-direction: column; gap: .75rem; width: 320px; background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
.login-card label { display: flex; flex-direction: column; gap: .25rem; font-size: .9rem; }

/* Topbar */
.topbar { display: flex; justify-content: space-between; align-items: center; background: #1a5c8c; color: #fff; padding: .75rem 1.25rem; }
.topbar .brand { font-weight: 600; }
.topbar .user { display: flex; align-items: center; gap: .75rem; }
.topbar .user button { background: rgba(255,255,255,.15); }

/* Layout */
.layout { display: flex; min-height: calc(100vh - 52px); }
.sidebar { width: 180px; background: #fff; border-right: 1px solid #e2e8ee; padding: 1rem 0; display: flex; flex-direction: column; }
.sidebar a { padding: .7rem 1.25rem; color: #1a2b3c; text-decoration: none; }
.sidebar a:hover { background: #eef3f7; }
.sidebar a.active { background: #e2edf5; border-left: 3px solid #1a5c8c; font-weight: 600; }
.content { flex: 1; padding: 1.5rem 2rem; }

/* KPI */
.kpi-row { display: flex; gap: 1rem; flex-wrap: wrap; }
.kpi { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 140px; padding: 1.25rem 1.5rem; background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.06); text-decoration: none; color: inherit; }
.kpi-n { font-size: 2rem; font-weight: 700; color: #1a5c8c; }
.kpi-l { color: #5a6b7b; margin-top: .25rem; }
a.kpi:hover { box-shadow: 0 2px 10px rgba(0,0,0,.12); }

/* Viste */
.view-head { display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap; }
.view-head label { display: flex; align-items: center; gap: .4rem; }
.stato { margin: 1rem 0; color: #5a6b7b; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; background: #fff; }
th, td { text-align: left; padding: .55rem .7rem; border-bottom: 1px solid #e8edf1; font-size: .92rem; vertical-align: top; }
th { background: #f0f4f7; color: #34506a; white-space: nowrap; }
.badge { display: inline-block; padding: .1rem .5rem; border-radius: 10px; font-size: .8rem; }
.badge-incasa { background: #d8f0dd; color: #1c6b2e; }
.badge-atteso { background: #fdeecf; color: #8a5a09; }

.inline-form { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; margin-top: 1rem; }
ul#user-list { padding-left: 1rem; }
```

- [ ] **Step 3: Riscrivi `web/app.js`**

```js
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let currentUser = null;

// --- sessione / bootstrap ---
async function refresh() {
  const { status, body } = await api('/api/me');
  if (status !== 200) { showLogin(); return; }
  currentUser = body.user;
  $('#login-view').hidden = true;
  $('#app').hidden = false;
  $('#welcome').textContent = `${currentUser.username} (${currentUser.role})`;
  $('#nav-utenti').hidden = currentUser.role !== 'admin';
  if (!location.hash) location.hash = '#home';
  route();
}

function showLogin() {
  currentUser = null;
  $('#app').hidden = true;
  $('#login-view').hidden = false;
}

// --- router hash ---
function route() {
  const view = (location.hash || '#home').slice(1);
  const known = ['home', 'arrivi', 'utenti'];
  const v = known.includes(view) ? view : 'home';
  document.querySelectorAll('.view').forEach((el) => { el.hidden = true; });
  document.querySelectorAll('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.nav === v));
  $(`#view-${v}`).hidden = false;
  if (v === 'home') loadHome();
  else if (v === 'arrivi') initArrivi();
  else if (v === 'utenti') { if (currentUser && currentUser.role === 'admin') loadUsers(); }
}
window.addEventListener('hashchange', route);

// --- Home ---
async function loadHome() {
  $('#home-error').textContent = '';
  const { status, body } = await api('/api/dashboard');
  if (status !== 200) { $('#home-error').textContent = 'Impossibile leggere i dati dal PMS.'; return; }
  $('#kpi-arrivi').textContent = body.arrivi;
  $('#kpi-partenze').textContent = body.partenze;
  $('#kpi-presenti').textContent = body.presenti;
}

// --- Arrivi ---
let arriviInit = false;
function initArrivi() {
  if (!arriviInit) {
    const input = $('#arrivi-data');
    input.value = new Date().toISOString().slice(0, 10);
    input.addEventListener('change', loadArrivi);
    arriviInit = true;
  }
  loadArrivi();
}

async function loadArrivi() {
  const data = $('#arrivi-data').value || new Date().toISOString().slice(0, 10);
  const tab = $('#arrivi-tab');
  const stato = $('#arrivi-stato');
  tab.hidden = true;
  stato.textContent = 'Caricamento…';
  const { status, body } = await api(`/api/arrivi?data=${encodeURIComponent(data)}`);
  if (status !== 200) { stato.textContent = 'Errore nel leggere gli arrivi dal PMS.'; return; }
  const arrivi = body.arrivi || [];
  if (arrivi.length === 0) { stato.textContent = 'Nessun arrivo per questa data.'; return; }
  stato.textContent = `${arrivi.length} arrivi`;
  $('#arrivi-body').innerHTML = arrivi.map((a) => `
    <tr>
      <td>${a.nominativo ? esc(a.nominativo) : '<em>(senza nominativo)</em>'}</td>
      <td>${a.camere ? esc(a.camere) : '—'}</td>
      <td>${a.paxAdulti}${a.paxBambini ? '+' + a.paxBambini : ''}</td>
      <td>${a.notti}</td>
      <td>${esc(a.dtpartenza)}</td>
      <td>${a.oraArrivo ? esc(a.oraArrivo) : '—'}</td>
      <td>${a.inCasa ? '<span class="badge badge-incasa">In casa</span>' : '<span class="badge badge-atteso">Atteso</span>'}</td>
      <td>${a.provenienza ? esc(a.provenienza) : '—'}</td>
      <td>${a.trattamento ? esc(a.trattamento) : '—'}</td>
      <td>${a.note ? esc(a.note) : ''}</td>
    </tr>`).join('');
  tab.hidden = false;
}

// --- Utenti (admin) ---
async function loadUsers() {
  const { body } = await api('/api/admin/users');
  $('#user-list').innerHTML = (body.users || [])
    .map((u) => `<li>${esc(u.username)} — ${esc(u.role)} ${u.attivo ? '' : '(disattivato)'}</li>`)
    .join('');
}

// --- eventi login/logout/crea utente ---
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const { status } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: f.username.value, password: f.password.value }),
  });
  if (status === 200) { f.reset(); $('#login-error').textContent = ''; refresh(); }
  else $('#login-error').textContent = 'Credenziali non valide';
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  showLogin();
});

$('#new-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const { status } = await api('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username: f.username.value, password: f.password.value, role: f.role.value }),
  });
  if (status === 201) { f.reset(); $('#new-user-error').textContent = ''; loadUsers(); }
  else $('#new-user-error').textContent = 'Errore nella creazione utente';
});

refresh();
```

- [ ] **Step 4: Verifica manuale/servita (controller)**

Run: `npm start` → apri `http://localhost:3000`, login `admin` / `Admin2026!`.
Verifica: la Home mostra i 3 KPI del giorno; il menù "Arrivi" apre la tabella con gli arrivi reali (oggi ~8, con camere/nominativi/stato); cambiando la data la tabella si aggiorna; "Utenti" (solo admin) mostra e crea utenti; logout torna al login.

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/app.js web/styles.css
git commit -m "feat(web): app-shell con menù + home dashboard KPI + pagina arrivi del giorno"
```

---

## Self-Review (copertura spec)

- **App-shell (header+nav+viste, routing hash)** → Task 3. ✅
- **Home dashboard, 3 KPI (arrivi/partenze/presenti)** → `getRiepilogoGiorno` (Task 1) + `/api/dashboard` (Task 2) + view Home (Task 3). ✅
- **Pagina Arrivi, selettore data, colonne complete** → `getArriviByData` (Task 1) + `/api/arrivi` (Task 2) + view Arrivi (Task 3). ✅
- **Fonti dati verificate (camera COALESCE AlbergDay/TipoPre, ora EstTimeArr, decodifiche)** → SQL in Task 1. ✅
- **Sola lettura PMS** → livello `pms/` solo SELECT; il pool PMS ha comunque solo permessi SELECT a livello DB. ✅
- **Casi limite (nominativo/ora/camera mancanti, PMS giù, data non valida)** → mapper Task 1, stati UI Task 3, validazione + 500 handler (già presente) Task 2. ✅
- **Pannello Utenti spostato nella shell** → Task 3. ✅
- **Testing** → unit `pms` (Task 1), API supertest (Task 2), verifica servita (Task 3). ✅

## Note di esecuzione

- Prerequisito runtime: il DB `TSASS,2022` deve essere raggiungibile per la verifica end-to-end (durante la stesura è capitato che fosse temporaneamente giù). I test unit/API non dipendono dal DB reale.
- Ordine consigliato: Task 1 → 2 → 3. I Task 1 e 2 sono coperti da test automatici; il Task 3 si verifica servendo l'app.
- Dopo i tre task: review finale whole-branch + `finishing-a-development-branch` (merge su `main`).
