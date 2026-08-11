# Checklist per il rientro in hotel

> Tutto ciò che è stato sviluppato fuori dalla rete dell'hotel è stato provato contro
> il server di sviluppo con dati finti (`npm run dev:mock`), che **riconosce le query
> per espressione regolare senza eseguirle**: valida l'interfaccia e la logica, non
> il SQL. Questa lista è ciò che resta da fare con il database vero davanti.
>
> Aggiornata all'11/08/2026.

---

## 1. Da fare PRIMA di mettere in produzione

Due migrazioni sul DB CRM (`HolidayCanneBianche_CRM`). **Senza queste la sezione
Complaints va in errore**: l'app chiede colonne che non esistono ancora.
Entrambe idempotenti — rilanciarle non fa danni.

```bash
sqlcmd -S CB-DH -d HolidayCanneBianche_CRM -i scripts/crm-complaint-followup.sql
```
```bash
sqlcmd -S CB-DH -d HolidayCanneBianche_CRM -i scripts/crm-complaint-reparto.sql
```

| Script | Cosa aggiunge | Perché serve |
|---|---|---|
| `crm-complaint-followup.sql` | `customer_complaints.follow_up` | il campo "come è stato risolto", obbligatorio alla risoluzione |
| `crm-complaint-reparto.sql` | `customer_complaints.reparto`, `.categoria` (+ CHECK) | classificazione per reparto |

**Le allergie non richiedono nulla**: scrivono in `customer_intolerances`, che esiste
già da mesi.

Facoltativa, quando capita: `crm-data-nascita.sql` (in fondo al file) fa il DROP di
`customer_profile.data_nascita`, colonna rimasta inutilizzata da quando la data di
nascita è tornata in sola lettura dal PMS. Verificare prima che sia vuota.

---

## 2. Query mai eseguite su SQL Server vero

Da guardare al primo avvio: se una è sbagliata, l'errore si vede subito.

- [ ] `listNotePersonali` — `src/crm/profilo.js` (SELECT su `customer_profile`)
- [ ] `getStoricoByIds` — `src/pms/clienti.js` (COUNT DISTINCT su StorAlberg/StorPrenota)
- [ ] `getAnagreConfronto` — `src/pms/duplicati.js`

⚠️ Attenzione particolare a `getStoricoByIds`: il rischio non è l'errore SQL ma il
**doppio conteggio** fra prenotazioni correnti e concluse. Verificare su un ospite di
cui si conosce il numero reale di soggiorni che il badge "Nª volta" dica il vero.

---

## 3. Verifiche con dati veri, funzione per funzione

### Allergie proposte dalle note PMS
La verifica più importante, perché il vocabolario è tarato su note inventate.

- [ ] Aprire Arrivi e In casa e guardare **quante proposte escono** su una giornata vera
- [ ] Raccogliere le **frasi vere non riconosciute** (falsi negativi) → si aggiungono
      a `SOSTANZE` in `src/crm/allergie-note.js`, con un test, in mezz'ora
- [ ] Raccogliere le **proposte sbagliate** (falsi positivi) → capire se il problema è
      la frase o il marcatore
- [ ] Decidere se serve rendere permanente il pulsante **Ignora** (oggi dura quanto la
      sessione del browser). Richiede una tabella → migrazione
- [ ] Valutare se leggere anche `Anagra.Annotazioni`: è per-persona, quindi senza il
      problema di attribuzione (basta una colonna in più nella query batch esistente)

Dettagli e regole: [2026-08-11-allergie-da-note-pms.md](2026-08-11-allergie-da-note-pms.md)

### Complaint
- [ ] Risolvere un reclamo vero e verificare che il **follow-up** sia obbligatorio
- [ ] Controllare quanti reclami storici restano **"da classificare"** e classificarli
- [ ] Verificare che le **categorie proposte** (Pulizia, Manutenzione, Rumore, Servizio,
      Cibo e bevande, Attesa, Conto, Altro) rispecchino i reclami reali. La lista è in
      `CATEGORIE_COMPLAINT` e nel CHECK della migrazione: cambiarla dopo costa di più

### Export per i reparti
- [ ] Stampare un foglio vero e vedere se sta in **una pagina A4 orizzontale** con i
      volumi reali (le note vere sono più lunghe di quelle finte)
- [ ] Farlo leggere a un reparto: le colonne sono quelle giuste?
- [ ] Aprire il CSV in Excel e controllare accenti e separatore

### Note personali nelle card
- [ ] Le note scritte in reception restano leggibili tagliate a ~90 caratteri?
      Se la prima frase è sempre una premessa lunga, conviene cambiare la regola

### Importi
- [ ] Riconfermare con la software house del PMS (vedi la nota PENDING sugli importi)

### Merge / duplicati
- [ ] Provare su casi reali, es. Brolin 48758 / 55491 / 31355

### Funzioni AI
Sul mock rispondono **sempre** 503, perché `dev-mock.js` non carica il `.env`:
non sono mai state provate davvero.

- [ ] Guest Briefing dalla card Arrivi
- [ ] Suggerisci preferenze
- [ ] Genera note personali con AI
- [ ] Verificare che il pulsante resti spento dopo una generazione riuscita

---

## 4. Da sviluppare in hotel

### Priorità alta: due migrazioni che perdono dati ogni giorno che passa
Nessuna delle due recupera il passato, quindi prima si fanno prima si inizia a
raccogliere.

- [ ] **`ai_events`** — oggi le chiamate all'AI finiscono solo in un `console.log`.
      Senza questa tabella non si potrà mai sapere quante proposte l'AI ha fatto e
      quante ne sono state scartate: è il denominatore dell'acceptance rate
- [ ] **`origine` sulle preferenze** — una preferenza confermata da un suggerimento
      passa dalla stessa POST di una scritta a mano. Le preferenze salvate NON si
      perdono; si perde solo la provenienza

### Dashboard Analytics
Analisi già fatta, da riusare: [2026-08-10-analytics-dashboard-analisi.md](2026-08-10-analytics-dashboard-analisi.md).
Rimandata apposta per non scrivere aggregati alla cieca.

### Export per intervallo di date
Oggi l'export copre **una** data (quella mostrata dalla pagina). L'intervallo richiede
una query PMS nuova: `SQL_ARRIVI` legge un giorno alla volta.

*(Le viste per reparto — F&B, Housekeeping, SPA, Concierge — si fanno invece da
remoto: basta una voce in `VISTE_EXPORT` in `web/export.js`.)*

---

## 5. Nota sul server di sviluppo

I dati del mock **non sono persistenti**: vivono in memoria e a ogni riavvio si
riparte dalle fixture. Il DB vero ovviamente no. Se durante le prove serve
persistenza fra un riavvio e l'altro, è una ventina di righe da aggiungere.
