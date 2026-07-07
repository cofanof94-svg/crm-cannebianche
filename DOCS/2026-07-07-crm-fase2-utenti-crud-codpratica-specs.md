# SPECS — CRM Direct Holiday · Rifinitura Fase 2: codpratica arrivi + CRUD utenti

- **Data:** 2026-07-07
- **Autore:** Mik
- **Stato:** Design approvato
- **Contesto:** Rifinitura sopra Fase 2 parte 1 (già su `main`): home dashboard + pagina Arrivi + app-shell. Aggiunge il numero prenotazione agli arrivi e completa la gestione utenti (finora solo creazione).

---

## 1. Obiettivo e ambito

Due migliorie richieste:
1. **Arrivi**: mostrare il **`codpratica`** (numero prenotazione) in tabella.
2. **Utenti**: CRUD completo — **creazione**, **modifica** (username, ruolo, attiva/disattiva, reset password, + **nome, cognome, email**) e **cancellazione definitiva**, con i blocchi di sicurezza.

Fuori ambito: scheda cliente 360°, note CRM, report (fette successive).

---

## 2. Arrivi — colonna codpratica

- Nuova colonna **"Prenota"** come prima colonna della tabella arrivi, valore `codpratica`.
- Il campo è **già** nella risposta di `GET /api/arrivi` (`arrivo.codpratica`): nessuna modifica a backend/SQL. Solo frontend (`web/index.html` intestazione + `web/app.js` render riga).

---

## 3. Utenti — nuovi campi anagrafici (schema)

Tre colonne aggiunte a `users` (SQL Server), tutte **nullable**:
- `nome` NVARCHAR(60) NULL
- `cognome` NVARCHAR(60) NULL
- `email` NVARCHAR(120) NULL

Script `scripts/crm-users-anagrafica.sql` idempotente (`IF COL_LENGTH(...) IS NULL ALTER TABLE users ADD ...`). Applicato dal controller al DB reale `HolidayCanneBianche_CRM`.

---

## 4. Utenti — API CRUD (`src/api/admin.js`, tutte `requireRole('admin')`)

- `GET /api/admin/users` → elenco con `{ id, username, nome, cognome, email, role, attivo, created_at }`.
- `POST /api/admin/users` → crea. Body: `username, password, role, nome?, cognome?, email?`. Validazioni: username/password presenti, role in `ROLES`. Password → hash bcrypt. Username duplicato → **409** `{error:'Username già esistente'}`.
- `PATCH /api/admin/users/:id` → modifica. Campi opzionali: `username, role, attivo, nome, cognome, email, password`. Se `password` presente e non vuota → re-hash. Blocchi (vedi §6). `id` non intero → 400. Username duplicato → 409.
- `DELETE /api/admin/users/:id` → **rimozione definitiva**. Blocchi (vedi §6). Se l'utente ha dati collegati (FK, es. note CRM future) → **409** `{error:'Impossibile eliminare: utente con dati collegati'}`.

Tutte le query parametrizzate; risposte JSON; messaggi in italiano.

---

## 5. Utenti — data-access (`src/crm/users.js`)

- `listUsers(db)` → include i nuovi campi.
- `createUser(db, { username, passwordHash, role, nome, cognome, email })`.
- `updateUser(db, id, campi)` → UPDATE dinamico dei soli campi forniti (whitelist: `username, role, attivo, nome, cognome, email, password_hash`); nessun campo → nessuna query.
- `deleteUser(db, id)` → DELETE per id.
- `getUserById`, `countActiveAdmins` (già presenti).

---

## 6. Blocchi di sicurezza (server-side, su PATCH e DELETE)

- **Sé stessi**: un admin non può cambiare il **proprio** ruolo, disattivarsi, né eliminarsi → 400 `{error:'Non puoi modificare o eliminare il tuo account'}` (PATCH ruolo/attivo mantiene il messaggio esistente; DELETE self → 400).
- **Ultimo admin attivo**: non declassabile, non disattivabile, non eliminabile se è l'unico admin attivo → 400 `{error:'Deve restare almeno un admin attivo'}` (via `getUserById` + `countActiveAdmins`).
- **Username duplicato** su create/patch → 409.
- **FK / dati collegati** su delete (SQL error 547) → 409.

---

## 7. Utenti — interfaccia

La vista Utenti diventa una **tabella**: colonne *Utente · Nome · Cognome · Email · Ruolo · Stato · Azioni*. Ogni riga ha **Modifica** ed **Elimina**; in alto un pulsante **"+ Nuovo utente"**.

- **Modale** (`<dialog>` nativo, vanilla) riutilizzato per crea/modifica: campi username, nome, cognome, email, ruolo (select), attiva (checkbox, solo in modifica), password (in modifica: "lascia vuoto per non cambiarla"; in creazione: obbligatoria). Titolo e comportamento cambiano tra "Nuovo utente" e "Modifica utente".
- **Elimina**: azione **diretta** al click (nessun popup di conferma), con i blocchi applicati lato server; in caso di errore (400/409) mostra il messaggio restituito.
- Errori del modale mostrati in un `<p class="error">` interno.

Coerente con il design system introdotto (pill/tag, card, `<dialog>` stilizzato).

---

## 8. Testing

- **`users.js`**: unit per `updateUser` (UPDATE dinamico, whitelist, nessun campo → no-op) e `deleteUser` (con `pmsDb`/`db` finto).
- **API**: supertest — create con nuovi campi (201), patch (username/nome/email/password/attivo), delete (200); blocchi: self→400, ultimo admin→400, username duplicato→409, delete con FK→409, id non intero→400, senza login→401/403.
- **Verifica end-to-end** sul DB reale: applicare l'ALTER, creare/modificare/eliminare un utente di prova via API.

---

## 9. Definizione di "fatto"

- La tabella arrivi mostra il numero prenotazione (`codpratica`).
- Da Utenti (admin) si crea, modifica ed elimina un utente, con nome/cognome/email; i blocchi impediscono di rimuovere/declassare l'ultimo admin o il proprio account.
- Suite test verde; nessuna scrittura sul PMS; verificato sul DB reale.
