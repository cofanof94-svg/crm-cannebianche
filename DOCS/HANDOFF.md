# HANDOFF — CRM Direct Holiday

Documento di passaggio di consegne. Legge questo e sei operativo. Ultimo aggiornamento: 2026-07-08.

---

## 1. Cos'è

App **CRM web** costruita sopra il PMS alberghiero **Direct Holiday** (sviluppato internamente) per l'hotel **Holiday Canne Bianche Lifestyle Hotel** (Torre Canne di Fasano, Puglia).

- **Legge in tempo reale** dal DB SQL Server del PMS (**SOLO SELECT**, mai scritture).
- Ha un **DB CRM proprio** (SQL Server) per i dati dell'app: utenti/ruoli, note cliente, complaints.
- Frontend **HTML5 statico** (vanilla JS + fetch, nessun framework, nessun build), backend **Node/Express**, API REST, auth a sessione.

Obiettivo principale: **scheda cliente 360°** (chi è, storico soggiorni, quanto ha speso, note/reclami) + viste operative (arrivi, clienti in casa).

---

## 2. Stack & requisiti

- **Node.js 20** (testato su 20.11.1). ⚠️ `mssql@11` (tedious 18) è pinnato apposta per Node 20 — **non aggiornare a mssql@12+** (richiede Node 22).
- Dipendenze: `express@5`, `express-session`, `bcryptjs`, `mssql@11`, `dotenv`. Zero dipendenze frontend.
- Test: **`node:test`** built-in + `supertest`. `npm test` → oggi **82/82 verdi**.
- DB: due database SQL Server sulla stessa istanza `TSASS,2022`, stesso login con permessi differenziati (SELECT-only sul PMS, read/write sul CRM).

---

## 3. Setup rapido

```bash
npm install
# crea .env (vedi sotto) con le credenziali — CHIEDILE A MIK, non sono in git
npm run seed          # crea l'utente admin (usa ADMIN_PASSWORD=... npm run seed per la password)
npm start             # avvia su http://localhost:3000 (PORT da .env)
npm test              # suite (deve essere verde)
```

**`.env`** (git-ignored, mai committarlo). Chiavi richieste (valori = da Mik):

```
PORT=3000
SESSION_SECRET=<stringa lunga a caso>
PMS_SERVER=TSASS
PMS_PORT=2022
PMS_DATABASE=HolidayCanneBianche
PMS_USER=<login>
PMS_PASSWORD=<password>
CRM_SERVER=TSASS
CRM_PORT=2022
CRM_DATABASE=HolidayCanneBianche_CRM
CRM_USER=<login>
CRM_PASSWORD=<password>
```

**Schema DB CRM:** eseguire `scripts/crm-schema.sql` (tabelle `users`, `customer_notes`, `customer_complaints`) sul database CRM. `scripts/crm-users-anagrafica.sql` e `scripts/crm-complaints.sql` sono migrazioni già applicate (idempotenti). Il DB PMS **esiste già** (è il gestionale), non si tocca.

**Login di test:** `admin` / password impostata al seed. C'è anche `reception1`.

---

## 4. Struttura del repo

```
src/
  server.js            entrypoint: apre i pool DB, crea l'app, ascolta su PORT
  app.js               createApp({crmDb,pmsDb,sessionSecret}) → monta le rotte
  config/index.js      legge .env
  db/pms.js db/crm.js  connection pool (PMS read-only, CRM read/write)
  db/query.js          wrapper: db.query(text, params) → recordset (params via request.input)
  auth/                password (bcrypt), middleware (requireAuth/requireRole), routes (login/logout)
  api/
    admin.js           CRUD utenti (solo admin)
    arrivi.js          /api/arrivi, /api/incasa, /api/dashboard (letture PMS, autenticate)
    clienti.js         scheda 360°: ricerca, dettaglio+statistiche, note, complaints
  pms/                 SOLO SELECT sul PMS
    prenotazioni.js    liste arrivi / clienti in casa (fragment COLONNE condiviso) + occupanti
    clienti.js         cercaClienti, getCliente, getSoggiorniCliente
  crm/                 read/write sul DB CRM
    users.js note.js complaint.js
web/
  index.html app.js styles.css   frontend completo (app-shell, routing #hash)
scripts/               crm-schema.sql, seed-admin.js, migrazioni
test/                  *.test.js (node:test + supertest)
DOCS/                  spec/piani per fase + questo HANDOFF
```

**Come sono organizzate le query:** ogni funzione dati prende un `db`/`pmsDb` iniettabile e usa `db.query(sql, params)`; questo rende i moduli testabili con un `pmsDb` finto (i test non toccano il DB reale). Le query PMS stanno TUTTE dentro `src/pms/`.

---

## 5. Database

### PMS (`HolidayCanneBianche`) — SOLA LETTURA
Tabelle chiave usate: `Anagra` (clienti, PK `CodCli`), `Prenota`/`StorPrenota` (prenotazioni correnti/archiviate), `Alberg`/`StorAlberg` + `AlbergDay`/`StorAlbergDay` (folio camera/roomlist), `TipoPre` (camere/tariffe pianificate), `Matura`/`StorMatura` (maturato: arrangiamento+extra), `Trattamenti`, `Persona` (config, contiene la data di lavoro), `Movcass` (fatturato — non ancora usato).

### CRM (`HolidayCanneBianche_CRM`) — READ/WRITE
- `users` (id, username, password_hash bcrypt, role admin|reception|marketing, attivo, nome/cognome/email)
- `customer_notes` (id, pms_customer_id=CodCli, autore_user_id, testo, created_at)
- `customer_complaints` (id, pms_customer_id, autore_user_id, testo, stato 'aperto'|'risolto', created_at, resolved_at)

---

## 6. ⚠️ Regole di dominio PMS (CRITICHE — leggere prima di toccare `src/pms/`)

Queste sono verità del PMS scoperte/confermate con Mik e verificate sui dati reali. Sbagliarle = dati sbagliati (soprattutto sui soldi).

1. **Ospite vs pagante.** L'**ospite/referente** è `Prenota.codclinterm` (join `Anagra.CodCli = codclinterm`), NON `codcli`. `codcli` = intestatario/pagante; `codditta` = Ditta; `codAge` = Adv/TO.

2. **Occupanti della camera.** `Alberg` ha **una riga per occupante**: `Alberg.codcli` = ogni persona fisicamente in camera (referente + accompagnatori). `TipoPre` non ha `codcli`. Il referente NON è automaticamente un occupante.

3. **Camera** = `COALESCE(AlbergDay.codcam per la data, TipoPre.codcam)` — assegnazione reale (roomlist) con fallback alla pianificata. Una prenotazione può avere più camere.

4. **Trattamento / Tariffa (card)** = `COALESCE(Alberg, TipoPre)`: trattamento `codarr` (codice grezzo, es. BB), tariffa `CodConvenzione`.

5. **Importo "tariffa pianificata" (card Arrivi/In casa)** = **somma del `MAX(Alberg.impoeur)` per camera** (Alberg ha una riga per occupante: sommare tutte le righe MOLTIPLICA per i pax → sbagliato). NON usare `SUM` grezzo.

6. **Speso reale (scheda ospite): Arrangiamento vs Extra** — fonte `Matura` ∪ `StorMatura`, agganciate alla camera via `codalb`. Per camera:
   - **Arrangiamento** = `SUM(impoeur)` dove `codarr` NON è nullo/vuoto (righe pensione).
   - **Extra** = `SUM(impoeur)` dove `codarr` è vuoto **E** `flgDistintaArr <> 'S'` (consumi: ristorante, spiaggia, city tax…).
   - Le righe `codarr` vuoto + `flgDistintaArr='S'` sono la **distinta** dell'arrangiamento (stesso totale) → IGNORARE.
   - ⚠️ Leggere SEMPRE `Matura` + `StorMatura` sommando con **subquery correlate per `codalb`** (index seek). NON usare `Matura UNION ALL StorMatura` come derived table: materializza le tabelle intere → ~10× più lento.

7. **Storico soggiorni** = prenotazioni dove il cliente è **referente** (`codclinterm`) **O occupante** (`Alberg`/`StorAlberg.codcli`).

8. **Consensi privacy: logica INVERTITA.** `'S'` = **NON** autorizzato → autorizzato = valore `<> 'S'`. Campi: `Privacy`=Marketing, `Privacy2`=Telefonate in camera, `PrivacyConservaDati`=Conservazione, `PrivacyCessioneDati`=Cessione.

9. **Data di lavoro ("oggi")** = `Persona.Dataggio` (NON l'orologio del server). `getDataLavoro()`.

10. **Stato check-in/partenza:** `Prenota.flgincasa` ('S'=in casa, 'P'=partito); check-out effettuato = `Alberg.flgpar IN ('O','D')`.

Dettaglio completo con esempi verificati: vedi commit history e le spec in `DOCS/`.

---

## 7. Funzionalità implementate

- **Auth** a sessione (cookie httpOnly), ruoli admin/reception/marketing. **CRUD utenti** (solo admin, con guardie anti-lockout: non elimini/declassi te stesso né l'ultimo admin).
- **Home** (KPI arrivi/partenze/presenti del giorno), **Arrivi del giorno**, **Clienti in casa** — rese a **card** ("schede prenotazione"): intestazione (pratica, data creazione, **Referente**, stato), Arrivo→Partenza, **Ospiti in camera** (occupanti cliccabili con camera; mostra anche camere senza occupanti) unito a Trattamento/Tariffa+totale.
- **Scheda ospite 360°** (`#cliente/<CodCli>`): anagrafica, **statistiche** (n° soggiorni, Arrangiamenti, Extra, prima→ultima visita), **storico soggiorni** (per camera: occupanti + arr/extra), **Note CRM** (CRUD), **Complaints** (CRUD + Risolvi/Riapri), **consensi** in box. Si apre cliccando un ospite nelle liste o dalla pagina Ricerca.
- **Ricerca** (voce di menù): per nome/email/cellulare; risultati con telefono e, se in casa, la camera (via occupante).
- Importi in € con 2 decimali (it-IT). Branding "Customer Relationship Management".

Storia per fasi e decisioni: `DOCS/2026-07-*` (spec + piani).

---

## 8. Come lavorare

- **Workflow test:** `npm test` deve restare verde. I test unit usano `db`/`pmsDb` FINTI (nessun DB). I test API usano `supertest` con fake DB. Aggiungendo query, aggiorna i fake che le riconoscono via regex sul testo SQL.
- **Verifica e2e sul DB reale:** scrivere uno scriptino `node` temporaneo che apre il pool con `.env` e chiama le funzioni `pms/*`/`crm/*` (pattern usato spesso durante lo sviluppo). È il modo per confermare le query SQL sui dati veri.
- **Sandbox Windows/PowerShell:** a volte blocca comandi con `*` o indicizzazione `$r['name']`; workaround: `COUNT(1)` e accesso ordinale `$r[0]`.
- **Git:** commit con `git add <file espliciti>` (mai `git add .` — `.env` è ignorato ma per sicurezza). Branch principale: `main`.

---

## 9. Aperti / TODO / note

- **Soggiorni futuri/senza maturato** → Arrangiamento/Extra a 0 (decisione di Mik: "per ora lascia così"). Soggiorni conclusi con `StorAlberg.impoeur` ma senza righe `Matura`/`StorMatura` → mostrano 0 (fallback non deciso).
- Le **card** Arrivi/In casa mostrano la **tariffa pianificata** (`Alberg.impoeur`), la **scheda ospite** mostra il **maturato** (`Matura`): concetti diversi, voluto.
- Complaints senza **categoria** (rinviata). "Totale speso" reale da `Movcass` = fase futura.
- Minor: `?q=` ripetuto in ricerca → 500 (edge); `dataValida` date-overflow; default data in UTC vicino a mezzanotte IT.
- Store sessione = MemoryStore (ok per singola istanza; migrare a store persistente prima della produzione multi-istanza).
- **Roadmap:** Fase 3 report/analisi; marketing/comunicazioni.

---

## 10. Sicurezza

- **PMS = sola lettura.** Qualsiasi query in `src/pms/` deve essere SELECT. Mai INSERT/UPDATE/DELETE sul PMS.
- **Credenziali solo in `.env`** (git-ignored). Mai in codice/git/log. Ruotare la password è consigliato.
- Le note/complaints scrivono **solo** sul DB CRM. Tutte le rotte dati sono dietro `requireAuth`; l'admin dietro `requireRole('admin')`. Output escapato lato frontend (helper `esc`) → niente XSS. Query parametrizzate.

---

**Contatto dominio/PMS:** Mik (autore del PMS). Per dubbi su come il PMS registra un dato, chiedere a lui: la logica del gestionale non è sempre intuitiva (vedi §6).
