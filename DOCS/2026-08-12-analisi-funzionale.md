# Analisi funzionale — CRM Hotel Canne Bianche

- **Data:** 2026-08-12
- **Oggetto:** che cosa fa l'applicazione e con quali regole, dal punto di vista di chi la usa.
- **Metodo:** lettura dei documenti in `DOCS/`, del codice in `src/` e `web/`, dei test in `test/`. Nessuna verifica sul database dell'hotel (irraggiungibile da qui).

---

## Come si legge questo documento

Ogni regola porta la sua fonte. Serve a sapere di quali affermazioni ci si può fidare e quali vanno confermate con chi ha commissionato il lavoro.

| Marca | Significato |
|---|---|
| `[DOC]` | Sta scritta in un documento di `DOCS/` o in un ticket. È un requisito dichiarato. |
| `[TEST]` | È fissata da un test in `test/`. Se cambia, la suite si accorge. |
| `[CODICE]` | È stata dedotta leggendo il codice. **Nessuno l'ha mai scritta come requisito.** Può essere una scelta voluta o un difetto che non è mai emerso: da qui non è possibile distinguere i due casi. |

Una regola può portare più marche: `[DOC][TEST]` significa che è richiesta ed è protetta da un test.

**Avvertenza sulle regole `[CODICE]`.** Sono la maggioranza. Non vanno lette come "requisiti impliciti": vanno lette come "oggi il programma si comporta così". Le più significative sono ripetute in fondo, in *Domande aperte*, dove per ciascuna sono indicate le risposte possibili.

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
20. [Domande aperte](#20-domande-aperte)

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
- Non esiste blocco dopo N tentativi falliti, né limite di frequenza sul login `[CODICE]`.

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
- **Analytics non esiste ancora**: la regola di protezione c'è già, la pagina no `[CODICE]`.
- Un ruolo sconosciuto nel database (per esempio il vecchio `marketing`) vale **sola lettura**, non pieni poteri. L'utente resta operativo per consultare e nella pagina Utenti compare con un'etichetta gialla "non previsto" `[DOC][TEST]`.
- Nascondere i pulsanti non è la difesa: chiamando le interfacce a mano si prende comunque un 403. La matrice ruoli × operazioni è verificata chiamando le API senza passare dall'interfaccia `[TEST]` (`test/permessi-api.test.js`).
- **Le maiuscole nell'indirizzo non aggirano il controllo.** Era un buco reale — la reception poteva crearsi un amministratore — chiuso il 12/08 con un test che rifà l'attacco `[DOC][TEST]`.

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

- Tre riquadri: **Arrivi oggi**, **Partenze oggi**, **Presenti in casa**, riferiti alla data di lavoro del gestionale `[DOC]`.
- Sono conteggi di **prenotazioni**, non di persone `[CODICE]`.
- Arrivi = prenotazioni non annullate con data di arrivo pari a oggi, escluse quelle già segnate come partite. Partenze = stesso criterio sulla data di partenza. Presenti = check-in fatto e oggi compreso fra arrivo e partenza, **partenza esclusa** `[CODICE]` (`src/pms/prenotazioni.js:121-126`).
- Cliccando "Partenze oggi" si apre la pagina In casa già filtrata sui partenti `[CODICE]`.
- Se il gestionale non risponde, i tre numeri diventano trattini con un messaggio `[CODICE]`.

> Attenzione: il criterio dei "presenti" della Home **non coincide** con quello della pagina In casa (vedi §5 e *Domande aperte* D3).

---

## 4. Arrivi del giorno

### A cosa serve

Preparare l'accoglienza: chi arriva oggi, in che camera, cosa serve sapere prima che varchi la porta.

### Cosa mostra ogni scheda

Una scheda per prenotazione, non per persona `[CODICE]`. Contiene:

- **Referente** (cliccabile, apre la scheda ospite), stato *Atteso* / *In casa*, ora prevista di arrivo, badge VIP.
- **Banda di accoglienza**: ospite indesiderato, compleanno durante il soggiorno, allergie, reclami aperti con il loro testo, fino a 3 preferenze, nota personale accorciata.
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
| Allergie | CRM | Tutte quelle del gruppo, senza doppioni. **Non si dice di chi sono** `[CODICE]` |
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
- Nel riepilogo compaiono i campi *anniversari* e *suggerimenti AI*, sempre a zero: manca la fonte dati `[CODICE]` (dichiarato nel codice come da fare).
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
- Entrano le prenotazioni non annullate con **check-in fatto** e data di lavoro compresa fra arrivo e partenza, **partenza inclusa** `[CODICE]` (`src/pms/prenotazioni.js:116-118`).
- **Ordine da rack**: per numero di camera crescente, con chi ha già fatto il check-out in fondo. Le camere non numeriche vanno in coda in ordine alfabetico `[CODICE][TEST]` (`test/incasa-brief.test.js`).
- Tre stati per riga: `incasa`, `partenza` (parte oggi, ancora in camera), `checkout` (check-out registrato) `[CODICE]`.
- **Avanzamento del soggiorno**: "Notte 3 di 7 · parte il …", con pallini solo fino a 14 notti; oltre diventano rumore. Il giorno dell'arrivo è la notte 1. Chi ha fatto il check-out mostra "Soggiorno concluso" `[CODICE][TEST]`.
- **Badge "Nª volta"** con la data dell'ultima visita, per chi è già stato in hotel; chi non c'è mai stato non ha badge `[CODICE]`.
- Stessa banda di accoglienza degli Arrivi, stesse regole (§4).
- Filtri: In casa · Partono oggi · VIP · Alert · Ricorrenze · Reclami · Usciti `[CODICE]`.
- **"Partono oggi"** comprende sia chi è ancora in camera con partenza odierna sia chi ha già fatto il check-out `[CODICE][TEST]`.
- Il contatore "presenti" **esclude** chi ha già fatto il check-out `[CODICE][TEST]`.

### Casi limite

- Il check-out è determinato da **una sola riga** del conto alberghiero, presa senza criterio di scelta: con più camere, se il gestionale ne segna una come chiusa, l'intera prenotazione può risultare uscita `[CODICE]` (`src/pms/prenotazioni.js:109`). Vedi *Domande aperte* D4.
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
- Dai conteggi si escludono i soggiorni in stato **Eliminata** e **No-show** `[CODICE][TEST]` (`test/clienti-api.test.js`).
- **I soggiorni futuri (stato "Pianificata") contano** nel numero di soggiorni e abbassano le medie, pur avendo importo maturato zero `[CODICE]`. Vedi *Domande aperte* D5.
- Prima e ultima visita sono cliccabili e portano allo storico, che si apre e lampeggia `[CODICE]`.

### Storico soggiorni

Una riga per pratica: numero, arrivo → partenza, notti, camere, importo, extra, stato.

- Entrano le prenotazioni in cui l'ospite è **referente oppure occupante**: chi viaggia in famiglia vede i soggiorni condivisi `[DOC]`.
- Correnti e archiviate sono unite; se una pratica è presente in entrambe vince quella archiviata, per non contarla due volte `[CODICE]`.
- **Importo**: pianificato per le prenotazioni correnti, maturato per quelle concluse (la pianificazione non sopravvive all'archiviazione) `[CODICE]`.
- **Stati possibili**: In casa, Partito, Pianificata (arrivo futuro), No-show (arrivo passato senza check-in), Confermato (arriva oggi), Concluso, Eliminata `[CODICE]`.
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

- **L'ambito predefinito è `nucleo`** `[CODICE][TEST]` (`src/api/clienti.js:441`; `test/clienti-api.test.js`, «preferenze: ambito default nucleo»). Il modulo della scheda non chiede l'ambito: chi inserisce una preferenza ne crea una condivisa senza doverlo scegliere `[CODICE]`. **Il documento di analisi del 04/08 chiedeva il contrario** (default personale, con adesione volontaria al nucleo) `[DOC]`. Vedi *Domande aperte* D1.
- L'ambito si cambia dopo, con un interruttore a due voci sulla riga `[CODICE]`.
- Le preferenze di ambito `nucleo` **di un altro membro del nucleo** compaiono sulla scheda in un blocco separato, **in sola lettura**, con il nome di chi le possiede (cliccabile). Si correggono solo dalla sua scheda `[CODICE][TEST]`.
- Le preferenze `personale` non escono mai dalla scheda del loro proprietario `[CODICE][TEST]`.
- Nelle schede di Arrivi e In casa compaiono **solo le preferenze `nucleo`**, al massimo tre `[CODICE][TEST]`.
- Una preferenza si elimina, non si archivia. Si può correggere testo, reparto, categoria e ambito `[CODICE]`.
- Ogni riga porta autore e data di inserimento `[CODICE]`.
- **Non è registrato se una preferenza è stata scritta a mano o confermata da un suggerimento dell'AI**: passano dalla stessa strada `[DOC]` (`DOCS/2026-08-10-analytics-dashboard-analisi.md` §3.2).
- Testo oltre i 400 caratteri → messaggio che dice quanto ci sta e quanto è stato scritto, e il testo resta nel campo `[DOC][TEST]`. **La correzione di una preferenza esistente non ha questo controllo** `[CODICE]` (vedi D8).

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
- **Nelle schede le allergie sono aggregate su tutta la prenotazione** (referente + occupanti + anagrafiche fuse) e **non si dice a chi appartengono** `[CODICE]`. L'analisi del 04/08 le classifica invece come dato strettamente personale `[DOC]`. Vedi *Domande aperte* D2.
- Un salvataggio fallito **lo dice**, e il testo resta nel campo: prima non succedeva niente e si credeva di aver registrato un'allergia che non c'era `[DOC][TEST]`.
- Nella scheda le allergie sono lette su tutte le anagrafiche fuse; la scrittura va sul codice che si sta guardando `[CODICE]`.

### Chi può

Leggere: tutti. Aggiungere ed eliminare: `reception` e `admin`.

### Da dove vengono i dati

CRM. Le proposte automatiche nascono da una nota del PMS ma non sono ancora un dato: vedi il paragrafo seguente.

---

## 11. Proposte di allergie dalle note del PMS

### A cosa serve

Le allergie spesso sono già scritte nella nota libera della prenotazione, ma in un posto dove nessuno le cerca. L'applicazione le riconosce e **le propone**; è la reception a decidere.

### Perché propone e non scrive

Due motivi osservati nelle note vere, nessuno risolvibile con più codice `[DOC]`:

1. **La nota è della prenotazione, non della persona.** "La signora è celiaca", in una pratica con quattro ospiti, non dice quale signora. Attribuirla d'ufficio all'intestatario può mettere l'allergia sulla persona sbagliata — peggio che non averla, perché sposta l'attenzione della cucina.
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
- **Le note dell'anagrafica non vengono lette**, solo quelle della prenotazione. Sarebbero per-persona, quindi senza il problema dell'attribuzione: è segnato come possibile miglioramento `[DOC]`.
- Il vocabolario è tarato su note inventate: la verifica sui dati veri è il punto principale della checklist di rientro `[DOC]`.

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
- La **nota personale non ha limite di lunghezza**; la lingua ne ha 40 `[CODICE]`.
- Nelle schede di Arrivi e In casa la nota compare **accorciata**: non è un riassunto, è l'inizio della nota tagliato dove finisce la frase, al massimo 90 caratteri. Chi scrive mette l'identikit in apertura e il dettaglio dopo `[CODICE][TEST]` (`test/arrivi-brief.test.js`, sei casi su `sintetizzaNota`).
- Il taglio non spezza mai una parola a metà e non lascia un punto e virgola in coda; il segno "c'è dell'altro" lo mette la scheda, una volta sola `[CODICE][TEST]`.
- Nelle schede compare **solo la nota del referente** (e delle sue anagrafiche fuse), mai quella di un occupante: la scheda è intestata al referente `[CODICE][TEST]`.
- La versione accorciata la calcola il server, così chi salva la vede comparire subito nelle schede a video senza ricaricare `[CODICE]`.
- **Su una scheda fusa, "Elimina" cancella su tutto il gruppo.** La lettura prende il primo valore non nullo di tutte le anagrafiche fuse: svuotandone una sola, la nota di un altro codice riaffiorava e sembrava che il pulsante non funzionasse. Decisione presa il 12/08: **la nota è della persona, non dell'anagrafica**. Conseguenza accettata: dopo uno "Scollega" quell'anagrafica non ritrova la sua vecchia nota `[DOC][TEST]` (`test/profilo-fusa.test.js`).
- Cancellare la nota **non porta via la lingua**, e viceversa `[TEST]`.
- La modifica invece scrive **solo sul codice che si sta guardando**: la riga toccata diventa la più recente e vince in lettura `[CODICE]`.
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

### Il "gruppo nucleo"

Per decidere con chi condividere le preferenze si considera: l'ospite, i membri del suo nucleo agganciati a un'anagrafica, e chi elenca lui nel proprio nucleo. **Un solo livello, in entrambe le direzioni**: il coniuge del coniuge non entra `[CODICE]`.

### Chi può

Leggere: tutti. Aggiungere, modificare, eliminare: `reception` e `admin`.

> **Attenzione**: la precompilazione automatica avviene durante una **lettura** della scheda. Un utente di sola lettura che apre la scheda di un ospite mai visitato provoca la scrittura delle righe del nucleo, che risultano inserite a suo nome `[CODICE]`. Vedi *Domande aperte* D6.

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

- **Le scritture vanno sul codice che si sta guardando**, non sul principale. Fa eccezione la cancellazione di nota personale e lingua, che agisce su tutto il gruppo (§13) `[CODICE]`.
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
- **La password non ha lunghezza minima, e email, nome e cognome non sono validati** in alcun modo `[CODICE]`. Vedi *Domande aperte* D9.

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
- Modelli: il briefing usa il modello più capace, le altre funzioni uno più economico. La scelta nasce da un confronto dal vivo `[DOC]`.

### 18.3 Regole comuni

- Entrambe richiedono il permesso `usa-ai`: la sola lettura non le può usare `[CODICE][TEST]`.
- Se l'AI non è configurata (chiave o libreria assenti) l'endpoint risponde con un messaggio esplicito e **l'applicazione resta in piedi** `[CODICE][TEST]`.
- I guasti sono tradotti in messaggi comprensibili: credito esaurito, chiave non valida, troppe richieste, servizio non disponibile. **Un errore non riconosciuto non viene mascherato**: diventa un errore interno nei log, invece di un messaggio rassicurante inventato `[DOC][CODICE][TEST]` (`test/ai-guasti.test.js`).
- L'interfaccia mostra **il messaggio del server**, non una frase fissa: un credito esaurito arrivava a schermo come "Errore durante la generazione" e sarebbe partita una segnalazione di bug per un problema di fatturazione `[DOC][TEST]`.
- Ogni pulsante di generazione si spegne dopo un successo, con la spiegazione, e si riattiva rientrando nella pagina o riaprendo la scheda `[CODICE][TEST]`.
- **Nessuna delle due funzioni lascia traccia**: c'è solo una riga di registro nella console del server (chi, per quale ospite, quante proposte). Non esiste una tabella degli eventi, quindi **non si potrà mai sapere quante proposte sono state scartate** `[DOC]` (`DOCS/2026-08-10-analytics-dashboard-analisi.md` §3.1). Ogni giorno che passa è storico perso.

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

---

## 20. Domande aperte

Questa è la parte che vale di più. Sono contraddizioni fra codice e documenti, comportamenti che potrebbero non essere quelli voluti, e regole che valgono in un punto e non in un altro simile. Ognuna è formulata come domanda, con le risposte possibili.

---

### D1 — L'ambito predefinito delle preferenze è `nucleo`. Il documento chiedeva `personale`.

**Dove.** `src/api/clienti.js:441` (`ambito = ... : 'nucleo'`), `src/crm/preferenze.js` (`createPreferenza`, default `nucleo`), `scripts/crm-preferenze-ambito.sql` (`DEFAULT 'nucleo'`), `web/app.js:1587` (il modulo non manda l'ambito).
**Contro.** `DOCS/2026-08-04-condivisione-dati-nucleo-analisi.md` §3.2: «preferenze → default `personale`, con possibilità di marcare "di nucleo"». Lo stesso documento elenca fra le decisioni da prendere: «Preferenze: default `personale` con opt-in "nucleo", oppure il contrario?».

Oggi ogni preferenza scritta dalla reception nasce **condivisa con chi viaggia con l'ospite**, e compare sulle schede dei familiari. Il codice non registra da nessuna parte che questa decisione sia stata presa: il commento nella migrazione dice solo «la maggior parte delle preferenze è di nucleo».

**Risposte possibili:**
1. La decisione è stata presa dopo il documento, a favore di `nucleo`, e il documento non è stato aggiornato. Va scritto da qualche parte.
2. Il documento vale ancora e il default è un difetto: preferenze personali ("lei vegetariana") stanno finendo sulle schede di altre persone.
3. Il default giusto dipende dal tipo: camera e occasioni sono di nucleo, persona è personale. Nessuna delle due opzioni è quella buona.

---

### D2 — Nelle schede di Arrivi/In casa le allergie del gruppo sono mostrate senza dire di chi sono.

**Dove.** `src/crm/arrivi-brief.js:127-135`: le intolleranze di referente e di tutti gli occupanti (più le anagrafiche fuse) finiscono in un unico elenco. `web/app.js`, `flagAllergie`: le stampa come "⚠ Allergie: Glutine, Arachidi". Stessa cosa nella colonna Allergie dell'export (`web/export.js`).
**Contro.** `DOCS/2026-08-04-...` §2.C classifica le intolleranze come «dato di **sicurezza del singolo** (l'allergia è di UNA persona, non del gruppo)». E `DOCS/2026-08-11-allergie-da-note-pms.md` §2.1 argomenta che attribuire un'allergia alla persona sbagliata è **peggio del non averla**, «perché sposta l'attenzione della cucina sul commensale sbagliato».

Il sistema è quindi rigorosissimo nel far **scegliere** a chi attribuire un'allergia quando la propone, e poi la **rimostra senza il nome** in scheda e sul foglio che va in cucina.

**Risposte possibili:**
1. È voluto: in scheda serve l'allarme, il dettaglio si apre nella scheda ospite. Allora vale la pena verificare che il foglio stampato basti alla cucina.
2. È una svista: l'elenco dovrebbe portare il nome ("Glutine — Bebie Sienna"), almeno nell'export.
3. Va distinto: allarme aggregato nella scheda a video (dove il nome si legge un clic più in là), nome obbligatorio sul foglio stampato.

---

### D3 — "Presenti in casa" della Home e la lista "In casa" contano cose diverse.

**Dove.** `src/pms/prenotazioni.js:126` — la Home conta i presenti con `dtpartenza > data` (partenza **esclusa**). `src/pms/prenotazioni.js:118` — la lista In casa seleziona con `dtpartenza >= data` (partenza **inclusa**). In più, il contatore della pagina In casa esclude chi ha già fatto il check-out (`src/crm/incasa-brief.js:62`).

Risultato: nel giorno in cui qualcuno parte, la Home dice per esempio 40 presenti e la pagina In casa ne elenca 45, di cui alcuni marcati "Parte oggi" o "Check-out effettuato". Nessun documento dice quale sia il numero giusto.

**Risposte possibili:**
1. Sono due domande diverse e vanno bene entrambe: la Home dice "quante camere restano occupate stanotte", la pagina dice "chi c'è in hotel adesso". Allora vanno etichettate diversamente.
2. È un'incoerenza: il numero della Home deve essere quello della pagina che si apre cliccandolo.
3. La Home ha ragione (definizione alberghiera di presenza notturna) e la lista deve smettere di mostrare i partiti fra i presenti.

---

### D4 — Lo stato di check-out di una prenotazione è deciso da una riga scelta a caso.

**Dove.** `src/pms/prenotazioni.js:109`: `SELECT TOP 1 al.flgpar FROM Alberg al WHERE al.codpratica = p.codpratica`, senza alcun criterio di ordinamento.

Il conto alberghiero ha **una riga per occupante** (regola di dominio dichiarata in `HANDOFF.md` §6.2). Con una prenotazione di quattro persone, o con due camere di cui una già chiusa, quale riga risponda non è determinato: dipende dal piano di esecuzione del database. Da questa riga dipendono la pastiglia "Check-out effettuato", la posizione in fondo alla lista, il conteggio "usciti", il filtro "Partono oggi" e una voce dell'export.

**Risposte possibili:**
1. Nel gestionale il flag è identico su tutte le righe della pratica, quindi la scelta è irrilevante. Da confermare con l'autore del PMS.
2. Basta che **una** riga sia chiusa perché la prenotazione conti come uscita — allora va scritto `EXISTS`, non `TOP 1`.
3. Servono **tutte** chiuse — allora la condizione è l'opposto, e oggi la lista sta nascondendo ospiti ancora in casa.

---

### D5 — Le prenotazioni future contano nel numero di soggiorni e abbassano le medie.

**Dove.** `src/api/clienti.js:22-24`: dai cumulativi si escludono solo gli stati `Eliminata` e `No-show`. Lo stato `Pianificata` (arrivo futuro, `src/pms/clienti.js:67`) resta dentro, con arrangiamento ed extra a zero perché non c'è ancora nulla di maturato.

Un ospite con 10 soggiorni fatti e 2 prenotazioni per l'estate prossima risulta con **12 soggiorni** e una spesa media più bassa del vero. Nella stessa applicazione, il badge "Nª volta" delle schede conta invece **solo i soggiorni conclusi** (`src/pms/clienti.js:248-258`): due numeri diversi per la stessa domanda, sulla stessa persona.

**Risposte possibili:**
1. È voluto: "numero di soggiorni" include le prenotazioni in essere, e le medie sono un dettaglio accettabile.
2. I cumulativi devono escludere anche `Pianificata` e `Confermato`, allineandosi al badge.
3. Vanno mostrati due numeri distinti — soggiorni fatti e prenotazioni future — perché sono informazioni diverse per chi accoglie.

---

### D6 — Un utente di sola lettura, aprendo una scheda, scrive nel database.

**Dove.** `src/api/clienti.js:486-492`: la lettura del nucleo chiama `autoPopulaNucleo`, che inserisce righe in `customer_travel_party` con `autore_user_id = req.session.user.id`. La guardia dei permessi classifica le letture come `leggi` (`src/auth/middleware.js`), quindi il profilo di sola consultazione passa.

Conseguenze: chi consulta e basta risulta autore di righe che non ha inserito; la prima apertura di una scheda produce una scrittura non richiesta; l'operazione non è ripetibile (un marcatore la blocca), quindi **il primo che apre la scheda fissa il nucleo per tutti**, anche se in quel momento i dati del gestionale erano incompleti.

**Risposte possibili:**
1. È accettabile: la precompilazione è un servizio, l'autore è irrilevante.
2. La precompilazione va spostata su un'azione esplicita ("Precompila dai soggiorni"), soggetta al permesso di scrittura.
3. Va mantenuta automatica ma attribuita al sistema, non all'utente collegato, e ripetibile su richiesta.

---

### D7 — La stessa applicazione valida gli identificativi in due modi diversi.

**Dove.** `src/api/clienti.js:35-42` definisce `intParam`, che accetta **solo cifre**, proprio perché `Number(true)` vale 1 e `Number('')` vale 0 e questo aveva già creato gruppi di fusione fantasma (correzione del 12/08, `DOCS/2026-08-11-bug-da-collaudo.md`).

`intParam` è usato per: fusione, preferenze, nucleo, complaints (solo in cancellazione). **Non** è usato per: il codice ospite di tutte le rotte della scheda (`Number(req.params.codCli)`, righe 94, 122, 130, 139, 149, 206, 248, 276, 283, 342, 349, 362, 369, 390, 416, 437, 487, 495), la modifica dei reclami (riga 304), gli identificativi utente (`src/api/admin.js:70, 119`).

Non risulta un caso di danno concreto: sono percorsi di sola lettura o comunque legati a chiavi esistenti. Resta però che la difesa introdotta dopo un incidente è stata applicata a metà.

**Risposte possibili:**
1. È una scelta di rischio: dove il valore finisce in una chiave di gruppo serve il controllo stretto, altrove basta un intero.
2. È una dimenticanza: `intParam` va usato ovunque, ed è una modifica di poche righe.
3. È irrilevante finché il database rifiuta i valori non validi; da chiudere solo se emerge un caso reale.

---

### D8 — I limiti di lunghezza valgono in inserimento e non in correzione.

**Dove.** `src/api/clienti.js:49-56` definisce i tetti (preferenza 400, allergia 200, nome 80, nota nucleo 400, lingua 40, periodo 60), presi dalle colonne del database. Sono applicati in creazione (`campoTesto`). **Non** sono applicati in `PATCH /preferenze/:id` (righe 454-470, controlla solo che il testo non sia vuoto) né in `PATCH /nucleo/:id` (righe 514-530, nessun controllo). Anche `PATCH /admin/users/:id` non controlla nome, cognome ed email.

Il difetto che questi tetti dovevano chiudere — "i moduli non dicevano niente quando il salvataggio falliva", con un errore interno del database al posto di un messaggio — si ripresenta quindi identico correggendo una riga esistente invece di crearne una nuova `[DOC]` (`2026-08-11-bug-da-collaudo.md`).

**Risposte possibili:**
1. È una svista: gli stessi controlli vanno estesi alle correzioni.
2. Non capita mai, perché in correzione si accorcia. Da verificare sui dati veri prima di decidere.
3. Il controllo va spostato in un punto solo, attraversato da tutte le scritture, invece di essere ripetuto per rotta.

---

### D9 — Sugli account non c'è nessun requisito di password né validazione dell'email.

**Dove.** `src/api/admin.js:55`: basta che la password sia una stringa non vuota. Nessuna lunghezza minima, nessun controllo di complessità, nessuna scadenza, nessun blocco dopo tentativi falliti (`src/auth/routes.js`). L'email non è validata in alcun modo (righe 51, 105) e non viene usata per nulla — non c'è recupero password.

L'applicazione gira sulla rete interna dell'hotel, il che riduce l'esposizione ma non la elimina (il cookie di sessione non è marcato come "solo su connessione cifrata", `src/app.js:18`).

**Risposte possibili:**
1. È adeguato a un'applicazione interna con pochi utenti e una rete controllata.
2. Serve almeno una lunghezza minima e il marcatore di sicurezza sul cookie, prima di andare in produzione.
3. Il tema va affrontato quando si deciderà se esporre l'applicazione fuori dall'hotel; fino ad allora è un rischio accettato — ma va scritto che lo è.

---

### D10 — Lo stato "No-show" esiste nel codice, e il documento dice che non deve esistere.

**Dove.** `src/pms/clienti.js:68`: una prenotazione corrente con arrivo precedente alla data di lavoro e senza check-in viene mostrata come **No-show**. Lo stato compare nello storico con una pastiglia dedicata (`web/app.js:1262`) ed è escluso dai cumulativi.
**Contro.** `DOCS/2026-07-30-crm-anagrafica-v2-mapping-specs.md` §4.4: «Stato prenotazione → solo Confermata / Completata / Cancellata. **Nessun No-show**: il PMS non ha un flag dedicato e `Motivo` è testo libero inaffidabile».

Inoltre l'import usa i tre stati del documento e lo storico della scheda ne usa sette: le due strade danno nomi diversi alla stessa prenotazione. Il "No-show" dedotto qui non distingue un ospite che non si è presentato da una prenotazione che nessuno ha chiuso nel gestionale.

**Risposte possibili:**
1. La deduzione è utile alla reception ed è stata aggiunta consapevolmente: allora il documento va corretto e va scelto un nome che non prometta più di quanto sappia (per esempio "Non arrivata").
2. Il documento vale: lo stato va tolto, e quelle prenotazioni vanno mostrate per quello che sono (correnti, non archiviate).
3. Va tenuto ma solo come segnalazione, senza escluderlo dai cumulativi in silenzio.

---

### D11 — Le note personali non hanno un tetto di lunghezza, tutti gli altri campi sì.

**Dove.** `src/api/clienti.js:389-412`: la nota personale è accettata di qualunque lunghezza (la colonna è senza limite). Il testo del reclamo, stessa cosa (riga 289, tetto dichiarato pari al massimo intero).

Il briefing AI, con "Salva nel profilo", **accoda** il testo generato a quello esistente senza limiti (riga 405). Nulla impedisce che una nota cresca indefinitamente a forza di generazioni ripetute su schede diverse (il blocco del pulsante vale per sessione e per anagrafica, non per sempre). Nelle schede la nota viene comunque tagliata a 90 caratteri, quindi il problema non si vede.

**Risposte possibili:**
1. È voluto: la nota personale è il posto dove si scrive liberamente, e la colonna lo consente.
2. Serve un tetto, foss'anche generoso, perché una nota di 20.000 caratteri rende inutilizzabile il riquadro e pesa su ogni caricamento di Arrivi.
3. Il problema non è la lunghezza ma l'accodamento cieco dell'AI: dovrebbe sostituire la parte generata invece di aggiungerne un'altra.

---

### D12 — La tabella delle "Note CRM" esiste, ma non la usa più nessuno.

**Dove.** `scripts/crm-schema.sql` crea `customer_notes` (note interne del team, con autore e data). Nessuna riga di `src/` o `web/` la legge o la scrive: la ricerca su tutto il repository trova solo lo script di creazione.
**Contro.** `DOCS/2026-07-07-crm-fase2-scheda-cliente-360-specs.md` la definisce come uno dei cinque blocchi della scheda ospite («Note CRM — note interne del team, crea/modifica/elimina») e ne dà le regole (modificabili da chiunque sia autenticato). `HANDOFF.md` §5 la elenca ancora fra le tabelle in uso.

Le sue funzioni sembrano essere state assorbite da "Note personali" (che però sono per-persona e a riga unica, non un diario) e dai reclami.

**Risposte possibili:**
1. La funzione è stata deliberatamente sostituita e la tabella è residuo da eliminare: vanno aggiornati i due documenti.
2. Serve ancora un blocco note libero, cronologico e a più voci, e la sua sparizione non è stata notata da nessuno. Se il database dell'hotel contiene righe, sono dati oggi invisibili.
3. Va lasciata dov'è come archivio storico, in sola lettura, con un riquadro che le mostri.

---

### D13 — Le scritture vanno sul codice visualizzato, le letture sull'intero gruppo fuso.

**Dove.** In tutta la scheda: le letture usano `getGruppo` e leggono su tutti i codici (`src/api/clienti.js`, righe 98, 124, 132, 141, 213, 278, 344, 364, 418, 489); le creazioni usano `codCli` così com'è (righe 299, 354, 449, 509). Fa eccezione la cancellazione di nota e lingua, resa esplicitamente di gruppo il 12/08 `[DOC]`.

Finché il gruppo resta unito non si vede nulla. **Dopo uno "Scollega", i dati si sparpagliano**: la preferenza inserita mentre si guardava il codice A resta su A, quella inserita guardando B resta su B, e l'ospite si ritrova con due schede parziali. Il documento del 04/08 poneva la domanda («Le informazioni condivise devono essere modificabili da qualsiasi membro o solo dal proprietario?») e non risulta una risposta.

**Risposte possibili:**
1. È coerente con la fusione come "vista logica": ogni anagrafica conserva ciò che le è stato scritto, e scollegare deve riportare indietro davvero.
2. Le scritture dovrebbero andare tutte sul **principale**, così scollegare un duplicato non porta via niente.
3. Il caso è raro (lo scollegamento è un'eccezione) e va lasciato com'è, ma l'operatore va avvisato al momento dello scollegamento.

---

### D14 — Il riepilogo degli arrivi contiene due voci che valgono sempre zero.

**Dove.** `src/crm/arrivi-brief.js:23-26`: `anniversari` e `suggerimentiAi` sono inizializzati a zero e non vengono mai incrementati; il commento dice «nessuna fonte dati affidabile per ora → 0 (TODO)». Non compaiono fra le voci filtranti mostrate a schermo (`web/app.js`, `BRIEF_CHIPS`), quindi oggi sono invisibili.

**Risposte possibili:**
1. Sono un segnaposto per funzioni previste: vanno tenuti e completati (gli anniversari di matrimonio sono un classico dell'accoglienza 5 stelle).
2. Sono residui di un'idea abbandonata e vanno tolti, perché un campo sempre a zero prima o poi finisce in una schermata.

---

### D15 — La cancellazione per identificativo non verifica a chi appartiene la riga.

**Dove.** `src/api/clienti.js:79-84` (`delRoute`) e i moduli CRM: preferenze, allergie, reclami e membri del nucleo si cancellano per identificativo, senza controllare che appartengano all'ospite che si sta guardando. Stessa cosa per le correzioni (`PATCH /preferenze/:id`, `/nucleo/:id`, `/complaints/:id`).

Dall'interfaccia non è possibile sbagliare, perché gli identificativi arrivano dalla scheda aperta. Chiamando le interfacce a mano, invece, un utente con permesso di scrittura può cancellare l'allergia di un altro ospite conoscendone il numero. Tutti gli utenti dell'applicazione sono personale interno di fiducia, quindi il rischio pratico è basso; resta che il registro degli autori non permette di ricostruire chi ha cancellato cosa (l'autore è salvato, la cancellazione no).

**Risposte possibili:**
1. Accettabile per un'applicazione interna: chi ha il permesso di scrivere ha il permesso di scrivere.
2. Va aggiunto il controllo di appartenenza, se non altro perché rende gli errori di programmazione innocui.
3. Il problema vero non è il controllo ma la mancanza di tracciamento delle cancellazioni su un dato di sicurezza come le allergie.

---

### D16 — "Ignora" su una proposta di allergia dura quanto la scheda del browser.

**Dove.** `web/app.js:532`, insieme in memoria con chiave prenotazione + termine. Ricaricando la pagina, la proposta scartata torna. È documentato come consapevole `[DOC]` (`2026-08-11-allergie-da-note-pms.md` §5 e §6.1: «Da decidere con dati d'uso, non per ipotesi»), quindi non è una domanda sul codice ma una decisione rinviata che va presa dopo i primi giorni d'uso reale.

**Risposte possibili:**
1. Se i falsi positivi ricorrenti sono pochi, si lascia così.
2. Se tornano ogni mattina, serve una tabella dedicata (e quindi una migrazione sul database).
3. Se i falsi positivi sono tanti, il problema non è "Ignora" ma il vocabolario, e va corretto quello.

---

### Punti in sospeso già dichiarati altrove

Non sono domande aperte da porre: sono cose già note e scritte, riportate qui per completezza.

- **Gli importi vanno riconfermati con la software house del PMS** `[DOC]` (nota PENDING, checklist §3).
- **Tre migrazioni da lanciare sul database dell'hotel** prima della messa in produzione; senza due di esse la sezione Reclami va in errore `[DOC]` (checklist §1).
- **Quattro interrogazioni non sono mai state eseguite su SQL Server vero** `[DOC]` (checklist §2), fra cui quella del badge "Nª volta", dove il rischio non è l'errore ma il doppio conteggio.
- **Il vocabolario delle allergie è tarato su note inventate** `[DOC]` (checklist §3).
- **Nessun evento AI viene registrato**: ogni giorno di attesa è storico non recuperabile `[DOC]` (analisi analytics §3.1 e checklist §4).
- **L'origine di una preferenza (manuale o AI) non è tracciata** `[DOC]` (analisi analytics §3.2).
- **La memoria delle sessioni è in RAM**: da sostituire prima di far girare più di un processo `[DOC]` (`HANDOFF.md` §9).
- **L'export copre una sola data** `[DOC]` (checklist §4).
- **La dashboard Analytics non esiste**: l'analisi è fatta, l'implementazione è rimandata al rientro in hotel `[DOC]`.
