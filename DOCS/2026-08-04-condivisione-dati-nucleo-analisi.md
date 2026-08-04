# Condivisione informazioni tra membri della stessa prenotazione — Analisi (Fase 1)

> Documento di **analisi e proposta**. Non è implementazione. Deriva dalla richiesta
> "Analizzare la gestione delle informazioni associate ai membri della stessa prenotazione".

## 1. Cosa vede OGGI un co-occupante (dati reali)

Confronto holder **De Iaco Isabella #2117** vs suoi co-occupanti (famiglia Bebie):

| Dato | Holder #2117 | Bebie Nevio #2124 | Bebie Sienna #2125 |
|---|---|---|---|
| Soggiorni | 78 | 28 | 30 |
| Consumi F&B/Bar | 40 voci | **0** | **0** |
| Consumi SPA | 2 | **0** | **0** |

**Causa tecnica** (verificata nel codice):
- `SQL_SOGGIORNI` (`src/pms/clienti.js`) aggancia le pratiche via `codclinterm IN (…) OR Alberg.codcli IN (…)` → include l'ospite anche come **occupante** ⇒ i soggiorni sono già condivisi.
- `src/pms/gusti.js` e `src/pms/spa.js` filtrano **solo** via `codclinterm` (intestatario) ⇒ i consumi F&B/Bar/SPA restano attribuiti **solo all'intestatario**.

## 2. Classificazione dei dati

### A. Oggi associati solo all'intestatario (ma di fatto legati al soggiorno)
- Consumi **F&B / Bar** (comande per camera+data, ma catturate solo dalle pratiche dove il cliente è intestatario).
- Consumi **SPA** (via `codalb` delle pratiche dell'intestatario).
- Cumulativi economici che ne derivano (parte degli **Extra**, quindi dell'**LTV**).

### B. Naturalmente condivisi a livello di prenotazione (del soggiorno/nucleo)
- **Soggiorni/prenotazioni** condivise (già così).
- **F&B / Bar**: le comande sono per **camera** → non separabili per persona ⇒ dato **del nucleo** per natura.
- **Note PMS di soggiorno** riferite al gruppo (es. *"GLI OSPITI GRADISCONO COCA ZERO…"*).
- **Preferenze di camera/soggiorno** (vista mare, cuscini, topper) → riguardano il gruppo.

### C. Strettamente personali (per-persona)
- **Anagrafica**: nome, contatti, data di nascita, codice fiscale, città, nazione.
- **Consensi privacy (GDPR)**: individuali per legge.
- **VIP** (`CodVip` è su Anagra, per persona).
- **Intolleranze / allergie**: dato di **sicurezza del singolo** (l'allergia è di UNA persona, non del gruppo).
- **Preferenze personali** (es. *"lei vegetariana"*, *"predilige il massaggio Serenity"*).
- **Lingua preferita**.

### Il nodo ambiguo: SPA
- **F&B/Bar** è chiaramente **condiviso** (per camera, non attribuibile al singolo).
- **SPA** è addebitata su `codalb` = la **linea del singolo occupante** ⇒ è **potenzialmente personale** (attribuibile a chi ha ricevuto il trattamento), ma oggi sommata a livello prenotazione. Decisione da prendere in Fase 2 (vedi §5).

## 3. Proposta tecnica e funzionale

**Concetto chiave**: rendere esplicito l'**AMBITO** di ogni informazione — `personale` vs `condiviso (prenotazione/nucleo)` — e mostrarlo in scheda con etichette chiare, senza mischiare i due piani. Due meccanismi complementari.

### 3.1 Dati PMS (soggiorni, F&B, SPA) → condivisione via il grafo prenotazione↔occupanti
Il legame naturale è la **pratica** (`codpratica`): tutti gli occupanti la condividono.
- Estendere le query **F&B** e **SPA** ad agganciarsi anche via **occupante** (`Alberg.codcli`), non solo via `codclinterm` — come già fa lo storico soggiorni. Così un co-occupante vede i consumi del **soggiorno condiviso**.
- Etichettare questi dati come **"del soggiorno / nucleo"** (icona 👪), non come consumi personali del singolo.
- Non richiede nuove tabelle: si appoggia al legame occupanti già presente nel PMS.

### 3.2 Dati CRM (preferenze, note, ecc.) → attributo `ambito` per riga
- Aggiungere alle tabelle CRM un campo **`ambito`** enum: `personale` | `nucleo`.
- Default per tipo: **intolleranze → sempre `personale`** (sicurezza); **preferenze → default `personale`**, con possibilità di marcare "di nucleo" (es. vista mare); note → a scelta.
- Una preferenza `nucleo` inserita su un membro diventa **visibile (sola lettura, badge "condivisa dal nucleo") anche sugli altri membri**; una `personale` resta solo sul singolo.
- **Estendibile**: `ambito` è un attributo generico → qualsiasi tipo di dato futuro eredita il meccanismo.

### 3.3 Distinzione in UI
- In ogni sezione: badge **"Personale"** vs **"Del soggiorno/nucleo"** (👪).
- I dati condivisi mostrati sugli altri membri sono in sola lettura, con provenienza chiara (da quale membro / dal soggiorno).

### 3.4 Da cosa è definito il "gruppo"
- **Dati PMS**: dal **grafo occupanti** (chi condivide una pratica) — non serve il nucleo CRM.
- **Dati CRM `ambito=nucleo`**: dal **nucleo familiare** (`customer_travel_party`, con `pms_occupant_id`) già introdotto.
- La **fusione duplicati** (`customer_merge`) resta ortogonale (unifica la stessa persona, non persone diverse).

## 4. Estendibilità
- `ambito` come attributo generico sui dati CRM.
- Query PMS parametrizzate per **insieme di codici + insieme di pratiche** → aggiungere nuove fonti (spiaggia, garage, minibar…) segue lo stesso pattern.

## 5. Decisioni da prendere in Fase 2 (prima di implementare)
1. **LTV / economico**: mostrato pieno su ogni membro (valore del **nucleo**) o solo sull'intestatario (evitando il doppio conteggio della stessa pratica su più membri)?
2. **SPA**: la trattiamo come **condivisa** (del soggiorno) o proviamo ad **attribuirla al singolo** via `codalb` (chi ha ricevuto il trattamento)?
3. **Preferenze**: default `personale` con opt-in "nucleo", oppure il contrario?
4. Le informazioni condivise devono essere **modificabili da qualsiasi membro** o solo dal "proprietario"/intestatario?

## 6. Passi implementativi proposti (Fase 2, quando approvato)
1. F&B/SPA: aggancio anche per occupante → consumi del soggiorno visibili su tutti i membri, etichettati "del soggiorno".
2. Campo `ambito` sui dati CRM + badge UI personale/condiviso + condivisione delle preferenze `nucleo`.
3. LTV: separare "valore come intestatario" da "soggiorni del nucleo".
