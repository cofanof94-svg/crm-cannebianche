# CRM Direct Holiday — Rifinitura Fase 2: codpratica arrivi + CRUD utenti — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrare il numero prenotazione negli arrivi e completare la gestione utenti (creazione + modifica con nome/cognome/email/reset password + cancellazione definitiva), con i blocchi di sicurezza.

**Architecture:** Aggiunta di 3 colonne anagrafiche a `users`; estensione del data-access `src/crm/users.js` (update/delete dinamici) e dell'API admin `src/api/admin.js` (POST/PATCH estesi + DELETE con guardie); frontend: colonna codpratica negli arrivi e vista Utenti a tabella con modale crea/modifica e cancellazione.

**Tech Stack:** Node 20, Express 5, `mssql`, `bcryptjs`, test `node:test` + `supertest`. Frontend vanilla (no framework), `<dialog>` nativo.

## Riferimenti

- SPEC: `DOCS/2026-07-07-crm-fase2-utenti-crud-codpratica-specs.md`
- Base: Fase 2 parte 1 su `main` (arrivi, app-shell, KPI). API admin già esistente con `POST /users`, `PATCH /users/:id` (guardie self + ultimo admin), `getUserById`, `countActiveAdmins`.

## Global Constraints

- Node.js 20, JavaScript CommonJS (`require`), no TypeScript.
- Tutte le risposte API in JSON; messaggi d'errore in italiano.
- Ogni query parametrizzata (valori via `db.query(text, params)`); nessuna concatenazione di input in SQL. Nomi di colonna in UPDATE dinamici SOLO da whitelist fissa.
- Password mai in chiaro: hash `bcryptjs`.
- Ruoli ammessi: costante `ROLES = ['admin','reception','marketing']`.
- Blocchi: né sé stessi né l'ultimo admin attivo possono essere declassati/disattivati/eliminati.
- Frontend HTML5 + CSS + vanilla JS, nessun framework.

## File Structure

```
scripts/crm-users-anagrafica.sql   (nuovo)  ALTER TABLE users ADD nome, cognome, email
src/crm/users.js                   (mod)    createUser/listUsers estesi; updateUser, deleteUser
src/api/admin.js                   (mod)    POST/PATCH estesi; DELETE con guardie
web/index.html                     (mod)    colonna Prenota negli arrivi; vista Utenti a tabella + <dialog>
web/app.js                         (mod)    codpratica in riga arrivi; loadUsers tabella + modale + delete
web/styles.css                     (mod)    stile modale, azioni riga, colonna prat
test/users.test.js                 (mod)    updateUser, deleteUser
test/admin.test.js                 (mod)    create con nuovi campi, patch, delete + blocchi
```

---

### Task 1: Schema — colonne anagrafiche in `users`

**Files:**
- Create: `scripts/crm-users-anagrafica.sql`

**Interfaces:**
- Produces: colonne `nome`, `cognome`, `email` (nullable) su `users`. Nessun test automatico (DDL applicato dal controller).

- [ ] **Step 1: Scrivi `scripts/crm-users-anagrafica.sql`**

```sql
IF COL_LENGTH('users','nome')    IS NULL ALTER TABLE users ADD nome    NVARCHAR(60)  NULL;
IF COL_LENGTH('users','cognome') IS NULL ALTER TABLE users ADD cognome NVARCHAR(60)  NULL;
IF COL_LENGTH('users','email')   IS NULL ALTER TABLE users ADD email   NVARCHAR(120) NULL;
```

- [ ] **Step 2: (Prerequisito) Applica al DB CRM**

Il controller esegue lo script su `HolidayCanneBianche_CRM`. Verifica: `SELECT nome, cognome, email FROM users` non dà errore.

- [ ] **Step 3: Commit**

```bash
git add scripts/crm-users-anagrafica.sql
git commit -m "feat(db): colonne nome/cognome/email in users"
```

---

### Task 2: Data-access utenti — update/delete + campi anagrafici

**Files:**
- Modify: `src/crm/users.js`
- Test: `test/users.test.js`

**Interfaces:**
- Consumes: un `db` con `query(text, params)`.
- Produces:
  - `createUser(db, { username, passwordHash, role, nome?, cognome?, email? })` → riga con i campi.
  - `listUsers(db)` → righe con `{ id, username, nome, cognome, email, role, attivo, created_at }`.
  - `updateUser(db, id, campi)` → UPDATE dinamico dei soli campi in whitelist (`username, role, attivo, nome, cognome, email, password_hash`); nessun campo valido → nessuna query.
  - `deleteUser(db, id)` → DELETE per id.
  - invariati: `findUserByUsername`, `getUserById`, `setUserActive`, `setUserRole`, `countActiveAdmins`.

- [ ] **Step 1: Scrivi i nuovi test in `test/users.test.js`**

Aggiungi (mantieni i test esistenti) usando l'helper `fakeDb` già presente nel file:
```js
test('updateUser aggiorna solo i campi in whitelist', async () => {
  const db = fakeDb([]);
  await users.updateUser(db, 7, { nome: 'Mario', email: 'm@x.it', ruoloFinto: 'x' });
  const { text, params } = db.calls[0];
  assert.match(text, /UPDATE users SET/);
  assert.match(text, /nome = @nome/);
  assert.match(text, /email = @email/);
  assert.doesNotMatch(text, /ruoloFinto/);
  assert.strictEqual(params.nome, 'Mario');
  assert.strictEqual(params.id, 7);
});

test('updateUser senza campi validi non esegue query', async () => {
  const db = fakeDb([]);
  await users.updateUser(db, 7, { qualcosa: 1 });
  assert.strictEqual(db.calls.length, 0);
});

test('deleteUser esegue DELETE per id', async () => {
  const db = fakeDb([]);
  await users.deleteUser(db, 9);
  assert.match(db.calls[0].text, /DELETE FROM users WHERE id = @id/);
  assert.strictEqual(db.calls[0].params.id, 9);
});

test('createUser passa i campi anagrafici', async () => {
  const db = fakeDb([{ id: 5 }]);
  await users.createUser(db, { username: 'u', passwordHash: 'h', role: 'reception', nome: 'A', cognome: 'B', email: 'a@b.it' });
  assert.strictEqual(db.calls[0].params.nome, 'A');
  assert.strictEqual(db.calls[0].params.email, 'a@b.it');
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `node --test test/users.test.js`
Expected: FAIL (`updateUser`/`deleteUser` non definiti; createUser non passa `nome`).

- [ ] **Step 3: Aggiorna `src/crm/users.js`**

Sostituisci `createUser` e `listUsers` e aggiungi `updateUser`/`deleteUser`:
```js
async function createUser(db, { username, passwordHash, role, nome = null, cognome = null, email = null }) {
  const rows = await db.query(
    `INSERT INTO users (username, password_hash, role, attivo, created_at, nome, cognome, email)
     OUTPUT INSERTED.id, INSERTED.username, INSERTED.role, INSERTED.attivo, INSERTED.nome, INSERTED.cognome, INSERTED.email
     VALUES (@username, @passwordHash, @role, 1, SYSUTCDATETIME(), @nome, @cognome, @email)`,
    { username, passwordHash, role, nome, cognome, email }
  );
  return rows[0];
}

async function listUsers(db) {
  return db.query(
    'SELECT id, username, nome, cognome, email, role, attivo, created_at FROM users ORDER BY username',
    {}
  );
}

const CAMPI_MODIFICABILI = ['username', 'role', 'attivo', 'nome', 'cognome', 'email', 'password_hash'];

async function updateUser(db, id, campi) {
  const keys = Object.keys(campi || {}).filter((k) => CAMPI_MODIFICABILI.includes(k));
  if (keys.length === 0) return;
  const params = { id };
  for (const k of keys) params[k] = campi[k];
  const set = keys.map((k) => `${k} = @${k}`).join(', ');
  await db.query(`UPDATE users SET ${set} WHERE id = @id`, params);
}

async function deleteUser(db, id) {
  await db.query('DELETE FROM users WHERE id = @id', { id });
}
```
Aggiorna `module.exports` includendo `updateUser` e `deleteUser` (oltre agli esistenti `findUserByUsername, createUser, listUsers, setUserActive, setUserRole, getUserById, countActiveAdmins`).

- [ ] **Step 4: Esegui e verifica il successo**

Run: `node --test test/users.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/crm/users.js test/users.test.js
git commit -m "feat(crm): updateUser/deleteUser e campi anagrafici in users.js"
```

---

### Task 3: API admin — POST/PATCH estesi + DELETE

**Files:**
- Modify: `src/api/admin.js`
- Test: `test/admin.test.js`

**Interfaces:**
- Consumes: `updateUser`, `deleteUser`, `createUser`, `getUserById`, `countActiveAdmins` (Task 2), `hashPassword`, `requireRole`, `ROLES`.
- Produces: `POST /users` (con nome/cognome/email), `PATCH /users/:id` (username/role/attivo/nome/cognome/email/password), `DELETE /users/:id` (guardie).

- [ ] **Step 1: Aggiungi i test in `test/admin.test.js`**

Estendi il fake `crmDb` in `makeApp` per gestire anche `DELETE FROM users` (registra l'id e restituisce `[]`) e le nuove colonne; mantieni i test esistenti. Aggiungi:
```js
test('creazione con nome/cognome/email → 201', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.post('/api/admin/users').send({ username: 'nuovo', password: 'pw', role: 'reception', nome: 'Anna', cognome: 'Bianchi', email: 'a@b.it' });
  assert.strictEqual(res.status, 201);
});

test('modifica nome/email/password → 200', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.patch('/api/admin/users/2').send({ nome: 'X', email: 'x@y.it', password: 'nuova' });
  assert.strictEqual(res.status, 200);
});

test('DELETE utente non-admin → 200', async () => {
  const recep = { id: 2, username: 'recep', password_hash: await hashPassword('pw'), role: 'reception', attivo: 1 };
  const { app } = await makeApp({ extraUsers: [recep] });
  const agent = await loginAgent(app);
  const res = await agent.delete('/api/admin/users/2');
  assert.strictEqual(res.status, 200);
});

test('DELETE del proprio account → 400', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app); // admin id=1
  const res = await agent.delete('/api/admin/users/1');
  assert.strictEqual(res.status, 400);
});

test('DELETE ultimo admin attivo → 400', async () => {
  const admin2 = { id: 2, username: 'admin2', password_hash: await hashPassword('pw'), role: 'admin', attivo: 1 };
  const { app } = await makeApp({ extraUsers: [admin2], countActiveAdminsOverride: 1 });
  const agent = await loginAgent(app);
  const res = await agent.delete('/api/admin/users/2');
  assert.strictEqual(res.status, 400);
});

test('DELETE id non numerico → 400', async () => {
  const { app } = await makeApp();
  const agent = await loginAgent(app);
  const res = await agent.delete('/api/admin/users/abc');
  assert.strictEqual(res.status, 400);
});

test('DELETE senza login → 401', async () => {
  const { app } = await makeApp();
  const res = await request(app).delete('/api/admin/users/2');
  assert.strictEqual(res.status, 401);
});
```
Nota per il fake `crmDb`: aggiungi un ramo `if (/DELETE FROM users/.test(text)) return [];`.

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `node --test test/admin.test.js`
Expected: FAIL (rotta DELETE assente → 404; patch nome/email non gestiti).

- [ ] **Step 3: Aggiorna `src/api/admin.js`**

Importa anche `updateUser, deleteUser` da `../crm/users`. Sostituisci `POST /users` e `PATCH /users/:id`, e aggiungi `DELETE /users/:id`:
```js
  router.post('/users', async (req, res) => {
    const { username, password, role, nome = null, cognome = null, email = null } = req.body || {};
    if (!username || !password || !ROLES.includes(role)) {
      return res.status(400).json({ error: 'Dati non validi' });
    }
    const passwordHash = await hashPassword(password);
    try {
      const user = await createUser(db, { username, passwordHash, role, nome, cognome, email });
      res.status(201).json({ user });
    } catch (e) {
      if (e && (e.number === 2627 || e.number === 2601)) {
        return res.status(409).json({ error: 'Username già esistente' });
      }
      throw e;
    }
  });

  router.patch('/users/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const { username, role, attivo, nome, cognome, email, password } = req.body || {};
    const disattiva = attivo === false || attivo === 0;
    // Un admin non può cambiare il PROPRIO ruolo (verso un ruolo diverso) o disattivarsi
    if (id === req.session.user.id && ((role !== undefined && role !== req.session.user.role) || disattiva)) {
      return res.status(400).json({ error: 'Non puoi modificare il tuo ruolo o stato' });
    }
    if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Ruolo non valido' });
    // Non lasciare il sistema senza admin attivi
    const rimuoveAdmin = (role !== undefined && role !== 'admin') || disattiva;
    if (rimuoveAdmin) {
      const target = await getUserById(db, id);
      if (target && target.role === 'admin' && target.attivo) {
        const n = await countActiveAdmins(db);
        if (n <= 1) return res.status(400).json({ error: 'Deve restare almeno un admin attivo' });
      }
    }
    const campi = {};
    if (username !== undefined) campi.username = username;
    if (role !== undefined) campi.role = role;
    if (attivo !== undefined) campi.attivo = attivo ? 1 : 0;
    if (nome !== undefined) campi.nome = nome;
    if (cognome !== undefined) campi.cognome = cognome;
    if (email !== undefined) campi.email = email;
    if (password) campi.password_hash = await hashPassword(password);
    try {
      await updateUser(db, id, campi);
      res.json({ ok: true });
    } catch (e) {
      if (e && (e.number === 2627 || e.number === 2601)) {
        return res.status(409).json({ error: 'Username già esistente' });
      }
      throw e;
    }
  });

  router.delete('/users/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    if (id === req.session.user.id) return res.status(400).json({ error: 'Non puoi eliminare il tuo account' });
    const target = await getUserById(db, id);
    if (target && target.role === 'admin' && target.attivo) {
      const n = await countActiveAdmins(db);
      if (n <= 1) return res.status(400).json({ error: 'Deve restare almeno un admin attivo' });
    }
    try {
      await deleteUser(db, id);
      res.json({ ok: true });
    } catch (e) {
      if (e && e.number === 547) {
        return res.status(409).json({ error: 'Impossibile eliminare: utente con dati collegati' });
      }
      throw e;
    }
  });
```

- [ ] **Step 4: Esegui la suite e verifica il successo**

Run: `npm test`
Expected: PASS (tutti i test preesistenti + i nuovi).

- [ ] **Step 5: Commit**

```bash
git add src/api/admin.js test/admin.test.js
git commit -m "feat(api): CRUD utenti completo (create/patch estesi + delete con guardie)"
```

---

### Task 4: Frontend — codpratica negli arrivi + vista Utenti CRUD

**Files:**
- Modify: `web/index.html`, `web/app.js`, `web/styles.css`

**Interfaces:**
- Consumes: `GET /api/arrivi` (`arrivo.codpratica`), `GET/POST/PATCH/DELETE /api/admin/users`.

> Nessun test automatico (frontend statico). Verifica: servire con `npm start`, controllare la colonna Prenota negli arrivi e crea/modifica/elimina utenti con i nuovi campi e i blocchi.

- [ ] **Step 1: `web/index.html` — intestazione arrivi**

Nel `<thead>` della tabella `#arrivi-tab`, aggiungi `<th>Prenota</th>` come PRIMA colonna (prima di `Ospite`):
```html
              <thead><tr>
                <th>Prenota</th><th>Ospite</th><th>Camera</th><th>Pax</th><th>Notti</th>
                <th>Partenza</th><th>Ora</th><th>Stato</th><th>Provenienza</th><th>Trattamento</th><th>Note</th>
              </tr></thead>
```

- [ ] **Step 2: `web/index.html` — vista Utenti a tabella + modale**

Sostituisci l'intera `<section id="view-utenti" ...>` con:
```html
        <section id="view-utenti" class="view" hidden>
          <div class="page-head">
            <div><h1>Utenti</h1><p class="sub">Gestione accessi e ruoli</p></div>
            <button id="btn-nuovo-utente" class="btn btn-primary">+ Nuovo utente</button>
          </div>
          <div class="card table-wrap">
            <table class="users-tab">
              <thead><tr>
                <th>Utente</th><th>Nome</th><th>Cognome</th><th>Email</th><th>Ruolo</th><th>Stato</th><th></th>
              </tr></thead>
              <tbody id="user-list"></tbody>
            </table>
          </div>

          <dialog id="user-dialog" class="modal">
            <form id="user-form">
              <div class="modal-title" id="user-dialog-title">Nuovo utente</div>
              <div class="modal-grid">
                <label class="field">Username <input name="username" required /></label>
                <label class="field">Ruolo
                  <select name="role">
                    <option value="reception">reception</option>
                    <option value="marketing">marketing</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
                <label class="field">Nome <input name="nome" /></label>
                <label class="field">Cognome <input name="cognome" /></label>
                <label class="field field-wide">Email <input name="email" type="email" /></label>
                <label class="field field-wide">Password <input name="password" type="password" autocomplete="new-password" /></label>
                <label class="check" id="attivo-wrap" hidden><input type="checkbox" name="attivo" /> Attivo</label>
              </div>
              <p id="user-form-error" class="error"></p>
              <div class="modal-actions">
                <button type="button" class="btn btn-ghost" id="user-cancel">Annulla</button>
                <button type="submit" class="btn btn-primary">Salva</button>
              </div>
            </form>
          </dialog>
        </section>
```

- [ ] **Step 3: `web/app.js` — codpratica nella riga arrivi**

In `rigaArrivo`, aggiungi come PRIMA cella del `<tr>`:
```js
      <td class="prat">${a.codpratica}</td>
```
(subito dopo `` `\n    <tr>\n `` e prima della cella `cell-name`).

- [ ] **Step 4: `web/app.js` — sostituisci la sezione Utenti**

Sostituisci l'intera sezione `// --- Utenti (admin) ---` (la funzione `loadUsers`) e il gestore `#new-user-form` in fondo al file con:
```js
// --- Utenti (admin) ---
let usersCache = [];
let editingId = null;

async function loadUsers() {
  const { body } = await api('/api/admin/users');
  usersCache = body.users || [];
  $('#user-list').innerHTML = usersCache.map((u) => `
    <tr>
      <td class="cell-name">${esc(u.username)}</td>
      <td>${cell(u.nome)}</td>
      <td>${cell(u.cognome)}</td>
      <td class="cell-muted">${cell(u.email)}</td>
      <td><span class="role-tag">${esc(u.role)}</span></td>
      <td>${u.attivo ? '<span class="pill pill-incasa">Attivo</span>' : '<span class="pill pill-atteso">Disattivato</span>'}</td>
      <td class="row-actions">
        <button class="btn-icon" data-edit="${u.id}">Modifica</button>
        <button class="btn-icon danger" data-del="${u.id}">Elimina</button>
      </td>
    </tr>`).join('');
}

function openUserDialog(user) {
  editingId = user ? user.id : null;
  const f = $('#user-form');
  f.reset();
  $('#user-form-error').textContent = '';
  $('#user-dialog-title').textContent = user ? 'Modifica utente' : 'Nuovo utente';
  $('#attivo-wrap').hidden = !user;
  if (user) {
    f.username.value = user.username || '';
    f.role.value = user.role || 'reception';
    f.nome.value = user.nome || '';
    f.cognome.value = user.cognome || '';
    f.email.value = user.email || '';
    f.attivo.checked = !!user.attivo;
    f.password.placeholder = 'lascia vuoto per non cambiarla';
    f.password.required = false;
  } else {
    f.password.placeholder = '';
    f.password.required = true;
  }
  $('#user-dialog').showModal();
}

async function salvaUtente(e) {
  e.preventDefault();
  const f = e.target;
  const payload = {
    username: f.username.value.trim(),
    role: f.role.value,
    nome: f.nome.value.trim(),
    cognome: f.cognome.value.trim(),
    email: f.email.value.trim(),
  };
  if (f.password.value) payload.password = f.password.value;
  let res;
  if (editingId) {
    payload.attivo = f.attivo.checked;
    res = await api(`/api/admin/users/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  } else {
    res = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
  }
  if (res.status === 200 || res.status === 201) { $('#user-dialog').close(); loadUsers(); }
  else $('#user-form-error').textContent = res.body.error || 'Errore nel salvataggio';
}

async function eliminaUtente(id) {
  const res = await api(`/api/admin/users/${id}`, { method: 'DELETE' });
  if (res.status === 200) loadUsers();
  else alert(res.body.error || 'Impossibile eliminare l\\'utente');
}

$('#btn-nuovo-utente').addEventListener('click', () => openUserDialog(null));
$('#user-cancel').addEventListener('click', () => $('#user-dialog').close());
$('#user-form').addEventListener('submit', salvaUtente);
$('#user-list').addEventListener('click', (e) => {
  const ed = e.target.closest('[data-edit]');
  const dl = e.target.closest('[data-del]');
  if (ed) { const u = usersCache.find((x) => x.id === Number(ed.dataset.edit)); if (u) openUserDialog(u); }
  else if (dl) eliminaUtente(Number(dl.dataset.del));
});
```

> Nota: la funzione `cell(v)` esiste già (definita per gli arrivi) e restituisce il valore escapato o un trattino. `esc` è già definita.

- [ ] **Step 5: `web/styles.css` — stile modale, azioni, colonna prat**

Aggiungi in fondo al file (prima del blocco `@media (prefers-reduced-motion...)`):
```css
/* codpratica */
.prat { font-family: var(--font-display); font-variant-numeric: tabular-nums; color: var(--muted); font-size: 12.5px; }

/* Utenti — azioni riga */
.row-actions { text-align: right; white-space: nowrap; }
.btn-icon { font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; background: var(--surface-2); border: 1px solid var(--border); color: var(--brand); border-radius: 7px; padding: 5px 10px; margin-left: 6px; }
.btn-icon:hover { background: var(--brand-050); }
.btn-icon.danger { color: var(--danger); }
.btn-icon.danger:hover { background: #f6e4e2; }

/* Modale */
dialog.modal { border: none; border-radius: 18px; padding: 0; box-shadow: var(--shadow-md); width: 500px; max-width: calc(100vw - 32px); color: var(--text); }
dialog.modal::backdrop { background: rgba(8,42,52,.45); }
#user-form { padding: 26px; }
.modal-title { font-family: var(--font-display); font-weight: 600; font-size: 18px; margin-bottom: 18px; }
.modal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.modal-grid .field-wide { grid-column: 1 / -1; }
.modal-grid .field input { font-weight: 400; }
.check { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
.check input { width: 16px; height: 16px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
.modal-actions .btn-ghost { color: var(--muted); border-color: var(--border-strong); }
.modal-actions .btn-ghost:hover { background: var(--surface-2); color: var(--text); }
```

- [ ] **Step 6: Verifica servita (controller)**

Run: `npm start` → login `admin`/`Admin2026!`.
- **Arrivi**: la tabella mostra la colonna **Prenota** con il numero pratica.
- **Utenti**: tabella con Nome/Cognome/Email; **+ Nuovo utente** apre il modale e crea; **Modifica** apre il modale precompilato (password vuota = invariata); **Elimina** rimuove; provare i blocchi: eliminare il proprio account e l'unico admin → messaggio d'errore.

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/app.js web/styles.css
git commit -m "feat(web): codpratica negli arrivi + vista Utenti CRUD con modale"
```

---

## Self-Review (copertura spec)

- **codpratica negli arrivi** → Task 4 (Step 1, 3). ✅
- **Colonne nome/cognome/email** → Task 1 (schema), Task 2 (data-access), Task 3 (API), Task 4 (UI). ✅
- **CRUD completo (create/modifica/delete)** → Task 3 (API) + Task 4 (UI). ✅
- **Reset password in modifica** → Task 3 PATCH (`password` → hash) + Task 4 modale. ✅
- **Blocchi (self, ultimo admin)** su PATCH e DELETE → Task 3. ✅
- **Username duplicato → 409; FK → 409** → Task 3. ✅
- **UPDATE dinamico da whitelist** (no SQL injection su nomi colonna) → Task 2. ✅
- **Testing** → Task 2 (unit), Task 3 (API supertest). ✅

## Note di esecuzione

- Prerequisito runtime per la verifica end-to-end: DB `TSASS,2022` raggiungibile e ALTER applicato (Task 1). Unit/API non dipendono dal DB reale.
- Il messaggio della guardia self su PATCH resta "Non puoi modificare il tuo ruolo o stato" (compatibile col test esistente); la guardia self su DELETE usa "Non puoi eliminare il tuo account".
- Un admin PUÒ modificare i propri dati anagrafici/username/password (la guardia scatta solo su cambio ruolo effettivo o disattivazione di sé stessi).
- Dopo i 4 task: review finale whole-branch + `finishing-a-development-branch` (merge su `main`).
```
