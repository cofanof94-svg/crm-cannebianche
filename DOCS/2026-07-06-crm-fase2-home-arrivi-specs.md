# SPECS — CRM Direct Holiday · Fase 2 (parte 1): Home + Arrivi del giorno

- **Data:** 2026-07-06
- **Autore:** Mik
- **Stato:** Design approvato — fonti dati PMS verificate su dati reali
- **Contesto:** Prosegue il progetto CRM (vedi `2026-07-03-crm-directholiday-specs.md`).
  Il Piano 1 (Fondamenta & Auth) è completo su `main`: login a sessione, ruoli
  admin/reception/marketing, gestione utenti, due pool SQL Server (PMS read-only,
  CRM read/write). Questa è la **prima funzionalità operativa** del CRM.

---

## 1. Obiettivo e ambito

Dare al CRM la sua prima schermata utile: una **home dashboard presentabile** e una
**pagina "Arrivi del giorno"** che legge in tempo reale dal PMS. Sostituisce
l'attuale guscio post-login minimale.

**In questa fetta:**
1. **App shell** presentabile: intestazione (nome app, utente, logout) + menù
   laterale (Home, Arrivi, Utenti) + area contenuti, con cambio vista via `#hash`.
2. **Home dashboard**: 3 riquadri KPI — **Arrivi oggi**, **Partenze oggi**,
   **Presenti in casa** — + scorciatoia alla pagina Arrivi.
3. **Pagina Arrivi**: selettore data libero (default oggi), tabella arrivi con
   nominativo, camera/e, pax, notti/partenza, ora prevista, stato check-in,
   provenienza, trattamento, note. **Sola consultazione** (PMS read-only).

**Fuori ambito (fette successive):**
- **Scheda cliente 360°** (le righe arrivi vi si collegheranno in seguito).
- Elenco/ricerca clienti generale, note CRM, report/analisi, marketing.

---

## 2. Vincolo cardine

Il **PMS è in sola lettura**: la pagina Arrivi è una **vista**. Nessuna azione di
check-in/modifica dal CRM (impossibile scrivere sul PMS). Lo stato check-in è
mostrato solo in lettura.

---

## 3. Fonti dati PMS (verificate su dati reali — 2026-07-06)

Tutte SELECT sul pool PMS. Confinate nel livello `pms/`.

- **Arrivi di una data:** `Prenota` con `DataEliminazione IS NULL` e
  `CAST(dtarrivo AS date) = @data`. Cliente via `Anagra.CodCli = Prenota.codcli`
  (`Cognome`,`Nome`; alcune prenotazioni senza nominativo → gruppi/intermediari).
- **Camera/e:** `Alberg` non ha colonna camera. Regola (autore PMS):
  **camera = COALESCE(`AlbergDay.codcam`, `TipoPre.codcam`)**. La camera è sempre
  in `TipoPre.codcam` (pianificata); quando si fa la **roomlist** compare anche in
  `Alberg`+`AlbergDay` (`ad.codalb=al.codalb`, data arrivo in
  `[ad.dtarrivo, ad.dtpartenza)`) con `Alberg.flgincasa='N'` finché non arriva.
  Una prenotazione può avere **più camere** → concatenate (es. "102, 103").
- **Ora arrivo prevista:** `TipoPre.EstTimeArr` (più affidabile di
  `Prenota.OraArrPrevisto`, spesso `__.__`); se vuota/placeholder → "—".
- **Stato check-in:** `Prenota.flgincasa` ('S' = in casa / 'N' = atteso).
- **Trattamento:** `CodArr` → `Arrangia.desarra`.
- **Provenienza:** `Prenota.CodProvenienza` → `PrenotaProvenienze.DesProvenienza`.
- **Pax:** `Prenota.paxadulti` + `paxbambini`. **Notti:** `dtpartenza - dtarrivo`.
- **Note:** `Prenota.Note`.

**Riquadri home (conteggi per la data odierna):**
- Arrivi oggi: `Prenota` con `dtarrivo = oggi`, non eliminate.
- Partenze oggi: `Prenota` con `dtpartenza = oggi`, non eliminate.
- Presenti in casa: `Prenota` con `flgincasa='S'` e oggi in `[dtarrivo, dtpartenza)`.

> Le decodifiche/join esatti (colonne, gestione multi-camera) vengono rifiniti nel
> piano di implementazione; le fonti qui sopra sono confermate su dati reali.

---

## 4. Backend

**Nuovo livello `src/pms/` (sola lettura):**
- `src/pms/prenotazioni.js`:
  - `getArriviByData(pmsDb, data)` → array di arrivi. Ogni riga:
    `{ codpratica, cognome, nome, camere (string), paxAdulti, paxBambini,
       dtpartenza, notti, oraArrivo, inCasa (bool), provenienza, trattamento, note }`.
  - `getRiepilogoGiorno(pmsDb, data)` → `{ arrivi, partenze, presenti }` (numeri).

**Nuove rotte API (autenticate) `src/api/arrivi.js`:**
- `GET /api/arrivi?data=YYYY-MM-DD` → `{ data, arrivi: [...] }`.
- `GET /api/dashboard?data=YYYY-MM-DD` → `{ data, arrivi, partenze, presenti }`.
- Parametro `data` opzionale → default oggi; validazione formato (400 se non valido).
- Montate in `src/app.js` dopo le rotte esistenti, protette da `requireAuth`.

Il pool PMS è già disponibile in `createApp` (`pmsDb`), finora inutilizzato.

---

## 5. Frontend (app shell vanilla)

Evoluzione del frontend esistente (nessun framework, come da vincolo Fase 1).

```
┌─────────────────────────────────────────────┐
│  CRM Direct Holiday          admin   [Esci]   │
├────────────┬────────────────────────────────┤
│  Home      │  [Arrivi oggi] [Partenze] [Presenti] │
│  Arrivi    │                                 │
│  Utenti*   │  (contenuto della vista attiva) │
└────────────┴────────────────────────────────┘
     * voce "Utenti" visibile solo agli admin
```

- **Routing** via `#home` / `#arrivi` / `#utenti` (mostra/nasconde le viste).
- **Home**: 3 card KPI (Arrivi/Partenze/Presenti oggi da `/api/dashboard`); click su
  "Arrivi oggi" porta a `#arrivi`.
- **Arrivi**: selettore data (default oggi) → `GET /api/arrivi?data=...`; tabella con
  le colonne di §3; note espandibili in riga; stati **caricamento**, **nessun
  arrivo per la data**, **errore PMS** (banner, senza rompere l'app).
- **Utenti**: il pannello admin del Piano 1 spostato in questa vista.
- Pulizia estetica: card KPI, tabella leggibile, layout responsivo, palette coerente.

Man mano che `web/app.js` cresce, si può suddividere per vista (es.
`web/js/arrivi.js`, `web/js/home.js`) mantenendo il caricamento statico.

---

## 6. Casi limite (dai dati reali)

- **Nominativo mancante** → "(senza nominativo)".
- **Ora arrivo** vuota o `__.__` → "—".
- **Più camere** per prenotazione → elenco concatenato.
- **Nessuna camera** ancora assegnata (né AlbergDay né TipoPre) → "—".
- **PMS irraggiungibile** → banner d'errore nella vista, resto dell'app funzionante.
- **Data non valida** nel parametro → 400 JSON.

---

## 7. Testing

- **`pms/`**: le funzioni prendono `pmsDb` iniettabile → unit test con `pmsDb` finto
  (verifica shape/mappatura righe, gestione camera COALESCE, note/ora placeholder).
  Inoltre verifica end-to-end con query reali in sola lettura (dati veri: oggi 8 arrivi).
- **API**: supertest con `pmsDb` finto → data default, validazione data, forma
  risposta, `requireAuth`.
- **Frontend**: verificato servendo dati reali dal server (come nel Piano 1).

---

## 8. Struttura file (nuovi/modificati)

```
src/pms/prenotazioni.js     (nuovo)  data-access arrivi/riepilogo
src/api/arrivi.js           (nuovo)  rotte /api/arrivi, /api/dashboard
src/app.js                  (mod)    monta le nuove rotte
web/index.html              (mod)    app shell: header + nav + viste
web/app.js                  (mod)    routing hash + logica home/arrivi/utenti
web/styles.css              (mod)    stile app shell, card KPI, tabella
test/pms-prenotazioni.test.js (nuovo)
test/arrivi-api.test.js       (nuovo)
```

---

## 9. Definizione di "fatto"

- Login → app shell con menù; la home mostra i 3 KPI reali del giorno.
- Pagina Arrivi: scelta data, tabella arrivi reali dal PMS con tutte le colonne,
  stati vuoto/errore gestiti.
- Pannello Utenti (admin) funzionante nella nuova shell.
- Livello `pms/` in sola lettura, isolato; test verdi; nessuna scrittura sul PMS.
