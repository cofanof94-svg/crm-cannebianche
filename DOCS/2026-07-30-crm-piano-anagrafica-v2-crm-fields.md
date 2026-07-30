# CRM Direct Holiday — Campi manuali Anagrafica v2 — Implementation Plan

> **For agentic workers:** implementare task-per-task. Gli step usano checkbox (`- [ ]`) per il tracking. Mantenere `npm test` verde a ogni task.

**Goal:** Aggiungere alla scheda ospite le sezioni per i **dati manuali** decisi in Anagrafica v2 — **Lingua**, **Intolleranze**, **Preferenze** (per reparto/categoria), **Nucleo di viaggio** (accompagnatori) — tutte CRUD sul DB CRM, più il campo **periodo** nei Claim/complaints.

**Architecture:** Nuovi moduli data-access CRM in `src/crm/` (read/write su DB CRM), esposti estendendo `src/api/clienti.js`. Frontend: nuove sezioni nella pagina `#cliente/<CodCli>` (design system esistente: card, pill, `<dialog>`). Nessuna modifica al PMS (resta live/read-only per anagrafica e storico).

**Tech Stack:** Node 20, Express 5, `mssql`, test `node:test` + `supertest`. Frontend vanilla, `esc` per l'escaping.

## Riferimenti
- SPEC/decisioni: `DOCS/2026-07-30-crm-anagrafica-v2-mapping-specs.md`
- Schema DB già applicato: `scripts/crm-anagrafica-v2.sql` (tabelle `customer_profile`, `customer_intolerances`, `customer_preferences`, `customer_travel_party`; colonna `customer_complaints.periodo`).
- Pattern esistenti da imitare: `src/crm/note.js`, `src/crm/complaint.js`, e le rotte in `src/api/clienti.js`.

## Global Constraints
- CommonJS, no TypeScript. Query parametrizzate. Rotte dietro `requireAuth`.
- Cliente identificato da `Anagra.CodCli` = `pms_customer_id`. Autore = utente in sessione.
- Liste chiuse validate anche lato API (oltre al CHECK del DB): reparto ∈ {Rooms, F&B, SPA, Front office}; categoria ∈ {F&B, Camera, Persona, Occasioni, Generale}; tipo_relazione ∈ {Coniuge, Figlio-a, Genitore, Amico-a, Assistente, Altro}.
- Modificabili/eliminabili da chiunque autenticato (team piccolo), come le note.
- Frontend: stringhe escapate prima di `innerHTML`.

## File Structure
```
src/crm/profilo.js        (nuovo)  getProfilo, upsertLingua
src/crm/intolleranze.js   (nuovo)  list/create/delete
src/crm/preferenze.js     (nuovo)  list/create/update/delete (reparto+categoria+testo)
src/crm/nucleo.js         (nuovo)  list/create/update/delete accompagnatori
src/crm/complaint.js      (mod)    gestione campo periodo
src/api/clienti.js        (mod)    nuove rotte sotto /api/clienti/:codCli/*
web/index.html            (mod)    sezioni Lingua/Intolleranze/Preferenze/Nucleo nella scheda
web/app.js                (mod)    fetch + render + form/<dialog> delle nuove sezioni
web/styles.css            (mod)    stile sezioni (riuso card/pill)
test/crm-profilo.test.js       (nuovo)
test/crm-intolleranze.test.js  (nuovo)
test/crm-preferenze.test.js    (nuovo)
test/crm-nucleo.test.js        (nuovo)
test/clienti-api.test.js       (mod)  copertura nuove rotte + validazioni liste chiuse
```

## Tasks

### 1. Data-access CRM — Profilo/Lingua
- [ ] `src/crm/profilo.js`: `getProfilo(db, pmsCustomerId)` (SELECT), `upsertLingua(db, { pmsCustomerId, lingua, autoreUserId })` (INSERT o UPDATE su UNIQUE `pms_customer_id`).
- [ ] Unit test con `db` finto (upsert: prima INSERT poi UPDATE; parametri corretti).

### 2. Data-access CRM — Intolleranze
- [ ] `src/crm/intolleranze.js`: `listIntolleranze`, `createIntolleranza`, `deleteIntolleranza`.
- [ ] Unit test.

### 3. Data-access CRM — Preferenze
- [ ] `src/crm/preferenze.js`: `listPreferenze`, `createPreferenza`, `updatePreferenza`, `deletePreferenza` (campi reparto, categoria, testo).
- [ ] Unit test (inclusa validazione valori lista chiusa rifiutati).

### 4. Data-access CRM — Nucleo di viaggio
- [ ] `src/crm/nucleo.js`: `listNucleo`, `createMembro`, `updateMembro`, `deleteMembro` (tipo_relazione, nome, cognome, nota).
- [ ] Unit test.

### 5. Complaints — campo periodo
- [ ] `src/crm/complaint.js`: create/update accettano `periodo` opzionale; `listComplaints` lo restituisce.
- [ ] Aggiornare i fake nei test API che riconoscono le query complaints.

### 6. API — nuove rotte in `src/api/clienti.js`
- [ ] `GET/PUT /api/clienti/:codCli/profilo` (lingua).
- [ ] `GET/POST /api/clienti/:codCli/intolleranze`, `DELETE /api/intolleranze/:id`.
- [ ] `GET/POST /api/clienti/:codCli/preferenze`, `PATCH/DELETE /api/preferenze/:id`.
- [ ] `GET/POST /api/clienti/:codCli/nucleo`, `PATCH/DELETE /api/nucleo/:id`.
- [ ] Validazioni: `codCli`/`:id` interi (400); testo non vuoto (400); valori lista chiusa (400 se fuori set).
- [ ] Supertest: happy path + validazioni + `requireAuth`.

### 7. Frontend — sezioni nella scheda ospite
- [ ] **Lingua**: nell'header o box anagrafico, campo editabile (select/lista aperta) → PUT profilo.
- [ ] **Intolleranze**: box "sicurezza" evidenziato, elenco + aggiungi/elimina.
- [ ] **Preferenze**: elenco raggruppato per reparto, con categoria; form `<dialog>` (reparto, categoria, testo).
- [ ] **Nucleo di viaggio**: elenco accompagnatori (relazione, nome, cognome, nota) + CRUD; mostrare accanto agli occupanti reali dal PMS.
- [ ] **Claim**: aggiungere il campo periodo al form complaint esistente.
- [ ] Stati vuoto/caricamento/errore coerenti col resto.

### 8. Verifica
- [ ] `npm test` verde.
- [ ] Prova e2e servendo dati reali: creare/modificare/eliminare voci per un cliente campione e verificarle nel DB CRM.

## Definizione di "fatto"
- Nella scheda ospite si gestiscono Lingua, Intolleranze, Preferenze e Nucleo di viaggio (CRUD), salvati nel DB CRM con autore.
- Liste chiuse validate lato API e DB. Claim con periodo.
- Suite test verde; PMS invariato (read-only).
