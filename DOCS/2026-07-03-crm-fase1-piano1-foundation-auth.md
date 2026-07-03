# CRM Direct Holiday — Piano 1: Fondamenta & Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire lo scheletro dell'app CRM (Node.js + Express) con i due pool SQL Server (PMS read-only, CRM read/write), autenticazione a sessione con ruoli e gestione utenti da parte dell'admin.

**Architecture:** Un processo Express che serve un frontend HTML5 statico ed espone una API REST. La configurazione arriva da `.env`. L'accesso ai dati passa da wrapper `db` (metodo `query(text, params)`) iniettabili, così i moduli sono testabili senza un DB reale. Auth via `express-session` (cookie httpOnly); ruoli come enum applicato da middleware.

**Tech Stack:** Node 20, Express, `mssql` (node-mssql), `express-session`, `bcryptjs`, `dotenv`. Test con `node:test` (integrato) + `supertest`.

## Decomposizione Fase 1 (3 piani)

1. **Piano 1 — Fondamenta & Auth** (questo documento): scaffold, config, pool DB, auth+ruoli, gestione utenti admin, login page. Deliverable: app in cui si fa login e l'admin gestisce utenti.
2. **Piano 2 — Vista 360° cliente**: livello `pms/` (Anagra/Prenota/StorPrenota/Alberg/Movcass), API + pagine elenco/ricerca e scheda cliente, note CRM.
3. **Piano 3 — Report/analisi**: query KPI e dashboard.

I Piani 2 e 3 verranno dettagliati dopo l'esecuzione del Piano 1.

## Global Constraints

- Node.js 20 (già installato: v20.11.1). Nessun TypeScript: JavaScript CommonJS (`require`).
- Il pool **PMS è read-only**: nel codice si eseguono SOLO `SELECT`. Credenziali PMS reali già note: server `TSASS`, porta `2022`, database `HolidayCanneBianche`, utente `g.mangano`.
- Segreti SOLO in `.env` (mai versionato). `.env.example` senza valori reali.
- Tutte le risposte API in JSON. Messaggi d'errore in italiano.
- Ruoli ammessi: `admin`, `reception`, `marketing` (costante `ROLES` unica fonte di verità).
- Password mai in chiaro: hash `bcryptjs`.
- Ogni query parametrizzata (mai concatenazione di stringhe con input utente).

## Prerequisiti — sciolti ✅

DB CRM verificato il 2026-07-03: **`HolidayCanneBianche_CRM`** esiste sull'istanza
`TSASS,2022`; l'account `g.mangano` ha permessi read/write completi (CREATE TABLE,
INSERT, UPDATE, DELETE — prova di scrittura riuscita) su questo DB, mentre resta
`SELECT`-only sul DB PMS `HolidayCanneBianche`. Resta solo da applicare lo script
`scripts/crm-schema.sql` (Task 5) e lanciare il seed (Task 9).

## File Structure

```
CRM - DirectHoliday/
├─ .gitignore
├─ .env.example
├─ package.json
├─ scripts/
│  ├─ crm-schema.sql        → CREATE TABLE users, customer_notes
│  └─ seed-admin.js         → crea il primo utente admin da env
├─ src/
│  ├─ config/index.js       → carica e valida env
│  ├─ db/query.js           → createDb(pool): wrapper query(text, params)
│  ├─ db/crm.js             → connectCrm(config) → db read/write
│  ├─ db/pms.js             → connectPms(config) → db read-only
│  ├─ crm/users.js          → data-access utenti
│  ├─ auth/password.js      → hashPassword / verifyPassword
│  ├─ auth/middleware.js    → requireAuth / requireRole
│  ├─ auth/routes.js        → createAuthRouter(db): /login /logout
│  ├─ api/admin.js          → createAdminRouter(db): CRUD utenti (admin)
│  ├─ app.js                → createApp({crmDb, pmsDb, sessionSecret})
│  └─ server.js             → entrypoint: crea pool + avvia
├─ web/
│  ├─ index.html            → login + shell
│  ├─ app.js                → JS frontend
│  └─ styles.css
└─ test/
   ├─ config.test.js
   ├─ db-query.test.js
   ├─ password.test.js
   ├─ users.test.js
   ├─ middleware.test.js
   ├─ auth.test.js
   └─ admin.test.js
```

---

### Task 1: Scaffolding progetto + modulo config

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `src/config/index.js`, `test/config.test.js`

**Interfaces:**
- Produces: `loadConfig() -> { port:number, sessionSecret:string, pms:{server,port,database,user,password}, crm:{server,port,database,user,password} }`. Lancia `Error` se manca una variabile obbligatoria.

- [ ] **Step 1: Inizializza il progetto e installa le dipendenze**

Run:
```bash
cd "C:/USR/CRM - DirectHoliday"
npm init -y
npm install express express-session mssql bcryptjs dotenv
npm install --save-dev supertest
```

- [ ] **Step 2: Configura package.json (script test/start)**

Modifica `package.json` aggiungendo:
```json
{
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "seed": "node scripts/seed-admin.js",
    "test": "node --test"
  }
}
```

- [ ] **Step 3: Crea `.gitignore`**

```
node_modules/
.env
*.log
```

- [ ] **Step 4: Crea `.env.example`**

```
PORT=3000
SESSION_SECRET=cambia-questo-con-una-stringa-lunga-e-casuale

# PMS (SOLA LETTURA)
PMS_SERVER=TSASS
PMS_PORT=2022
PMS_DATABASE=HolidayCanneBianche
PMS_USER=g.mangano
PMS_PASSWORD=

# CRM (LETTURA/SCRITTURA - DB gia' esistente, stesso account read/write)
CRM_SERVER=TSASS
CRM_PORT=2022
CRM_DATABASE=HolidayCanneBianche_CRM
CRM_USER=g.mangano
CRM_PASSWORD=
```

- [ ] **Step 5: Scrivi il test di config**

`test/config.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');

function withEnv(vars, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, vars);
  try { return fn(); } finally { process.env = saved; }
}

test('loadConfig legge le variabili obbligatorie', () => {
  delete require.cache[require.resolve('../src/config')];
  withEnv({
    PORT: '4000', SESSION_SECRET: 's3cret',
    PMS_SERVER: 'TSASS', PMS_PORT: '2022', PMS_DATABASE: 'HolidayCanneBianche',
    PMS_USER: 'g.mangano', PMS_PASSWORD: 'pw',
    CRM_SERVER: 'CRMSRV', CRM_PORT: '1433', CRM_DATABASE: 'CRM_DirectHoliday',
    CRM_USER: 'crm', CRM_PASSWORD: 'pw2',
  }, () => {
    const { loadConfig } = require('../src/config');
    const c = loadConfig();
    assert.strictEqual(c.port, 4000);
    assert.strictEqual(c.pms.server, 'TSASS');
    assert.strictEqual(c.pms.port, 2022);
    assert.strictEqual(c.crm.database, 'CRM_DirectHoliday');
  });
});

test('loadConfig lancia se manca una variabile', () => {
  delete require.cache[require.resolve('../src/config')];
  withEnv({ SESSION_SECRET: '', PMS_SERVER: '' }, () => {
    const { loadConfig } = require('../src/config');
    assert.throws(() => loadConfig(), /SESSION_SECRET/);
  });
});
```

- [ ] **Step 6: Esegui il test e verifica che fallisca**

Run: `npm test`
Expected: FAIL (`Cannot find module '../src/config'`).

- [ ] **Step 7: Implementa `src/config/index.js`**

```js
require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Variabile ambiente mancante: ${name}`);
  return v;
}

function loadConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    sessionSecret: required('SESSION_SECRET'),
    pms: {
      server: required('PMS_SERVER'),
      port: Number(required('PMS_PORT')),
      database: required('PMS_DATABASE'),
      user: required('PMS_USER'),
      password: required('PMS_PASSWORD'),
    },
    crm: {
      server: required('CRM_SERVER'),
      port: Number(required('CRM_PORT')),
      database: required('CRM_DATABASE'),
      user: required('CRM_USER'),
      password: required('CRM_PASSWORD'),
    },
  };
}

module.exports = { loadConfig };
```

- [ ] **Step 8: Esegui il test e verifica che passi**

Run: `npm test`
Expected: PASS (i test di config).

- [ ] **Step 9: Crea il `.env` reale (non versionato)**

Copia `.env.example` in `.env` e inserisci `PMS_PASSWORD=GianMan2026@`, un `SESSION_SECRET` casuale lungo, e (quando disponibili) i valori `CRM_*`.

- [ ] **Step 10: Commit**

```bash
git init
git add .gitignore .env.example package.json package-lock.json src/config test/config.test.js
git commit -m "chore: scaffolding progetto e modulo config"
```

---

### Task 2: Wrapper DB (`db/query.js`, `db/crm.js`, `db/pms.js`)

**Files:**
- Create: `src/db/query.js`, `src/db/crm.js`, `src/db/pms.js`, `test/db-query.test.js`

**Interfaces:**
- Produces: `createDb(pool) -> { query(text, params={}), close() }` dove `query` restituisce `result.recordset` (array di righe).
- Produces: `connectCrm(config) -> Promise<db>` e `connectPms(config) -> Promise<db>`.

- [ ] **Step 1: Scrivi il test di `createDb`**

`test/db-query.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db/query');

function fakePool(recordset) {
  const bound = {};
  return {
    _bound: bound,
    _lastQuery: null,
    request() {
      const self = this;
      return {
        input(k, v) { bound[k] = v; return this; },
        async query(text) { self._lastQuery = text; return { recordset }; },
      };
    },
  };
}

test('query lega i parametri e restituisce il recordset', async () => {
  const pool = fakePool([{ id: 1 }]);
  const db = createDb(pool);
  const rows = await db.query('SELECT * FROM t WHERE id=@id', { id: 1 });
  assert.deepStrictEqual(rows, [{ id: 1 }]);
  assert.strictEqual(pool._bound.id, 1);
  assert.match(pool._lastQuery, /SELECT/);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test test/db-query.test.js`
Expected: FAIL (`Cannot find module '../src/db/query'`).

- [ ] **Step 3: Implementa `src/db/query.js`**

```js
function createDb(pool) {
  return {
    async query(text, params = {}) {
      const request = pool.request();
      for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
      }
      const result = await request.query(text);
      return result.recordset;
    },
    async close() {
      await pool.close();
    },
  };
}

module.exports = { createDb };
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `node --test test/db-query.test.js`
Expected: PASS.

- [ ] **Step 5: Implementa `src/db/crm.js` e `src/db/pms.js`**

`src/db/crm.js`:
```js
const sql = require('mssql');
const { createDb } = require('./query');

async function connectCrm(config) {
  const pool = new sql.ConnectionPool({
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: { encrypt: true, trustServerCertificate: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  });
  await pool.connect();
  return createDb(pool);
}

module.exports = { connectCrm };
```

`src/db/pms.js` (identico ma read-only per convenzione: si usano solo SELECT):
```js
const sql = require('mssql');
const { createDb } = require('./query');

async function connectPms(config) {
  const pool = new sql.ConnectionPool({
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: { encrypt: true, trustServerCertificate: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  });
  await pool.connect();
  return createDb(pool);
}

module.exports = { connectPms };
```

- [ ] **Step 6: Commit**

```bash
git add src/db test/db-query.test.js
git commit -m "feat: wrapper DB con query parametrizzata e pool CRM/PMS"
```

---

### Task 3: Hashing password

**Files:**
- Create: `src/auth/password.js`, `test/password.test.js`

**Interfaces:**
- Produces: `hashPassword(plain) -> Promise<string>`, `verifyPassword(plain, hash) -> Promise<boolean>`.

- [ ] **Step 1: Scrivi il test**

`test/password.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword } = require('../src/auth/password');

test('hash e verifica password corretta', async () => {
  const hash = await hashPassword('segreta');
  assert.notStrictEqual(hash, 'segreta');
  assert.strictEqual(await verifyPassword('segreta', hash), true);
});

test('verifica fallisce con password errata', async () => {
  const hash = await hashPassword('segreta');
  assert.strictEqual(await verifyPassword('sbagliata', hash), false);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test test/password.test.js`
Expected: FAIL (modulo mancante).

- [ ] **Step 3: Implementa `src/auth/password.js`**

```js
const bcrypt = require('bcryptjs');
const ROUNDS = 12;

async function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, verifyPassword };
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `node --test test/password.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/password.js test/password.test.js
git commit -m "feat: hashing password con bcryptjs"
```

---

### Task 4: Data-access utenti (`crm/users.js`)

**Files:**
- Create: `src/crm/users.js`, `test/users.test.js`

**Interfaces:**
- Consumes: un `db` con `query(text, params)`.
- Produces:
  - `findUserByUsername(db, username) -> Promise<user|null>` (user: `{id, username, password_hash, role, attivo}`)
  - `createUser(db, {username, passwordHash, role}) -> Promise<{id, username, role, attivo}>`
  - `listUsers(db) -> Promise<Array<{id, username, role, attivo, created_at}>>`
  - `setUserActive(db, id, attivo) -> Promise<void>`
  - `setUserRole(db, id, role) -> Promise<void>`

- [ ] **Step 1: Scrivi il test con `db` finto**

`test/users.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const users = require('../src/crm/users');

function fakeDb(recordset = []) {
  return {
    calls: [],
    async query(text, params) { this.calls.push({ text, params }); return recordset; },
  };
}

test('findUserByUsername passa il parametro e restituisce la prima riga', async () => {
  const db = fakeDb([{ id: 1, username: 'mik', password_hash: 'h', role: 'admin', attivo: 1 }]);
  const u = await users.findUserByUsername(db, 'mik');
  assert.strictEqual(u.username, 'mik');
  assert.strictEqual(db.calls[0].params.username, 'mik');
});

test('findUserByUsername restituisce null se nessuna riga', async () => {
  const db = fakeDb([]);
  assert.strictEqual(await users.findUserByUsername(db, 'x'), null);
});

test('createUser passa username/hash/role', async () => {
  const db = fakeDb([{ id: 5, username: 'nuovo', role: 'reception', attivo: 1 }]);
  const u = await users.createUser(db, { username: 'nuovo', passwordHash: 'h', role: 'reception' });
  assert.strictEqual(u.id, 5);
  assert.strictEqual(db.calls[0].params.role, 'reception');
});

test('setUserActive normalizza a 0/1', async () => {
  const db = fakeDb([]);
  await users.setUserActive(db, 3, false);
  assert.strictEqual(db.calls[0].params.attivo, 0);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test test/users.test.js`
Expected: FAIL (modulo mancante).

- [ ] **Step 3: Implementa `src/crm/users.js`**

```js
async function findUserByUsername(db, username) {
  const rows = await db.query(
    'SELECT id, username, password_hash, role, attivo FROM users WHERE username = @username',
    { username }
  );
  return rows[0] || null;
}

async function createUser(db, { username, passwordHash, role }) {
  const rows = await db.query(
    `INSERT INTO users (username, password_hash, role, attivo, created_at)
     OUTPUT INSERTED.id, INSERTED.username, INSERTED.role, INSERTED.attivo
     VALUES (@username, @passwordHash, @role, 1, SYSUTCDATETIME())`,
    { username, passwordHash, role }
  );
  return rows[0];
}

async function listUsers(db) {
  return db.query(
    'SELECT id, username, role, attivo, created_at FROM users ORDER BY username',
    {}
  );
}

async function setUserActive(db, id, attivo) {
  await db.query('UPDATE users SET attivo = @attivo WHERE id = @id', {
    id, attivo: attivo ? 1 : 0,
  });
}

async function setUserRole(db, id, role) {
  await db.query('UPDATE users SET role = @role WHERE id = @id', { id, role });
}

module.exports = { findUserByUsername, createUser, listUsers, setUserActive, setUserRole };
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `node --test test/users.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/crm/users.js test/users.test.js
git commit -m "feat: data-access utenti CRM"
```

---

### Task 5: Schema SQL del DB CRM

**Files:**
- Create: `scripts/crm-schema.sql`

**Interfaces:**
- Produces: tabelle `users` e `customer_notes` nel DB CRM. (Nessun test automatico: script DDL applicato manualmente.)

> Nota di design: i ruoli sono un enum in codice (`ROLES`), non una tabella — YAGNI per la Fase 1.

- [ ] **Step 1: Scrivi `scripts/crm-schema.sql`**

```sql
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'users')
CREATE TABLE users (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  username      NVARCHAR(50)  NOT NULL UNIQUE,
  password_hash NVARCHAR(255) NOT NULL,
  role          NVARCHAR(20)  NOT NULL,
  attivo        BIT           NOT NULL DEFAULT 1,
  created_at    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_notes')
CREATE TABLE customer_notes (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  pms_customer_id INT           NOT NULL,   -- riferimento logico ad Anagra.CodCli
  autore_user_id  INT           NOT NULL,
  testo           NVARCHAR(MAX) NOT NULL,
  created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_notes_user FOREIGN KEY (autore_user_id) REFERENCES users(id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_notes_customer')
CREATE INDEX IX_notes_customer ON customer_notes(pms_customer_id);
GO
```

- [ ] **Step 2: (Prerequisito) Applica lo script al DB CRM**

Quando il DB CRM read/write è disponibile, esegui lo script con `sqlcmd`/SSMS. Verifica: le tabelle `users` e `customer_notes` esistono.

- [ ] **Step 3: Commit**

```bash
git add scripts/crm-schema.sql
git commit -m "feat: schema SQL del database CRM"
```

---

### Task 6: Middleware di autorizzazione

**Files:**
- Create: `src/auth/middleware.js`, `test/middleware.test.js`

**Interfaces:**
- Produces: `requireAuth(req,res,next)`; `requireRole(...roles) -> middleware`. In assenza di sessione: 401; ruolo non ammesso: 403.

- [ ] **Step 1: Scrivi il test**

`test/middleware.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { requireAuth, requireRole } = require('../src/auth/middleware');

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test('requireAuth blocca senza sessione', () => {
  const res = mockRes(); let called = false;
  requireAuth({ session: {} }, res, () => { called = true; });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(called, false);
});

test('requireAuth passa con utente in sessione', () => {
  const res = mockRes(); let called = false;
  requireAuth({ session: { user: { id: 1 } } }, res, () => { called = true; });
  assert.strictEqual(called, true);
});

test('requireRole nega ruolo non ammesso con 403', () => {
  const res = mockRes(); let called = false;
  requireRole('admin')({ session: { user: { role: 'reception' } } }, res, () => { called = true; });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(called, false);
});

test('requireRole ammette ruolo valido', () => {
  const res = mockRes(); let called = false;
  requireRole('admin', 'reception')({ session: { user: { role: 'reception' } } }, res, () => { called = true; });
  assert.strictEqual(called, true);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test test/middleware.test.js`
Expected: FAIL (modulo mancante).

- [ ] **Step 3: Implementa `src/auth/middleware.js`**

```js
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Non autenticato' });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Permesso negato' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `node --test test/middleware.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/middleware.js test/middleware.test.js
git commit -m "feat: middleware requireAuth/requireRole"
```

---

### Task 7: App factory + rotte di autenticazione

**Files:**
- Create: `src/auth/routes.js`, `src/app.js`, `test/auth.test.js`

**Interfaces:**
- Consumes: `findUserByUsername`, `verifyPassword`, `requireAuth`.
- Produces: `createAuthRouter(db) -> Router` con `POST /login`, `POST /logout`.
- Produces: `createApp({crmDb, pmsDb, sessionSecret}) -> express app` (monta json, sessione, rotte auth+admin, `/api/me`, statico `web/`). Non chiama `listen` (testabile con supertest).

- [ ] **Step 1: Scrivi il test di login/logout**

`test/auth.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');

async function appWithUser(user) {
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text) && params.username === user.username) {
        return [user];
      }
      return [];
    },
  };
  return createApp({ crmDb, pmsDb: {}, sessionSecret: 'test-secret' });
}

test('login corretto imposta il cookie di sessione', async () => {
  const user = { id: 1, username: 'mik', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const app = await appWithUser(user);
  const res = await request(app).post('/api/auth/login').send({ username: 'mik', password: 'pw' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.role, 'admin');
  assert.ok(res.headers['set-cookie']);
});

test('login con password errata → 401', async () => {
  const user = { id: 1, username: 'mik', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const app = await appWithUser(user);
  const res = await request(app).post('/api/auth/login').send({ username: 'mik', password: 'sbagliata' });
  assert.strictEqual(res.status, 401);
});

test('utente disattivato non può loggare', async () => {
  const user = { id: 1, username: 'mik', password_hash: await hashPassword('pw'), role: 'admin', attivo: 0 };
  const app = await appWithUser(user);
  const res = await request(app).post('/api/auth/login').send({ username: 'mik', password: 'pw' });
  assert.strictEqual(res.status, 401);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test test/auth.test.js`
Expected: FAIL (`Cannot find module '../src/app'`).

- [ ] **Step 3: Implementa `src/auth/routes.js`**

```js
const express = require('express');
const { findUserByUsername } = require('../crm/users');
const { verifyPassword } = require('./password');

function createAuthRouter(db) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Credenziali mancanti' });
    }
    const user = await findUserByUsername(db, username);
    if (!user || !user.attivo) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ user: req.session.user });
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  return router;
}

module.exports = { createAuthRouter };
```

- [ ] **Step 4: Implementa `src/app.js`**

```js
const express = require('express');
const session = require('express-session');
const path = require('path');
const { createAuthRouter } = require('./auth/routes');
const { createAdminRouter } = require('./api/admin');
const { requireAuth } = require('./auth/middleware');

function createApp({ crmDb, pmsDb, sessionSecret }) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
  }));

  app.use('/api/auth', createAuthRouter(crmDb));
  app.use('/api/admin', createAdminRouter(crmDb));
  app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.session.user }));

  app.use(express.static(path.join(__dirname, '..', 'web')));
  return app;
}

module.exports = { createApp };
```

> Nota: `createApp` importa `createAdminRouter` (Task 8). Esegui il Task 8 nello stesso ciclo prima di lanciare `test/auth.test.js`, oppure crea prima uno stub minimo di `src/api/admin.js` che esporta `createAdminRouter = () => express.Router()`.

- [ ] **Step 5: Esegui il test e verifica che passi**

Run: `node --test test/auth.test.js`
Expected: PASS (dopo Task 8 o stub).

- [ ] **Step 6: Commit**

```bash
git add src/auth/routes.js src/app.js test/auth.test.js
git commit -m "feat: rotte login/logout e app factory"
```

---

### Task 8: API amministrazione utenti

**Files:**
- Create: `src/api/admin.js`, `test/admin.test.js`

**Interfaces:**
- Consumes: `requireRole`, `listUsers`, `createUser`, `setUserActive`, `setUserRole`, `hashPassword`.
- Produces: `createAdminRouter(db) -> Router` (tutte le rotte protette da `requireRole('admin')`): `GET /users`, `POST /users`, `PATCH /users/:id`. Esporta anche `ROLES = ['admin','reception','marketing']`.

- [ ] **Step 1: Scrivi il test (agent con sessione admin)**

`test/admin.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');

async function makeApp() {
  const admin = { id: 1, username: 'admin', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const created = [];
  const crmDb = {
    async query(text, params) {
      if (/FROM users WHERE username/.test(text)) {
        return params.username === 'admin' ? [admin] : [];
      }
      if (/INSERT INTO users/.test(text)) {
        const u = { id: 2, username: params.username, role: params.role, attivo: 1 };
        created.push(u); return [u];
      }
      if (/SELECT id, username, role, attivo, created_at FROM users/.test(text)) {
        return [admin, ...created];
      }
      return [];
    },
  };
  return { app: createApp({ crmDb, pmsDb: {}, sessionSecret: 'test' }) };
}

async function loginAgent(app) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return agent;
}

test('senza login GET /api/admin/users → 401', async () => {
  const { app } = await makeApp();
  const res = await request(app).get('/api/admin/users');
  assert.strictEqual(res.status, 401);
});

test('admin può listare gli utenti', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.get('/api/admin/users');
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.users));
});

test('admin crea un utente con ruolo valido', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.post('/api/admin/users').send({ username: 'nuovo', password: 'pw', role: 'reception' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.user.role, 'reception');
});

test('ruolo non valido → 400', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.post('/api/admin/users').send({ username: 'x', password: 'pw', role: 'root' });
  assert.strictEqual(res.status, 400);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test test/admin.test.js`
Expected: FAIL (`Cannot find module '../src/api/admin'`).

- [ ] **Step 3: Implementa `src/api/admin.js`**

```js
const express = require('express');
const { requireRole } = require('../auth/middleware');
const { listUsers, createUser, setUserActive, setUserRole } = require('../crm/users');
const { hashPassword } = require('../auth/password');

const ROLES = ['admin', 'reception', 'marketing'];

function createAdminRouter(db) {
  const router = express.Router();
  router.use(requireRole('admin'));

  router.get('/users', async (req, res) => {
    res.json({ users: await listUsers(db) });
  });

  router.post('/users', async (req, res) => {
    const { username, password, role } = req.body || {};
    if (!username || !password || !ROLES.includes(role)) {
      return res.status(400).json({ error: 'Dati non validi' });
    }
    const passwordHash = await hashPassword(password);
    const user = await createUser(db, { username, passwordHash, role });
    res.status(201).json({ user });
  });

  router.patch('/users/:id', async (req, res) => {
    const id = Number(req.params.id);
    const { attivo, role } = req.body || {};
    if (role !== undefined) {
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Ruolo non valido' });
      await setUserRole(db, id, role);
    }
    if (attivo !== undefined) await setUserActive(db, id, !!attivo);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createAdminRouter, ROLES };
```

- [ ] **Step 4: Esegui tutti i test e verifica che passino**

Run: `npm test`
Expected: PASS (config, db-query, password, users, middleware, auth, admin).

- [ ] **Step 5: Commit**

```bash
git add src/api/admin.js test/admin.test.js
git commit -m "feat: API amministrazione utenti (solo admin)"
```

---

### Task 9: Entrypoint server + seed admin

**Files:**
- Create: `src/server.js`, `scripts/seed-admin.js`

**Interfaces:**
- Consumes: `loadConfig`, `connectCrm`, `connectPms`, `createApp`, `hashPassword`, `createUser`.
- Produces: processo avviabile con `npm start`; utente admin iniziale con `npm run seed`.

- [ ] **Step 1: Implementa `src/server.js`**

```js
const { loadConfig } = require('./config');
const { connectCrm } = require('./db/crm');
const { connectPms } = require('./db/pms');
const { createApp } = require('./app');

async function main() {
  const config = loadConfig();
  const crmDb = await connectCrm(config.crm);
  const pmsDb = await connectPms(config.pms);
  const app = createApp({ crmDb, pmsDb, sessionSecret: config.sessionSecret });
  app.listen(config.port, () => {
    console.log(`CRM in ascolto su http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Avvio fallito:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Implementa `scripts/seed-admin.js`**

```js
const { loadConfig } = require('../src/config');
const { connectCrm } = require('../src/db/crm');
const { hashPassword } = require('../src/auth/password');
const { createUser, findUserByUsername } = require('../src/crm/users');

async function main() {
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error('Imposta ADMIN_PASSWORD nell\'ambiente prima del seed');

  const config = loadConfig();
  const db = await connectCrm(config.crm);
  if (await findUserByUsername(db, username)) {
    console.log(`Utente '${username}' già esistente, nessuna azione.`);
    await db.close();
    return;
  }
  const passwordHash = await hashPassword(password);
  const user = await createUser(db, { username, passwordHash, role: 'admin' });
  console.log(`Creato admin id=${user.id} username=${user.username}`);
  await db.close();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 3: (Prerequisito) Esegui il seed**

Con `.env` CRM compilato e schema applicato (Task 5):
```bash
ADMIN_PASSWORD=UnaPasswordForte npm run seed
```
Expected: `Creato admin id=1 username=admin`.

- [ ] **Step 4: Commit**

```bash
git add src/server.js scripts/seed-admin.js
git commit -m "feat: entrypoint server e seed admin"
```

---

### Task 10: Frontend HTML5 — login + shell amministrazione

**Files:**
- Create: `web/index.html`, `web/styles.css`, `web/app.js`

**Interfaces:**
- Consumes: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`, `GET/POST /api/admin/users`.
- Produces: pagina unica che mostra il form di login se non autenticati; se autenticati, saluto + logout; se admin, elenco utenti e form "nuovo utente".

- [ ] **Step 1: Crea `web/index.html`**

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
  <main id="app">
    <section id="login-view" hidden>
      <h1>CRM Direct Holiday</h1>
      <form id="login-form">
        <label>Utente <input name="username" required /></label>
        <label>Password <input name="password" type="password" required /></label>
        <button type="submit">Accedi</button>
        <p id="login-error" class="error"></p>
      </form>
    </section>

    <section id="home-view" hidden>
      <header>
        <span id="welcome"></span>
        <button id="logout-btn">Esci</button>
      </header>
      <section id="admin-panel" hidden>
        <h2>Utenti</h2>
        <ul id="user-list"></ul>
        <form id="new-user-form">
          <input name="username" placeholder="username" required />
          <input name="password" type="password" placeholder="password" required />
          <select name="role">
            <option value="reception">reception</option>
            <option value="marketing">marketing</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit">Crea utente</button>
        </form>
      </section>
    </section>
  </main>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Crea `web/styles.css`**

```css
* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; margin: 0; padding: 2rem; color: #1a2b3c; }
main { max-width: 640px; margin: 0 auto; }
form { display: flex; flex-direction: column; gap: .75rem; max-width: 320px; }
label { display: flex; flex-direction: column; font-size: .9rem; gap: .25rem; }
input, select, button { padding: .5rem; font-size: 1rem; }
button { cursor: pointer; background: #1a5c8c; color: #fff; border: none; border-radius: 4px; }
header { display: flex; justify-content: space-between; align-items: center; }
.error { color: #b00020; min-height: 1.2em; }
#new-user-form { flex-direction: row; flex-wrap: wrap; max-width: none; }
ul { padding-left: 1rem; }
```

- [ ] **Step 3: Crea `web/app.js`**

```js
const $ = (sel) => document.querySelector(sel);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function show(view) {
  $('#login-view').hidden = view !== 'login';
  $('#home-view').hidden = view !== 'home';
}

async function refresh() {
  const { status, body } = await api('/api/me');
  if (status !== 200) { show('login'); return; }
  show('home');
  $('#welcome').textContent = `Ciao ${body.user.username} (${body.user.role})`;
  const isAdmin = body.user.role === 'admin';
  $('#admin-panel').hidden = !isAdmin;
  if (isAdmin) loadUsers();
}

async function loadUsers() {
  const { body } = await api('/api/admin/users');
  $('#user-list').innerHTML = (body.users || [])
    .map((u) => `<li>${u.username} — ${u.role} ${u.attivo ? '' : '(disattivato)'}</li>`)
    .join('');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const { status } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: f.username.value, password: f.password.value }),
  });
  if (status === 200) { f.reset(); refresh(); }
  else $('#login-error').textContent = 'Credenziali non valide';
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  show('login');
});

$('#new-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const { status } = await api('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username: f.username.value, password: f.password.value, role: f.role.value }),
  });
  if (status === 201) { f.reset(); loadUsers(); }
});

refresh();
```

- [ ] **Step 4: Verifica manuale nel browser**

Con DB CRM provisionato, schema applicato e seed eseguito:
```bash
npm start
```
Apri `http://localhost:3000`. Verifica: login con l'admin, comparsa del pannello utenti, creazione di un utente reception, logout, e che un login errato mostri l'errore.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat: frontend login e pannello amministrazione utenti"
```

---

## Self-Review (copertura spec)

- **Due pool SQL Server separati** → Task 2 (`connectCrm`/`connectPms`). ✅
- **PMS read-only** → convenzione in `db/pms.js` (solo SELECT); pool PMS non usato per scritture. ✅
- **Auth a sessione, cookie httpOnly** → Task 7 (`express-session`, `cookie.httpOnly`). ✅
- **Ruoli admin/reception/marketing** → costante `ROLES` (Task 8), middleware (Task 6). ✅
- **Password hashate** → Task 3 (`bcryptjs`). ✅
- **Admin gestisce utenti** → Task 8 (CRUD) + Task 10 (UI). ✅
- **Modello dati CRM (users, customer_notes)** → Task 5. ✅
- **Frontend HTML5 statico via Express** → `app.js` `express.static` + Task 10. ✅
- **Segreti in `.env`** → Task 1. ✅

Fuori scope (Piani 2/3): livello `pms/` dati cliente, scheda 360°, note CRM lato API/UI, report. La tabella `customer_notes` è creata qui ma usata nel Piano 2.

## Note su store di sessione

Per la Fase 1 si usa lo store di default di `express-session` (in memoria): adatto a singola istanza interna. Prima della produzione multi-istanza, sostituire con uno store persistente (es. su SQL Server CRM). Segnalato come follow-up, non bloccante.
