# Dashboard Analytics CRM — Analisi dei dati disponibili e proposta

> Documento di **analisi e proposta**. Non è implementazione: alla data di scrittura
> non è stata scritta una riga di codice.
>
> Il ticket chiedeva esplicitamente di analizzare prima cosa esiste davvero nel
> modello dati e di **non** costruire KPI privi di dati affidabili. L'analisi ha
> mostrato che una parte consistente della dashboard richiede query aggregate nuove
> sul PMS — impossibili da validare fuori dalla rete dell'hotel, dove il server di
> sviluppo riconosce le query per espressione regolare senza eseguirle.
> **Decisione (Mik, 2026-08-10): si implementa in hotel, col DB davanti.**

## 1. Cosa è calcolabile ed esatto OGGI (solo DB CRM)

Sono tabelle di cui controlliamo lo schema: nessuna incognita, numeri verificabili.

| Ambito | Fonte | KPI ottenibili |
|---|---|---|
| Preferenze | `customer_preferences` (`created_at`, `reparto`, `categoria`, `ambito`, `testo`, `autore_user_id`) | raccolte nel periodo, distribuzione per reparto/categoria/ambito, Top 10 testi, clienti distinti toccati, andamento nel tempo |
| Complaint | `customer_complaints` (`created_at`, `resolved_at`, `stato`, `follow_up`) | ricevuti, risolti, aperti a oggi, % risoluzione, **giorni medi di risoluzione**, copertura follow-up, andamento |
| Qualità CRM | tutte le tabelle `customer_*` | clienti con almeno una preferenza / con note personali / con intolleranze / con nucleo mappato |
| Duplicati | `customer_merge` + `getTuttiGruppiDuplicati` | gruppi ancora da gestire, già fusi (riusa `separaGruppiDuplicati`) |
| Operatori | `autore_user_id` ovunque | chi sta alimentando il CRM e con cosa |

Il filtro temporale funziona su tutto questo: ogni tabella ha `created_at`.

## 2. Cosa richiede query PMS NUOVE (da scrivere in hotel)

Nessuna di queste esiste oggi a livello hotel: le query disponibili sono per
singolo cliente o per singola data.

- Ospiti unici nel periodo, **nuovi vs returning**, soggiorni, notti.
- VIP (`Anagra.CodVip`), nazionalità/provenienza (`Anagra.CodNaz`, `Citta`).
- Top consumi F&B e SPA a livello hotel (oggi: `getGustiFB` e `getTrattamentiSpa`,
  entrambi per lista di clienti).

⚠️ Il rischio concreto non è l'errore SQL — è il **doppio conteggio** fra prenotazioni
correnti (`Prenota`) e concluse (`StorPrenota`), che produce numeri plausibili ma
sbagliati. Già incontrato in `getStoricoByIds`, risolto con `COUNT(DISTINCT codpratica)`.

## 3. Cosa NON è calcolabile: manca proprio il dato

Questa è la parte più importante del documento.

### 3.1 Utilizzo AI — sezione 5 del ticket: oggi vale zero
Briefing e suggerimenti finiscono solo in un `console.log` (`src/api/clienti.js`).
Nessuna tabella, nessuno storico. **Nessun** KPI della sezione è calcolabile:
generati, accettati, scartati, acceptance rate, note generate.

Serve una tabella `ai_events` (tipo evento, cliente, utente, esito, timestamp) più
la strumentazione nelle tre rotte AI. I numeri partirebbero dal giorno del deploy:
**il passato non è recuperabile**, quindi ogni giorno di attesa è dato perso.

### 3.2 Preferenze manuali vs generate dall'AI
Una preferenza confermata da un suggerimento passa dalla **stessa POST** di una
scritta a mano (`POST /clienti/:id/preferenze`): non c'è marcatore di origine.
Distinguerle a posteriori è impossibile — serve una colonna `origine` da qui in avanti.

### 3.3 Tipologia / reparto del complaint
`customer_complaints` ha solo `testo` libero e `periodo`. "Complain per categoria" e
"tipologie più frequenti" richiedono un campo nuovo (o una classificazione AI del
testo, che è un'altra evolutiva).

### 3.4 Andamento delle note personali
`customer_profile` ha **un solo `updated_at` per riga**, condiviso fra lingua e note
personali: modificare la lingua sposterebbe la data della nota. Il **totale** dei
profili con note è esatto; l'**andamento nel tempo** no.

## 4. Proposta di struttura (5 domande → 5 blocchi)

1. **Chi sono i nostri clienti** → PMS (§2)
2. **Cosa sappiamo di loro** → preferenze + qualità CRM (§1)
3. **Che problemi hanno e come li gestiamo** → complaint (§1), incluso il follow-up
4. **Quanto contribuisce l'AI** → richiede §3.1
5. **Quanto è completa la nostra conoscenza** → qualità CRM (§1)

Filtro periodo: 7g / 30g / 3 mesi / 12 mesi / personalizzato, con confronto al
periodo precedente dove ha senso (grandezze di flusso: preferenze raccolte,
complaint ricevuti — non sugli indicatori di stock come "clienti con preferenze").

KPI navigabili come chiede il ticket: complaint aperti → elenco, duplicati →
Gestione Duplicati, preferenza → clienti che la hanno.

**Insights AI (fase successiva)**: l'architettura regge, a una condizione — l'AI
deve ricevere **solo aggregati già calcolati** e commentarli, mai produrre numeri.

## 5. Ordine consigliato al rientro in hotel

1. **`ai_events` + strumentazione** e **`origine` sulle preferenze**: migrazioni
   piccole, ma finché non ci sono si perde storico ogni giorno. Prima di tutto il resto.
2. Query PMS aggregate, scritte e verificate sul DB vero.
3. Dashboard vera e propria, partendo dai blocchi CRM (§1) che sono già certi.
