# CRM Direct Holiday — Import ibrido (snapshot prenotazioni) — Implementation Plan

> **For agentic workers:** implementare task-per-task, checkbox (`- [ ]`). `npm test` verde a ogni task. **Vincolo assoluto: nessuna scrittura sul PMS** — l'import fa SELECT dal PMS e INSERT/UPDATE solo sul DB CRM.

**Goal:** Introdurre un **import periodico** che copia lo **storico prenotazioni** del PMS in una tabella snapshot del CRM (`booking_snapshot`), con importi già "puliti" (city tax separata) e i **campi congelati** (VIP-prenotazione, Amenities) al momento del soggiorno. Da lì si calcolano i **cumulativi** puliti. L'operativo (Arrivi/In casa/anagrafica) resta **live**.

**Architecture:** Nuovo livello `src/import/` che riusa le query `src/pms/` (SELECT), trasforma (decodifiche Source/Provenienza/Tipologia, split city-tax, calcolo importi lordi folio) e scrive su `booking_snapshot` (+ opzionale `customer_cumulativi`) nel DB CRM via `MERGE` su `codpratica`. Entry point `npm run import`. Scheda ospite: sezione storico+statistiche legge dallo snapshot.

**Tech Stack:** Node 20, `mssql`, test `node:test`. Batch CLI (no HTTP).

## Riferimenti
- DESIGN: `DOCS/2026-07-30-crm-import-ibrido-design.md` (tabella, sync, trade-off).
- Regole dominio importi/città/tassonomie: `DOCS/2026-07-30-crm-anagrafica-v2-mapping-specs.md` §3–§4 e HANDOFF §6.
- Query storico esistenti da riusare/estendere: `src/pms/clienti.js` (`getSoggiorniCliente`).

## Global Constraints
- PMS **read-only**. Import gira col pool PMS in lettura e pool CRM in scrittura.
- Idempotente: rieseguire l'import **aggiorna** le righe (upsert su `codpratica`), non duplica.
- Import **non bloccante**: righe non convertibili → saltate e loggate in un **report anomalie** (file/tabella), l'import prosegue.
- Importi: lordo folio `Matura`+`StorMatura`; **city tax** (`codser='IMP'`) separata in `city_tax`, esclusa da `imp_extra`.
- `valido_cumulativi = 0` per Cancellate (DataEliminazione) e per lo spazzatura di `StorPrenota`.

## File Structure
```
scripts/crm-booking-snapshot.sql   (nuovo)  DDL booking_snapshot (+ customer_cumulativi)
src/import/estrai.js               (nuovo)  SELECT dal PMS (riusa pms/)
src/import/trasforma.js            (nuovo)  decodifiche, split city-tax, importi, valido_cumulativi
src/import/carica.js               (nuovo)  MERGE su booking_snapshot (CRM)
src/import/run.js                  (nuovo)  orchestrazione + report anomalie
package.json                       (mod)    script "import": "node src/import/run.js"
src/pms/clienti.js                 (mod?)   estrarre i campi extra (source, mercato, tipologia, vip, amenities)
src/api/clienti.js                 (mod)    storico+statistiche dallo snapshot (fallback live)
test/import-trasforma.test.js      (nuovo)  unit puro sulle trasformazioni (no DB)
test/import-carica.test.js         (nuovo)  MERGE con db finto
```

## Tasks

### 1. Schema snapshot (DB CRM)
- [ ] `scripts/crm-booking-snapshot.sql` idempotente: `booking_snapshot` (campi da design §2, UNIQUE `codpratica`, index `pms_customer_id`) + opzionale `customer_cumulativi` (1:1).
- [ ] Validare in transazione (rollback) e applicare come per `crm-anagrafica-v2.sql`.

### 2. Estrazione PMS
- [ ] `src/import/estrai.js`: query che per ogni prenotazione valida (Prenota ∪ StorPrenota, per `codclinterm`/occupanti) restituisce i campi grezzi: date, stato, `CodSource`, `CodProvenienza`, `codtip`, trattamento, pax, righe `Matura`/`StorMatura` per importi e city-tax, `CodVip` corrente, `ListaCodAmenities`.
- [ ] Verificare la query sui dati reali (cliente campione con storico ricco).

### 3. Trasformazione (unit puro, no DB)
- [ ] `src/import/trasforma.js`: decodifica Source (`SourcePrenota`), Mercato (`PrenotaProvenienze`), Tipologia (`Tipologie`); calcolo `imp_arrangiamento`, `imp_extra` (city tax esclusa), `city_tax` (`codser='IMP'`); mappa stato (Confermata/Completata/Cancellata); `valido_cumulativi` (regola: escludi Cancellate + euristica spazzatura StorPrenota).
- [ ] Unit test esaustivi (è il cuore logico; niente DB).

### 4. Caricamento (CRM)
- [ ] `src/import/carica.js`: `MERGE booking_snapshot` su `codpratica` (INSERT/UPDATE), set `pms_updated_at`, `imported_at`.
- [ ] Test con `db` finto (verifica MERGE/parametri).

### 5. Orchestrazione + anomalie
- [ ] `src/import/run.js`: apre i due pool, estrai→trasforma→carica in batch; raccoglie righe scartate in un **report anomalie** (log + conteggio); chiude i pool; exit code coerente.
- [ ] Incrementale opzionale: filtro `Prenota.UpdatedAtNewDH > ultimo_import` (marcatore); refresh completo periodico per StorPrenota.
- [ ] `package.json`: script `import`.

### 6. Cumulativi
- [ ] Calcolo (N soggiorni, notti totali, LTV, medie, ultima Source) da `booking_snapshot WHERE valido_cumulativi=1`; scelta se materializzare in `customer_cumulativi` o calcolo al volo.
- [ ] Unit test del calcolo.

### 7. Integrazione scheda ospite
- [ ] `src/api/clienti.js`: sezione storico+statistiche servita dallo snapshot (con VIP/Amenities congelati); fallback live se snapshot assente per il cliente.
- [ ] Eventuale pulsante "aggiorna dati" (refresh on-demand del singolo cliente).

### 8. Scheduling (fuori app)
- [ ] Documentare/predisporre l'esecuzione notturna (task Windows o cron); non parte del processo web.

### 9. Verifica
- [ ] `npm test` verde. Import e2e su dati reali: confronto snapshot vs lettura live per alcuni clienti (coerenza importi, stato, cumulativi).

## Definizione di "fatto"
- `npm run import` popola `booking_snapshot` dal PMS senza mai scriverci; rieseguibile (upsert).
- Cumulativi calcolati solo su soggiorni validi; report anomalie a ogni run.
- Scheda ospite: storico+statistiche+snapshot dallo snapshot; operativo ancora live; PMS invariato.

## Aperti (dal design §6)
- Cadenza esatta; materializzare o no i cumulativi; euristica precisa `valido_cumulativi`; UI refresh on-demand; meccanismo di scheduling.
