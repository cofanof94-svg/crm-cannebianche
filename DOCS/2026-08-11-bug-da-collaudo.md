# Bug trovati nel collaudo dell'11/08/2026

Giro sistematico su tutta l'applicazione: lettura del codice, chiamate alle API con
curl per ciascun ruolo, tentativi di aggirare i permessi. Fatto contro il server di
sviluppo con dati finti (`npm run dev:mock`), quindi il DB dell'hotel non è stato
toccato. Gli endpoint AI non sono stati chiamati (credito esaurito).

**Tutto quanto segue è stato riprodotto**, non dedotto. Dove un problema riguarda
solo il mock e non il database vero, è scritto.

Stato: **2 corretti**, 10 aperti. Da decidere insieme cosa sistemare e in che ordine.

---

## ✅ CORRETTO — Una maiuscola nell'URL rendeva chiunque amministratore

Commit `276205d`.

Express instrada senza guardare le maiuscole (`case sensitive routing` è spento di
serie), le regole della guardia invece le guardavano. `/api/ADMIN/users` arrivava al
router degli utenti senza combaciare con `/^\/admin/`, ricadeva sulla regola
generica "il resto è scrivere", e chiunque potesse scrivere passava.

In pratica: **la reception si creava un amministratore** con una lettera maiuscola,
e poi ci faceva login. Stessa strada con `PATCH` per promuovere un utente esistente.

Corretto normalizzando il percorso prima del confronto, in `src/auth/middleware.js`.
Sondate anche le altre forme (percento-codifica, doppia barra, punto, barra finale):
non arrivano al router, il caso era l'unico. Due test, uno sulla funzione pura e uno
che rifà l'attacco dalle API — quest'ultimo serve, perché il problema stava proprio
fra chi instrada e chi decide.

---

## 🟠 Aperti — dove l'utente crede che qualcosa sia successo e non è vero

Sono i tre da guardare per primi: non è che una funzione manca, è che **mente**.

### 1. ✅ CORRETTO — Su una scheda fusa la nota personale non si può cancellare

> Chiuso il 12/08/2026. **Decisione di Mik: la nota è della persona**, quindi Elimina
> cancella su tutto il gruppo di fusione. Conseguenza accettata: dopo uno "Scollega"
> quell'anagrafica non ritrova la sua vecchia nota. La modifica non è stata toccata,
> funzionava già. Quattro test in `test/profilo-fusa.test.js`.
> Segue la descrizione originale del difetto.

`getProfilo` restituisce il primo valore non nullo **del gruppo di fusione**, ma la
PUT scrive sempre sulla riga del codice visualizzato. "Elimina" svuota la propria
riga, il server ripropone subito la nota di un altro membro del gruppo, il testo
torna a video. Riclicare non serve: **non è rimovibile dall'interfaccia**.

```bash
# 1201 ha una nota, poi lo si fonde su 1001
PUT /api/clienti/1001/note-personali {"testo":"","mode":"set"}   # -> {"notePersonali":null} sembra fatta
GET /api/clienti/1001/profilo                                     # -> la nota di 1201 è tornata
```

Vale anche per la **lingua preferita**. La nota riappare anche nelle card Arrivi/In
casa e nell'export.

*Dove:* `src/crm/profilo.js:23-24` contro `src/api/clienti.js:311-317` e `:322-338`.

*Perché conta:* le note personali contengono informazioni biografiche sull'ospite,
anche generate dal briefing AI. Se una è sbagliata, o l'ospite chiede di toglierla,
non si può.

**Da decidere:** la cancellazione deve svuotare tutte le righe del gruppo, oppure la
scrittura deve andare sempre sul codice principale?

### 2. Le proposte di allergie inventano termini e ne perdono di vere

Tre difetti distinti in `src/crm/allergie-note.js`, verificati eseguendo il modulo.

**a) Termini spazzatura.** Una nota che dice che l'ospite è allergico senza nominare
la sostanza produce una proposta fatta con la coda della parola stessa:

```
"La signora è allergica"           -> termine "Ca"
"Ospite allergico"                 -> termine "Co"
"allergica: verificare in cucina"  -> termine "Verificare in cucina"
```

Causa: `allergi\w*` fa backtracking e, non trovando due caratteri dopo "allergica",
riduce il match a "allergi" e cattura "ca" come sostanza (`:64`, `:117-120`).
Un clic e finisce nelle intolleranze, che sono un dato di sicurezza: "Ca" comparirebbe
in rosso con ⚠ nel foglio stampato e nelle card.

**b) Una negazione a inizio frase cancella l'allergia vera che segue.** `frasi()`
spezza su `.` `;` e a capo, **non sulla virgola** (`:70-75`, `:106`):

```
"Il bambino non ha allergie ma la madre è allergica al lattosio"  -> nessuna proposta
"Nessuna allergia, ma la signora è celiaca"                       -> nessuna proposta
```

È esattamente come si scrive la nota di una prenotazione familiare. E il modulo tace:
nessuno si accorge che c'era qualcosa.

**c) `no` come marcatore genera falsi positivi.** `MARCATORE` include `\bno\b`
(`:41`): *"Camera no fumatori, servire crostacei alla cena di gala"* → propone
Crostacei. Minore, c'è il pulsante Ignora, ma stessa causa della (b).

**Da decidere:** spezzare anche sulla virgola risolve (b) e (c) ma accorcia le frasi,
quindi va riprovato tutto il vocabolario. Vale la pena farlo prima o dopo aver visto
le note vere dell'hotel?

### 3. I form non dicono niente quando il salvataggio fallisce

Preferenze, intolleranze, nucleo e reclami fanno `if (status === 201) { ... }` senza
`else`: se la chiamata fallisce non succede **niente**. Campo pieno, nessun
messaggio, nessuna riga nuova.

*Dove:* `web/app.js:1557` (preferenze), `:2048` (intolleranze), `:1708` (nucleo),
`:2111` (reclami).

Il caso che lo fa scattare sul DB vero: nessun limite di lunghezza lato server, ma le
colonne sono limitate (`customer_intolerances.testo` è `NVARCHAR(200)`,
`customer_preferences.testo` `NVARCHAR(400)`, nucleo nome/cognome `NVARCHAR(80)`).
Solo il follow-up ha un controllo (`FOLLOWUP_MAX`). Sul mock una lingua di 5.000
caratteri viene salvata; sul DB vero l'INSERT verrebbe rifiutato e l'API risponderebbe
500 — senza che il form lo dica.

**Il silenzio però non dipende dalla lunghezza**: vale per qualsiasi errore, anche
rete assente o DB giù. Sulle intolleranze significa credere di aver registrato
un'allergia che non c'è.

---

## 🟡 Aperti — validazione e casi limite

### 4. La fusione accetta valori non numerici e codici inesistenti

`intParam` usa `Number(v)`, e `Number(true)` = 1, `Number("")` = 0, `Number([])` = 0:
tutti interi validi. In più non si verifica che i codici esistano in `Anagra`.

```bash
POST /api/clienti/1003/merge {"memberId":true,"canonicalId":1003}     # 201
POST /api/clienti/1003/merge {"memberId":"","canonicalId":1003}       # 201
POST /api/clienti/1003/merge {"memberId":555555,"canonicalId":1003}   # 201
```

Il banner poi dice "Scheda fusa — dati aggregati su 4 anagrafiche" ma ne elenca una, e
il pulsante per scollegare esiste solo per quelle mostrate: **i codici fantasma non si
tolgono dall'interfaccia**. Entrano in ogni query di gruppo (preferenze, intolleranze,
reclami, soggiorni, nucleo).

*Dove:* `src/api/clienti.js:28`, `:117-125`; `web/app.js:1770-1784`.

### 5. Gestione utenti: successo dichiarato su utenti inesistenti

| Chiamata (da admin) | Risposta | Atteso |
|---|---|---|
| `PATCH /api/admin/users/99999 {"nome":"Fantasma"}` | `200 {"ok":true}` | 404 |
| `DELETE /api/admin/users/99999` | `200 {"ok":true}` | 404 |
| `POST /api/admin/users {"username":"   ", ...}` | `201`, username di soli spazi | 400 |
| `PATCH /api/admin/users/3 {"username":12345}` | `200`, username numerico | 400 |

*Dove:* `src/api/admin.js:54-92`, `:94-112`; `src/crm/users.js:38-49`.

Sul DB vero `username` è `NVARCHAR(50) NOT NULL UNIQUE`: uno username di soli spazi o
numerico ci entra, e poi con quell'account non si fa più login.

### 6. Nessun controllo che il cliente esista, e valori non stringa

```bash
POST /api/clienti/987654/complaints {...}                    # 201 su un codice inesistente
POST /api/clienti/1001/complaints {"testo":{"a":1}, ...}     # 201 -> testo "[object Object]"
```

*Dove:* `src/api/clienti.js:230-245`, e uguale per preferenze `:362-376`, intolleranze
`:292-299`, nucleo `:419-431`, profilo `:311-338`.

### 7. Il CSV dell'export non neutralizza le formule

`campoCsv` (`web/export.js:155-158`) quota solo se il testo contiene `"`, `;` o a capo.
Un valore che inizia con `=`, `+`, `-`, `@` arriva a Excel tale e quale e viene
valutato. Le note della prenotazione sono testo libero che viene dal PMS.

### 8. JSON malformato → 500 invece di 400

Il `SyntaxError` di `express.json()` finisce nel gestore generico
(`src/app.js:50-53`). Nessun dettaglio interno trapela, ma un errore del client viene
contato come guasto del server e riempie i log di stack.

### 9. `#cliente/` senza codice blocca la scheda sul caricamento

`route()` fa `loadCliente(hash.split('/')[1])` → stringa vuota → `GET /api/clienti/`
non dà 400, finisce sulla rotta di ricerca e risponde `200 {"risultati":[]}`.
`loadCliente` schianta su `d.anagrafica.nominativo` e la vista resta ferma su
"Carico la scheda ospite…".

*Dove:* `web/app.js:163`, `:1165-1171`; `src/api/clienti.js:42-47`.

### 10. Il contatore degli arrivi mente quando il filtro non trova nulla

Con 5 arrivi e un filtro che non seleziona niente, il messaggio dice "Nessun risultato
per il filtro." ma l'indicatore continua a dire "5 arrivi". Quando il filtro trova
qualcosa dice correttamente "1 di 5".

*Dove:* `web/app.js:458-462`; stessa forma in `renderInCasa`, `:838-842`.

---

## 🔧 Solo mock — ci impedisce di collaudare

### 11. La salvaguardia "almeno un admin attivo" va in 500 in sviluppo

`src/crm/users.js:61` usa `SELECT COUNT(*) AS n`, `scripts/dev-mock.js:287` riconosce
`COUNT(1) AS n`. Il mock non combacia, restituisce `[]`, e `rows[0].n` esplode.
Sul DB vero `COUNT(*)` restituisce sempre una riga, quindi il crash non esiste — ma
**in sviluppo non si può declassare, disattivare o eliminare nessun admin**, e quella
regola non è provabile né a mano né in un test che usi il mock.

Sempre solo-mock: `GET /api/admin/users` restituisce anche `password_hash`, perché il
finto DB rimanda l'oggetto intero. La query vera (`src/crm/users.js:21`) non seleziona
quella colonna.

---

## Aree controllate e risultate solide

Serve saperlo, per non ricontrollarle domani.

- **XSS.** Iniettati `<img src=x onerror=…>`, `<svg onload=…>`, `"><script>` in
  preferenze, intolleranze, reclami, note personali, lingua, nome e nota del nucleo,
  poi ispezionato l'HTML renderizzato: tutto neutralizzato. `esc()` è applicato con
  disciplina anche negli attributi `title`/`data-*`, nel foglio di stampa e nelle card.
- **Login, logout, sessione.** Senza cookie tutto 401; credenziali errate non
  distinguono utente inesistente da password sbagliata; cookie riusato dopo logout 401;
  `username` come oggetto o array non aggira il controllo.
- **Matrice permessi sui percorsi normali.** 18 rotte × 2 ruoli: `lettore` prende 403
  su tutte le 15 scritture e sulle 3 admin, `reception` scrive tutto e prende 403 sulle
  3 admin. L'impianto "il metodo HTTP decide" è corretto: cadeva solo sul case.
- **Liste chiuse.** Reparto, categoria, ambito, relazione e ruolo fuori elenco → 400.
- **Salvaguardie sul proprio account.** Un admin non può cambiarsi ruolo, disattivarsi
  o eliminarsi.
- **Date.** `?data=xxx` e `?data=2026-99-99` → 400; le frecce avanti/indietro calcolano
  in UTC e non sfasano di un giorno.
- **`src/pms/importo.js`.** Gradini della pianificazione, trascinamento dell'override e
  camere in parallelo tornano.
- **`src/crm/incasa-brief.js`.** Ordinamento delle camere e conteggio delle notti
  corretti.
