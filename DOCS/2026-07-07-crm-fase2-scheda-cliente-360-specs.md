# SPECS — CRM Direct Holiday · Fase 2: Scheda cliente 360°

- **Data:** 2026-07-07
- **Autore:** Mik
- **Stato:** Design approvato
- **Contesto:** Prosegue il CRM (Home/Arrivi/In casa/Utenti già su `main`). Aggiunge la scheda cliente 360°, cuore relazionale del CRM. Usa la tabella `customer_notes` (creata in Fase 1).

---

## 1. Obiettivo e ambito

Dare una **scheda completa del cliente**: chi è, dove è stato (storico soggiorni), quanto vale (statistiche), più le **note interne** del team e i **consensi privacy**. Il cliente è identificato da `Anagra.CodCli`.

**In questa fetta (5 blocchi):**
1. **Anagrafica** — nome, contatti (telefono, cellulare, email), città/provenienza (nazione), data di nascita, codice fiscale, flag VIP, note anagrafiche del PMS (`Annotazioni`).
2. **Statistiche** — n° soggiorni, **totale speso** (= somma degli importi dei soggiorni), prima e ultima visita.
3. **Storico soggiorni** — tutte le prenotazioni del cliente (correnti + storiche).
4. **Note CRM** — note interne del team (crea/modifica/elimina), separate dal PMS.
5. **Consensi privacy** — i flag di consenso presenti in anagrafica (sola lettura).

**Fuori ambito (dopo):** fatturato reale da `Movcass` come "totale speso" (per ora = somma importi soggiorni); marketing/segmentazione; modifica dell'anagrafica PMS (il PMS resta read-only).

---

## 2. Ingressi (come si apre)

- **Clic sul nome ospite** in Arrivi / Clienti in casa → apre la scheda del `codclinterm` di quella riga. (Richiede di esporre `codclinterm` nelle righe di quelle API.)
- **Ricerca globale nella topbar** — campo sempre disponibile: si digita nome/email/cellulare → tendina risultati → clic apre la scheda.
- La scheda è una **pagina intera**, rotta frontend `#cliente/<CodCli>`.

---

## 3. Fonti dati PMS (sola lettura)

- **Anagrafica:** `Anagra` per `CodCli` — `Cognome`, `Nome`, `Telefono`, `Cellulare`, `email`, `Citta`, `CodNaz`, `dtNascita`, `CodFis`, `CodVip`, `Annotazioni`, e i flag consenso `Privacy`, `PrivacyConservaDati`, `PrivacyCessioneDati`.
- **Storico soggiorni:** `Prenota` (attive, `DataEliminazione IS NULL`) ∪ `StorPrenota` (storiche), filtrate per **`codclinterm` = CodCli**, ordinate per `dtarrivo` desc. Per riga: `codpratica`, arrivo, partenza, notti, camera e importo. Camera/importo dal folio corrispondente (`Alberg`/`AlbergDay` per le correnti, `StorAlberg`/`StorAlbergDay` per le storiche); il dettaglio esatto della query si finalizza in fase di piano, verificato su dati reali (il cliente campione DI BARI ha 14 soggiorni: 1 attivo + 13 storici).
- **Statistiche** calcolate dai soggiorni: conteggio, somma importi, min/max data.

## 4. Dati CRM (lettura/scrittura)

- **Note:** tabella `customer_notes` (`id`, `pms_customer_id`, `autore_user_id`, `testo`, `created_at`). `pms_customer_id` = `CodCli`. Autore = utente loggato. **Modificabili/eliminabili da chiunque sia autenticato** (team piccolo).

---

## 5. Backend

- `src/pms/clienti.js` (sola lettura):
  - `cercaClienti(pmsDb, q)` → ricerca `Anagra` (LIKE su Cognome/Nome/email/Cellulare), top ~20 → `{ codCli, nominativo, email, cellulare, citta }`.
  - `getCliente(pmsDb, codCli)` → anagrafica (§3).
  - `getSoggiorniCliente(pmsDb, codCli)` → array soggiorni (§3).
- `src/crm/note.js` (lettura/scrittura CRM):
  - `listNote(db, pmsCustomerId)`, `createNota(db, { pmsCustomerId, autoreUserId, testo })`, `updateNota(db, id, testo)`, `deleteNota(db, id)`.
- `src/api/clienti.js` (tutte `requireAuth`):
  - `GET /api/clienti?q=` → risultati ricerca.
  - `GET /api/clienti/:codCli` → `{ anagrafica, statistiche, soggiorni }`.
  - `GET /api/clienti/:codCli/note` → elenco note (con username autore).
  - `POST /api/clienti/:codCli/note` → crea (autore = sessione).
  - `PATCH /api/note/:id` → modifica testo.
  - `DELETE /api/note/:id` → elimina.
  - Validazione: `codCli`/`:id` interi → 400 se non validi; testo nota non vuoto → 400.

---

## 6. Frontend

- **Vista pagina cliente** (`#view-cliente`, routing `#cliente/<CodCli>`), 5 sezioni:
  1. **Intestazione**: nome grande, badge VIP se presente, contatti (tel/cell/email), città + nazione.
  2. **Statistiche**: 3 card (n° soggiorni · totale speso € · prima/ultima visita).
  3. **Storico soggiorni**: tabella (Num.pratica · Arrivo · Partenza · Notti · Camera · Importo · Stato), ordinata dalla più recente.
  4. **Note CRM**: elenco note (testo · autore · data) con "+ Aggiungi nota" e, per riga, Modifica/Elimina; input in un piccolo form/modale.
  5. **Consensi privacy**: badge Sì/No per i flag anagrafici.
- **Ricerca topbar**: input con tendina risultati (nome — città — email); clic → `#cliente/<CodCli>`.
- **Link dal contesto**: in Arrivi/In casa il nome ospite diventa link a `#cliente/<codclinterm>` (le API arrivi/incasa espongono `codCliente` = codclinterm).
- Stati: caricamento, cliente senza soggiorni (storico vuoto), senza note (invito ad aggiungere), errore PMS (banner). Coerente col design system (card, pill, tabella, `<dialog>`).

---

## 7. Testing

- **`crm/note.js`**: unit con `db` finto (create/update/delete/list, parametri).
- **API note**: supertest (crea/modifica/elimina, validazioni, `requireAuth`).
- **`pms/clienti`**: unit con `pmsDb` finto (mappatura ricerca/anagrafica/soggiorni); query reali verificate end-to-end sui dati veri.
- **Frontend**: verificato servendo dati reali (scheda DI BARI con 14 soggiorni).

---

## 8. Definizione di "fatto"

- Cliccando un ospite (o cercandolo) si apre la sua scheda con anagrafica, statistiche, storico soggiorni reale, note CRM (CRUD) e consensi.
- Le note vengono salvate nel DB CRM con autore e data; il PMS resta in sola lettura.
- Suite test verde; livello `pms/clienti` isolato; verificato sul DB reale.
