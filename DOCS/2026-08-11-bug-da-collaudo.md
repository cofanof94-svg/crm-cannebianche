# Bug trovati nel collaudo dell'11/08/2026

Giro sistematico su tutta l'applicazione: lettura del codice, chiamate alle API con
curl per ciascun ruolo, tentativi di aggirare i permessi. Fatto contro il server di
sviluppo con dati finti (`npm run dev:mock`), quindi il DB dell'hotel non è stato
toccato.

## Stato: **tutti chiusi** (12/08/2026)

Undici problemi più quello di sicurezza. Ognuno corretto con almeno un test che
riproduce il caso originale, così se torna lo si vede subito.

Restano da verificare **con i dati veri dell'hotel** (vedi
`2026-08-11-checklist-rientro-in-hotel.md`): il vocabolario delle allergie contro le
note reali, e i limiti di lunghezza sui campi, che qui sono provati contro il finto
database.

---

## Sicurezza

### ✅ Una maiuscola nell'URL rendeva chiunque amministratore — `276205d`

Express instrada senza guardare le maiuscole (`case sensitive routing` è spento di
serie), le regole della guardia invece le guardavano. `/api/ADMIN/users` arrivava al
router degli utenti senza combaciare con `/^\/admin/`, ricadeva sulla regola generica
"il resto è scrivere", e chiunque potesse scrivere passava. **La reception si creava
un amministratore** e ci faceva login.

Corretto normalizzando il percorso prima del confronto. Sondate anche percento-codifica,
doppia barra, punto e barra finale: non arrivavano al router, il caso era l'unico.
Due test, uno sulla funzione pura e uno che rifà l'attacco dalle API — quest'ultimo
serve, perché il problema stava proprio fra chi instrada e chi decide.

---

## Dove l'applicazione dichiarava un successo che non c'era

Erano i tre peggiori: non è che una funzione mancasse, è che **mentiva**.

### ✅ Su una scheda fusa la nota personale non si cancellava — `c669977`

La lettura prende il primo valore non nullo di tutto il gruppo di fusione, la
cancellazione svuotava una riga sola: la nota di un altro codice riaffiorava e il
testo tornava a video. Valeva anche per la lingua.

**Decisione di Mik: la nota è della persona**, quindi Elimina cancella su tutto il
gruppo. Conseguenza accettata: dopo uno "Scollega" quell'anagrafica non ritrova la
sua vecchia nota. La modifica non è stata toccata, funzionava già.

### ✅ Le proposte di allergie inventavano termini e ne perdevano di vere — `8c78fc9`

Tre difetti in `src/crm/allergie-note.js`:

- **"Ca" proposto come allergia.** Non trovando una sostanza dopo il marcatore, la
  regex ripiegava dentro la parola stessa e ne prendeva la coda. Un `\b` lo rende
  impossibile. Buttate anche le code che sono ordini di servizio: *"allergica:
  verificare in cucina"*.
- **Un'allergia vera spariva dopo una negazione.** *"Il bambino non ha allergie ma la
  madre è allergica al lattosio"* non proponeva niente: una frase sola, la negazione
  iniziale la scartava tutta. Ora si spezza anche sulle avversative.
  **Non sulla virgola**, benché sembri la mossa ovvia: *"Allergia a noci, arachidi e
  mandorle"* diventerebbe tre pezzi e le sostanze dopo la prima perderebbero il
  marcatore. Si perderebbero gli elenchi. C'è un test che lo fissa.
- **"no" e "senza" contavano a qualsiasi distanza.** *"Camera no fumatori, servire
  crostacei"* proponeva Crostacei. Ora i marcatori sono di due forze: i deboli valgono
  solo se attaccati alla sostanza, al massimo due parole e nessuna virgola.

### ✅ I form non dicevano niente quando il salvataggio falliva — `90b819e`

`if (status === 201) { … }` senza `else`: campo pieno, nessun messaggio, nessuna riga.
Sulle allergie significava credere di aver registrato un dato di sicurezza che non
c'è. Ora ognuno dice cosa non è riuscito, e che il testo è rimasto nel campo.

Corretta anche la causa che lo faceva scattare con il DB vero: **nessun tetto di
lunghezza lato server** mentre le colonne ce l'hanno (allergia 200, preferenza 400,
nome 80, nota 400, lingua 40, periodo 60). Ora è un 400 che dice quanto ci sta e
quanto è stato scritto, invece di un 500 dal database.

---

## Validazione e casi limite

### ✅ La fusione accettava valori non numerici e codici inesistenti — `f3bc3f2`

`Number(true)` è 1, `Number('')` e `Number([])` sono 0: passavano tutti per interi
validi, e nessuno controllava che il codice esistesse. Il gruppo si riempiva di
codici fantasma che sporcavano ogni query per gruppo e **dall'interfaccia non si
toglievano**, perché il pulsante per scollegare c'è solo per le anagrafiche visibili.
Ora `intParam` accetta solo cifre, e la fusione verifica che entrambe le anagrafiche
esistano in `Anagra`.

### ✅ Gestione utenti: successo dichiarato su utenti inesistenti — `f3bc3f2`

`PATCH` e `DELETE` su un id inventato rispondevano `200 {"ok":true}`. Ora 404.
Lo `username` passava senza controlli: soli spazi, numerico, o più lungo della
colonna (`NVARCHAR(50)`) — con un account così non si fa più login.

### ✅ Formule nel CSV dell'export — `7d640d4`

Un valore che inizia per `=` `+` `-` `@` veniva valutato da Excel all'apertura. Le
note arrivano dal PMS, cioè da testo che scrive chiunque. Ora davanti va un apostrofo,
che Excel legge come "questo è testo" e nella cella non si vede.

### ✅ JSON malformato → 500 invece di 400 — `7d640d4`

Errore di chi chiama, non guasto del server. Contava anche perché i 500 veri si
notano solo se sono rari.

### ✅ `#cliente/` senza codice bloccava la scheda — `7d640d4`

La richiesta finiva sulla rotta di ricerca, che risponde 200 con un elenco vuoto, e
il render andava in errore su un'anagrafica che non c'era: vista ferma su "Carico…"
finché non si cambiava pagina.

### ✅ Il contatore mentiva quando il filtro non trovava nulla — `7d640d4`

Diceva "5 arrivi" con zero risultati a schermo: sembrava che i cinque fossero lì e la
pagina non li mostrasse. Ora "0 di 5", come già faceva quando il filtro trova
qualcosa. Stessa cosa per In casa.

### ✅ Solo mock: la salvaguardia "almeno un admin attivo" andava in 500 — `f3bc3f2`

Il finto database riconosceva `COUNT(1)`, la query vera usa `COUNT(*)`: non
combaciavano, tornava `[]` e `rows[0].n` esplodeva. In sviluppo non si poteva
declassare, disattivare o eliminare nessun admin, e quella regola non era provabile.
Tolto anche `password_hash` dall'elenco utenti del mock: la query vera non lo
seleziona, il finto database rimandava l'oggetto intero.

---

## Aree controllate e risultate solide

Serve saperlo, per non ricontrollarle.

- **XSS.** Iniettati `<img src=x onerror=…>`, `<svg onload=…>`, `"><script>` in
  preferenze, intolleranze, reclami, note personali, lingua, nome e nota del nucleo,
  poi ispezionato l'HTML renderizzato: tutto neutralizzato. `esc()` è applicato con
  disciplina anche negli attributi `title`/`data-*`, nel foglio di stampa e nelle card.
- **Login, logout, sessione.** Senza cookie tutto 401; credenziali errate non
  distinguono utente inesistente da password sbagliata; cookie riusato dopo logout 401;
  `username` come oggetto o array non aggira il controllo.
- **Matrice permessi sui percorsi normali.** 18 rotte × 2 ruoli: `lettore` prende 403
  su tutte le 15 scritture e sulle 3 admin, `reception` scrive tutto e prende 403 sulle
  3 admin.
- **Liste chiuse.** Reparto, categoria, ambito, relazione e ruolo fuori elenco → 400.
- **Salvaguardie sul proprio account.** Un admin non può cambiarsi ruolo, disattivarsi
  o eliminarsi.
- **Date.** `?data=xxx` e `?data=2026-99-99` → 400; le frecce avanti/indietro calcolano
  in UTC e non sfasano di un giorno.
- **`src/pms/importo.js`.** Gradini della pianificazione, trascinamento dell'override e
  camere in parallelo tornano.
- **`src/crm/incasa-brief.js`.** Ordinamento delle camere e conteggio delle notti
  corretti.
