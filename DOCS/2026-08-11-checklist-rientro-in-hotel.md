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

Una terza, **non obbligatoria ma consigliata**, per i ruoli utente:

```bash
sqlcmd -S CB-DH -d HolidayCanneBianche_CRM -i scripts/crm-ruoli.sql
```

Non cambia lo schema (`users.role` è già `NVARCHAR(20)` senza CHECK): converte gli
utenti con il vecchio ruolo `marketing` in `readonly` ed elenca eventuali ruoli
inattesi. Anche senza lanciarlo l'applicazione è sicura — un ruolo sconosciuto vale
sola lettura — ma nella pagina Utenti quel ruolo compare con l'etichetta gialla
"non previsto". **Leggere l'elenco che stampa prima di proseguire**: se saltano
fuori ruoli che non ti aspetti, guardali uno per uno.

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
- [ ] **`cancellaNotePersonali` e `cancellaLingua`** — `src/crm/profilo.js` (12/08, due
      UPDATE su `customer_profile`). Si provano premendo **Elimina** sulla nota
      personale e sulla lingua di un ospite qualsiasi: se la query è sbagliata
      l'errore si vede subito

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

### Limiti di lunghezza dei campi (nuovi del 12/08)
I tetti sono presi dalle colonne del CRM, ma finora provati solo contro il database
finto. Se un limite fosse più stretto della realtà, si bloccherebbe chi scrive.

- [ ] Incollare una **preferenza lunga** (oltre 400 caratteri) e verificare che il
      messaggio dica quanto ci sta, invece di non far succedere niente
- [ ] Idem per un'**allergia** (200) e per una **nota del nucleo** (400)
- [ ] Se qualche reparto scrive davvero più lungo di così, il tetto va alzato **nella
      colonna e nel codice insieme** (`LIMITI` in `src/api/clienti.js`)

### Importi
- [ ] Riconfermare con la software house del PMS (vedi la nota PENDING sugli importi)

### Merge / duplicati
- [ ] Provare su casi reali, es. Brolin 48758 / 55491 / 31355

### Ruoli e permessi
I tre ruoli sono `readonly`, `reception`, `admin`. Sul server finto ci sono quattro
utenti (`admin`, `reception`, `lettore`, `vecchio`), tutti con password `admin`.

- [ ] Guardare **quali ruoli hanno davvero gli utenti dell'hotel** e assegnare a
      ciascuno quello giusto: chi sta al banco `reception`, la direzione `admin`,
      chi consulta e basta `readonly`
- [ ] Entrare come `readonly` e verificare che la reception **non si senta
      bloccata per errore**: se qualcuno che deve lavorare finisce con quel ruolo,
      vede sparire i pulsanti e pensa a un guasto (per questo c'è il badge
      "Sola lettura" accanto al nome — verificare che si noti)
- [ ] Provare il giro completo: creare un utente, cambiargli ruolo, disattivarlo
- [ ] Controllare che resti **almeno un admin attivo**: l'applicazione lo impedisce,
      ma vale la pena vederlo succedere

### Funzioni AI
Dall'11/08 `dev-mock.js` carica il `.env`, quindi **si provano anche da casa**: le
chiamate all'AI non passano dal DB dell'hotel. Provate davvero, sul mock:
Guest Briefing su personaggio pubblico (OK) e su nome ambiguo (OK, nessuna
informazione). Restano da vedere con dati veri:

- [ ] Suggerisci preferenze
- [ ] Genera note personali con AI dalla scheda
- [ ] Verificare che il pulsante resti spento dopo una generazione riuscita

### Briefing AI — profili professionali (LinkedIn)
Dall'11/08 il briefing cerca anche i **profili professionali**, per riconoscere i
manager che non sono personaggi pubblici. Tre esiti possibili, con etichette
diverse in card: *Personaggio pubblico*, *Profilo professionale*, *Identità da
confermare* (quest'ultima non è salvabile nel profilo).

- [ ] **Vedere almeno un caso "Profilo professionale" vero**: sul mock non è mai
      uscito, perché servirebbe il nome di una persona reale non famosa e non
      volevo metterne uno nel repo. È la verifica principale
- [ ] Controllare che con ospiti **corporate** (mail aziendale) l'identificazione
      sia certa: il dominio della mail è la prova che usiamo contro l'omonimia
- [ ] Controllare il contrario: su nomi comuni con mail generica NON deve uscire
      un ruolo dato per certo. Se succede, la regola dei due riscontri non tiene
- [ ] Decidere se allargare a ruolo/azienda anche i **gruppi aziendali**

### Fonti del briefing
Sistemato l'11/08: l'elenco mostrava **tutti i risultati della ricerca**, letti o
no (16 su un ospite noto, molti blog). Ora mostra le fonti che il modello ha
davvero **citato**; i risultati grezzi restano come ripiego, al massimo 6 e sotto
un'etichetta diversa ("Risultati della ricerca — non citati dall'AI").

Su un'ospite molto nota si è visto un comportamento da tenere d'occhio: **0
citazioni su 40 risultati**, cioè il modello ha risposto da quello che già sapeva
senza agganciarsi alla ricerca. Il testo era corretto, ma non era verificato.
Aggiungere al prompt "non scrivere ciò che non hai trovato ora" non ha cambiato
nulla: è per questo che l'etichetta ora distingue i due casi.

- [ ] Guardare su 4-5 ospiti veri **quante volte compare l'etichetta "non citati
      dall'AI"**: se è la norma e non l'eccezione, il briefing sta lavorando a
      memoria e va ripensato (es. obbligare una ricerca prima di rispondere).
      Finora: citazioni presenti su un imprenditore, assenti su due persone molto
      note (una nobildonna britannica e un dirigente universitario). Sembra che
      più il modello conosce la persona, meno si aggancia alla ricerca
- [ ] Se restano link deboli fra quelli citati, ormai è una scelta del modello:
      il passo successivo sarebbe una lista bianca di domini, da decidere con
      casi veri in mano
- [ ] ⚠️ **Fra i link non citati compaiono OMONIMI**: su un imprenditore sono
      usciti la pagina Wikipedia di un attore quasi omonimo e la scheda di un
      ricercatore con lo stesso nome; su un CEO americano, **sei profili LinkedIn
      di sei persone diverse**. Da qui il "un link per sito" e il tetto di sei.
      Resta però il rischio di fondo: chi apre quel link può leggere di un'altra
      persona. Verificare che in reception l'etichetta si capisca, altrimenti la
      scelta giusta è **non mostrarli affatto** quando l'AI non cita

### Costo del briefing
Il briefing usa `claude-opus-5` (variabile `ANTHROPIC_MODEL_BRIEFING`), le altre
funzioni AI restano su Sonnet. La scelta nasce da un confronto dal vivo sullo
stesso ospite: Sonnet incollava frasi intere dai comunicati stampa in inglese,
Opus no. Si chiede a mano poche volte al giorno, quindi il costo è contenuto.

- [ ] Dopo qualche settimana, guardare la spesa reale e decidere se tenerlo

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

Dall'11/08 il mock legge il `.env`, quindi **le funzioni AI girano davvero anche
fuori dall'hotel** (non toccano il DB: servono solo chiave e internet). Le chiamate
si pagano, come in produzione. In fixture ci sono due arrivi di oggi apposta per
provare il briefing: **Farinetti Oscar** (personaggio pubblico) e **Rossi Marco**
(nome ambiguo, deve NON produrre attribuzioni).
