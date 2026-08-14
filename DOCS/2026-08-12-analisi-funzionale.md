# Analisi funzionale — CRM Hotel Canne Bianche

- **Data:** 2026-08-12, **aggiornato il 2026-08-13 in hotel** e il **2026-08-14**
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

Il documento è aggiornato alle decisioni prese. Delle tre domande che richiedevano i dati veri dell'hotel, **due sono state chiuse il 13/08** e una resta aperta perché ha bisogno di giorni d'uso, non di un'interrogazione: sono in §20.

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
20. [Decisioni prese e domande ancora aperte](#20-decisioni-prese-e-domande-ancora-aperte)

---

## 1. Il quadro generale

### A cosa serve

Il CRM sta sopra il gestionale alberghiero (PMS) e serve alla reception per **conoscere l'ospite prima di averlo davanti**: chi è, quante volte è già stato qui, cosa gradisce, a cosa è allergico, se ha già avuto un problema. Il gestionale continua a fare quello che ha sempre fatto (prenotazioni, camere, conti); il CRM aggiunge il lato relazionale e non tocca nulla del gestionale.

### Le due sorgenti dei dati

| | PMS (`HolidayCanneBianche`) | CRM (`HolidayCanneBianche_CRM`) |
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

- Le pagine Arrivi e In casa provano ad arricchire la lista con i dati CRM; se **il CRM** fallisce, la lista operativa del PMS viene servita comunque, senza gli arricchimenti `[CODICE]` (`src/api/arrivi.js:27-33`). È una scelta esplicita: la reception deve poter lavorare anche con il CRM in avaria.
- Se **il PMS** non risponde, la pagina mostra un messaggio d'errore e il resto dell'applicazione continua a funzionare `[DOC]`.

---

## 2. Autenticazione, ruoli e permessi

### A cosa serve

Solo chi ha un account entra, e ciascuno vede e può fare quello che gli compete: chi sta al banco lavora, chi consulta e basta non modifica, la direzione amministra.

### Accesso

- Username e password; la password è conservata come impronta bcrypt, mai in chiaro `[DOC]`.
- Un **utente disattivato non entra**, anche con la password giusta `[TEST]` (`test/auth.test.js`).
- Credenziali sbagliate e utente inesistente danno **lo stesso messaggio**: non si può capire dall'esterno se un nome utente esiste `[DOC][TEST]`.
- La sessione dura **8 ore** e viaggia su un cookie non leggibile da JavaScript `[CODICE]` (`src/app.js:18`).
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

---

## 3. Home

### A cosa serve

La fotografia della giornata in tre numeri, all'apertura dell'applicazione.

### Regole

- Tre riquadri: **Arrivi oggi**, **Partenze oggi**, **Restano stanotte**, riferiti alla data di lavoro del gestionale `[DOC]`.
- Sono conteggi di **prenotazioni**, non di persone `[CODICE]`.
- Arrivi = prenotazioni non annullate con data di arrivo pari a oggi, escluse quelle già segnate come partite. Partenze = stesso criterio sulla data di partenza. **Restano stanotte** = check-in fatto e oggi compreso fra arrivo e partenza, **partenza esclusa** `[CODICE]` (`src/pms/prenotazioni.js:121-126`).
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
- **Banda di accoglienza**: ospite indesiderato, compleanno durante il soggiorno, allergie *col nome di chi le ha*, reclami aperti con il loro testo, fino a 3 preferenze, nota personale accorciata.
- **Camere e tipologie**, date, notti.
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
| Preferenze | CRM | Solo quelle di ambito **nucleo**, senza doppioni, **massimo 3** `[CODICE][TEST]` |
| Reclami | CRM | Conteggio di tutti + testo di quelli aperti (i risolti restano solo numero) `[CODICE][TEST]` |
| Compleanno | PMS (data di nascita) | Il primo membro che compie gli anni fra arrivo e partenza compresi; gestisce il soggiorno a cavallo di capodanno `[CODICE][TEST]` |
| Nota personale | CRM | Solo quella del **referente** (e delle sue anagrafiche fuse), mai quella di un occupante `[CODICE][TEST]` |
| Nª volta | PMS | Soggiorni **già conclusi**: quello in corso è l'(n+1)-esimo `[CODICE]` |

- Le preferenze **personali non compaiono mai nelle schede** di Arrivi e In casa, né nell'export `[CODICE]`.
- Senza data di nascita in anagrafica non c'è compleanno: il CRM non ha una propria copia del dato `[CODICE][TEST]`.

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
- **Ordine da rack**: per numero di camera crescente, poi chi ha già fatto il check-out, in fondo gli ospiti del giorno `[DECISO][TEST]` (`test/incasa-brief.test.js`).
- Quattro stati per riga: `incasa`, `partenza` (parte oggi, ancora in camera), `checkout` (conto chiuso), `dayuse` (ospite del giorno) `[CODICE]`.
- **Avanzamento del soggiorno**: "Notte 3 di 7 · parte il …". La notte in corso è disegnata come **anello**, non come pallino pieno: alla data di lavoro quella notte non è ancora stata dormita. Chi parte oggi ha la fila piena ma **spenta**. Il giorno dell'arrivo è la notte 1; chi ha fatto il check-out mostra "Soggiorno concluso" `[DECISO][TEST]`.
- Oltre le **17 notti** i pallini diventano una **barra di larghezza fissa**: prima sparivano del tutto, e i soggiorni lunghi — quelli in cui sapere a che punto si è conta di più — restavano senza colpo d'occhio `[DECISO][TEST]`.
- **Badge "Nª volta"** con la data dell'ultima visita, per chi ha già **dormito** qui; accanto, se ci sono, le **visite in giornata** in un badge separato (§7) `[DECISO][TEST]`.
- Stessa banda di accoglienza degli Arrivi, stesse regole (§4).
- Filtri: **Oggi in hotel** · Partono oggi · VIP · Alert · Ricorrenze · Reclami · Usciti · **Day use** `[CODICE]`.
- **"Partono oggi"** comprende sia chi è ancora in camera con partenza odierna sia chi ha già fatto il check-out `[CODICE][TEST]`.
- Il contatore **esclude** chi ha già fatto il check-out `[CODICE][TEST]`.
- Con un filtro che non seleziona nulla il contatore dice **"0 di 5"**, non "5": diceva il numero pieno a schermo vuoto `[DOC][TEST]`.

> **"Oggi in hotel" non è il numero della Home** `[DECISO]`. Questa lista comprende chi parte oggi, il riquadro "Restano stanotte" della Home no. Sono due domande diverse (vedi §3): i nomi lo dichiarano, invece di lasciar credere a un errore.

### Ospiti del giorno (day use) — dal 13/08/2026

Il gestionale registra gli esterni di SPA, piscina, cene e serate come prenotazioni con **arrivo e partenza nello stesso giorno**, e li marca "partiti" fin dalla creazione perché non pernottano. Il CRM chiedeva il check-in per la lista In casa e "diverso da partito" per gli Arrivi: **erano esclusi da entrambe**, cioè non comparivano da nessuna parte.

Sono circa **1.200 l'anno**, stabili dal 2023, e fra loro ci sono ospiti che l'hotel conosce: il 13/08 è venuta per la piscina un'ospite con quattro soggiorni alle spalle e una celiachia in nota.

- **Riconoscimento**: arrivo = partenza. Sui dati veri coincide sempre con "nessuna camera pianificata" (85 pratiche correnti, 3.168 archiviate dal 2024, tutte a zero camere), quindi non c'è ambiguità con le partenze anticipate `[DECISO]`.
- **Restano fuori** le pratiche di un giorno intestate a chi in quel momento è già in albergo con il check-in fatto: sono scritture contabili (l'extra addebitato a parte) e produrrebbero una seconda card per lo stesso ospite `[DECISO][TEST]`.
- «Già in albergo» significa **check-in fatto**, non «ha un'altra pratica che copre questa data»: i **voucher regalo** sono registrati come prenotazioni lunghe un anno e coprirebbero qualunque giorno `[DECISO][TEST]`.
- **In pagina**: pastiglia "Day use", nessuna camera, nessuna notte, nessun importo di soggiorno; in coda alla lista. Restano allergie, preferenze, VIP, reclami, "Nª volta" e note `[DECISO]`.
- **I tre numeri della Home non cambiano**: un ospite del giorno non fa check-in, non occupa una camera la notte, non è una partenza da gestire `[DECISO]`.
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
- La ricerca è per anagrafica, non per persona: **due codici fusi restano due risultati distinti** `[CODICE]`.

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
- Restano invece **dentro** i soggiorni *In casa* e *Partito*: stanno avvenendo o sono appena finiti, e i soldi sono veri. Così il numero coincide con il badge "Nª volta" delle schede, che mostra i soggiorni archiviati più quello in corso.

> **Che cosa conta come "una volta"** `[DECISO][TEST]` — deciso il 13/08/2026 guardando l'archivio vero.
>
> L'archivio delle prenotazioni non contiene solo soggiorni. Su 41.337 pratiche archiviate: **12.492 sono giornate** (SPA, piscina, cene per esterni), **2.951 non hanno nemmeno le date** e **79 sono voucher regalo**, registrati come prenotazioni lunghe un anno perché quella è la loro validità. Un terzo di ciò che contava come soggiorno non lo era.
>
> Contandole tutte, **9.996 ospiti su 62.123** risultavano più affezionati di quanto fossero, e **5.363 comparivano come "di ritorno" senza aver mai dormito qui**. Un ospite in casa il 13/08 leggeva "7ª volta" con cinque soggiorni veri.
>
> Da oggi sono **due conteggi separati**: il badge "Nª volta" conta i soggiorni con pernottamento; le giornate hanno un badge a parte ("3 in giornata"). Non si sommano — chi ha dormito qui una volta e poi è tornato sei volte per la SPA è al secondo soggiorno — ma non si buttano: un cliente che torna spesso in giornata è un dato commerciale, e prima chi veniva **solo** in giornata non entrava proprio nello storico.
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
- Le preferenze `personale` non escono mai dalla scheda del loro proprietario `[CODICE][TEST]`.
- Nelle schede di Arrivi e In casa compaiono **solo le preferenze `nucleo`**, al massimo tre `[CODICE][TEST]`.
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

Arrivi, In casa **e scheda ospite** `[DECISO]`. Sulla scheda entrano entrambe le fonti: all'inizio erano escluse le note di prenotazione per non attribuire in silenzio a chi apre la pagina un'allergia riferita a un altro occupante, ma alla prova coi dati veli la scelta non ha retto — chi apre la scheda ha davanti la frase, il numero di pratica e le date, e giudica meglio di qualunque regola. Sulla scheda si leggono le note delle prenotazioni **correnti**, non l'archivio: le richieste di soggiorni conclusi anni fa tornerebbero a galla a ogni apertura senza che nessuno sappia se valgono ancora.

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
- La precompilazione avviene **una sola volta**: un marcatore evita che si ripeta a ogni apertura, anche se nel frattempo i membri sono stati cancellati `[CODICE][TEST]`.

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
- Ordine per numero di camera, come il rack `[CODICE][TEST]`.
- Delle attenzioni si legge il **testo** del reclamo aperto (primi due, poi il conteggio), non il numero `[CODICE][TEST]`.
- Il foglio dice quante prenotazioni contiene e **quante hanno allergie**, e porta in fondo l'avvertenza che contiene dati personali `[CODICE]`.
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
- **Quello che deliberatamente NON c'è** `[DECISO]`: nessun requisito di complessità, nessuna scadenza, **nessun blocco dopo tentativi falliti** (chiuderebbe fuori chi dimentica la password, e non esiste recupero via email), nessuna validazione dell'email — che infatti non serve a niente, perché non c'è recupero. E il cookie di sessione **non è marcato "solo su connessione cifrata"**: in hotel si va in HTTP semplice e marcarlo impedirebbe di accedere del tutto. Sono scelte prese sapendo che l'applicazione gira su rete interna: **da rivedere il giorno che uscirà dall'hotel**.

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
- **Le proposte accettate vengono salvate con ambito `nucleo`** `[CODICE]` (`web/app.js:1690`).
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

## 20. Decisioni prese e domande ancora aperte

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
