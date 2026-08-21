# Checklist per il rientro in hotel

> Tutto ciò che è stato sviluppato fuori dalla rete dell'hotel è stato provato contro
> il server di sviluppo con dati finti (`npm run dev:mock`), che **riconosce le query
> per espressione regolare senza eseguirle**: valida l'interfaccia e la logica, non
> il SQL. Questa lista è ciò che resta da fare con il database vero davanti.
>
> Aggiornata all'11/08/2026. **Giornata in hotel del 13/08: vedi il riepilogo qui
> sotto.** Quasi tutta la lista è stata smarcata; quello che resta è in fondo.

---

## 0. Giornata del 13/08/2026 — cosa è stato fatto

**Migrazioni** — eseguite e verificate: `crm-complaint-followup.sql` e
`crm-complaint-reparto.sql` (le due obbligatorie), più l'eliminazione di
`customer_notes` (`crm-drop-note.sql`, tabella mai usata, due righe di prova
trascritte nello script). `crm-ruoli.sql` è risultata **non necessaria**: nel
database ci sono solo ruoli previsti.

**Interrogazioni mai eseguite** — tutte provate su SQL Server vero, nessun errore.

**Difetti trovati sui dati veri e corretti in giornata:**

1. gli **ospiti del giorno** (day use, ~1.200 l'anno) non comparivano in nessuna pagina;
2. il badge **"Nª volta"** contava giornate e voucher come soggiorni: 5.363 ospiti risultavano di ritorno senza aver mai dormito in hotel;
3. le allergie scritte nelle **annotazioni di anagrafica** non arrivavano in cucina (92 anagrafiche, due ospiti in casa quella notte);
4. un **permesso revocato restava valido fino a otto ore**, perché il ruolo si leggeva solo al login;
5. il **check-out** dipendeva da una riga del conto presa senza criterio;
6. **allergia già registrata riproposta** a ogni ricaricamento (confronto fra forme di dato diverse);
7. il **vocabolario delle allergie** rimisurato due volte sulle 30.938 note vere.

**Verifiche superate:** importi, storico senza doppi conteggi, proposte di
allergia su una settimana di ospiti veri (7 su 7 corrette, zero falsi positivi).

---

## 0-bis. Cosa resta aperto dopo il 13/08

Sono le uniche cose che richiedono ancora l'hotel o una decisione.

- [x] ~~**Gli utenti veri.**~~ **Fatto** — verificato il 21/08/2026: cinque account
      attivi, `admin` e `Pascal` amministratori, `Fabio` e `Reception` reception,
      `Solalettura` in sola lettura. Nessuno spento.
      **Da decidere:** `Reception` e `Solalettura` sono account *condivisi*. Vanno
      bene per il collaudo, ma il CRM firma ogni preferenza, allergia e reclamo con
      il nome di chi l'ha scritta, e il registro accessi con chi è entrato: con un
      account in comune quelle due informazioni non distinguono più le persone.
- [ ] **Briefing AI su un profilo LinkedIn vero.** ~~Il credito è esaurito~~ — il
      credito c'è, verificato il 19/08: Briefing, Suggerisci preferenze e Genera
      note personali funzionano tutti. Resta **solo** il caso *"Profilo
      professionale"*, che si può provare unicamente qui perché serve il nome di
      un ospite reale.
- [ ] **Il foglio per i reparti** stampato con i volumi veri: sta in un A4?
- [ ] **Fusione anagrafiche** sul caso reale Brolin (48758 / 55491 / 31355),
      compreso lo scollegamento.
- [ ] **Reclami**: i due in archivio sono senza reparto né categoria. Classificarli,
      provare la risoluzione con follow-up obbligatorio, e dire se le otto
      categorie rispecchiano i reclami veri (cambiarle dopo costa di più).
- [ ] **"Ignora" sulle proposte di allergia**: se sono davvero rari i falsi
      positivi ricorrenti si lascia com'è. Serve qualche giorno d'uso.
- [x] ~~**Nome utente con lo spazio**~~ — **non esiste più**: letti gli utenti veri
      il 21/08/2026, nessuno dei cinque ha uno spazio nel nome utente (`Fabio` è
      senza). Il divieto resta e non blocca nessuno.

---

## 0-ter. Deciso di NON fare (21/08/2026)

Il collaudo a più revisori del 20-21/08 ha chiuso 22 difetti su 27. **I cinque
rimasti non si fanno**, per decisione di Mik. Sono scritti qui perché a ogni
revisione futura risalteranno di nuovo: sono noti, e la risposta è già data.

| Non si fa | Cos'è | Gravità |
|---|---|---|
| Virgola nella finestra "allergia" | «Intolleranza al lattosio, per il bambino preparare **latte di soia**» propone lattosio *e soia*. Stringere la regola spezzerebbe gli elenchi (*«allergie: arachidi, noci, sedano»*), che sono il modo più comune di scriverne più di una | media |
| Determinanti inglesi | «Please note **the** allergy to kiwi» non propone niente quando la sostanza è fuori elenco: `the`/`his`/`her` servono a scartare «comunicare *questa* allergia» | media |
| Modifica di una preferenza persa | Con una riga aperta in modifica, qualunque altro clic nel riquadro Preferenze ricarica dal server e butta via il testo riscritto, senza avviso | media |
| Pastiglia e casella di ricerca | Cercando in "In casa" le pastiglie continuano a mostrare il totale. La riga sotto dice già *"2 di 9"*, quindi si capisce | bassa |
| Spunta "Solo VIP" durante il ricalcolo | Sta dentro il riquadro che si ridisegna, quindi sparisce per un secondo insieme a tutto il resto | bassa |

---

## 1. Da fare PRIMA di mettere in produzione

> ✅ **FATTO il 13/08/2026.** Le due migrazioni obbligatorie sono state eseguite e
> verificate, e `crm-ruoli.sql` è risultata non necessaria. Questa sezione resta
> come documentazione di cosa fanno gli script, non come cosa da fare.

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

> ✅ **Quelle dell'11/08 sono state provate il 13/08**, tutte senza errori:
> `listNotePersonali`, `getStoricoByIds`, `getAnagreConfronto`,
> `cancellaNotePersonali` e `cancellaLingua`.
>
> ⚠️ **Restano le tre qui sotto**, scritte dopo quella giornata e mai girate sul
> database vero.

### ✅ Fatte il 21/08/2026, sul database vero

- **`analytics:inizio`** — lo storico parte dal **2 giugno 2011**, in 197 ms.
  Quindici anni, sotto il limite dei venti: nessun taglio. Le etichette del
  grafico per anno sono anni veri, quindi anche il `CONVERT(varchar(4))` va.
- **`getStoricoByIds`** — i due codici del gruppo Brolin danno ora la stessa
  storia (9 soggiorni, ultima 04/07/2026); senza raggruppamento davano 6 e 3.
  ⚠️ **Da decidere:** nel CRM il gruppo è di **due** anagrafiche, non tre. Il
  codice 31355 non è collegato e sta per conto suo con 5 soggiorni, ultimo nel
  2022. O non è mai stato unito, o è stato scollegato: va guardato.
- **`sqlConsumi` con "Solo ospiti VIP"** — 803 voci, nessuna sopra il proprio
  totale: il filtro è corretto. Ma era **inutilizzabile** per lentezza, ed è
  stato riscritto (vedi §4).
- **Nazionalità** — decodificate dalla tabella `Nazioni`. Vedi §4.
- **Allergie sulle note vere** — misurate. Vedi §4.

### Le tre query nuove — provate il 21/08, esito qui sopra

> Le caselle restano vuote apposta: sono **come si riprova**, non cose da fare.
> Vanno ricontrollate se qualcuno tocca queste query.

- [ ] **`getStoricoByIds` — il raggruppamento per gruppo** (`src/pms/clienti.js`).
      Il `CASE c.codCli WHEN … THEN …` ora comprende **tutti** i membri dei gruppi
      coinvolti, non solo i codici chiesti: prima un membro che non era anche una
      chiave della mappa restava per sé e la sua metà di storia non veniva sommata.
      **Come si prova:** aprire gli arrivi di un giorno in cui c'è un ospite con più
      anagrafiche (caso reale Brolin 48758 / 55491 / 31355) e controllare che il
      badge "Nª volta" dica lo stesso numero della sua scheda, **da qualunque delle
      sue anagrafiche** si arrivi.

- [ ] **`sqlConsumi` con la spunta "Solo ospiti VIP"** (`src/pms/analytics.js`).
      Era fatta di JOIN, e `StorAlberg` ha una riga **per occupante**: una camera con
      due VIP dentro faceva contare due volte ogni sua ordinazione. Adesso è un
      `EXISTS` su una CTE `camereVip` con `DISTINCT`, e comprende anche i soggiorni
      **non ancora archiviati** (`AlbergDay`/`Alberg`), che prima sparivano dal filtro.
      **Come si prova, in un minuto:** su Analytics, stesso periodo, leggere il
      riquadro Consumi F&B **senza** spunta e **con** spunta. Con la spunta ogni
      numero dev'essere **minore o uguale** a quello senza: è un sottoinsieme. Se
      qualcuno è più alto, la query è ancora sbagliata.
      *(Prima della correzione poteva essere più alto: è così che il difetto si vede.)*

- [ ] **`analytics:inizio`** (`src/pms/analytics.js`) — la `MIN(dtpartenza)` su
      `StorPrenota` + `Prenota` che alimenta il periodo **"Tutto lo storico"**.
      **Come si prova:** aprire Analytics e premere *Tutto lo storico*. Due cose da
      guardare: che **non sia lenta** (è un aggregato su tutto l'archivio) e **quale
      data d'inizio compare** — se è assurda è scattato il limite dei vent'anni, e va
      capito perché. Nello stesso schermo si vede anche se le etichette del grafico
      per anno sono numeri veri (`2019`, `2020`…) e non `****`: quella è l'unica
      riga di SQL che nessuno ha potuto provare, un `CONVERT(varchar(4), …)`.

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

### Il controllo dell'ultimo amministratore non è atomico
`src/api/admin.js` conta gli amministratori, decide, poi scrive: fra le due cose
c'è una finestra, e nel progetto non esiste nessuna transazione. Due
amministratori che si declassano (o si eliminano) a vicenda nello stesso istante
passano tutti e due il controllo, e ne restano **zero** — a quel punto la pagina
Utenti è irraggiungibile per chiunque e si rientra solo dal database.

La **rete di sicurezza c'è già**: [crm-ripristina-admin.sql](../scripts/crm-ripristina-admin.sql),
prudente per costruzione (se un amministratore attivo esiste, non tocca niente).

**Da fare qui**, meglio se lo stesso giorno in cui si creano gli account veri del
personale — cioè quando il rischio comincia a esistere davvero:

- spostare il controllo **dentro la scrittura**, in un'istruzione sola che si
  applica solo se un altro amministratore attivo resta;
- aggiungere il **blocco esplicito sulla lettura** (`UPDLOCK, HOLDLOCK`) o una
  transazione serializzabile, se no due richieste simultanee vedono entrambe
  l'altro come ancora attivo;
- provarlo davvero: **il server finto non valida il SQL**, quindi da remoto una
  query sbagliata sembra funzionare. E qui una query sbagliata rompe proprio la
  pagina che serve per rimediare.

### Priorità alta: due migrazioni che perdono dati ogni giorno che passa
Nessuna delle due recupera il passato, quindi prima si fanno prima si inizia a
raccogliere.

- [ ] **`ai_events`** — oggi le chiamate all'AI finiscono solo in un `console.log`.
      Senza questa tabella non si potrà mai sapere quante proposte l'AI ha fatto e
      quante ne sono state scartate: è il denominatore dell'acceptance rate
- [ ] **`origine` sulle preferenze** — una preferenza confermata da un suggerimento
      passa dalla stessa POST di una scritta a mano. Le preferenze salvate NON si
      perdono; si perde solo la provenienza

### Dashboard Analytics — la query di "Tutto lo storico" non è mai girata sul vero
`analytics:inizio` in [../src/pms/analytics.js](../src/pms/analytics.js) è la
`MIN(dtpartenza)` su `StorPrenota` + `Prenota` che dice da quando parte il periodo
"Tutto lo storico". Sul server finto funziona, sul database vero non è mai stata
eseguita. Due cose da guardare:

- **quanto ci mette**: è un aggregato su tutto l'archivio, e gira solo quando si
  sceglie quel pulsante;
- **quale data torna**: se è assurda (un anno molto anteriore all'hotel) è scattato il
  limite a vent'anni, e vale la pena trovare la prenotazione che la causa.

### ✅ Dashboard Analytics — nazionalità decodificate (21/08/2026)

Il riquadro mostrava il **codice** dell'anagrafica (`I`, `GB`, `PBS`). La tabella
`Nazioni` ha 246 righe, colonne `codnaz` e `desnaz`, e su tutta l'anagrafica **solo
quattro righe in tutto** non si decodificano (`IT`, `ITA`, e una `Ù` che è un errore
di battitura): per quelle resta il codice, come già fa `sqlVip` con `TabVip`.

Nello stesso riquadro è saltato fuori un secondo difetto: la voce **"Non"** su 291
ospiti non era un codice ma "Non indicata" **tagliata a tre lettere**, perché `ISNULL`
eredita il tipo del primo argomento e `Anagra.CodNaz` è `nvarchar(3)`. Ora `COALESCE`,
che calcola il tipo su tutti i rami. Le altre due `ISNULL` con ripiego testuale del
file sono al sicuro: partono da colonne `nvarchar(50)`.

Le etichette lunghe ci stanno: "STATI UNITI D'AMERICA" chiede 160 px in una colonna
da 177. Sotto i ~420 px di riquadro viene troncata, con il testo pieno nel titolo.

### ✅ Analytics — "Solo ospiti VIP" era inutilizzabile (21/08/2026)

Il filtro era **corretto** (803 voci, nessuna sopra il proprio totale) ma su tutto lo
storico superava il limite dei quindici secondi e la pagina andava in errore.

Due cause che si nascondevano a vicenda: il `TOP 12` con `ORDER BY` su un aggregato
faceva scegliere a SQL Server un piano pessimo, e la lista delle camere VIP si
costruiva su quindici anni per poi buttarne via quasi tutto. **Servivano tutte e due
le correzioni insieme:** da sole si danneggiano — il solo taglio sulle date peggiorava.

Pagina intera, dodici mesi con la spunta: **9.765 ms → 1.311 ms**. Tutto lo storico: da
timeout a 11.986 ms, che resta lento e vicino al limite. Se un giorno dà fastidio, è
lì che si torna.

### ✅ Allergie — misurate sulle 43.271 note vere (21/08/2026)

Confronto fra la versione precedente al blocco di modifiche e quella attuale, su ogni
nota di anagrafica e di prenotazione:

| | |
|---|---|
| Note lette | 43.271 |
| Note con almeno una proposta | 394 (0,9 %) |
| Falsi positivi tolti | 5 |
| Allergie perse | **0** |
| Proposte nuove | 0 |

I cinque tolti erano `NO PIUMINI, SOLO LENZUOLA` letto come allergia alle piume (tre
volte) e due parole che allergeni non sono. Nel farlo è emersa **una** nota che perdeva
tre allergie su quattro: la finestra fra "allergia" e la sostanza è passata da 10 a 20
parole, dopo aver misurato che cambia quella nota e nessun'altra.

Analisi originale della dashboard, se serve: [2026-08-10-analytics-dashboard-analisi.md](2026-08-10-analytics-dashboard-analisi.md).

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
