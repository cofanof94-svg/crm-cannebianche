# DESIGN — CRM Direct Holiday · Import ibrido (live + snapshot)

- **Data:** 2026-07-30
- **Autore:** Mik (decisione architetturale) · design tecnico
- **Stato:** Proposta di design — da validare prima del piano di implementazione
- **Deriva da:** `DOCS/2026-07-30-crm-anagrafica-v2-mapping-specs.md` (§4.7 architettura ibrida)

---

## 1. Perché ibrido

Oggi l'app legge il PMS **solo live** (real-time SELECT). Va benissimo per l'operativo, ma **non può fotografare** un valore com'era in passato: se `Anagra.CodVip` o le amenities cambiano, lo storico "vero al momento del soggiorno" è perso. I desiderata chiedono esplicitamente questi **snapshot** (VIP-prenotazione, Amenities). Inoltre i **cumulativi** (N soggiorni, LTV, medie) calcolati live ogni volta sono costosi e fragili (vedi record spazzatura di `StorPrenota`).

**Scelta:** tenere il **live** dove serve freschezza, aggiungere un **import periodico** dove serve storia/velocità/robustezza.

| Ambito | Modalità | Perché |
|--------|----------|--------|
| Arrivi, Clienti in casa | **Live** | Devono essere sempre freschi (check-in in corso). |
| Scheda ospite: anagrafica, contatti, consensi | **Live** | Dati correnti del cliente. |
| Scheda ospite: **storico soggiorni + statistiche** | **Import (snapshot)** | Foto storiche, cumulativi veloci, resistenza se PMS è giù. |
| Campi-snapshot (VIP-preno, Amenities) | **Import** | Congelati al momento del soggiorno. |
| Dati CRM (note, complaints, preferenze, ecc.) | Nativi CRM | Già read/write nel DB CRM. |

Il PMS resta **sola lettura**: l'import fa `SELECT` dal PMS e `INSERT/UPDATE` **solo** sul DB CRM (permessi già così).

## 2. Tabella di snapshot (DB CRM)

Una riga per **prenotazione valida** del cliente, denormalizzata per query cumulative rapide.

```
booking_snapshot
  id                INT IDENTITY PK
  codpratica        INT        -- chiave PMS della prenotazione (UNIQUE)
  pms_customer_id   INT        -- codclinterm (ospite/referente) = Anagra.CodCli
  dtarrivo          DATE
  dtpartenza        DATE
  notti             INT
  stato             NVARCHAR(20)   -- Confermata | Completata | Cancellata
  source            NVARCHAR(60)   -- da SourcePrenota (decodificato)
  mercato           NVARCHAR(60)   -- da PrenotaProvenienze (decodificato)
  camere            NVARCHAR(100)  -- es. "204, 205"
  tipologia         NVARCHAR(100)  -- da Tipologie (decodificato)
  trattamento       NVARCHAR(20)   -- BB/HB/FB/AI…
  pax               INT
  imp_arrangiamento DECIMAL(12,2)  -- lordo folio
  imp_extra         DECIMAL(12,2)  -- extra, city tax ESCLUSA
  city_tax          DECIMAL(12,2)  -- separata (non nei ricavi)
  vip_snapshot      NVARCHAR(20)   -- Anagra.CodVip congelato all'import
  amenities_snapshot NVARCHAR(MAX) -- Prenota.ListaCodAmenities congelato
  valido_cumulativi BIT            -- 0 per Cancellata / record spazzatura
  pms_updated_at    DATETIME2      -- marcatore incrementale (UpdatedAtNewDH)
  imported_at       DATETIME2 DEFAULT SYSUTCDATETIME()
  UNIQUE(codpratica)
  INDEX(pms_customer_id)
```

> `valido_cumulativi` è la chiave per i cumulativi puliti: 1 solo per soggiorni reali (Confermata/Completata, importo o occupanti presenti), 0 per Cancellate e per lo **spazzatura** di `StorPrenota` (DOPPIA/test/prova/fittizia/ERRORE — `Motivo` testo libero: si filtra con euristiche + `DataEliminazione`).

I **cumulativi** (N soggiorni, notti totali, LTV, medie, ultima Source) si calcolano da `booking_snapshot WHERE valido_cumulativi = 1`, opzionalmente materializzati in una `customer_cumulativi` (1:1) aggiornata a fine import.

## 3. Strategia di sync

- **Cadenza:** batch **notturno** (es. 03:00) su tutto lo storico + le prenotazioni correnti. Comando: `npm run import` (nuovo script `src/import/run.js`).
- **Incrementale:** dove possibile filtrare per `Prenota.UpdatedAtNewDH > ultimo_import` (marcatore già presente nel PMS). `StorPrenota` è per lo più statico → refresh completo periodico (es. settimanale) + incrementale sulle correnti.
- **Upsert:** `MERGE` su `codpratica` (aggiorna la riga esistente, inserisce le nuove). Un reimport della stessa pratica **aggiorna**, non duplica (coerente col desiderata "anti-duplicato").
- **On-demand (opzionale):** all'apertura della scheda, un refresh mirato del singolo cliente, per non aspettare il batch notturno.
- **Robustezza:** conversioni tipi non bloccanti; righe non convertibili → saltate e loggate in un **report anomalie** (come da Legenda del file desiderata).

## 4. Come cambia l'app

- **`src/import/`** (nuovo): estrae dal PMS (riusa le query `pms/`), trasforma (decodifiche Source/Provenienza/Tipologia, calcolo city-tax e importi), scrive su `booking_snapshot`/`customer_cumulativi` nel CRM.
- **Scheda ospite:** la sezione *storico + statistiche* legge da `booking_snapshot` (con i campi-snapshot); l'header anagrafico resta live. Le sezioni Arrivi/In casa **non cambiano** (restano live).
- **Nessuna scrittura sul PMS.** L'import gira col pool CRM in scrittura e col pool PMS in lettura.

## 5. Trade-off

- ✅ Snapshot storici, cumulativi rapidi/puliti, resilienza a PMS non raggiungibile, carico PMS spostato di notte.
- ⚠️ Dato storico **non istantaneo** (fino al prossimo import); complessità di sync e gestione anomalie; storage duplicato (accettabile, solo campi utili).
- Mitigazioni: refresh on-demand per cliente; marcatore incrementale; `valido_cumulativi` per la qualità dati.

## 6. Aperti da decidere nel piano

- Cadenza esatta e finestra (notturna? ogni N ore?).
- Materializzare `customer_cumulativi` o calcolare al volo dallo snapshot.
- Euristica precisa per `valido_cumulativi` (quali `Motivo`/condizioni marcano spazzatura).
- Se e come esporre un pulsante "aggiorna dati" nella scheda (refresh on-demand).
- Scheduling: cron di sistema, `node-cron`, o task Windows.

## 7. Definizione di "fatto" (per il futuro piano)

- Script `npm run import` che popola `booking_snapshot` dal PMS senza mai scrivere sul PMS.
- Scheda ospite: storico + statistiche + campi-snapshot serviti dallo snapshot; operativo ancora live.
- Cumulativi calcolati solo su soggiorni validi; report anomalie prodotto a ogni run.
