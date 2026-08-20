# Analisi funzionale — CRM Hotel Canne Bianche

- **Data:** 2026-08-12, **aggiornato il 2026-08-13 in hotel**, il **2026-08-14** e il **2026-08-18**
- **Oggetto:** che cosa fa l'applicazione e con quali regole, dal punto di vista di chi la usa.
- **Metodo:** lettura dei documenti in `DOCS/`, del codice in `src/` e `web/`, dei test in `test/`. La prima stesura è stata scritta **senza il database dell'hotel**; il 13/08 tutto ciò che si poteva misurare è stato misurato sui dati veri, e dove i numeri contraddicevano il documento ha vinto il database.

---

## Come si legge questo documento

Ogni regola porta la sua fonte. Serve a sapere di quali affermazioni ci si può fidare e quali vanno confermate con chi ha commissionato il lavoro.

| Marca | Significato |
|---|---|
| `[DOC]` | Sta scritta in un documento di `DOCS/` o in un ticket. È un requisito dichiarato. |
| `[TEST]` | È fissata da un test in `test/`. Se cambia, la suite si accorge. |
| `[CODICE]` | È stata dedotta leggendo il codice. **Nessuno l'ha mai scritta come requisito.** Può essere una scelta voluta o un difetto che non è mai emerso: da qui non è possibile distinguere i due casi. |

Una regola può portare più marche: `[DOC][TEST]` significa che è richiesta ed è protetta da un test.

**Avvertenza sulle regole `[CODICE]`.** Sono la maggioranza. Non vanno lette come "requisiti impliciti": vanno lette come "oggi il programma si comporta così". Le più significative erano raccolte in fondo, in *Domande aperte*: il **12/08/2026 sono state discusse una per una con Mik e decise**. Da lì in avanti portano la marca `[DECISO]`.

| Marca | Significato |
|---|---|
| `[DECISO]` | Regola discussa e decisa con il committente (12 o 13 agosto 2026). Non è più una deduzione: è un requisito. |

Il documento è aggiornato alle decisioni prese. Delle tre domande che richiedevano i dati veri dell'hotel, **due sono state chiuse il 13/08** e una resta aperta perché ha bisogno di giorni d'uso, non di un'interrogazione: sono in §21.

**Cosa è cambiato il 13/08/2026, in hotel.** La giornata è servita a mettere l'applicazione davanti ai dati veri per la prima volta, e ha prodotto più correzioni della settimana precedente: gli **ospiti del giorno** che non comparivano da nessuna parte (§5), il badge **"Nª volta"** che contava come soggiorni le giornate e i voucher (§7), le allergie scritte in **anagrafica** che non arrivavano in cucina (§11), il **check-out** deciso da una riga presa a caso (§5), e un permesso revocato che **restava valido per ore** (§2). Nessuno di questi si vedeva sul server di sviluppo con dati inventati.

---

## Indice

1. [Il quadro generale](#1-il-quadro-generale)
2. [Autenticazione, ruoli e permessi](#2-autenticazione-ruoli-e-permessi)
3. [Home](#3-home)
4. [Arrivi del giorno](#4-arrivi-del-giorno)
5. [Clienti in casa](#5-clienti-in-casa)
6. [Ricerca ospiti](#6-ricerca-ospiti)
7. [Scheda ospite: anagrafica, statistiche, storico](#7-scheda-ospite-anagrafica-statistiche-storico)
8. [Consumi F&B e SPA](#8-consumi-fb-e-spa)
9. [Preferenze](#9-preferenze)
10. [Allergie e intolleranze](#10-allergie-e-intolleranze)
11. [Proposte di allergie dalle note del PMS](#11-proposte-di-allergie-dalle-note-del-pms)
12. [Reclami (complaints)](#12-reclami-complaints)
13. [Note personali e lingua preferita](#13-note-personali-e-lingua-preferita)
14. [Nucleo di viaggio](#14-nucleo-di-viaggio)
15. [Duplicati e fusione anagrafiche](#15-duplicati-e-fusione-anagrafiche)
16. [Export per i reparti](#16-export-per-i-reparti)
17. [Gestione utenti](#17-gestione-utenti)
18. [Funzioni AI](#18-funzioni-ai)
19. [Import periodico (scritto, non collegato)](#19-import-periodico-scritto-non-collegato)
20. [Analytics](#20-analytics)
21. [Decisioni prese e domande ancora aperte](#21-decisioni-prese-e-domande-ancora-aperte)

---

## 1. Il quadro generale

### A cosa serve

Il CRM sta sopra il gestionale alberghiero (PMS) e serve alla reception per **conoscere l'ospite prima di averlo davanti**: chi è, quante volte è già stato qui, cosa gradisce, a cosa è allergico, se ha già avuto un problema. Il gestionale continua a fare quello che ha sempre fatto (prenotazioni, camere, conti); il CRM aggiunge il lato relazionale e non tocca nulla del gestionale.

### Le due sorgenti dei dati

| | PMS (`HolidaySQL`) | CRM (`HolidayCanneBianche_CRM`) |
|---|---|---|
| Accesso | **Sola lettura**, garantita dai permessi del database `[DOC]` | Lettura e scrittura |
| Contiene | Anagrafiche, prenotazioni, camere, occupanti, consumi, consensi privacy, note libere del gestionale | Utenti dell'app, preferenze, allergie, reclami, note personali, lingua, nucleo, fusioni |
| Chi lo modifica | Solo il gestionale | Solo questa applicazione |

Nessuna funzione del CRM scrive sul PMS. Non è una convenzione: è impossibile per costruzione, perché l'utenza del database ha solo il permesso di lettura `[DOC]`. Conseguenza operativa: **tutto ciò che si corregge in anagrafica (nome, data di nascita, telefono, consensi) si corregge nel gestionale**, non qui.

### Regole di dominio ereditate dal gestionale

Sono verità del PMS, non scelte del CRM, e spiegano molti comportamenti dell'applicazione `[DOC]` (`DOCS/HANDOFF.md` §6):

- **L'ospite è `codclinterm`, non `codcli`.** `codcli` è chi paga; l'ospite/referente della prenotazione è un altro campo. Tutte le schermate ragionano sull'ospite.
- **Gli occupanti della camera** sono righe separate: una per persona fisicamente in camera. Il referente non è automaticamente fra loro.
- **La camera** è quella assegnata alla data, con ripiego su quella pianificata. Una prenotazione può avere più camere.
- **I consensi privacy sono a logica invertita**: nel gestionale il valore `S` significa *non* autorizzato. L'applicazione li ribalta prima di mostrarli `[DOC][TEST]` (`test/clienti-api.test.js`, «consensi invertiti (S = non autorizzato) esposti dall'API»).
- **"Oggi" non è l'orologio del server**, è la data di lavoro del gestionale. Se la reception non ha ancora fatto il cambio giornata, il CRM resta sul giorno precedente `[DOC][TEST]` (`test/arrivi-api.test.js`, «GET /api/arrivi senza data → usa la data di lavoro del PMS»). Se la data di lavoro non è leggibile, si ripiega sulla data del server `[CODICE]`.

### Se il gestionale non risponde

- Le pagine Arrivi e In casa provano ad arricchire la lista con i dati CRM; se **il CRM** fallisce, la lista operativa del PMS viene servita comunque, senza gli arricchimenti `[CODICE]` (il ripiego è il `catch` intorno a `arricchisciArrivi` in `src/api/arrivi.js`). È una scelta esplicita: la reception deve poter lavorare anche con il CRM in avaria.
- Se **il PMS** non risponde, la pagina mostra un messaggio d'errore e il resto dell'applicazione continua a funzionare `[DOC]`.

---

## 2. Autenticazione, ruoli e permessi

### A cosa serve

Solo chi ha un account entra, e ciascuno vede e può fare quello che gli compete: chi sta al banco lavora, chi consulta e basta non modifica, la direzione amministra.

### Accesso

- Username e password; la password è conservata come impronta bcrypt, mai in chiaro `[DOC]`.
- Un **utente disattivato non entra**, anche con la password giusta `[TEST]` (`test/auth.test.js`).
- Credenziali sbagliate e utente inesistente danno **lo stesso messaggio** `[DOC][TEST]`. **Il messaggio, non il tempo** — vedi qui sotto.
- **Dal tempo di risposta si capisce se un nome utente esiste** `[DECISO]`. Quando l'utente c'è, la password viene verificata con bcrypt, che è lento **apposta** per rendere costoso indovinare le password; quando non c'è, la risposta parte subito. Misurato: **circa 476 ms contro 4**, centosette volte. La difesa diventa un segnale. A qualcuno servirebbe per costruire l'elenco dei nomi utente veri prima di provare le password — utile perché il login non ha limite ai tentativi (punto sotto).
  **Deciso il 20/08/2026: si lascia com'è.** L'applicazione vive dentro la rete dell'hotel, e in prospettiva dietro la sua VPN: chi arriva fin lì è già una persona autorizzata, e i nomi utente sono i colleghi — non c'è niente da scoprire. Sta accanto alle altre scelte prese sapendo dove gira (nessun blocco dopo N tentativi, cookie non cifrato, sessioni in memoria) e con la stessa avvertenza: **da rivedere il giorno che l'applicazione esce dalla rete interna.**
- La sessione dura **8 ore** e viaggia su un cookie non leggibile da JavaScript `[CODICE]` (la durata sta nel `cookie.maxAge` di `src/app.js`).
- Dopo il logout il vecchio cookie non vale più `[DOC]` (verificato nel collaudo dell'11/08).
- **Ruolo e stato si rileggono a ogni richiesta**, non solo all'accesso `[DECISO][TEST]`. Fino al 13/08/2026 il ruolo veniva letto una volta sola al login e messo in sessione: declassare qualcuno non era un'etichetta rimasta indietro, era un permesso che **restava valido fino a otto ore**, e disattivare un account non buttava fuori nessuno. Trovato in hotel declassando un utente a sola lettura e vedendolo ancora operativo nell'altra finestra. Ora un ruolo cambiato si riallinea alla richiesta successiva e un utente disattivato o eliminato perde la sessione all'istante.
- Non esiste blocco dopo N tentativi falliti, né limite di frequenza sul login: **è una scelta**, non una dimenticanza `[DECISO]`. Un blocco chiuderebbe fuori chi ha davvero dimenticato la password, e non esiste recupero via email. Vedi §17 per il quadro completo.

### I tre ruoli

| Ruolo | Etichetta a schermo | Cosa può fare |
|---|---|---|
| `readonly` | Sola lettura | Consulta tutto. Non modifica niente, non usa l'AI, non vede Utenti. |
| `reception` | Reception | Tutto sul cliente: preferenze, allergie, reclami, note, nucleo, fusioni. Usa l'AI. Non amministra. |
| `admin` | Amministratore | Come reception, più la gestione utenti e le funzioni direzionali. |

Fissati da `[TEST]` (`test/permessi.test.js`, «i tre ruoli della Fase 1, e nessun altro»).

### Come funziona il controllo

- L'applicazione non ragiona per ruolo ma per **permesso**: `leggi`, `scrivi`, `usa-ai`, `gestisci-utenti`, `vedi-analytics`. Il ruolo è solo un insieme di permessi `[CODICE][TEST]`.
- **La regola di base è il metodo della richiesta**: leggere è lettura, tutto il resto è scrittura. Una funzione nuova nasce quindi già protetta, anche se chi la scrive non ci pensa `[CODICE][TEST]` (`test/permessi.test.js`, «una rotta nuova nasce protetta senza che nessuno la registri»).
- Le eccezioni sono tre: le due funzioni AI richiedono `usa-ai` (non scrivono nel CRM ma costano e producono contenuto), l'area utenti richiede `gestisci-utenti`, l'area Analytics richiede `vedi-analytics` `[CODICE][TEST]`.
- **Analytics esiste dal 13/08/2026**: la regola di protezione c'era già da prima della pagina. Reception e sola lettura non vi accedono `[CODICE][TEST]`.
- Un ruolo sconosciuto nel database (per esempio il vecchio `marketing`) vale **sola lettura**, non pieni poteri. L'utente resta operativo per consultare e nella pagina Utenti compare con un'etichetta gialla "non previsto" `[DOC][TEST]`.
- Nascondere i pulsanti non è la difesa: chiamando le interfacce a mano si prende comunque un 403. La matrice ruoli × operazioni è verificata chiamando le API senza passare dall'interfaccia `[TEST]` (`test/permessi-api.test.js`).
- **Le maiuscole nell'indirizzo non aggirano il controllo.** Era un buco reale — la reception poteva crearsi un amministratore — chiuso il 12/08 con un test che rifà l'attacco `[DOC][TEST]`.
- **Togliere un permesso ha effetto subito.** Vedi *Accesso*: era il secondo buco vero della gestione ruoli, e come il primo è stato trovato provando, non leggendo `[DECISO][TEST]`.
- **La regola del metodo ha un limite, e va conosciuto**: una rotta di lettura che internamente scrive sfugge al controllo, perché la guardia guarda il metodo e non cosa succede dentro. È capitato con la precompilazione del nucleo (§14), corretta il 12/08 controllando il permesso dentro la rotta. Chi aggiunge una lettura che scrive deve fare lo stesso `[DECISO][TEST]`.
- **Le righe si toccano solo dalla scheda del loro ospite**: il percorso delle richieste di modifica e cancellazione porta anche il codice ospite, e una riga che non è sua risulta inesistente `[DECISO][TEST]`. Non difende dal personale — chi può scrivere può scrivere — ma rende innocuo un errore di programmazione.

### Cosa vede chi non può scrivere

- Il nome utente porta accanto un badge **"Sola lettura"** `[DOC]`.
- Tutti i comandi che modificano spariscono dall'interfaccia, compresi quelli disegnati dopo il caricamento della pagina `[CODICE][TEST]` (`test/permessi-ui.test.js` verifica che nessun comando di scrittura sia rimasto fuori dalla regola).
- Nei riquadri che normalmente mostrano un modulo di inserimento quando il dato manca (lingua, note personali), a chi non può scrivere si dice invece che il dato non c'è: un modulo nascosto lascerebbe un buco bianco che sembra un guasto `[CODICE][TEST]`.
- Se il server non manda l'elenco dei permessi (file dell'applicazione più recenti del processo in esecuzione), l'interfaccia va **prudentemente in sola lettura** e dice che il server va riavviato, invece di far sembrare che tutti abbiano perso metà delle funzioni `[CODICE][TEST]`.

### Che cosa resta scritto di un accesso

Ogni tentativo di entrare **con nome utente e password** lascia una riga nel CRM: chi, quando, com'è andata `[CODICE][TEST]`. Un modulo inviato a metà viene rifiutato prima e non si registra: non è un tentativo di accesso, è un campo dimenticato.

- Tre esiti possibili: **riuscito**, **credenziali sbagliate**, **utente disattivato**. All'utente il messaggio è sempre lo stesso — dall'esterno non si deve capire se un nome utente esiste (vedi *Accesso*) — ma nel registro i casi si distinguono: un account disattivato che continua a provare è un'informazione che serve.
- Chi ha provato è registrato per nome anche quando quel nome utente **non esiste**: la riga resta senza collegamento a nessuno, ma il tentativo si conta.
- **Si registrano anche i tentativi falliti**, e il motivo è l'adozione più che la sicurezza: qualcuno che sbaglia password tre volte al giorno è una persona in difficoltà con l'applicazione, e va visto.
- Il registro **non è legato alla vita degli utenti**: eliminando una persona dalla pagina Utenti (§17) la storia dei suoi accessi resta. Cancellarla sarebbe cancellare proprio quello che si vuole conservare.
- **Registrare non deve mai far fallire l'azione registrata** `[CODICE][TEST]`. Se la scrittura non riesce — la migrazione non è ancora passata, il database è occupato — l'errore finisce nei log del server e chi sta entrando non se ne accorge. Un accesso rifiutato perché non si è potuto annotare che era avvenuto sarebbe assurdo. Vale identica per il registro dell'AI (§18).

### Che cosa NON resta scritto

Il registro risponde a **una** domanda — *"il CRM lo stanno usando?"* — e a nient'altro `[CODICE]`:

- **niente navigazione**: quali pagine sono state aperte, quali schede consultate, quante ricerche fatte;
- **niente uscita**: il logout non lascia traccia, quindi la durata di una sessione non è ricostruibile;
- **niente indirizzo di rete né dispositivo**.

Di chi **scrive** si sapeva già tutto, perché preferenze, allergie, reclami e note portano autore e data. Quello che mancava era chi **consulta e basta**: una reception che apre venti schede al giorno sta usando il CRM anche se non salva niente, e prima di questo registro risultava inattiva.

Conseguenza da tenere presente leggendo Analytics (§20): il riquadro **"Chi usa l'applicazione"** conta gli **accessi riusciti**, non il lavoro fatto dentro. Dice chi entra, non quanto ci sta.

### Per quanto si conserva — deciso il 20/08/2026 `[DECISO]`

**Si tiene tutto. Le righe non vengono mai cancellate e non esiste una pulizia periodica.**

Non è una cosa capitata: è una scelta, e queste sono le ragioni per cui è stata presa così.

**Il volume non è un argomento.** Dieci persone, quattro accessi al giorno, duecentocinquanta giorni lavorativi: circa **diecimila righe l'anno, sotto il megabyte**. Su un database che contiene decine di migliaia di anagrafiche non si nota, e fra vent'anni non si noterebbe ancora. Se lo spazio fosse il problema la risposta sarebbe ovvia, e non ci sarebbe niente da decidere.

**Quello che si guadagna tenendo tutto** è il confronto fra stagioni: fra un anno si potrà dire se il CRM viene aperto più o meno dell'estate precedente. È una domanda che oggi non si può nemmeno porre, perché il registro è nato da poco.

**Quello che va saputo** è che si tratta di un registro dell'**attività del personale**: dice chi entra, quando, e quante volte ha sbagliato la password. Conservarlo senza scadenza è una scelta che riguarda i dipendenti, non solo il database. Il giorno in cui in hotel dovesse essere valutata dal punto di vista della privacy del personale, questa pagina dice esattamente cosa c'è dentro e cosa no — ed è il motivo per cui la sezione «Che cosa NON resta scritto» è dettagliata quanto l'altra.

**Un caso in cui la decisione va rivista**: se l'applicazione viene esposta su un indirizzo pubblico, i tentativi falliti smettono di essere solo quelli dei dipendenti — sulla rete pubblica i tentativi automatici verso qualunque pagina di accesso sono la norma. In quel caso il registro si riempie di righe che non riguardano nessuno, e il conteggio degli accessi falliti smette di dire qualcosa sull'adozione. Non serve cambiare la regola: basta ripulire **quella finestra**, una volta sola, quando l'esposizione finisce.

---

## 3. Home

### A cosa serve

La fotografia della giornata in tre numeri, all'apertura dell'applicazione.

### Regole

- Tre riquadri: **Arrivi oggi**, **Partenze oggi**, **Restano stanotte**, riferiti alla data di lavoro del gestionale `[DOC]`.
- Sono conteggi di **prenotazioni**, non di persone `[CODICE]`.
- Arrivi = prenotazioni non annullate con data di arrivo pari a oggi, escluse quelle già segnate come partite. Partenze = stesso criterio sulla data di partenza. **Restano stanotte** = check-in fatto e oggi compreso fra arrivo e partenza, **partenza esclusa** `[CODICE]` (`SQL_RIEPILOGO` in `src/pms/prenotazioni.js`).
- Cliccando "Partenze oggi" si apre la pagina In casa già filtrata sui partenti `[CODICE]`.
- Se il gestionale non risponde, i tre numeri diventano trattini con un messaggio `[CODICE]`.

> **Il terzo riquadro e la pagina "In casa" rispondono a due domande diverse, e il nome lo dice** `[DECISO]`.
> La Home conta le **camere ancora occupate stanotte**: chi parte oggi non c'è più. La lista "Oggi in hotel" (§5) elenca **chi è in hotel adesso**, partenze di oggi comprese, e dà quindi un numero più alto.
> Prima si chiamavano entrambe "presenti" e la differenza sembrava un errore. Sono due informazioni utili a momenti diversi della giornata: il numero della Home serve alla notte, quello della lista serve al banco.

---

## 4. Arrivi del giorno

### A cosa serve

Preparare l'accoglienza: chi arriva oggi, in che camera, cosa serve sapere prima che varchi la porta.

### Cosa mostra ogni scheda

Una scheda per prenotazione, non per persona `[CODICE]`. Contiene:

- **Referente** (cliccabile, apre la scheda ospite), stato *Atteso* / *In casa*, ora prevista di arrivo, badge VIP.
- **Banda di accoglienza**: ospite indesiderato, i compleanni durante il soggiorno, allergie *col nome di chi le ha*, reclami aperti con il loro testo, fino a **5 preferenze** (§9), nota personale accorciata.
- **Camere e tipologie**, date, notti, e il badge **"Nª volta"** con le eventuali visite in giornata — dal 14/08/2026 `[DECISO]`. Era solo in "In casa": chi accoglie deve sapere che sta per arrivare qualcuno alla quarta volta **prima** che entri dalla porta, non scoprirlo il giorno dopo dalla lista dei presenti. È lo stesso pezzo di codice delle due pagine, quindi non possono divergere. Sugli arrivi del 14/08 riguarda 2 prenotazioni su 10.
- **Ospiti in camera**: gli occupanti, con la relazione col referente quando è nota. Le camere senza occupanti assegnati compaiono lo stesso, con la dicitura "nessun ospite assegnato" `[CODICE]`.
- **Dati operativi**: importo del soggiorno, extra maturati, trattamento e tariffa, numero pratica, data di creazione.
- **Note della prenotazione** dal gestionale, in un blocco richiudibile.

### Regole di selezione e di calcolo

- Entrano le prenotazioni **non annullate** con arrivo alla data scelta, escluse quelle già marcate come partite `[CODICE]`.
- La **data è libera**: si sceglie col calendario, si scorre coi tasti avanti/indietro, "Oggi" torna alla data di lavoro. Una data scritta male viene rifiutata `[TEST]`. Il calcolo avanti/indietro è fatto in UTC per non sfasare di un giorno `[DOC]`.
- **Nominativo mancante** → "(senza nominativo)"; **ora di arrivo** vuota o segnaposto (`__.__`) → trattino; **nessuna camera** ancora assegnata → trattino `[DOC][TEST]`.
- **Camera** = quella assegnata alla data; se non c'è, quella pianificata. Più camere vengono concatenate `[DOC]`.
- **Importo** = totale *pianificato* del soggiorno, ricostruito dalla pianificazione a gradini del gestionale (tariffa base per notte, sovrascritture che si trascinano fino al cambio successivo, camere in parallelo sommate). Il calcolo è verificato contro tre prenotazioni reali di cui si conosceva il totale del gestionale `[DOC][TEST]` (`test/pms-importo.test.js`).
- A check-in avvenuto il gestionale svuota la pianificazione: in quel caso l'importo diventa *maturato finora + notti residue valorizzate* `[CODICE][TEST]`.
- **Importo negli Arrivi ≠ importo nella scheda ospite**: qui è il pianificato, là il maturato. È voluto `[DOC]` (`HANDOFF.md` §9).
- Gli importi restano **PENDING**: da riconfermare con la software house del PMS `[DOC]` (checklist §3).

### Le informazioni di accoglienza: da dove vengono

Per ogni prenotazione si raccolgono i codici del referente **e di tutti gli occupanti**, ciascuno espanso ai codici delle sue anagrafiche fuse; su quell'insieme si leggono i dati CRM `[CODICE][TEST]` (`test/arrivi-brief.test.js`).

| Informazione | Fonte | Regola |
|---|---|---|
| VIP | PMS (classificazione decodificata) | Vale quella del referente; se manca, quella di un occupante `[CODICE]` |
| Ospite indesiderato | PMS | Se **almeno uno** del gruppo è classificato indesiderato `[CODICE]`. Riconosciuto dalla descrizione, non da un elenco fisso di codici |
| Allergie | CRM | Tutte quelle del gruppo, **ciascuna col nome di chi la ha** `[DECISO][TEST]`. Doppioni tolti per coppia persona+allergia: due occupanti celiaci restano due voci, perché sono due piatti da preparare |
| Preferenze | CRM | **Personali e di nucleo**, senza doppioni, **massimo 5**; le personali col nome di chi le ha (§9) `[DECISO][TEST]` |
| Reclami | CRM | Conteggio di tutti + testo di quelli aperti (i risolti restano solo numero) `[CODICE][TEST]` |
| Compleanni | PMS (data di nascita) | **Tutti** i membri che compiono gli anni fra arrivo e partenza compresi, in ordine di data; gestisce il soggiorno a cavallo di capodanno `[DECISO][TEST]` |
| Nota personale | CRM | Solo quella del **referente** (e delle sue anagrafiche fuse), mai quella di un occupante `[CODICE][TEST]` |
| Nª volta | PMS | Soggiorni **già conclusi**: quello in corso è l'(n+1)-esimo `[CODICE]` |

- Senza data di nascita in anagrafica non c'è compleanno: il CRM non ha una propria copia del dato `[CODICE][TEST]`.
- **Di una prenotazione si segnalano TUTTI i compleanni**, in ordine di data — dal 14/08/2026 `[DECISO][TEST]`. Fino al giorno prima ci si fermava al primo trovato. Misurato sul database dell’hotel: delle **1.482 prenotazioni** con almeno un compleanno durante il soggiorno, **41 ne hanno più di uno** (2,8%) e una ne ha tre. Sono casi veri e proprio quelli che contano: coniugi che festeggiano nella stessa vacanza, gemelle nate lo stesso giorno (pratica 51908), nonna e nipote entrambe il 3 luglio (pratica 47381, 1954 e 2017). Il secondo nome non arrivava a nessuno, e in cucina si preparava una torta sola.
- **Quando due festeggiano lo stesso giorno la data si scrive una volta sola** e i nomi si affiancano — *20/12/2024 ELISABETH, MARGARETE* `[DECISO][TEST]`. Succede spesso (in quasi metà dei casi misurati) e ripetere la stessa data due volte di fila sembrerebbe un errore invece di due festeggiate. Stessa resa in card e sul foglio dei reparti, perché è la stessa informazione.
- Ogni nome resta **cliccabile**: dalla card si apre la scheda del festeggiato `[CODICE][TEST]`.
- La pastiglia **Compleanni** in cima alla pagina conta le **prenotazioni** con almeno un festeggiato, non le persone: al clic filtra le righe, e il numero deve tornare con quelle `[CODICE][TEST]`.

### Barra di riepilogo e filtri

- In cima: Arrivi · VIP · Compleanni · Reclami · Alert, con i relativi numeri. Ogni voce filtra la lista; ricliccarla torna a mostrare tutto `[CODICE]`.
- **Alert** = c'è almeno un'allergia registrata, oppure un ospite indesiderato `[CODICE][TEST]`.
- **Reclami** conta le prenotazioni con almeno un reclamo, aperto **o** risolto `[CODICE]`.
- I campi *anniversari* e *suggerimenti AI*, che il server mandava sempre a zero e che nessuna schermata mostrava, sono stati **tolti** `[DECISO]`. Un contatore fermo a zero, il giorno che finisce in una pagina, non dice "non lo sappiamo" ma "oggi non festeggia nessuno". L'anniversario di matrimonio richiede un dato che il PMS non ha: si rifarà quando ci sarà un campo da compilare, insieme alla sua pastiglia.
- Ricerca libera nella pagina: numero pratica (anche parziale), camera, referente, occupante `[CODICE][TEST]`.
- Con un filtro attivo il contatore dice **"0 di 5"**, non "5 arrivi": diceva il numero pieno anche a schermo vuoto e sembrava che la pagina nascondesse qualcosa `[DOC][TEST]`.

### Chi può

Consultare: tutti i ruoli. Le uniche azioni di scrittura presenti in pagina sono la conferma di una proposta di allergia e il salvataggio del briefing AI nel profilo (§11 e §18): richiedono `scrivi`, il briefing anche `usa-ai`.

---

## 5. Clienti in casa

### A cosa serve

Gestire l'ospite durante il soggiorno: chi c'è, in che camera, a che punto è del soggiorno, a chi stare attenti.

### Regole

- **Nessun selettore di data**: la pagina è sempre alla data di lavoro del gestionale `[CODICE]`.
- Entrano le prenotazioni non annullate con **check-in fatto** e data di lavoro compresa fra arrivo e partenza, **partenza inclusa** `[CODICE]`.
- **Ordine per presenza, poi da rack** — dal 14/08/2026 `[DECISO][TEST]` (`test/incasa-brief.test.js`): prima **chi è in casa** (compreso chi parte oggi ma è ancora in camera), poi gli **ospiti del giorno**, in fondo chi ha già fatto il **check-out**. Dentro ogni gruppo resta il numero di camera crescente. Il criterio è "chi è in hotel adesso": un ospite del giorno non ha camera ma è una persona presente, e sta davanti a chi se n'è già andato. Chi ha fatto il check-out resta consultabile — serve a chiudere conti e ritrovare pratiche — ma non toglie posto in cima. Sui dati del 14/08: **32 in casa, 13 day use, 5 usciti**.
  Fino al 13/08 valeva l'ordine opposto fra gli ultimi due gruppi (usciti, poi ospiti del giorno in fondo), perché senza camera non saprebbero dove stare nel rack. Il ragionamento vale ancora, ma **dentro** il gruppo: fra i presenti non ci sono più.
- Quattro stati per riga: `incasa`, `partenza` (parte oggi, ancora in camera), `checkout` (conto chiuso), `dayuse` (ospite del giorno) `[CODICE]`.
- **Avanzamento del soggiorno**: "Notte 3 di 7 · parte il …". La notte in corso è disegnata come **anello**, non come pallino pieno: alla data di lavoro quella notte non è ancora stata dormita. Chi parte oggi ha la fila piena ma **spenta**. Il giorno dell'arrivo è la notte 1; chi ha fatto il check-out mostra "Soggiorno concluso" `[DECISO][TEST]`.
- Oltre le **17 notti** i pallini diventano una **barra di larghezza fissa**: prima sparivano del tutto, e i soggiorni lunghi — quelli in cui sapere a che punto si è conta di più — restavano senza colpo d'occhio `[DECISO][TEST]`.
- **Badge "Nª volta"** con la data dell'ultima visita, per chi ha già **dormito** qui; accanto, se ci sono, le **visite in giornata** in un badge separato (§7) `[DECISO][TEST]`.
- Stessa banda di accoglienza degli Arrivi, stesse regole (§4).
- Filtri: **Oggi in hotel** · Partono oggi · VIP · Alert · Ricorrenze · Reclami · Usciti · **Day use** `[CODICE]`.
- **"Partono oggi"** comprende sia chi è ancora in camera con partenza odierna sia chi ha già fatto il check-out `[CODICE][TEST]`.
- **Due numeri, e dicono due cose diverse** — dal 20/08/2026 `[DECISO][TEST]`. La pastiglia «Oggi in hotel» conta **tutte le righe della lista**, come fanno le altre sette: il numero è quante righe vedi cliccandola. La riga sotto aggiunge *«di cui N in camera»*, che esclude gli ospiti del giorno e chi ha già fatto il check-out — ed è il numero che serve al banco. Il secondo compare solo quando differisce dal primo.
  Fino al 19/08 la pastiglia mostrava **solo** il secondo: diceva `7` su una lista di `9`, e il suo stesso suggerimento dichiarava di comprendere gli ospiti del giorno. Il contatore era nato quando la lista conteneva soltanto chi era in casa, prima che ci entrassero gli ospiti del giorno (13/08) e restassero visibili gli usciti (14/08): sono state aggiunte le loro pastiglie, ma quella «tutti» ha continuato a puntare al vecchio numero.
- Con un filtro che non seleziona nulla il contatore dice **"0 di 5"**, non "5": diceva il numero pieno a schermo vuoto `[DOC][TEST]`.

> **"Oggi in hotel" non è il numero della Home** `[DECISO]`. Questa lista comprende chi parte oggi, il riquadro "Restano stanotte" della Home no. Sono due domande diverse (vedi §3): i nomi lo dichiarano, invece di lasciar credere a un errore.

### Ospiti del giorno (day use) — dal 13/08/2026

Il gestionale registra gli esterni di SPA, piscina, cene e serate come prenotazioni con **arrivo e partenza nello stesso giorno**, e li marca "partiti" fin dalla creazione perché non pernottano. Il CRM chiedeva il check-in per la lista In casa e "diverso da partito" per gli Arrivi: **erano esclusi da entrambe**, cioè non comparivano da nessuna parte.

Sono circa **1.200 l'anno**, stabili dal 2023, e fra loro ci sono ospiti che l'hotel conosce: il 13/08 è venuta per la piscina un'ospite con quattro soggiorni alle spalle e una celiachia in nota.

- **Riconoscimento**: arrivo = partenza. Sui dati veri coincide sempre con "nessuna camera pianificata" (85 pratiche correnti, 3.168 archiviate dal 2024, tutte a zero camere), quindi non c'è ambiguità con le partenze anticipate `[DECISO]`.
- **Restano fuori** le pratiche di un giorno intestate a chi in quel momento è già in albergo con il check-in fatto: sono scritture contabili (l'extra addebitato a parte) e produrrebbero una seconda card per lo stesso ospite `[DECISO][TEST]`.
- «Già in albergo» significa **check-in fatto**, non «ha un'altra pratica che copre questa data»: i **voucher regalo** sono registrati come prenotazioni lunghe un anno e coprirebbero qualunque giorno `[DECISO][TEST]`.
- **In pagina**: pastiglia "Day use", nessuna camera, nessuna notte, nessun importo di soggiorno; **dopo chi è in casa e prima di chi è uscito** (§5, ordinamento, aggiornato il 14/08). Restano allergie, preferenze, VIP, reclami, "Nª volta" e note `[DECISO]`.
- **I tre numeri della Home non cambiano**: un ospite del giorno non fa check-in, non occupa una camera la notte, non è una partenza da gestire `[DECISO]`.

> **L'anagrafica «. .» — caso noto, non si tocca** `[DECISO]` (14/08/2026). Nel gestionale esiste l'anagrafica **65750**, con cognome `.` e nome `.`, nessun contatto e nessun codice fiscale: ci si registrano i consumi degli esterni in giornata senza intestarli a nessuno. Ha **8 prenotazioni correnti e 26 archiviate**; il 14/08 ne aveva due nello stesso giorno (40 € e 50 € di extra), quindi due card identiche in "In casa".
>
> Il CRM si comporta correttamente — una card per prenotazione — ma la mostra come se fosse una persona: nome che non è un nome, e il badge le attribuirebbe 26 day use come a un cliente affezionato. **Si è deciso di non mascherarlo nel CRM**: la convenzione si corregge dove nasce, con chi crea le pratiche. Un'applicazione che nasconde una convenzione sbagliata del gestionale la rende solo più difficile da vedere.
- **Sul foglio dei reparti ci vanno**, con l'etichetta: per la cucina un celiaco a cena è un celiaco a cena, che dorma qui o no `[DECISO]`.
- **Nell'export l'etichetta sta nella colonna Camera**, come `DAY USE`, e in coda alla lista — dal 14/08/2026 `[DECISO][TEST]`. Prima stava fra le *Attenzioni*, che però è la colonna degli allarmi (allergie, reclami, indesiderati): il day use non è un problema da gestire, è dove sta l'ospite. Nella cella un trattino avrebbe fatto pensare a un dato mancante. Se il gestionale ha assegnato una camera per uso diurno, il numero resta scritto accanto (`DAY USE · 304`): serve a chi la deve pulire.

### Casi limite

- La prenotazione risulta **uscita solo quando tutte le righe del conto sono chiuse** `[DECISO][TEST]`. Il conto ha una riga per occupante: se in camera resta anche una persona sola la card resta in lista come presenza normale, perché far sparire dalla lista qualcuno che è ancora in albergo è peggio che tenerci qualcuno già uscito. Serve anche il controllo che le righe *esistano*: senza, una pratica priva di conto risulterebbe uscita.
- Se il CRM non risponde, la lista viene comunque servita, almeno ordinata per camera `[CODICE]`.

---

## 6. Ricerca ospiti

### A cosa serve

Trovare un ospite per nome, email o telefono e aprirne la scheda.

### Regole

- Serve un minimo di **2 caratteri**; sotto quella soglia non parte nessuna ricerca `[CODICE]`.
- Si digita liberamente: ogni parola deve comparire da qualche parte nei dati dell'ospite, **in qualunque ordine** — "mario rossi" e "rossi mario" trovano la stessa persona `[CODICE][TEST]` (`test/pms-clienti.test.js`).
- Insensibile a maiuscole e accenti; apostrofi, punti e trattini vengono ignorati (`D'Amico` = `damico`) `[CODICE][TEST]`.
- Si cerca su **cognome, nome, email, cellulare, telefono** `[CODICE]`.
- Massimo **6 parole** e **20 risultati**, senza paginazione. Chi cerca un cognome comune non vede tutto `[CODICE]`.
- Le anagrafiche **senza cognome e senza nome non compaiono mai** nei risultati `[CODICE]`.
- Ogni risultato mostra città, telefoni ed email, e — se l'ospite è in casa in questo momento — la pastiglia "In casa" con il numero di camera `[CODICE]`.
- La ricerca guarda le **anagrafiche del gestionale**, ma le mostra **per persona**: i codici riconosciuti come la stessa persona si presentano in una riga sola (vedi sotto).

### Un ospite, un risultato — dal 14/08/2026

Quando due o più anagrafiche del gestionale sono state **riconosciute come la stessa persona** (§15), la ricerca ne mostra **una sola: la principale** `[DECISO][TEST]`. Prima comparivano tutte, e lo stesso ospite occupava due righe identiche.

- **Cercare il nome vecchio continua a funzionare.** Se il termine intercetta solo un'anagrafica collegata, al suo posto compare il **principale** — letto apposta dal gestionale, se non era già fra i risultati. Limitarsi a scartare le collegate avrebbe fatto rispondere che quell'ospite non esiste `[DECISO][TEST]`.
- La riga porta una pastiglia **"+N collegata/e"**, che spiega perché quell’ospite compare una volta sola. Il dettaglio è nel suggerimento del mouse `[CODICE][TEST]`.
- Le anagrafiche collegate **restano raggiungibili**: il banner "Scheda fusa" sulla scheda del principale le elenca e le apre, e "Confronta anagrafiche" mostra i dati affiancati (§15) `[CODICE][TEST]`.
- **Niente viene cancellato o alterato**: la fusione resta una mappatura nel CRM, il gestionale non si tocca, e **Scollega** rimette tutto come prima — la ricerca torna a mostrare due profili `[CODICE][TEST]`.
- Due omonimi **non associati** restano due risultati distinti: il raggruppamento agisce solo su chi è stato davvero riconosciuto `[TEST]`.

> **Il quinto punto del ticket era già soddisfatto.** «Il profilo principale come riferimento per l’alimentazione dei dati» vale dal **12/08** (D13, §15): preferenze, allergie, reclami, nucleo, nota personale e lingua vengono scritti tutti sul principale del gruppo, mai sull’anagrafica collegata. Questa evolutiva ha completato il quadro sul lato della **lettura**.

### Chi può

Tutti i ruoli: è una lettura.

---

## 7. Scheda ospite: anagrafica, statistiche, storico

### A cosa serve

Il fascicolo dell'ospite. Ci si arriva cliccando il nome ovunque compaia (arrivi, in casa, ricerca, nucleo, duplicati) o dalla ricerca.

### Anagrafica — dal PMS, in sola lettura

Nominativo, data di nascita, email, telefono, cellulare, città e nazione, codice fiscale, classificazione VIP, note libere del gestionale, consensi privacy.

- **Nulla di questo si modifica dal CRM.** La data di nascita in particolare è stata deliberatamente tolta dal CRM per non avere due valori che possono divergere `[CODICE][TEST]` (`test/clienti-api.test.js`, «data di nascita: esposta dal PMS, non modificabile dal CRM»; commento in `src/crm/profilo.js`).
- **VIP** non è un livello ma una classificazione (per esempio "bollicine + frutta fresca", "ospite indesiderato"), letta dalla tabella del gestionale. L'ospite indesiderato viene riconosciuto dalla **descrizione**, non da un codice fisso `[CODICE][TEST]`.
- **Consensi**: quattro riquadri Sì/No — marketing, telefonate in camera, conservazione, cessione — con la logica del gestionale già ribaltata `[DOC][TEST]`.
- Se l'ospite fa parte di un nucleo, sotto le note del gestionale compaiono anche **le note anagrafiche degli altri membri del nucleo**, con il nome di chi le possiede `[CODICE]`.

### Statistiche cumulative

Numero di soggiorni, notti totali, LTV (arrangiamenti + extra), spesa media a soggiorno / camere / servizi, prima e ultima visita, ultima Source e ultimo mercato.

- Sono calcolate **in tempo reale** dallo storico, non da una tabella precalcolata `[DOC]` (`HANDOFF.md` §7).
- **La city tax è esclusa** da extra e LTV: è una tassa di passaggio, non un ricavo `[DOC]`.
- **Contano solo i soggiorni avvenuti** `[DECISO][TEST]`. Restano fuori: *Eliminata*, *No-show*, e le prenotazioni che devono ancora cominciare (*Pianificata*, *Confermato*). Queste ultime hanno importi a zero perché non c'è ancora nulla di maturato: contarle gonfiava il numero dei soggiorni e abbassava tutte le medie — un ospite con 10 soggiorni e 2 prenotazioni per l'estate prossima ne risultava 12.
- Restano invece **dentro** i soggiorni *In casa* e *Partito*: stanno avvenendo o sono appena finiti, e i soldi sono veri.
- **Un day use non è un soggiorno** — dal 18/08/2026 `[DECISO][TEST]`. Arrivo e partenza nello stesso giorno: nessuna notte, nessuna camera. Fino al giorno prima contava come gli altri, e la stessa applicazione dava due risposte sullo stesso ospite: il badge in card diceva *4ª volta*, la scheda *5 soggiorni*.
- **I suoi soldi però restano nel valore storico** `[DECISO][TEST]`. Sono stati incassati davvero: toglierli farebbe risultare l’ospite meno generoso di quanto è stato. Cambia solo il denominatore delle medie — sull’ospite di prova la spesa media passa da 1.470 a 1.837,50 € a soggiorno, perché si divide per quattro e non per cinque.
- Chi è venuto **solo** in giornata ha quindi **zero soggiorni** ma una spesa: la scheda lo dichiara con una riga *"+ N day use"* sotto il conteggio, altrimenti il valore storico sembrerebbe uscito dal nulla `[CODICE][TEST]`.
- La definizione di day use è **la stessa del resto del CRM** (arrivo = partenza), non una seconda regola. Se le date mancano si guardano le notti `[CODICE][TEST]`.
- **Una pratica senza date non è né un soggiorno né un day use: non si conta** — dal 18/08/2026 `[DECISO][TEST]`. Sono in gran parte pratiche archiviate vecchie, dati sporchi. Contarle come soggiorni gonfiava lo storico dell'ospite; contarle come day use gli attribuiva giornate che non ha mai fatto. **I suoi soldi restano nel valore storico**: se in quella pratica c'è un importo qualcuno l'ha pagato, e il valore storico è la somma di ciò che è entrato, non di ciò che sappiamo classificare.
  - La riga **resta visibile nello storico** della scheda, con i trattini al posto delle date: nasconderla renderebbe solo più difficile andare a correggerla nel gestionale. È la stessa linea tenuta con l'anagrafica «. .» (§5).
  - Quando ce ne sono, la scheda **lo dichiara** sotto il conteggio — *"2 pratiche senza date, non contate"* — accanto ai day use. Senza, chi conta le righe dell'elenco troverebbe un totale diverso da quello del riquadro Soggiorni e penserebbe a un guasto.
  - **Lo zero dichiarato resta un day use**: la regola non è "senza date, allora fuori", è "senza date *e* senza notti". Una pratica con `notti = 0` scritto è una giornata, e si conta come tale.
- Questa regola **allinea la scheda al resto dell'applicazione**: il badge "Nª volta" e tutti i numeri della dashboard escludevano già le pratiche senza date, e la scheda era l'unica a contarle `[CODICE]`.

> **Come è venuto fuori, ed è il motivo per cui vale la pena raccontarlo** `[DECISO]` (18/08/2026).
>
> Fino al 18/08 la regola era l'opposta — *"un campo vuoto non è uno zero, la riga vale come soggiorno"* — ed era scritta in un commento nel codice. **Il codice faceva il contrario**: in JavaScript `Number(null)` non vale "non è un numero", vale **zero**, e una pratica senza date arriva dal gestionale con le notti a `null`. Diventava uno zero, e finiva fra i **day use**.
>
> C'era anche un test su quella regola, ed era verde: passava una riga **priva del campo** notti, che in JavaScript diventa `undefined` — l'unico dei tre valori possibili che funzionava. Un test che prova solo il caso che funziona è peggio di nessun test, perché dichiara una copertura che non c'è.
>
> Messo davanti al comportamento vero, Mik ha cambiato la regola invece di farla rispettare: se non si sa cosa sia una pratica, **non la si conta**. Che è anche ciò che il resto dell'applicazione faceva già.
- **Nemmeno un voucher regalo è un soggiorno** — allineato il 20/08/2026 `[DECISO][TEST]`. Il gestionale lo registra come una prenotazione **lunga un anno**, perché quella è la sua validità. Il badge lo escludeva dal 13/08, la scheda no: lo stesso ospite aveva **3 soggiorni di là e 2 di qua**, e soprattutto il voucher si portava dietro le sue **365 notti** — «notti totali» diceva 374 e la media **124,7 notti a soggiorno**, in un albergo dove la stagione dura meno di duecento giorni. Come per i day use, **i suoi soldi restano** nel valore storico: è stato pagato davvero.
  Non serve sapere se il gestionale, quando il voucher viene usato, crei una pratica nuova o riusi quella esistente: se ne crea una nuova il voucher resta lungo un anno ed è escluso, se riusa quella le date diventano quelle del soggiorno vero e la riga rientra da sola. **In entrambi i casi il taglio fa la cosa giusta** — la domanda che era rimasta aperta si è sciolta da sé.
- Con queste regole il numero **coincide con il badge "Nª volta"** delle schede, che conta i soggiorni archiviati più quello in corso.
- Il taglio delle **200 notti** è scritto in **tre punti** — nelle statistiche della scheda e dentro il SQL di due interrogazioni, dove non si può importare. Un test verifica che i tre valori restino uguali: se un domani si cambia in un punto solo, scheda e badge tornano a dare numeri diversi sullo stesso ospite `[TEST]`.

> **Che cosa conta come "una volta"** `[DECISO][TEST]` — deciso il 13/08/2026 guardando l'archivio vero.
>
> L'archivio delle prenotazioni non contiene solo soggiorni. Su 41.337 pratiche archiviate: **12.492 sono giornate** (SPA, piscina, cene per esterni), **2.951 non hanno nemmeno le date** e **79 sono voucher regalo**, registrati come prenotazioni lunghe un anno perché quella è la loro validità. Un terzo di ciò che contava come soggiorno non lo era.
>
> Contandole tutte, **9.996 ospiti su 62.123** risultavano più affezionati di quanto fossero, e **5.363 comparivano come "di ritorno" senza aver mai dormito qui**. Un ospite in casa il 13/08 leggeva "7ª volta" con cinque soggiorni veri.
>
> Da oggi sono **due conteggi separati**: il badge "Nª volta" conta i soggiorni con pernottamento; le giornate hanno un badge a parte ("3 day use"). Non si sommano — chi ha dormito qui una volta e poi è tornato sei volte per la SPA è al secondo soggiorno — ma non si buttano: un cliente che torna spesso in giornata è un dato commerciale, e prima chi veniva **solo** in giornata non entrava proprio nello storico.
>
> Il taglio è fra **1 e 200 notti**: sotto c'è la giornata, sopra il voucher (stanno tutti sui 365 giorni), e qui la stagione dura meno di 200 giorni. Anche **"ultima visita"** guarda solo i soggiorni: prendeva il massimo fra le partenze, e un voucher valido fino al 2027 poteva far scrivere alla card una data che deve ancora arrivare.
- **Le prenotazioni future restano visibili nello storico** `[DECISO][TEST]`: non contano nei numeri, ma sapere che l'ospite torna a giugno serve a chi lo accoglie.
- Prima e ultima visita sono cliccabili e portano allo storico, che si apre e lampeggia `[CODICE]`.

### Storico soggiorni

Una riga per pratica: numero, arrivo → partenza, notti, camere, importo, extra, stato.

- Entrano le prenotazioni in cui l'ospite è **referente oppure occupante**: chi viaggia in famiglia vede i soggiorni condivisi `[DOC]`.
- Correnti e archiviate sono unite; se una pratica è presente in entrambe vince quella archiviata, per non contarla due volte `[CODICE]`.
- **Importo**: pianificato per le prenotazioni correnti, maturato per quelle concluse (la pianificazione non sopravvive all'archiviazione) `[CODICE]`.
- **Stati possibili**: In casa, Partito, Pianificata (arrivo futuro), No-show (arrivo passato senza check-in), Confermato (arriva oggi), Concluso, Eliminata `[DECISO]`. Lo stato *No-show* è dedotto dal CRM, non letto dal gestionale: le specifiche del 30/07 chiedevano di non averlo, ma alla prova dei fatti serve alla reception e **resta com'è** — sono quelle specifiche a dover essere corrette.
- I soggiorni futuri o senza maturato mostrano zero. Decisione registrata: "per ora lascia così" `[DOC]` (`HANDOFF.md` §9).

### Chi può

Consultare: tutti. Le sezioni scrivibili della scheda sono trattate nei paragrafi seguenti.

---

## 8. Consumi F&B e SPA

### A cosa serve

Capire cosa consuma davvero l'ospite: piatti, vini, trattamenti. Alimenta anche il suggeritore AI di preferenze.

### Regole

- **F&B** (ristorante/bar): consumi aggregati per articolo, con quante volte e quanto. Sono agganciati a **camera + date del soggiorno**, perché nelle comande il numero di pratica è vuoto `[CODICE]`.
- Di conseguenza **il F&B è un dato del soggiorno, non della persona**: con famiglie e coppie un consumo può essere di un accompagnatore. È scritto nel codice ed è coerente con l'analisi `[DOC][CODICE]` (`DOCS/2026-08-04-...`).
- Le comande eliminate e le voci cancellate sono escluse `[CODICE]`.
- **SPA**: trattamenti e prodotti benessere, presi dagli extra maturati, riconosciuti dal gruppo merceologico. A differenza del F&B sono agganciati alla **linea del singolo occupante**, quindi restano attribuiti a chi li ha ricevuti `[CODICE]`.
- Gli importi SPA sono già dentro il totale "Extra" dell'ospite: qui vengono solo dettagliati, non è un doppio conteggio `[CODICE]`.
- Massimo **40 voci** per lista, ordinate per frequenza; a schermo se ne mostrano poche per categoria `[CODICE]`.
- Categorie F&B: Vini, Bevande, Cibo, Altro. Categorie SPA: Trattamento, Prodotto, Altro `[CODICE][TEST]`.
- Entrambe le sezioni leggono su **tutte le anagrafiche fuse** del gruppo `[CODICE]`.
- Le due sezioni sono caricate con chiamate separate perché le interrogazioni sono pesanti `[CODICE]`.

### Non fatto

Il documento di Fase 3 prevedeva l'esclusione delle voci interne/omaggio (welcome, complimentary, righe a zero) `[DOC]`; nel codice non c'è alcun filtro di questo tipo `[CODICE]`.

---

## 9. Preferenze

### A cosa serve

Registrare cosa gradisce l'ospite in modo che arrivi al reparto giusto: "cuscino in piuma", "sempre vino bianco", "tavolo lontano dalla musica".

### Struttura di una preferenza

- **Reparto** (a chi serve): Rooms · F&B · SPA · Front office.
- **Categoria** (che tipo è): F&B · Camera · Persona · Occasioni · Generale.
- **Testo** libero, massimo 400 caratteri.
- **Ambito**: `personale` (vale solo per questo ospite) oppure `nucleo` (condivisa con chi viaggia con lui).

Reparto e categoria sono **liste chiuse**, validate sia dall'applicazione sia dal database. Un valore fuori elenco viene rifiutato `[DOC][TEST]`.

### Regole

- **L'ambito predefinito è `nucleo`, ed è una decisione presa** `[DECISO][TEST]` (`test/clienti-api.test.js`, «preferenze: ambito default nucleo»). Il modulo della scheda non chiede l'ambito: chi inserisce una preferenza ne crea una condivisa senza doverlo scegliere. La maggior parte delle preferenze riguarda davvero chi viaggia insieme, e chiedere ogni volta rallenterebbe il banco per il caso raro. **Il documento di analisi del 04/08 chiedeva il contrario** (default personale con adesione volontaria): quel documento è superato su questo punto e va corretto.
- Chi inserisce una preferenza davvero personale la marca dopo, con l'interruttore sulla riga.
- L'ambito si cambia dopo, con un interruttore a due voci sulla riga `[CODICE]`.
- Le preferenze di ambito `nucleo` **di un altro membro del nucleo** compaiono sulla scheda in un blocco separato, **in sola lettura**, con il nome di chi le possiede (cliccabile). Si correggono solo dalla sua scheda `[CODICE][TEST]`.
- Le preferenze `personale` non compaiono sulla scheda degli altri membri del nucleo `[CODICE][TEST]`, ma **compaiono nelle card della loro prenotazione** (vedi sotto).

### Quali finiscono nelle card — dal 14/08/2026

Nelle card di Arrivi e In casa e nell'export compaiono **sia le personali sia quelle di nucleo**, al massimo **cinque** `[DECISO][TEST]`. Fino al 13/08 entravano solo le `nucleo`: una preferenza scritta sulla singola persona non arrivava a chi la doveva servire.

- Una preferenza personale porta il **nome di chi la ha**; quelle di nucleo restano senza nome, perché sono di tutti `[DECISO][TEST]`. È lo stesso criterio delle allergie (D2): *"caffè decaffeinato"* su una prenotazione da quattro persone, senza dire per chi, non è servibile. Nessuna etichetta e nessun colore in più: la distinzione è il nome.
- Le altre non spariscono: una **(i)** dice quante sono e rimanda alla scheda dell'ospite, che si apre dal nome in cima alla card `[DECISO]`.

**Come si scelgono le cinque.** Il ticket proponeva di pesarle per affidabilità, frequenza e criticità. Misurando le 64 preferenze vere il 14/08, **nessuno di questi segnali esiste nei dati**: non c'è un contatore di conferme, non c'è una fonte da pesare, non c'è un campo "critica", tutte hanno la stessa forma («gradisce X», «predilige Y») e **50 su 64 sono dello stesso reparto**. Un punteggio costruito su questi dati sembrerebbe autorevole e sarebbe arbitrario, quindi non è stato scritto. Si sceglie sulle due cose che i dati dicono davvero `[DECISO]`:

1. **Le personali prima**: riguardano una persona sola fra quelle presenti, ed erano quelle che si perdevano.
2. **Poi si varia**: non due volte lo stesso reparto né la stessa persona, finché ci sono alternative. Serve perché **11 ospiti su 14 ne hanno più di tre** e chi ne ha otto le ha quasi tutte di cucina: prendendole in ordine, sull'ospite 2117 uscivano tre bevande e spariva *"aggiungere topper se c'è il divano letto"*, che va eseguito al check-in.

A parità di tutto, la più recente. Il tetto è **un solo valore condiviso** dalle due pagine e dall'export, così non possono divergere.
- Una preferenza si elimina, non si archivia. Si può correggere testo, reparto, categoria e ambito `[CODICE]`.
- Ogni riga porta autore e data di inserimento `[CODICE]`.
- **Dal 13/08/2026 ogni preferenza porta la propria origine** — scritta a mano o confermata da un suggerimento dell'AI `[CODICE][TEST]`. Prima passavano dalla stessa strada e diventavano indistinguibili (`DOCS/2026-08-10-analytics-dashboard-analisi.md` §3.2): senza questo dato non si sarebbe mai potuto dire se l'AI faccia risparmiare tempo o solo rumore.
- Testo oltre i 400 caratteri → messaggio che dice quanto ci sta e quanto è stato scritto, e il testo resta nel campo `[DOC][TEST]`. **Lo stesso controllo vale in correzione**, non solo in inserimento: correggere una riga non è meno rischioso che crearla `[DECISO][TEST]`.
- Una preferenza si corregge o si elimina **solo dalla scheda dell'ospite a cui appartiene** `[DECISO][TEST]`: il percorso della richiesta porta anche il codice ospite, e una riga di un altro risulta inesistente. Serve a rendere innocuo un errore di programmazione, non a difendersi dal personale.

### Chi può

Leggere: tutti. Aggiungere, modificare, eliminare: `reception` e `admin`.

### Da dove vengono i dati

Interamente CRM.

---

## 10. Allergie e intolleranze

### A cosa serve

Il dato di sicurezza. Sbagliarlo o perderlo ha conseguenze reali in cucina.

### Regole

- Una riga per allergia, testo libero fino a **200 caratteri**. Solo aggiungi ed elimina: **non si modifica in place** `[CODICE]` — un dato di sicurezza corretto a metà è peggio di uno riscritto.
- Ogni riga porta autore e data `[CODICE]`.
- Nelle schede di Arrivi e In casa compaiono in evidenza con l'etichetta esplicita "⚠ Allergie:" davanti al valore: "Noci" da solo sembrerebbe una preferenza `[CODICE][TEST]` (`test/web-ricerca.test.js`).
- Campo vuoto → nessun alert, non un alert vuoto `[CODICE][TEST]`.
- **Nelle schede e sul foglio per i reparti ogni allergia porta il nome di chi la ha** `[DECISO][TEST]`. La prenotazione è di più persone: "Glutine" da solo non dice a quale commensale preparare il piatto senza, e la cucina non può cliccare per scoprirlo. Sul foglio stampato le allergie vanno una per riga.
- I doppioni si tolgono per **coppia persona + allergia**: due occupanti celiaci restano due voci, perché sono due piatti `[DECISO][TEST]`.
- Se il nome manca (dato vecchio, anagrafica non raggiungibile) l'allergia si mostra lo stesso: meglio un allarme senza nome che nessun allarme `[DECISO][TEST]`.
- Un salvataggio fallito **lo dice**, e il testo resta nel campo: prima non succedeva niente e si credeva di aver registrato un'allergia che non c'era `[DOC][TEST]`.
- Le allergie si leggono su tutte le anagrafiche fuse; **la scrittura va sull'anagrafica principale del gruppo** `[DECISO][TEST]` (vedi §15).
- Si elimina **solo dalla scheda dell'ospite a cui appartiene** `[DECISO][TEST]`.

### Chi può

Leggere: tutti. Aggiungere ed eliminare: `reception` e `admin`.

### Da dove vengono i dati

CRM. Le proposte automatiche nascono da una nota del PMS ma non sono ancora un dato: vedi il paragrafo seguente.

---

## 11. Proposte di allergie dai testi del gestionale

### A cosa serve

Le allergie spesso sono già scritte nel gestionale, ma in posti dove nessuno le cerca durante il servizio. L'applicazione le riconosce e **le propone**; è la reception a decidere.

### Le due fonti — dal 13/08/2026

Il gestionale le scrive in due campi diversi, e la differenza non è un dettaglio tecnico: cambia **quanto ci si può fidare** della proposta `[DECISO][TEST]`.

| Campo | Dove sta | Attribuzione |
|---|---|---|
| `Prenota.Note` | sulla **prenotazione** | incerta: la pratica può avere più occupanti |
| `Anagra.Annotazioni` | sull'**anagrafica della persona** | certa per costruzione |

Fino al 13/08 si leggeva solo il primo. Il secondo era già mostrato nella scheda ospite, in un riquadro richiuso che durante il servizio nessuno apre: **92 anagrafiche parlano di allergie e non arrivavano in cucina**. Quel giorno, in hotel, due ospiti dormivano in casa con un'allergia scritta in anagrafica e nessuna traccia nella nota della prenotazione.

- Le proposte dall'**anagrafica** arrivano con il nome già attribuito: niente da scegliere `[DECISO][TEST]`.
- Le proposte dalla **nota** mantengono il menu con referente e occupanti: la persona la sceglie chi sa leggere `[DECISO][TEST]`.
- Ogni riga **dichiara la propria provenienza**, così chi guarda sa quanto fidarsi `[DECISO]`.
- Quando lo stesso termine arriva da entrambe, **vince l'anagrafica** `[DECISO][TEST]`.
- Nessuna interrogazione in più: `Annotazioni` è una colonna aggiunta alla lettura batch delle anagrafiche che Arrivi e In casa già fanno `[CODICE]`.

### Dove compaiono

Arrivi, In casa **e scheda ospite** `[DECISO]`. Sulla scheda entrano entrambe le fonti: all'inizio erano escluse le note di prenotazione per non attribuire in silenzio a chi apre la pagina un'allergia riferita a un altro occupante, ma alla prova coi dati veri la scelta non ha retto — chi apre la scheda ha davanti la frase, il numero di pratica e le date, e giudica meglio di qualunque regola. Sulla scheda si leggono le note delle prenotazioni **correnti**, non l'archivio: le richieste di soggiorni conclusi anni fa tornerebbero a galla a ogni apertura senza che nessuno sappia se valgono ancora.

### Perché propone e non scrive

Due motivi osservati nelle note vere, nessuno risolvibile con più codice `[DOC]`:

1. **La nota della prenotazione è della pratica, non della persona.** "La signora è celiaca", in una pratica con quattro ospiti, non dice quale signora. Attribuirla d'ufficio all'intestatario può mettere l'allergia sulla persona sbagliata — peggio che non averla, perché sposta l'attenzione della cucina.
2. **La negazione esiste.** "Il bambino NON è allergico alle arachidi" si scrive davvero.

### Le regole di riconoscimento

Sono regole scritte, non intelligenza artificiale: il vocabolario è di una ventina di termini, la risposta è immediata, gratuita e **spiegabile** — la proposta mostra la frase da cui nasce `[DOC]`.

| Nota | Esito | Perché |
|---|---|---|
| "Allergia alle arachidi" | ⚠ Arachidi | marcatore + sostanza |
| "La signora è celiaca" | ⚠ Celiachia | termine che vale da solo |
| "Gradisce la torta alle noci" | — | sostanza senza marcatore |
| "Non è allergico alle arachidi" | — | negazione |
| "No glutine" | ⚠ Glutine | il "no" cade sulla sostanza |
| "No allergie" | — | il "no" cade sull'allergia |
| "Allergica ai pollini di betulla" | ⚠ Pollini di betulla | sostanza fuori elenco, si prende la coda |
| "Camera no fumatori, servire crostacei" | — | marcatore debole lontano dalla sostanza |
| "Allergica: verificare in cucina" | — | dopo i due punti c'è un ordine di servizio |

Tutte fissate da test `[DOC][TEST]` (`test/allergie-note.test.js`, 20 casi).

Regole di fondo:

- **Sostanze** (glutine, lattosio, arachidi, frutta a guscio, crostacei, molluschi, pesce, uova, soia, sedano, sesamo, solfiti, fragole, nichel, lattice, latticini): valgono solo con un marcatore nella stessa frase `[DOC]`.
- **Marcatori forti** (allergia, intolleranza, evitare, vietato, non può) valgono ovunque nella frase; **marcatori deboli** (no, niente, senza) solo se attaccati alla sostanza — al massimo due parole di distanza e nessuna virgola in mezzo `[DOC][TEST]`.
- **Termini autonomi**: celiachia, favismo `[DOC]`.
- La nota si spezza su punti, punti e virgola, a capo **e congiunzioni avversative** ("ma", "però", "invece"): senza queste ultime, "il bambino non ha allergie ma la madre è allergica al lattosio" perdeva il lattosio `[DOC][TEST]`.
- **Non si spezza sulla virgola**, per non perdere gli elenchi: "allergia a noci, arachidi e mandorle" diventerebbe tre pezzi e i pezzi dopo il primo perderebbero il marcatore `[DOC][TEST]`.
- **Le diete sono escluse di proposito** (vegetariano, vegano): non sono dati di sicurezza e sporcherebbero la card. Il loro posto sono le preferenze `[DOC]`.
- Ciò che è **già registrato** non viene riproposto (confronto senza maiuscole) `[DOC][TEST]`.

### Ciclo di vita di una proposta

| Azione | Effetto | Durata |
|---|---|---|
| **Aggiungi** | L'allergia viene salvata sull'ospite scelto e compare subito in tutte le schede a video che lo coinvolgono | definitiva `[DOC]` |
| **Ignora** | La proposta sparisce | fino al ricaricamento dell'applicazione (memoria del browser, chiave prenotazione + termine) `[DOC]` |
| nessuna azione | Riappare a ogni caricamento della pagina `[DOC]` |

- **Chi conferma sceglie a chi attribuire l'allergia** da un menu con il referente e tutti gli occupanti. Se la prenotazione non ha nessuna persona identificabile, la proposta non viene nemmeno mostrata `[CODICE]`.
- L'analisi gira **solo** sulle note che Arrivi e In casa già caricano: arrivi della data mostrata e presenti in questo momento. Nessuna interrogazione nuova, nessun lavoro notturno, nessun popolamento massivo `[DOC]`.
### Misura sui dati veri — 13/08/2026 `[DECISO]`

Il vocabolario era tarato su note inventate, tutte italiane, in un albergo dove la maggioranza degli ospiti è straniera. Passata su **30.938 note di prenotazione** e **12.182 annotazioni di anagrafica**, con misura prima/dopo a ogni modifica:

- aggiunte le forme **inglesi, tedesche e francesi** di ogni sostanza e la regola "X free / X frei": *"gluten free"* da solo compariva in 29 note e non produceva niente;
- **le piume messe in elenco**: sono il secondo allergene per frequenza dopo il glutine e finivano nel testo libero, quindi la stessa cosa usciva come cinque voci diverse (*"Piume d'oca"*, *"Feather pillow"*, *"Down feathers in pillows and bedding"*…);
- tagliate le code che non sono sostanze: istruzioni in mezzo alla frase (*"…AL CETRIOLO EVITARE IN CIBI E BEVANDE"*), verbi coniugati che aprono un'altra frase, parentesi mai aperte, marcatori dentro parole composte (*"allergy-friendly room"*), frasi che richiamano un'allergia detta altrove (*"comunicare questa allergia ai ristoranti"*), negazioni inglesi.

**Dove siamo.** Su una finestra di sette giorni di ospiti veri: **7 proposte, corrette tutte e sette, zero falsi positivi**. Delle 32 note che nominano allergie senza produrre proposte: **14 è giusto che tacciano** (7 dicono che allergie non ce ne sono, 7 chiedono di raccoglierle), **12 nominano un'allergia senza dire di cosa** (cuscini anallergici, niente moquette, camera senza animali: l'allergene non è scritto e inventarlo sarebbe peggio che tacere), **5 sono elenchi di più sostanze in una frase sola** e **1 è una forma inglese non coperta**.

> **Il limite di fondo delle regole** sono quei 5 elenchi: *"intollerante al lattosio e allergica allo zenzero"* dà il lattosio e perde lo zenzero. È l'unico punto in cui un modello linguistico sarebbe più bravo — insieme all'attribuzione ("la bambina il lattosio, la signora i crostacei"). Discusso il 13/08 e **rimandato**: le regole sono istantanee, gratuite e non si spengono quando finisce il credito dell'AI, e un'allergia è un dato sanitario che oggi non esce dall'albergo. Se un giorno si farà, va fatto **sopra** le regole e non al posto loro, leggendo ogni nota una volta sola e conservando il risultato.

### Chi può

Vedere le proposte: tutti. Confermarle o ignorarle: `reception` e `admin` (l'intero riquadro sparisce in sola lettura) `[CODICE][TEST]`.

---

## 12. Reclami (complaints)

### A cosa serve

Tenere traccia di cosa è andato storto, a chi girarlo e come è stato risolto — e sapere, al successivo arrivo, che quell'ospite ha già avuto un problema.

### Struttura di un reclamo

Testo libero (senza limite), **reparto**, **categoria**, periodo indicativo (facoltativo, 60 caratteri), stato aperto/risolto, follow-up, autore, data di apertura e di risoluzione.

- **Reparto**: la stessa lista chiusa delle preferenze (Rooms · F&B · SPA · Front office). Deliberatamente identica: è la dimensione con cui si segregano i dati per reparto, e due liste diverse renderebbero impossibile incrociare "cosa gradisce" e "cosa è andato storto" `[DOC][TEST]`.
- **Categoria**: lista **propria** — Pulizia · Manutenzione · Rumore · Servizio · Cibo e bevande · Attesa · Conto · Altro. Le categorie delle preferenze descrivono un gradimento; un reclamo deve dire cosa non ha funzionato `[DOC][TEST]`.

### Regole

- Reparto e categoria sono **obbligatori sui reclami nuovi** `[CODICE][TEST]`. I reclami inseriti prima che esistessero restano senza e mostrano un tag "da classificare" cliccabile, che apre la maschera di classificazione `[DOC][CODICE]`.
- **Non si può risolvere un reclamo senza dire come è stato gestito**: il follow-up è obbligatorio alla risoluzione, e la regola sta sul server, non solo nella maschera `[CODICE][TEST]` (`test/clienti-api.test.js`, «risolvere senza follow-up → 400 e il complaint resta aperto»).
- Follow-up: massimo 500 caratteri `[CODICE][TEST]`.
- **Riaprire non cancella il follow-up**: dice cosa era già stato tentato e non era bastato. Lo sovrascrive la risoluzione successiva `[CODICE][TEST]`.
- Riaprendo, la data di risoluzione viene azzerata `[CODICE][TEST]`.
- Il follow-up si può correggere da solo, senza toccare lo stato `[CODICE][TEST]`.
- I reclami **aperti compaiono per primi** nell'elenco, poi per data decrescente `[CODICE][TEST]`.
- Nelle schede di Arrivi e In casa si legge il **testo** dei reclami aperti, preceduto da reparto e categoria: "1 reclamo aperto" non dice niente a chi deve accogliere l'ospite `[CODICE][TEST]`. Dei reclami risolti resta solo il conteggio.
- Un reclamo si elimina definitivamente `[CODICE]`.
- Modifica del testo e del periodo passano da due finestrelle di sistema del browser (`prompt`), non da una maschera dell'applicazione `[CODICE]`.

### Chi può

Leggere: tutti. Creare, classificare, risolvere, riaprire, eliminare: `reception` e `admin` — "Risolvi/Riapri" compreso, che cambia lo stato ed è quindi una scrittura `[CODICE][TEST]`.

### Da dove vengono i dati

Interamente CRM.

---

## 13. Note personali e lingua preferita

### A cosa serve

**Nota personale**: chi è l'ospite — cariche, ruoli, come rivolgersi. Distinta dalle preferenze. **Lingua preferita**: il gestionale non la memorizza, quindi è un campo del CRM `[DOC]`.

### Regole

- Entrambe stanno sulla stessa riga di profilo (una per ospite) e si caricano insieme `[CODICE]`.
- La nota personale ha un tetto di **4.000 caratteri**, la lingua di 40 `[DECISO][TEST]`. Il tetto è largo apposta: oltre, la nota non è leggibile da nessuno e pesa su ogni caricamento degli Arrivi, dove viene letta per ogni ospite del giorno. Il controllo è sul **risultato**, non su quello che si scrive: a farla crescere è l'accodamento del briefing AI (§18), non una singola scrittura.
- Nelle schede di Arrivi e In casa la nota compare **accorciata**: non è un riassunto, è l'inizio della nota tagliato dove finisce la frase, al massimo 90 caratteri. Chi scrive mette l'identikit in apertura e il dettaglio dopo `[CODICE][TEST]` (`test/arrivi-brief.test.js`, sei casi su `sintetizzaNota`).
- Il taglio non spezza mai una parola a metà e non lascia un punto e virgola in coda; il segno "c'è dell'altro" lo mette la scheda, una volta sola `[CODICE][TEST]`.
- Nelle schede compare **solo la nota del referente** (e delle sue anagrafiche fuse), mai quella di un occupante: la scheda è intestata al referente `[CODICE][TEST]`.
- La versione accorciata la calcola il server, così chi salva la vede comparire subito nelle schede a video senza ricaricare `[CODICE]`.
- **Su una scheda fusa, "Elimina" cancella su tutto il gruppo.** La lettura prende il primo valore non nullo di tutte le anagrafiche fuse: svuotandone una sola, la nota di un altro codice riaffiorava e sembrava che il pulsante non funzionasse. Decisione presa il 12/08: **la nota è della persona, non dell'anagrafica**. Conseguenza accettata: dopo uno "Scollega" quell'anagrafica non ritrova la sua vecchia nota `[DOC][TEST]` (`test/profilo-fusa.test.js`).
- Cancellare la nota **non porta via la lingua**, e viceversa `[TEST]`.
- La modifica scrive **sull'anagrafica principale del gruppo** `[DECISO][TEST]` (vedi §15).
- **Non si mostra chi/quando** accanto alla lingua: la riga di profilo ha una sola data di modifica, condivisa con la nota, e mostrarla sarebbe una data sbagliata `[CODICE]`.
- Per lo stesso motivo l'andamento nel tempo delle note non è ricostruibile `[DOC]`.
- Entrambi i riquadri hanno due stati: valore salvato con ✎ Modifica / Elimina, oppure modulo di inserimento. Dopo il salvataggio si torna sempre alla vista, ricaricando dal server: è la conferma che il dato c'è `[CODICE]`.

### Chi può

Leggere: tutti (a chi non può scrivere si mostra il testo o "nessuna nota", mai un modulo) `[CODICE][TEST]`. Scrivere: `reception` e `admin`. La generazione con AI richiede anche `usa-ai`.

---

## 14. Nucleo di viaggio

### A cosa serve

Sapere chi viaggia con l'ospite e in che rapporto: coniuge, figli, assistente. Serve all'accoglienza e a condividere le preferenze fra familiari.

### Regole

- Ogni membro ha una **relazione** da lista chiusa (Coniuge · Figlio-a · Genitore · Amico-a · Assistente · Altro), nome, cognome e una nota fino a 400 caratteri `[DOC][TEST]`.
- **Serve almeno il nome o il cognome** per aggiungere un membro `[CODICE][TEST]`.
- Tutti i campi sono modificabili in riga; il membro si può eliminare `[CODICE][TEST]`.
- Un membro agganciato a un'anagrafica del gestionale ha il nome **cliccabile**; uno scritto a mano resta testo, senza fingere un collegamento che non c'è `[CODICE][TEST]`.

### Precompilazione automatica

Alla **prima apertura della scheda** il nucleo viene precompilato con i co-occupanti delle prenotazioni `[CODICE]`:

- Un co-occupante è chi ha condiviso almeno una pratica con l'ospite (come occupante o come referente).
- **Se l'ospite ha al massimo 3 prenotazioni** entrano tutti i co-occupanti; **se ne ha di più** entrano solo quelli ricorrenti, cioè con almeno 2 soggiorni condivisi `[CODICE][TEST]` (`test/pms-nucleo.test.js`).
- **Le aziende sono escluse**, riconosciute dalla forma societaria nel nome (srl, spa, snc, sas, ltd, gmbh, inc) `[CODICE][TEST]`.
- I nomi precompilati arrivano con relazione **"Altro"**, da correggere a mano. Nelle schede di Arrivi e In casa la relazione "Altro" **non viene mostrata**: è il valore predefinito, quindi sarebbe rumore `[CODICE]`.
- **Il controllo si rifà a ogni apertura** e aggiunge chi è comparso nel frattempo — dal 14/08/2026 `[DECISO][TEST]`. Chi è già in elenco **non viene toccato**: relazione, nome e nota corretti a mano restano. Chi è stato **tolto non torna**: l'esclusione viene annotata in `customer_nucleo_scartati`, altrimenti correggere il nucleo sarebbe una fatica che si disfa da sola.

**Perché è cambiato.** Fino al 13/08 la precompilazione girava **una volta sola**, alla prima apertura. Il timore era che una composizione di anni prima restasse valida per sempre; misurando il database dell'hotel il 14/08 il difetto è risultato **l'opposto, e più immediato**: la scheda si apre preparando l'arrivo, gli occupanti entrano nel gestionale **al check-in**, e il nucleo veniva fotografato **prima che esistesse**.

Il caso: la scheda **81866 GINSBERG** è stata aperta il **07/08** con un solo accompagnatore noto; **KEIDAN ELIZABETH**, **GINSBERG SUMHA** e **CONTRERAS MARIA ELENA**, registrati lo stesso giorno al check-in, non vi sarebbero mai entrati. Su 33 schede inizializzate ne risultavano sbagliate **2**, per **4 persone** in tutto — numeri piccoli solo perché il CRM ha due settimane di vita: è un difetto che si ripete a **ogni arrivo preparato prima del check-in**.

- Un accompagnatore **scritto a mano** non è agganciato al gestionale: togliendolo non si annota nessuna esclusione, perché non può tornare da solo `[DECISO][TEST]`.
- **Le cancellazioni fatte prima del 14/08 non sono state registrate**: quelle persone, se il gestionale le propone ancora, rientreranno una volta e andranno tolte di nuovo `[DOC]`.

### Da quanto tempo viaggiano insieme — dal 14/08/2026

Ogni membro agganciato a un'anagrafica del gestionale porta in riga **quante volte ha soggiornato insieme all'ospite e il mese dell'ultima volta** — *"insieme 10 volte · ultima ago 2026"*; la data intera è nel suggerimento del mouse. Oltre i **tre anni** la riga si colora, senza essere un allarme `[DECISO][TEST]`.

**Perché.** Misurato sul database dell'hotel il 14/08: delle **80 righe di nucleo** (32 ospiti), **78 sono state rilevate in automatico** e **75 portano ancora "Altro"**, cioè nessuno ha mai dichiarato la relazione. Con la stessa etichetta su quasi tutte le righe, un accompagnatore di ieri e uno di dieci anni fa erano indistinguibili: TRANQUILLI ↔ TOSTI (10 soggiorni, l'ultimo ieri) e COLLEONI ↔ DESIATI (4 soggiorni, l'ultimo nel **giugno 2016**) apparivano identici. **12 legami su 78** hanno l'ultimo soggiorno insieme da oltre tre anni, fra cui DE IACO ↔ MANIGLIA: 36 soggiorni condivisi, nessuno dal novembre 2022.

**Perché solo questo.** Si era valutato di togliere la condivisione delle preferenze ai legami non dichiarati, ma i dati veri non lo giustificano: **33 legami su 78 hanno lo stesso cognome** e i restanti sono in larga parte coppie evidenti (36, 30, 28, 16, 10 soggiorni insieme). Il rilevamento automatico funziona; quello che mancava era il **contesto per giudicarlo**, non una regola nuova `[DECISO]`.

- Chi è stato **scritto a mano** non è agganciato a nessun codice del gestionale: di lui non risultano soggiorni e **non si scrive nulla**, perché uno "0 volte" sembrerebbe un giudizio invece di un dato che manca `[DECISO][TEST]`.
- La lettura costa **130–340 ms** sulle schede più popolate (misurato). Se il gestionale non risponde, **il nucleo si mostra ugualmente senza le date** `[CODICE][TEST]`.

### Un'asimmetria nota

Dichiarare una relazione la scrive **da un lato solo**: nella scheda di De Iaco, Bebie Nevio è "Figlio-a"; nella scheda di Bebie Nevio, De Iaco è ancora "Altro". La stessa relazione porta due etichette diverse a seconda di dove si guarda `[CODICE]`. Non è stato corretto: con 5 relazioni dichiarate su 80 righe, oggi il caso è raro.

### Il "gruppo nucleo"

Per decidere con chi condividere le preferenze si considera: l'ospite, i membri del suo nucleo agganciati a un'anagrafica, e chi elenca lui nel proprio nucleo. **Un solo livello, in entrambe le direzioni**: il coniuge del coniuge non entra `[CODICE]`.

### Chi può

Leggere: tutti. Aggiungere, modificare, eliminare: `reception` e `admin`.

- La precompilazione avviene durante una **lettura** della scheda, quindi **si esegue solo per chi ha il permesso di scrivere** `[DECISO][TEST]`. Prima, un utente di sola consultazione che apriva una scheda mai vista lasciava righe a suo nome nel database: la guardia dei permessi non poteva accorgersene, perché ragiona sul metodo HTTP e una lettura la considera — giustamente — una lettura. Il nucleo resta vuoto finché non apre la scheda qualcuno che ne ha titolo.
- Nome, cognome e nota rispettano i limiti di lunghezza **anche in correzione** `[DECISO][TEST]`, e un membro si corregge o si elimina **solo dalla scheda dell'ospite a cui appartiene** `[DECISO][TEST]`.

### Da dove vengono i dati

Nomi degli occupanti dal PMS; relazione e nota dal CRM.

---

## 15. Duplicati e fusione anagrafiche

### A cosa serve

La stessa persona nel gestionale può avere più codici (registrata due volte, codice fiscale italiano e estero, refusi). La fusione fa vedere la sua storia intera senza toccare il gestionale.

### Come si riconosce un duplicato

Due criteri `[DOC][CODICE]`:

- **Stesso codice fiscale** non vuoto (alta confidenza).
- **Stesso cognome + nome + data di nascita** (intercetta i casi con codici fiscali diversi o mancanti).

Le anagrafiche senza data di nascita e senza codice fiscale non vengono mai proposte come duplicati `[CODICE]`.

### La fusione

- **Il gestionale non viene toccato.** La fusione è una mappatura nel CRM: un codice "duplicato" punta a un codice "principale" `[DOC][CODICE]`.
- Un gruppo è il principale più tutti i codici che vi puntano. **Non esistono catene**: se si fonde in un codice che è già membro di un altro gruppo, il sistema risale al principale vero `[CODICE][TEST]` (`test/merge.test.js`).
- Se si fonde un codice che era a sua volta principale, i suoi ex membri vengono riagganciati al nuovo principale `[CODICE]`.
- **L'auto-fusione è rifiutata** `[CODICE][TEST]`.
- **I codici devono esistere davvero** nel gestionale: prima della correzione del 12/08 un codice inventato entrava nel gruppo, sporcava tutte le letture per gruppo e dall'interfaccia non si toglieva più `[DOC][TEST]`.
- **L'operazione è reversibile**: "Scollega" riporta un codice a sé stante. Il principale non si scollega da sé (non ha il pulsante) `[CODICE]`.

### Cosa cambia dopo la fusione

Sulla scheda compare un banner "Scheda fusa" con i codici del gruppo. Vengono letti sull'intero gruppo: soggiorni, statistiche, consumi F&B e SPA, preferenze, allergie, reclami, note personali e lingua `[CODICE]`.

- **Tutte le scritture vanno sull'anagrafica principale del gruppo** — preferenze, allergie, reclami, nucleo, nota personale, lingua `[DECISO][TEST]`. Finché i codici restano uniti non cambia nulla, perché le letture prendono comunque tutto il gruppo. Cambia allo **Scollega**: prima il dato inserito guardando il codice A restava su A e quello inserito guardando B restava su B, e sciogliendo la fusione l'ospite si ritrovava con due schede a metà. Ora scollegare un duplicato **non porta via niente**, perché sul duplicato non è mai stato scritto nulla.
- La cancellazione di nota personale e lingua agisce su **tutto** il gruppo (§13), per cancellare davvero anche ciò che era stato scritto prima di questa regola `[DECISO][TEST]`.
- Il pulsante **"Confronta anagrafiche"** riapre i dati delle singole anagrafiche affiancati: dopo la fusione la scheda mostra l'insieme, ed è l'unico modo per accorgersi che due codici hanno email o codice fiscale diversi. È una lettura, quindi disponibile anche a chi non può scrivere `[CODICE][TEST]` (`test/web-confronto-fusa.test.js`).

### La schermata di confronto

- Mostra le anagrafiche a colonne: nominativo, data di nascita, codice fiscale, città, email, telefono, cellulare, VIP, numero di prenotazioni `[CODICE]`.
- **I conflitti sono evidenziati**: un campo è in conflitto se fra i codici ci sono almeno due valori diversi e non vuoti `[CODICE][TEST]`.
- Il **principale suggerito** è quello con più prenotazioni, ma si può cambiare `[CODICE][TEST]`.
- Servono almeno due anagrafiche, altrimenti la schermata rifiuta di aprirsi `[CODICE]`.
- **Il conflitto avvisa, non blocca**: si può confermare comunque `[CODICE]`.

### La pagina "Duplicati"

- È una **coda di lavoro**: elenca tutti i gruppi rilevati nel gestionale su cui manca ancora una decisione `[CODICE]`.
- Un gruppo esce dalla coda quando **tutti** i suoi codici convergono sullo stesso principale. Se solo alcuni sono stati fusi, resta da lavorare (con l'indicazione di quanti sono già fusi) `[CODICE][TEST]`.
- Lo stato "gestito" **non viene salvato da nessuna parte**: è ricalcolato ogni volta. Sciogliendo una fusione, il gruppo ricompare da solo nella coda `[CODICE][TEST]`.
- I gruppi già sistemati non spariscono nel nulla: se ne dichiara il numero `[CODICE]`.
- Filtri per criterio (CF / anagrafica) e ricerca per nome o codice, insensibile agli accenti `[CODICE]`.
- **Revisione in serie**: si selezionano più gruppi e si scorrono uno dopo l'altro, con "Salta" per rimandare `[CODICE]`.

### Chi può

Consultare la pagina e il confronto: tutti. Fondere e scollegare: `reception` e `admin` `[CODICE][TEST]`.

---

## 16. Export per i reparti

### A cosa serve

Dare a un reparto il foglio della giornata: chi arriva o chi è in casa, con quello che serve per servirlo bene.

### Regole

- Due popolazioni: **arrivi** o **in casa**; due formati: **foglio stampabile** (dal browser, "Salva come PDF" è una voce della stessa finestra) o **CSV** `[CODICE]`.
- **Nessuna interrogazione nuova**: si esporta esattamente la lista che la pagina ha già caricato, quindi **l'export segue la data che si sta guardando**. Se la pagina non è mai stata aperta, la lista viene chiesta al server per la data di lavoro `[CODICE]`.
- **Copre una sola data.** L'intervallo richiederebbe una interrogazione nuova sul gestionale `[DOC]` (checklist §4).
- Oggi c'è **una sola vista** ("generale"). Le viste per reparto (F&B, Housekeeping, SPA, Concierge) sono previste e si aggiungono senza rimettere mano alle pagine `[DOC][CODICE]`.
- **Allergie e preferenze restano in colonne diverse**, e le allergie vengono prima, in rosso, con un simbolo di avviso: una Coca-Cola Zero gradita e un'allergia alle arachidi non possono avere lo stesso peso `[CODICE][TEST]` (`test/web-export.test.js`).
- **Ogni allergia porta il nome di chi la ha, una per riga** `[DECISO][TEST]`: è il foglio che va in cucina, e chi cucina non può cliccare per scoprire a quale commensale serve il piatto senza glutine.
- La riga di un ospite con allergie è marcata per intero `[CODICE][TEST]`.
- **Fuori dall'export, di proposito: importi, tariffe ed extra.** Non servono a nessun reparto per servire meglio un ospite e non devono girare su carta `[CODICE][TEST]`.
- Ordine per numero di camera, come il rack; gli ospiti del giorno in coda `[CODICE][TEST]`.
- **Chi ha già fatto il check-out non finisce sul foglio** — dal 14/08/2026 `[DECISO][TEST]`. Alla reception serve ancora (conti da chiudere, pratiche da ritrovare) e resta nella pagina "In casa", ma per cucina, housekeeping e SPA è una persona che non c'è più: un nome in più da leggere per scoprire che non c'è niente da fare. **Chi parte oggi ma è ancora in camera resta**: fino al check-out va servito, e toglierlo vorrebbe dire non preparargli la colazione. Sul foglio del 14/08 sono 5 righe su 51.
- Il foglio dice quante prenotazioni contiene, **quante hanno allergie** e **quante sono state escluse perché già uscite**, e porta in fondo l'avvertenza che contiene dati personali `[CODICE]`. L'anteprima nella finestra di export conta le stesse righe del foglio: annunciarne cinquanta e stamparne quarantacinque farebbe pensare a un dato perso.
- Delle attenzioni si legge il **testo** del reclamo aperto (primi due, poi il conteggio), non il numero `[CODICE][TEST]`.
- Le note della prenotazione sono tagliate a 180 caratteri sul foglio e **integrali nel CSV** `[CODICE][TEST]`; stessa regola per la nota personale (sintesi sul foglio, testo intero nel CSV).
- **CSV**: separatore `;` e marcatore di codifica, perché è ciò che si apre correttamente in Excel italiano con un doppio clic `[CODICE][TEST]`.
- **Un valore che comincia per `=` `+` `-` `@` non diventa una formula**: viene preceduto da un apostrofo. Le note arrivano dal gestionale, cioè da testo che scrive chiunque `[DOC][TEST]`.

### Chi può

L'export non è protetto da un permesso proprio: è una lettura e i pulsanti restano disponibili anche in sola lettura `[CODICE]`.

---

## 17. Gestione utenti

### A cosa serve

Creare e mantenere gli account del team.

### Regole

- Elenco a tabella: utente, nome, cognome, email, ruolo, stato, azioni `[DOC]`.
- Creazione: username e password obbligatori, ruolo da lista; nome, cognome ed email facoltativi `[DOC][TEST]`.
- Modifica: username, ruolo, attivazione, dati anagrafici, password (vuota = non si cambia) `[DOC][TEST]`.
- Eliminazione **definitiva**, senza finestra di conferma: i blocchi sono lato server `[DOC]`.
- **Username**: massimo 50 caratteri, niente spazi, niente stringhe vuote, niente valori che stringa non sono. Con un account fatto di soli spazi non si fa più login e per toglierlo bisogna mettere le mani nel database `[DOC][TEST]`.
- **Username duplicato** → messaggio dedicato `[DOC][TEST]`.
- **Utente inesistente** → "non trovato", non un finto successo: chi ha sbagliato riga se ne accorgeva solo molto dopo `[DOC][TEST]`.
- **Non ci si può declassare, disattivare o eliminare da soli** `[DOC][TEST]`.
- **Deve restare almeno un amministratore attivo**: l'ultimo non è declassabile, né disattivabile, né eliminabile `[DOC][TEST]`.
- Se l'utente ha dati collegati (è autore di preferenze, reclami, note…) l'eliminazione viene rifiutata `[DOC]`.
- L'elenco dei ruoli assegnabili **lo manda il server**, con etichetta e descrizione: un ruolo nuovo compare nel menu senza toccare l'interfaccia, e chi assegna un permesso vede scritto cosa sta dando `[CODICE][TEST]`.
- Un utente con un ruolo non più previsto non può conservarlo: il menu si posiziona sul primo ruolo valido `[CODICE]`.
- **Password: almeno 8 caratteri**, sia alla creazione sia al cambio — senza il controllo anche sul cambio, il minimo si aggirava con una modifica `[DECISO][TEST]`.
- **Quello che deliberatamente NON c'è** `[DECISO]`: nessun requisito di complessità, nessuna scadenza, **nessun blocco dopo tentativi falliti** (chiuderebbe fuori chi dimentica la password, e non esiste recupero via email), nessuna validazione dell'email — che infatti non serve a niente, perché non c'è recupero. E il cookie di sessione **non è marcato "solo su connessione cifrata"**: in hotel si va in HTTP semplice e marcarlo impedirebbe di accedere del tutto. A queste si aggiungono, dalla stessa famiglia e con la stessa avvertenza: **il tempo di risposta del login rivela se un nome utente esiste** (§2, misurato: 476 ms contro 4) e le **sessioni vivono nella memoria del processo**, quindi ogni riavvio fa uscire tutti e l'applicazione non può girare su più processi.

Sono scelte prese sapendo che l'applicazione gira su rete interna, e in prospettiva dietro la VPN dell'hotel: **da rivedere il giorno che uscirà da lì**. Non sono dimenticanze, e questa pagina esiste perché nessuno le scambi per tali — né per garanzie che non ci sono.

### Chi può

Solo `admin`. La voce di menu non compare agli altri, e le chiamate dirette sono respinte `[TEST]`.

---

## 18. Funzioni AI

Due funzioni, entrambe **solo su richiesta esplicita dell'operatore**, mai automatiche, mai in tempo reale, mai con scrittura cieca `[DOC]`.

### 18.1 Suggerisci preferenze

**A cosa serve.** Dai consumi e dalle note dell'ospite propone preferenze e intolleranze strutturate; l'operatore spunta quelle che tiene.

**Regole**

- Si attiva da un pulsante nella scheda ospite. **Non salva niente**: le proposte si confermano con gli stessi pulsanti delle voci scritte a mano `[DOC]`.
- Riceve: consumi F&B, trattamenti SPA, note dell'anagrafica dal gestionale, preferenze e intolleranze **già registrate** (per non riproporle) e quelle **già proposte in questa sessione** `[CODICE][TEST]`.
- Il controllo dei doppioni è esteso al **nucleo**: i consumi F&B sono condivisi, quindi una preferenza già salvata su un familiare non va riproposta `[CODICE]`.
- **Minimizzazione**: non vengono inviati identificativi né cognomi, solo i segnali utili `[DOC][CODICE][TEST]`.
- Se non ci sono abbastanza dati, l'AI non viene nemmeno interpellata: risposta "dati insufficienti" `[CODICE]`.
- Il modello risponde in formato vincolato: reparto e categoria possono essere **solo** valori delle liste chiuse. Una preferenza con reparto o categoria fuori lista viene **scartata**, non salvata a metà `[CODICE][TEST]`.
- Le regole date al modello: le note del gestionale sono fonte diretta e bastano da sole; i consumi sono fonte indiretta e servono 3-4 evidenze coerenti; entrambe insieme danno affidabilità massima; si sintetizza il tratto, non il singolo consumo; niente richieste occasionali (taxi, late check-out); nel dubbio non si propone; massimo 8 proposte `[DOC][CODICE][TEST]`.
- Ogni proposta mostra affidabilità, fonte e motivo `[CODICE]`.
- **Le proposte accettate vengono salvate con ambito `nucleo`** `[CODICE]` (`aiAggiungiPreferenza` in `web/app.js` passa `ambito: 'nucleo'`).
- Il pulsante si spegne dopo una generazione riuscita e torna disponibile riaprendo la scheda: ogni clic è una chiamata a pagamento. Un **errore non conta** come esecuzione, così si può riprovare subito `[CODICE][TEST]`.

### 18.2 Guest Briefing

**A cosa serve.** Capire chi si ha davanti quando l'ospite è una figura pubblica o un dirigente: ruolo, notorietà, come rivolgersi.

**Regole**

- Si attiva dal pulsante nella scheda arrivo o dalla scheda ospite ("Genera con AI" nelle note personali) `[CODICE]`.
- Usa **solo fonti web pubbliche**, sempre citate. Nessun dato privato o sensibile `[DOC][CODICE][TEST]`.
- **Vietati anche se pubblici**, perché all'accoglienza non servono: età, data e luogo di nascita, titoli di studio, patrimonio, fatturato dell'azienda `[CODICE][TEST]`.
- Il testo è in **italiano** anche con fonti in inglese, in forma di poche righe "Etichetta: parole chiave", mai prosa `[CODICE][TEST]`.
- L'appellativo segue la **nazionalità dell'ospite**, non l'inglese per abitudine `[CODICE][TEST]`.
- **Tre esiti possibili**, con etichette diverse in scheda `[DOC][CODICE][TEST]`:
  - *Personaggio pubblico* — fonti autorevoli;
  - *Profilo professionale* — nessun rilievo pubblico, ma un profilo professionale (tipicamente LinkedIn) confermato;
  - *Identità da confermare* — profilo plausibile ma non confermato: **non è salvabile nel profilo**, si mostra il link e decide l'operatore.
- **Regola dei due riscontri**: un profilo professionale vale come identificazione certa solo se, oltre a nome e cognome, combacia almeno un altro elemento — il dominio della mail, la città/nazione, l'azienda citata nelle note interne. L'omonimia è la regola, non l'eccezione `[DOC][CODICE][TEST]`.
- Del recapito arriva al modello **solo il dominio**, mai l'indirizzo; i provider generici (gmail, libero…) non vengono nemmeno passati, perché non dicono nulla `[CODICE][TEST]`.
- **Fonti citate contro risultati della ricerca**: se il modello ha agganciato quello che scrive ai risultati, si mostrano solo le fonti citate; altrimenti si mostrano al massimo 6 risultati grezzi, **un link per sito**, sotto un'etichetta diversa ("non citati dall'AI"). Su un CEO americano la ricerca aveva restituito sei profili di sei persone diverse `[DOC][CODICE][TEST]`.
- Domini esclusi comunque: aggregatori di contatti, marketplace, banche di immagini, social personali. **LinkedIn è ammesso** (è una presentazione autopubblicata), ma solo i profili, non i post `[CODICE][TEST]`.
- Il briefing **non viene conservato da nessuna parte**: resta a schermo finché non si cambia pagina, a meno che non lo si salvi nelle note personali (in coda a quelle esistenti, mai sovrascrivendole) `[CODICE]`.
- L'accodamento **non è illimitato**: se il risultato supera i 4.000 caratteri della nota personale (§13) il salvataggio viene rifiutato con l'invito ad accorciare prima `[DECISO][TEST]`. Rigenerare più volte non fa più crescere la nota all'infinito.
- Modelli: il briefing usa il modello più capace, le altre funzioni uno più economico. La scelta nasce da un confronto dal vivo `[DOC]`.

### 18.3 Regole comuni

- Entrambe richiedono il permesso `usa-ai`: la sola lettura non le può usare `[CODICE][TEST]`.
- Se l'AI non è configurata (chiave o libreria assenti) l'endpoint risponde con un messaggio esplicito e **l'applicazione resta in piedi** `[CODICE][TEST]`.
- I guasti sono tradotti in messaggi comprensibili: credito esaurito, chiave non valida, troppe richieste, servizio non disponibile. **Un errore non riconosciuto non viene mascherato**: diventa un errore interno nei log, invece di un messaggio rassicurante inventato `[DOC][CODICE][TEST]` (`test/ai-guasti.test.js`).
- L'interfaccia mostra **il messaggio del server**, non una frase fissa: un credito esaurito arrivava a schermo come "Errore durante la generazione" e sarebbe partita una segnalazione di bug per un problema di fatturazione `[DOC][TEST]`.
- Ogni pulsante di generazione si spegne dopo un successo, con la spiegazione, e si riattiva rientrando nella pagina o riaprendo la scheda `[CODICE][TEST]`.
- **Dal 13/08/2026 ogni generazione lascia traccia** nella tabella `ai_events`: chi, quando, per quale ospite, quante proposte sono uscite e quante ne sono state accettate `[CODICE][TEST]`. Fino al giorno prima esisteva solo una riga nella console del server, che nessuno rileggeva: non si sarebbe mai potuto sapere quante proposte venivano scartate (`DOCS/2026-08-10-analytics-dashboard-analisi.md` §3.1). **Registrare non deve mai far fallire l'azione registrata**: se la scrittura nel registro non riesce, la generazione va a buon fine lo stesso `[CODICE][TEST]`.

---

## 19. Import periodico (scritto, non collegato)

Esiste un import che copia lo storico prenotazioni dal gestionale in tabelle del CRM (`booking_snapshot`, `customer_cumulativi`), per congelare i valori "com'erano al momento del soggiorno" (VIP, amenities) e per avere cumulativi veloci e puliti `[DOC]`.

- Si lancia a mano (`npm run import`), eventualmente per un solo ospite `[CODICE]`.
- Legge dal gestionale, scrive **solo** sul CRM `[DOC]`.
- Riscrive la stessa prenotazione invece di duplicarla `[DOC][CODICE]`.
- Marca come **non valide per i cumulativi** le prenotazioni cancellate e quelle "di servizio", riconosciute da parole nel motivo (doppia, test, prova, fittizia, errore, opzione scaduta…) `[CODICE][TEST]`. Una prenotazione conta se non è cancellata, non è di servizio, e ha sostanza (un importo o occupanti reali).
- Gli stati usati dall'import sono **Confermata / Completata / Cancellata** `[DOC][TEST]` — tre, non i sette dello storico della scheda (§7).
- **Oggi la scheda ospite non lo usa**: i cumulativi sono calcolati in tempo reale. Il collegamento è il passo successivo `[DOC]` (`HANDOFF.md` §7 e §11).
- **L'estrazione non è mai stata eseguita sul database vero** `[DOC]`.

### Che cosa comporta non collegarlo — deciso il 14/08/2026

Poiché l'import resta scollegato, **tutto ciò che arriva dal gestionale è letto dal vivo e mostrato com'è adesso**. Vale la pena essere precisi su cosa questo faccia perdere, perché è molto meno di quanto la sezione sopra lasci temere.

**Non si perde quasi nulla.** Date, camere, notti, trattamento, importi, canale di vendita, note: sono tutti dati **della singola prenotazione**, che il gestionale archivia e non riscrive. Un soggiorno del 2024 continuerà a dire quello che diceva.

**Si perde una cosa sola: il VIP nel tempo.** Il codice VIP sta sull'**anagrafica**, cioè sulla persona, non sul soggiorno: esiste un solo valore, quello di adesso, e il precedente viene sovrascritto senza lasciare traccia `[CODICE]`. Conseguenze, tutte attive oggi:

1. **La storia si riscrive all'indietro.** Tolto il VIP a un ospite, i suoi soggiorni passati diventano soggiorni di un non-VIP.
2. **Vale anche per "ospite indesiderato"**, che nel gestionale è un codice VIP come gli altri (§7): segnalare qualcuno oggi fa risultare indesiderati anche i suoi soggiorni di tre anni fa, e riabilitarlo cancella quello in cui il fatto era successo.
3. **Il conteggio VIP della dashboard misura il presente, non il periodo**: "VIP negli ultimi 12 mesi" dice quanti di quegli ospiti **sono VIP adesso**, non quanti lo erano allora. Quel numero può cambiare da solo quando qualcuno tocca un codice in anagrafica, senza che nessuno abbia sbagliato nulla.

**Decisione di Mik (14/08/2026): si lascia com'è** `[DECISO]`. Quello che serve al lavoro di tutti i giorni è sapere che *Fabio è un nostro VIP adesso*, e quello funziona già. Ricostruire il VIP soggiorno per soggiorno vorrebbe dire collegare l'import, farlo girare ogni notte e reggere due fonti per lo stesso dato: complessità che oggi nessuna domanda del lavoro quotidiano giustifica.

**Da sapere se un giorno si cambia idea:** il passato **non è recuperabile**. Il VIP di un ospite nel 2024 non è scritto da nessuna parte. Il giorno in cui si accendesse l'import, i soggiorni vecchi verrebbero fotografati con il VIP di **oggi** — cioè sbagliati esattamente come adesso, solo congelati — e la storia diventerebbe corretta **solo da lì in avanti**. È lo stesso meccanismo degli eventi AI (§18): non è un lavoro che si può recuperare dopo.

---

## 20. Analytics

La dashboard risponde a due domande diverse, e per questo è divisa in due blocchi che **non vanno letti con lo stesso metro** `[CODICE]`:

- **I nostri ospiti — dal gestionale.** Chi è venuto, da dove, cosa ha consumato. Il gestionale è pieno: decine di migliaia di anagrafiche e migliaia di soggiorni l'anno.
- **Quanto conosciamo gli ospiti — dal CRM.** Quante persone hanno una preferenza, un'allergia, una nota; quanto l'applicazione viene aperta. Qui i numeri sono piccoli perché il CRM è appena nato, e infatti il blocco **non misura il business ma la copertura**: "quanto ne stiamo raccogliendo" è una domanda che ha senso anche partendo da zero, "cosa dicono i dati raccolti" no.

Tenerli insieme farebbe sembrare inaffidabile anche la metà buona.

### 20.1 Il periodo

Il periodo si sceglie fra cinque pulsanti (7 giorni, 30 giorni, 3 mesi, 12 mesi, **Tutto lo storico**) o a mano con due date. "Oggi" è la **data di lavoro del gestionale**, non l'orologio del server: è la stessa regola di Arrivi e In casa, e serve perché in hotel la giornata contabile non finisce a mezzanotte `[CODICE]`.

La regola che vale per tutta la pagina: **un soggiorno cade nel periodo quando ci FINISCE**, non quando comincia. A quel punto è concluso e i consumi sono stati registrati tutti; contarlo dall'arrivo farebbe entrare soggiorni ancora in corso, con metà dei numeri a zero `[CODICE]`.

**Non c'è nessun confronto fra periodi** — vedi §20.4.

#### "Tutto lo storico" — aggiunto il 18/08/2026 `[DECISO]`

Mostra tutti gli ospiti che l'hotel ricorda, senza finestra temporale. La data d'inizio **si chiede al gestionale** (il giorno in cui si è concluso il primo soggiorno in archivio) invece di inventarne una: partendo da un anno in cui non c'era niente, il grafico comincerebbe con una lunga riga a zero `[CODICE][TEST]`.

Due accorgimenti, entrambi con un test che li fissa:

- **Un limite a vent'anni.** Non è diffidenza verso l'hotel: nei gestionali vecchi capita una prenotazione con l'anno sbagliato di decenni, e basta quella per far partire lo storico da prima che l'albergo esistesse. Vent'anni sono già più storia di quanta ce ne sia.
- **Se la lettura non riesce**, si ripiega su dieci anni e la pagina si apre lo stesso, al più con qualche mese vuoto in testa. Far fallire l'intera dashboard per una data non letta sarebbe sproporzionato — è la stessa regola dei duplicati e del registro accessi.

L'unico numero che **non** cambia scegliendolo è il blocco del CRM, che è già complessivo per costruzione.

Che cos'è un **soggiorno**: una prenotazione da **1 a 200 notti**. Sotto c'è il day use (SPA, piscina, cene per esterni), sopra il voucher regalo, registrato come prenotazione lunga un anno perché quella è la sua validità. Contarli tutti è l'errore che faceva risultare "di ritorno" migliaia di ospiti che non avevano mai dormito qui `[CODICE]`.

### 20.2 Che cosa conta ogni numero

Ogni numero della pagina porta la sua definizione addosso, con la **iconcina (i)** usata nel resto dell'applicazione `[CODICE][TEST]`. Non è pignoleria: riquadri affiancati contano cose diverse, e senza dirlo sembrano confrontabili quando non lo sono.

| Numero | Conta | Unità | Risente del periodo |
|---|---|---|---|
| Ospiti unici | persone diverse che hanno concluso un soggiorno | persone | sì |
| Soggiorni | prenotazioni concluse (1–200 notti) | soggiorni | sì |
| Di ritorno | ospiti del periodo che avevano già dormito qui prima di quel soggiorno | persone | sì (ma guarda tutta la storia) |
| VIP | ospiti del periodo che hanno **oggi** una classificazione VIP | persone | sì |
| Notti medie | notti totali ÷ soggiorni | media per soggiorno | sì |
| Soggiorni conclusi per mese / per anno | soggiorni, raggruppati per mese di partenza — **per anno oltre i due anni** | soggiorni | sì |
| Canali di prenotazione | da dove è arrivata la prenotazione | **soggiorni** | sì |
| Nazionalità degli ospiti | nazione dell'anagrafica | **persone** | sì |
| Classificazioni VIP | come sono classificati i VIP del periodo | persone | sì |
| Consumi F&B | quante volte un articolo è stato ordinato | ordinazioni | sì, **per data dell'ordinazione** |
| Consumi F&B → «Solo ospiti VIP» | le sole ordinazioni addebitate a una camera occupata da un VIP | ordinazioni | sì |
| SPA | trattamenti addebitati | addebiti | sì, per data dell'addebito |
| Con preferenze / allergie / note personali | clienti che hanno almeno quella cosa nel CRM | persone | **no, complessivo** |
| Scritto nel periodo | preferenze, allergie e reclami **registrati** nel periodo | righe scritte | sì |
| Anagrafiche collegate | anagrafiche doppie agganciate a una principale | collegamenti | **no, complessivo** |
| Anagrafiche da completare | ospiti del periodo senza email, telefono o data di nascita | persone | sì |
| Preferenze per reparto | **preferenze**, non persone | preferenze | **no, complessivo** |
| Chi usa l'applicazione / Accessi | accessi **riusciti** | accessi | sì |
| Duplicati da gestire | gruppi su cui nessuno ha ancora deciso | gruppi | **no, complessivo** |
| Reclami | reclami aperti, in tutto, da classificare | reclami | **no, complessivo** |
| Uso dell'AI | generazioni chieste, proposte tornate, proposte accettate | eventi | sì |

Le cinque distinzioni che si sbagliano più facilmente:

1. **Ospiti unici ≠ Soggiorni.** Chi torna conta una volta sola fra gli ospiti e due volte fra i soggiorni, quindi Soggiorni non è mai minore di Ospiti unici.
2. **Canali conta soggiorni, Nazionalità conta persone**, e stanno affiancati. Sono i due riquadri più facili da confrontare per sbaglio.
3. **Ospiti unici conta l'intestatario della prenotazione**, non chi lo accompagna in camera: gli accompagnatori sono nel nucleo (§14), non qui.
4. **Due anagrafiche della stessa persona non ancora collegate contano due.** Sulla stessa pagina, poco più sotto, c'è il numero dei duplicati ancora da gestire (§15): è la misura di quanto questo pesi.
5. **Il blocco del CRM è quasi tutto complessivo.** L'unica eccezione è "Anagrafiche da completare", che dipende dal periodo, e per questo lo dichiara.

**Di ritorno** merita una riga a parte. Un ospite è "di ritorno" se il suo **primo soggiorno in assoluto** si era già concluso quando è arrivato: non "prima dell'inizio del periodo". La differenza non è accademica — con la seconda definizione chi veniva due volte nello stesso anno risultava nuovo tutte e due le volte, e su dodici mesi i clienti di ritorno crollavano a una frazione del vero, facendo credere all'hotel di non fidelizzare nessuno. Così invece il numero non dipende da dove si taglia la finestra, che è la proprietà che serve a un filtro temporale `[CODICE]`.

### 20.3 Correzioni fatte il 18/08/2026 `[DECISO]`

**Una frazione mescolava due popolazioni.** La riga della copertura diceva *"Clienti con almeno una preferenza: N su M ospiti del periodo"*, ma **N era complessivo** (tutti i clienti conosciuti, di qualunque data) e **M era del periodo**. Su una finestra corta la frazione poteva mostrare più clienti che ospiti, cioè una percentuale sopra il cento. Il denominatore è stato tolto e la riga ora dichiara di essere complessiva. C'è un test che impedisce di rimetterlo `[TEST]`.

Calcolare la copertura *sugli ospiti del periodo* — cioè quanti, fra chi ha soggiornato, hanno almeno una preferenza — è possibile e sarebbe la misura più utile, ma richiede di incrociare le due banche dati passando migliaia di codici. Non è stato fatto: se un giorno servirà, è un lavoro a sé.

**Tre nomi cambiati**, perché il nome vecchio non diceva cosa c'era dentro:

| Prima | Adesso | Perché |
|---|---|---|
| Da dove arrivano | **Canali di prenotazione** | "da dove" e "provenienza" sembravano la stessa cosa e non lo erano |
| Provenienza | **Nazionalità degli ospiti** | idem, e chiarisce che è la persona, non la prenotazione |
| Anagrafiche fuse | **Anagrafiche collegate** | "fuse" fa pensare a qualcosa di distruttivo: il collegamento è reversibile e non cancella niente (§15) |

**Il grafico dell'andamento aveva un titolo solo per i lettori di schermo**: adesso si chiama "Soggiorni conclusi per mese" e dice che il mese è quello della partenza.

**La spunta «Solo VIP» prometteva di filtrare la pagina e ne toccava un riquadro su sette** — deciso il 20/08/2026 `[DECISO]`. Stava nella barra in cima, accanto al selettore del periodo, ma il parametro arrivava alla sola interrogazione dei consumi: i cinque numeri, l'andamento, i canali, le nazionalità e la SPA restavano **identici cifra per cifra**, senza nessun avviso. La spunta è stata **spostata dentro il riquadro Consumi F&B**, che è l'unico posto in cui fa qualcosa, e adesso la promessa coincide con quello che succede. Da sapere leggendo quei numeri: il filtro guarda **chi occupava la camera**, non chi ha ordinato — se in una famiglia uno solo è VIP, contano tutte le ordinazioni di quella camera. È il massimo che il gestionale permetta, perché nelle comande il numero di pratica è vuoto (§8).

Se un giorno servisse una vera **vista di segmento** — l'intera dashboard ristretta ai VIP — è un altro lavoro: cinque interrogazioni da modificare, di cui quella della SPA richiede la stessa catena di collegamenti dei consumi. E porta con sé due effetti da accettare: il riquadro «VIP» diventerebbe uguale a «Ospiti unici», e «Di ritorno» cambierebbe significato in «VIP di ritorno».

**E scriveva un'etichetta per mese a qualunque lunghezza.** Su un periodo di più di due anni — "Tutto lo storico", ma anche due date digitate a mano — sarebbero state oltre cento scritte da dieci pixel sovrapposte: un grafico illeggibile che sembra un errore. Oltre i due anni i punti diventano gli **anni**, il titolo lo dice ("per anno") e le etichette cambiano di conseguenza. La regola sta sulla **durata**, non sul pulsante, così vale anche per il periodo personalizzato `[CODICE][TEST]`.

### 20.4 Il confronto fra periodi è stato tolto — deciso il 18/08/2026 `[DECISO]`

Sotto ognuno dei cinque numeri degli ospiti c'era una pastiglia con il confronto sul **periodo immediatamente precedente, lungo uguale**: `▲ 12%`, `▼ 8%`, `= stabile`.

**Obiezione di Mik:** in un CRM il cui unico obiettivo è sapere quanto conosciamo i nostri ospiti, quel confronto non serve. E ha ragione anche per una seconda ragione, più forte: in un albergo **stagionale** quel confronto non è soltanto superfluo, è **sbagliato**. Trenta giorni di agosto contro trenta di luglio danno un "+40%" che racconta la stagione, non l'hotel; ottobre contro settembre dà un "−60%" che non è un problema di nessuno. Il confronto che avrebbe senso per un albergo è con lo **stesso periodo dell'anno prima**, e quello non c'è.

**Cosa è stato tolto** `[CODICE][TEST]`:
- le cinque pastiglie sotto i numeri, e la scritta "confronto con …" nella riga del periodo in cima;
- la **seconda esecuzione dell'interrogazione più pesante della pagina**, che veniva fatta solo per calcolarle: ogni caricamento la eseguiva due volte, una per il periodo e una per quello prima. C'è un test che conta le esecuzioni e fallisce se tornano a essere due.

**Cosa è stato messo al suo posto.** Il blocco del CRM aveva quattro numeri complessivi che possono soltanto salire: da soli non distinguono un CRM che cresce piano da uno lasciato lì. Adesso c'è una riga che dice **quanto è stato registrato nel periodo scelto** — *"Scritto nel periodo: 12 preferenze · 3 allergie · 1 reclamo"* — e quando non c'è niente lo dice. Il dato **era già calcolato dal server e buttato via**: non è costata nessuna interrogazione in più.

Se un giorno servirà un confronto temporale vero, va rifatto da capo con l'anno precedente: quello che è stato tolto non era un pezzo di quel lavoro, era la strada sbagliata.

### 20.5 Cosa resta aperto

- **Le nazionalità sono codici, non nomi.** Il riquadro mostra il codice dell'anagrafica (per esempio `I`, `GB`, `D`), non "Italia", "Regno Unito", "Germania". Il gestionale ha una tabella di decodifica, ma i nomi delle sue colonne non sono documentati: **serve una lettura sul database dell'hotel** per collegarla. Finché non è fatto, la iconcina avverte che il valore è un codice.
- **Sugli schermi molto stretti** (telefono) l'intera applicazione scorre in orizzontale per via della barra laterale: è un limite del layout generale, non della dashboard.
- **Analytics non applica le fusioni**: due anagrafiche collegate contano ancora due nei numeri del gestionale. Allinearle vorrebbe dire rileggere il CRM dentro ogni interrogazione del gestionale; per ora lo dice la iconcina.

---

## 21. Decisioni prese e domande ancora aperte

La prima stesura di questo documento si chiudeva con **16 domande**: contraddizioni fra codice e documenti, comportamenti che potevano non essere quelli voluti, regole applicate in un punto e non in un altro simile.

Il **12/08/2026 sono state discusse una per una con Mik.** Tredici sono state decise e implementate: le decisioni sono scritte nelle sezioni delle rispettive funzionalità, con la marca `[DECISO]`, e ognuna ha almeno un test che riproduce il caso originale. Tre restavano aperte perché richiedevano i dati veri dell'hotel.

Il **13/08/2026, in hotel, sono state chiuse due delle tre** (A e B). Resta aperta solo la C, che ha bisogno di giorni di uso reale e non di una interrogazione.

### Le tre

#### A — Lo stato di check-out era deciso da una riga scelta senza criterio — CHIUSA il 13/08/2026

**Dov'era.** `src/pms/prenotazioni.js`: `SELECT TOP 1 al.flgpar FROM Alberg al WHERE al.codpratica = p.codpratica`, senza ordinamento. Il conto alberghiero ha **una riga per occupante** (`HANDOFF.md` §6.2), quindi con righe discordi la risposta la sceglieva il piano di esecuzione del database.

**Cosa dicono i dati.** Misurato sul database dell'hotel: nella tabella corrente **nessuna** delle 82 pratiche con più righe è discorde; nello storico lo sono **171 su 25.183** (0,68%), e la discordanza è vera, non fra i due codici che il CRM tratta già allo stesso modo. Non era quindi un difetto attivo ma un rischio latente: una volta su centocinquanta.

**Decisione di Mik.** La prenotazione risulta uscita **solo quando tutte le righe sono chiuse**. Se in camera resta anche una persona sola, la card resta in lista come una presenza normale: far sparire dalla lista qualcuno che è ancora in albergo è peggio che tenerci qualcuno già uscito, perché housekeeping e F&B smettono di vederlo.

Implementato con `EXISTS` + `NOT EXISTS` (serve anche il controllo di esistenza: senza, una pratica **senza** righe di conto risulterebbe uscita). Due test lo tengono fermo. Verificato dal vivo: la lista del 13/08 non cambia di una riga.

---

#### B — La tabella delle "Note CRM" — CHIUSA il 13/08/2026

`customer_notes` conteneva **due righe**, entrambe scritte da `admin` durante una sessione di prova di luglio: `"test"` sulla cliente 78602 e `"apprezza il polpo arrosto"` sulla 81304, quest'ultima a un minuto di distanza da una preferenza e da una lingua inserite sullo stesso ospite.

**Decisione di Mik:** si elimina tutto; la scheda resta con **preferenze, nota personale e reclami**. Il diario non si ricostruisce.

La ragione non è che il diario sia inutile, ma che è il posto dove l'informazione si ferma: *"apprezza il polpo arrosto"* scritto in una nota resta visibile solo a chi apre quella scheda, mentre la stessa frase come preferenza F&B finisce sul foglio che si stampa per il ristorante. Che qualcuno l'abbia scritta lì trenta secondi dopo aver inserito una preferenza dice però una cosa da tenere a mente: **scrivere una frase è più veloce che scegliere reparto e categoria**. Se in futuro le preferenze risultassero scomode, la risposta è renderle più rapide, non aggiungere un secondo posto dove scrivere.

Eseguito: `scripts/crm-drop-note.sql` (che trascrive le due righe eliminate), tabella tolta anche da `crm-schema.sql` e da `HANDOFF.md` §5.

---

#### C — "Ignora" su una proposta di allergia dura quanto la scheda del browser

**Dove.** `web/app.js`, insieme in memoria con chiave prenotazione + termine. Ricaricando la pagina la proposta scartata torna.

È documentato come consapevole: «da decidere con dati d'uso, non per ipotesi» (`2026-08-11-allergie-da-note-pms.md` §5). Non è quindi una svista, ma una decisione rinviata.

**Perché non si chiude da qui.** La risposta dipende da **quanti** falsi positivi ricorrenti produce il vocabolario sulle note vere:
1. pochi → si lascia così;
2. tornano ogni mattina → serve una tabella dedicata, quindi una migrazione;
3. tanti → il problema non è "Ignora" ma il vocabolario, e si corregge quello.

**Cosa serve.** Qualche giorno di uso reale, annotando le proposte sbagliate che si ripresentano.

**Primo dato, 13/08/2026.** Il vocabolario è stato passato sulle **214 prenotazioni con note fra oggi e i sette giorni successivi**: escono **7 proposte, corrette tutte e sette** (due celiachie, soia, lattosio, cetriolo, glutine da *"gluten free"*, crostacei). Zero falsi positivi. Con questi numeri l'ipotesi 1 è la più probabile, ma una settimana non fa una regola: la verifica resta aperta.

---

### Le tredici chiuse

Per riferimento, con il punto del documento in cui la decisione è ora scritta.

| # | Questione | Decisione | Dove |
|---|---|---|---|
| D1 | Ambito predefinito delle preferenze | Resta `nucleo`. Il documento del 04/08 è superato su questo punto | §9 |
| D2 | Allergie mostrate senza dire di chi sono | Ogni allergia porta il nome, anche sul foglio per la cucina | §4, §10, §16 |
| D3 | Due conteggi diversi dei presenti | Sono due domande diverse: "Restano stanotte" e "Oggi in hotel" | §3, §5 |
| D5 | Prenotazioni future nelle statistiche | Contano solo i soggiorni avvenuti; le future restano visibili nello storico | §7 |
| D6 | Una lettura che scrive (nucleo) | La precompilazione si esegue solo per chi può scrivere | §14, §2 |
| D7 | Identificativi validati in due modi | Controllo unico e condiviso da tutte le rotte | §2 |
| D8 | Limiti di lunghezza solo in inserimento | Valgono anche in correzione | §9, §14 |
| D9 | Nessun requisito sulla password | Minimo 8 caratteri; il resto è rischio accettato e dichiarato | §17, §2 |
| D10 | Lo stato "No-show" che le specifiche vietavano | Resta: sono le specifiche del 30/07 da correggere | §7 |
| D11 | Nota personale senza limite | Tetto di 4.000 caratteri, controllato sul risultato | §13, §18 |
| D13 | Scritture sul codice visualizzato | Vanno tutte sul principale del gruppo | §15 |
| D14 | Contatori sempre a zero | Tolti | §4 |
| D15 | Cancellazioni senza controllo di appartenenza | Le righe si toccano solo dalla scheda del loro ospite | §2, §9, §10, §14 |

---

---

### Quello che ha aggiunto la giornata in hotel

Nessuno di questi era fra le sedici domande: sono venuti fuori **guardando i dati veri**, e in tre casi su cinque provando l'applicazione invece che leggendola. Vanno letti come la misura di quanto vale un collaudo con i dati dell'hotel rispetto a uno con dati inventati.

| Cosa | Come è emerso | Dove |
|---|---|---|
| Gli **ospiti del giorno** non comparivano da nessuna parte — 1.200 l'anno | Guardando perché certe pratiche fossero marcate "partite" con la partenza nel futuro | §5 |
| Il badge **"Nª volta"** contava giornate e voucher come soggiorni: 5.363 ospiti risultavano di ritorno senza aver mai dormito qui | Cercando la causa di un voucher lungo un anno che nascondeva un'ospite dalla lista | §7 |
| Le allergie scritte in **anagrafica** non arrivavano in cucina: due ospiti in casa quella notte | Chiedendosi se valesse la pena leggere un secondo campo | §11 |
| Un permesso **revocato restava valido per ore** | Provando a declassare un utente e guardando l'altra finestra | §2 |
| Il **check-out** era deciso da una riga presa senza criterio | Era la domanda A, ma i numeri hanno cambiato la risposta attesa | §5 |

### Punti in sospeso già dichiarati altrove

Non sono domande aperte da porre: sono cose già note e scritte, riportate qui per completezza. **Barrate quelle chiuse il 13/08.**

- ~~Gli importi vanno riconfermati con la software house del PMS~~ — chiusa il 07/08: la fonte è `PianificazioneSogg`, validata sui check-in reali.
- ~~Tre migrazioni da lanciare sul database dell'hotel~~ — **eseguite e verificate il 13/08**. La terza (`crm-ruoli.sql`) è risultata inutile: nel database ci sono solo ruoli previsti.
- ~~Sei interrogazioni mai eseguite su SQL Server vero~~ — **tutte eseguite il 13/08**, nessun errore. Il rischio segnalato sul badge "Nª volta" (doppio conteggio) **non c'era**; ce n'era un altro, più grosso, che nessuno aveva previsto: contava cose che non sono soggiorni (§7).
- ~~Il vocabolario delle allergie è tarato su note inventate~~ — **misurato sulle 30.938 note vere** il 13/08, in due passate successive (§11).
- ~~Nessun evento AI viene registrato~~ — **chiusa il 13/08**: la tabella `ai_events` esiste ed è popolata; da quel giorno si sa quante proposte vengono accettate e quante scartate.
- ~~L'origine di una preferenza (manuale o AI) non è tracciata~~ — **chiusa il 13/08**: ogni preferenza porta l'origine.
- ~~La dashboard Analytics non esiste~~ — **costruita il 13/08**, sei blocchi, in linea con l'analisi del 10/08.
- **La memoria delle sessioni è in RAM**: da sostituire prima di far girare più di un processo `[DOC]` (`HANDOFF.md` §9).
- **L'export copre una sola data** `[DOC]` (checklist §4).
- **Il VIP è noto solo al presente**: la classificazione di un ospite non è storicizzata, e non lo sarà (§19, deciso il 14/08). Va tenuto a mente leggendo il conteggio VIP della dashboard.
