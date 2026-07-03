# SPECS — CRM Direct Holiday

- **Data:** 2026-07-03
- **Autore:** Mik
- **Stato:** Design approvato — schema PMS acquisito (connessione verificata 2026-07-03)
- **Tipo:** Documento di specifica (design)

---

## 1. Obiettivo

Web app **CRM** costruita sopra il PMS **Direct Holiday**. Il PMS è sviluppato
internamente e dispone di una base dati **SQL Server**; per il CRM è stato creato
un accesso in **sola lettura** a tale database.

Il CRM aggiunge al PMS funzionalità di relazione con il cliente e di analisi, senza
mai modificare i dati del PMS.

### Scopo — Fase 1 (in questo documento)

1. **Vista 360° cliente** — anagrafica, contatti, storico soggiorni, preferenze
   (dal PMS) arricchiti con **note CRM** (dati propri dell'app).
2. **Report / analisi** — dashboard con KPI live dal PMS.

### Roadmap (fasi successive, fuori scope ora)

- **Marketing & comunicazioni** — segmentazione clienti e invio/tracciamento
  campagne (email/altro canale). Canale e provider **da definire**.
- **Layer di cache / sync** dei dati PMS, da valutare **solo se** i report live
  gravano troppo sul DB di produzione.

---

## 2. Vincoli e decisioni chiave

| Tema | Decisione |
|------|-----------|
| Backend | **Node.js** (Express) |
| Frontend | **HTML5** statico (HTML + CSS + JavaScript vanilla, chiamate `fetch`) |
| Forma app | **Opzione A** — API REST + frontend HTML5 statico disaccoppiati |
| Dati PMS | **Query live** sul DB SQL Server in **sola lettura** (nessun sync in fase 1) |
| DB del CRM | **SQL Server** (secondo database, in lettura/scrittura) — stesso ecosistema |
| Utenti | Team con **ruoli differenziati**: admin, reception, marketing |
| Isolamento | Tutte le query PMS confinate in un unico modulo (`pms/`) |

### Trade-off accettati

- **Query live sul PMS**: dati sempre freschi e zero storage duplicato, ma carico
  sul DB di produzione e accoppiamento allo schema PMS. Mitigazione: livello di
  isolamento `pms/` + possibile cache/sync futura se necessario.

---

## 3. Architettura

Un unico processo Node.js (Express) che:

- serve il **frontend HTML5 statico** (`web/`);
- espone una **API REST** (`/api/...`);
- mantiene **due connection pool separati** verso SQL Server.

```
Browser (HTML5 + JS)  ──fetch──▶  API REST (Express)
                                      │
                          ┌───────────┴───────────┐
                          ▼                        ▼
                  pool PMS (read-only)      pool CRM (read/write)
                  SQL Server produzione     SQL Server CRM
```

### Principio chiave — livello di isolamento PMS

Tutte le query verso il PMS vivono **solo** nel modulo `pms/`. Il resto dell'app
non conosce lo schema del PMS: richiede concetti di dominio (es. "clienti",
"storico soggiorni"), non tabelle/colonne. Se lo schema del PMS cambia, si modifica
soltanto questo modulo.

---

## 4. Struttura del backend

Moduli a responsabilità singola:

```
src/
├─ config/   → variabili ambiente, stringhe di connessione (da .env, mai in git)
├─ db/       → creazione e gestione dei due pool (pms, crm)
├─ pms/      → data-access PMS: SOLO SELECT (guests, soggiorni, fatturato)
├─ crm/      → data-access CRM: utenti, ruoli, note, segmenti
├─ auth/     → login, sessioni, middleware di ruolo
├─ api/      → route REST (customers, reports, notes, admin)
└─ web/      → frontend HTML5 statico servito da Express
```

**Dipendenze tra moduli** (una direzione, dall'alto in basso):
`api/` → (`pms/`, `crm/`, `auth/`) → `db/` → `config/`.
Il frontend `web/` dipende solo dalla API REST, non dai moduli interni.

---

## 5. Modello dati — DB del CRM

Il DB del CRM contiene **solo** ciò che non esiste nel PMS. Tabelle iniziali:

- **users** — `id`, `username`, `password_hash` (bcrypt), `role`, `attivo`,
  `created_at`.
- **roles** — insieme dei ruoli: `admin`, `reception`, `marketing` (estendibile).
- **customer_notes** — note CRM legate a un cliente PMS: `id`,
  `pms_customer_id` (riferimento logico all'ID cliente nel PMS), `autore_user_id`,
  `testo`, `created_at`.

> Il collegamento tra note CRM e cliente PMS è **logico** (per ID), non un vincolo
> di chiave esterna cross-database: il PMS è in sola lettura e su DB separato.

Tabelle per il marketing (segmenti, campagne) **non** sono definite ora: fanno
parte della roadmap.

---

## 6. Livello di accesso al PMS (`pms/`)

Definisce **interfacce** stabili; le tabelle/colonne reali del PMS sono ora note
(vedi §13). Interfacce previste, con mappatura alle tabelle PMS:

- `getClienti({ ricerca, pagina, perPagina })` → elenco/ricerca clienti.
  Fonte: `Anagra` (ricerca su `Cognome`/`Nome`/`DesCli`/`email`).
- `getClienteById(codCli)` → anagrafica del singolo cliente. Fonte: `Anagra`
  (+ `AnagraContatti` per i contatti aggiuntivi).
- `getSoggiorniByCliente(codCli)` → storico soggiorni. Fonte: **`Prenota` ∪
  `StorPrenota`** filtrate per `codcli`, ordinate per `dtarrivo` desc.
- `getFatturatoByCliente(codCli)` → documenti/importi. Fonte: `Movcass` via
  `codpratica` dei soggiorni del cliente (escludendo `flgAnnullato`).
- `getConsensiCliente(codCli)` → flag privacy da `Anagra`
  (`Privacy`, `PrivacyConservaDati`, `PrivacyCessioneDati`); dettaglio consensi
  da `GdprLog`/`GdprConsensi` (per uso marketing futuro).
- Funzioni per i report, es. `getKpiOccupazione(periodo)`,
  `getKpiFatturato(periodo)` (su `Movcass`), `getProvenienzaClienti(periodo)`
  (su `Prenota.CodProvenienza`/`Anagra.CodNaz`), `getOspitiRicorrenti(periodo)`
  (clienti con più `codpratica`). Set esatto da rifinire in fase di piano.

**Regola invariante:** questo modulo esegue **esclusivamente `SELECT`**. Il pool
PMS usa le credenziali read-only, quindi qualsiasi scrittura fallisce per
costruzione.

---

## 7. API REST (bozza endpoint)

Tutti gli endpoint (tranne il login) richiedono sessione valida; alcuni richiedono
un ruolo specifico.

| Metodo | Endpoint | Ruolo | Descrizione |
|--------|----------|-------|-------------|
| POST | `/api/auth/login` | pubblico | Login, crea sessione |
| POST | `/api/auth/logout` | autenticato | Chiude sessione |
| GET | `/api/customers` | reception, admin | Elenco/ricerca clienti (PMS) |
| GET | `/api/customers/:id` | reception, admin | Scheda 360° cliente (PMS + note) |
| GET | `/api/customers/:id/notes` | reception, admin | Note CRM del cliente |
| POST | `/api/customers/:id/notes` | reception, admin | Aggiunge nota CRM |
| GET | `/api/reports/:tipo` | admin (config.) | KPI/report live dal PMS |
| GET/POST/PUT/DELETE | `/api/admin/users` | admin | Gestione utenti e ruoli |

La matrice ruolo→endpoint è indicativa e verrà rifinita in fase di piano.

---

## 8. Autenticazione e ruoli

- Login con username/password; password come **hash bcrypt** nel DB CRM.
- Sessione tramite **cookie httpOnly** (semplice e sicuro per app interna).
- Ruoli iniziali: **admin**, **reception**, **marketing** (estendibili).
- Middleware di autorizzazione per ruolo su ogni route protetta.
- L'**admin** crea/modifica/disattiva utenti dall'app.

---

## 9. Frontend (HTML5)

- HTML5 + CSS + JavaScript vanilla, servito come statico da Express.
- Pagine iniziali: **login**, **elenco clienti**, **scheda cliente 360°**,
  **dashboard report**, **amministrazione utenti**.
- Comunica con il backend solo via API REST (`fetch`), nessun accoppiamento ai
  moduli interni.

---

## 10. Gestione errori & testing

**Errori**

- Distinzione netta tra guasto **PMS** (es. DB non raggiungibile) ed errore **CRM**:
  un problema sul PMS mostra un messaggio nella sezione interessata senza bloccare
  il resto dell'app.
- Nessuna scrittura possibile sul PMS (pool read-only) → protezione per costruzione.

**Testing**

- Unit test sul data-access **CRM** con DB di test.
- Livello **PMS** testato contro uno schema di riferimento/fixture, così i test
  girano senza dipendere dal DB di produzione.

---

## 11. Connessione PMS — verificata

Connessione in sola lettura testata con successo il **2026-07-03**:

- **Server:** `TSASS,2022` (host `TSASS`, porta `2022`)
- **Database:** `HolidayCanneBianche`
- **Utente:** `g.mangano` (sola lettura)
- **SQL Server:** versione 16.x (2022) — 376 tabelle nello schema `dbo`.

> **Sicurezza:** le credenziali NON vanno in codice né in file versionati.
> Vivono in un file **`.env`** locale (escluso da git via `.gitignore`), letto dal
> modulo `config/`. Consigliata la **rotazione della password** (condivisa in chat).

Schema delle tabelle rilevanti documentato in §13. Nessun blocco residuo per la
Fase 1.

### Database del CRM (read/write) — verificato

- **Server:** `TSASS,2022` (stessa istanza del PMS)
- **Database:** `HolidayCanneBianche_CRM` (già esistente)
- **Utente:** `g.mangano` — **stesso login** del PMS, ma con permessi differenziati
  a livello di database: **read/write completo** su `HolidayCanneBianche_CRM`,
  **solo `SELECT`** su `HolidayCanneBianche`. Prova di scrittura riuscita il
  2026-07-03. La separazione read-only PMS è quindi garantita dal DB stesso.

---

## 12. Definizione di "fatto" — Fase 1

- Login funzionante con ruoli e gestione utenti (admin).
- Elenco/ricerca clienti e scheda 360° con storico soggiorni dal PMS + note CRM.
- Almeno una dashboard report con KPI live dal PMS.
- Due pool SQL Server separati (PMS read-only, CRM read/write) operativi.
- Test sui livelli data-access.

---

## 13. Appendice — Mappatura schema PMS (tabelle rilevanti)

Schema `dbo` del database `HolidayCanneBianche`. Solo le colonne utili al CRM.

### `Anagra` — anagrafica clienti/ospiti
- `CodCli` (int, **PK**) — identificativo cliente.
- `flganagra` — tipo anagrafica (persona/azienda).
- `DesCli`, `Nome`, `Cognome`, `Sesso`, `Titolo` — dati identità.
- `Indirizzo`, `CAP`, `Citta`, `CodPro` (provincia), `CodNaz` (nazione),
  `StatoNascita`, `CodNazCittadinanza` — residenza/provenienza.
- `CodFis`, `ParIva` — dati fiscali.
- `Telefono`, `Cellulare`, `email`, `MailPEC`, `Web` — contatti.
- `dtNascita`, `CittaNasc` — nascita.
- `CodVip`, `CodCatCom`, `CodSource` — segmentazione (VIP, categoria, sorgente).
- `Annotazioni`, `Memo`, `Amenities` — note libere presenti nel PMS.
- `Privacy`, `Privacy2`, `PrivacyConservaDati`, `PrivacyCessioneDati`, `OPPRIVACY`
  — flag consensi GDPR.
- `DataInserimento`, `DtOraModifica` — audit.

### `AnagraContatti` — contatti aggiuntivi
- `CodCli` (FK → `Anagra`), `DesContatto`, `Titolo`, `Telefono`, `email`, `Skype`.

### `Prenota` — prenotazioni attive / correnti
- `codpratica` (int, **PK**), `codcli` (FK → `Anagra`).
- `dtarrivo`, `dtpartenza`, `dtprenota`.
- `paxadulti`, `paxbambini`, `paxneonati`, `paxragazzi`.
- `impoeur` — importo pratica in EUR.
- `CodProvenienza`, `CodSource`, `CodMezzoCom`, `CodConvenzione`, `CodCatCom`.
- `Note`, `DataEliminazione`, `Motivo` — annullamenti.
- `BookingReference`.

### `StorPrenota` — prenotazioni storiche/archiviate
- Struttura identica a `Prenota`. Per lo **storico completo** di un cliente:
  `Prenota` ∪ `StorPrenota` su `codcli`.

### `Alberg` — dettaglio conto alberghiero (riga camera per soggiorno)
- `codpratica` (FK → prenotazione), `codcli`, `codalb` (camera), `codarr`
  (arrangiamento/trattamento), `impoeur`.
- Dati ISTAT del soggiorno, `PaxEta*` per fascia d'età.
- (`StorAlberg` = versione storica.)

### `Movcass` — movimenti di cassa / documenti (fatturato)
- `codconto` (**PK**), `codpratica`, `DataDoc`, `Tipodoc`, `NumDoc`.
- `TotDocEur` — totale documento in EUR; imponibili/imposte per aliquota.
- `flgAnnullato`, `flgEmissione` — stato documento (escludere annullati nei KPI).
- `dataArrivo`, `dataPartenza`, campi `Intesta_*` — intestazione.

### Lookup di supporto
- `Nazioni` / `Comuni` / `Province` — decodifica provenienza.
- `MezziComunicazione` (`CodMezzoCom`, `DesMezzoCom`) — canali.
- `GdprConsensi` / `GdprLog` — definizioni e log consensi (marketing futuro).
- `CRMProfili` — **da ignorare**: appartiene all'integrazione del PMS con un
  altro CRM esterno, non riguarda questa app.

> Nota: molte tabelle hanno campi `SyncNewDH`/`GuidNewDH`/`UpdatedAtNewDH` legati a
> una sincronizzazione interna del PMS ("NewDH"); non rilevanti per il CRM in sola
> lettura, ma `UpdatedAtNewDH` potrebbe servire come marcatore temporale se in
> futuro introdurremo un sync incrementale.
