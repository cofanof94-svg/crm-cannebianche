# Dashboard Analytics — cosa reggono i dati veri

- **Data:** 2026-08-13, misurato sul database dell'hotel
- **Oggetto:** i punti 1-4 dell'"output atteso" del ticket: quali KPI si possono
  calcolare in modo affidabile, quali no, e che forma dare alla dashboard.
- **Metodo:** interrogazioni di sola lettura su `HolidaySQL` (PMS) e
  `HolidayCanneBianche_CRM`. Nessun numero di questo documento è stimato.

---

## La cosa da sapere prima di tutte le altre

**Il CRM è quasi vuoto. Il gestionale è pieno.** È l'unico fatto che conta per
decidere che forma dare alla dashboard.

| Dove | Quanto materiale |
|---|---|
| `customer_preferences` | **64 righe**, su **14 clienti distinti** |
| `customer_intolerances` | 16 righe, 13 clienti |
| `customer_complaints` | **2 righe**, 2 clienti |
| `customer_profile` (note personali) | 3 clienti |
| `ai_events` | 0 — si raccoglie **da stasera** |
| `crm_accessi` | 0 — si raccoglie **da stasera** |

Tutto scritto fra il 30 luglio e oggi, **da un solo utente** (`admin`, cioè Mik)
durante le prove. Nel frattempo il gestionale contiene **81.792 anagrafiche** e
circa **2.400 soggiorni l'anno**.

Tradotto: una dashboard costruita sui dati del CRM oggi mostrerebbe riquadri con
dentro "14", "2", "0". Non sarebbe sbagliata — sarebbe **vera e inutile**.

Questo non è un motivo per rimandare, è un motivo per **cambiare la domanda** che
la sezione CRM deve porre. Non "cosa dicono i dati raccolti", ma **"quanto ne
stiamo raccogliendo"**: è la misura dell'adozione, ed è utile dal primo giorno
proprio perché parte da zero.

---

## 1. Quello che regge già oggi (dal gestionale)

### Clienti e soggiorni

| | 2022 | 2023 | 2024 | 2025 | 2026 (a oggi) |
|---|---|---|---|---|---|
| Soggiorni | 2.229 | 2.411 | 2.400 | 2.382 | 1.505 |
| Ospiti distinti | 2.114 | 2.255 | 2.293 | 2.274 | 1.430 |

Serie stabile e lunga: regge trend, confronto col periodo precedente e tutti i
filtri temporali chiesti dal ticket.

> ⚠️ **Attenzione, e non è teorica**: "soggiorno" deve significare **1-200
> notti**. Contando tutte le pratiche si includono 12.492 giornate e 79 voucher
> annuali, ed è esattamente l'errore che oggi faceva dire al badge "Nª volta" che
> 5.363 ospiti erano di ritorno senza aver mai dormito qui.

### Dimensioni per filtrare e segmentare

| Campo | Popolato | Utilizzabile? |
|---|---|---|
| Nazionalità | 65.422 / 81.792 (**80%**) | **Sì.** USA 1.185, Italia 916, GB 797 fra chi ha soggiornato dal 2024 |
| Classificazione VIP | 6.835 anagrafiche, **27 categorie descritte** | **Sì**, ed è la dimensione più ricca: da "BOLLICINE + FRUTTA FRESCA" (2.937) a "PERSONAGGIO FAMOSO" (5) |
| Source / canale | completo | **Sì**: Diretti 1.755, OTA 1.025, Tour Operator 649, GDS 241, Agenzie 224 (2025) |
| Data di nascita | 57.129 (70%) | Sì per fasce d'età, con la riserva del 30% mancante |
| Email | 27.300 (**33%**) | **No come dimensione**, sì come indicatore di qualità (vedi sotto) |
| Telefono | 27.376 (**33%**) | Idem |

### Consumi — la sezione più ricca, e oggi non esiste da nessuna parte

Negli ultimi 12 mesi: **90.236 righe di consumo su 1.052 articoli distinti**.

| Articolo | Volte | Euro |
|---|---|---|
| Acqua naturale | 6.812 | 20.128 |
| Amouse bouche | 3.836 | 2.072 |
| Caffè | 2.203 | 13.383 |
| Aperol Spritz | 1.319 | 36.956 |
| Insalata mista | 1.271 | 12.383 |
| **Coca Cola Zero** | 1.033 | 7.874 |

SPA, misurata a parte (non passa dalle comande ma dagli extra): Percorso Interni
692, Serenity 332, Decontratturante 293, Percorso Acqua 153.

Nel ticket la Coca-Cola Zero compare come **esempio inventato** di insight. È un
dato vero, e il taglio "fra i clienti VIP" è calcolabile: la classificazione VIP
sta sull'anagrafica e il consumo si aggancia al soggiorno.

---

## 2. Quello che NON regge, e perché

Il ticket chiede esplicitamente di segnalarlo.

| Metrica chiesta | Perché non regge oggi |
|---|---|
| **Acceptance rate dell'AI** | Zero eventi fino a stasera. Fra qualche settimana avrà senso; oggi mostrerebbe 0/0 |
| **Preferenze manuali vs AI** | Le 64 esistenti hanno origine `NULL` e non sappiamo come sono nate. Solo le nuove porteranno l'informazione |
| **Complain per categoria / reparto** | Due reclami in tutto, **entrambi non classificati**. Una "percentuale di risoluzione" su 2 casi è un numero che sembra preciso e non lo è |
| **Preferenze più frequenti** | 64 righe su 14 clienti, 50 delle quali in un solo reparto. Una Top 5 qui descrive le prove di Mik, non gli ospiti |
| **Note personali generate con AI** | 3 profili. Stesso problema |
| **Metriche economiche aggregate** | Gli importi sono validati **per singolo cliente** (BUG-006, luglio). A livello aggregato non sono mai stati confrontati con la contabilità: prima di esporre un "valore storico dell'hotel" va fatto quel confronto, altrimenti si pubblica un numero che nessuno ha verificato |

---

## 3. La forma che propongo

Due blocchi, perché rispondono a due domande diverse e hanno dati di qualità
molto diversa. Tenerli separati evita che i riquadri vuoti del secondo facciano
sembrare inaffidabile il primo.

### Blocco A — «I nostri ospiti» (dal gestionale, pieno da subito)

- **KPI**: ospiti unici · soggiorni · nuovi vs di ritorno · VIP · notti medie,
  ciascuno con il confronto sul periodo precedente.
- **Da dove arrivano**: canale (Diretti / OTA / TO / GDS / Agenzie).
- **Da dove vengono**: prime 8 nazionalità.
- **Cosa consumano**: Top 10 F&B e Top 8 SPA, filtrabili per VIP / non VIP.

### Blocco B — «Quanto conosciamo gli ospiti» (il CRM, parte da zero)

Non KPI di business ma **di copertura**, cioè quanto del patrimonio informativo
è stato costruito:

- clienti dell'anno **con almeno una preferenza** — oggi 14 su 2.274, cioè
  **0,6%**. È il numero da far salire, e vederlo salire è il senso della sezione;
- clienti con allergie registrate, con note personali;
- **anagrafiche incomplete**: senza email (67%), senza telefono (67%) — questo è
  un dato pieno e azionabile fin da subito, ed è l'indicatore di qualità più
  onesto che abbiamo;
- duplicati ancora da gestire;
- **uso dell'applicazione**: accessi per utente e per giorno, dal registro di
  stasera. È la risposta a "lo stanno usando?".

### Cosa lascio fuori dalla prima versione

Reclami e AI restano **due riquadri soli** con il conteggio grezzo, senza
percentuali né grafici, finché non ci sono abbastanza righe. Meglio un numero
piccolo e onesto di una torta costruita su due casi.

### Filtri

Periodo (7 / 30 giorni, 3 / 12 mesi, personalizzato) su tutto. In più **VIP /
non VIP** e **canale**, che sono le uniche due dimensioni con dati abbastanza
pieni da non produrre fette vuote. Nazionalità come vista, non come filtro.

### Navigabilità

Come chiede il ticket: dai riquadri si arriva alle liste già esistenti —
duplicati alla pagina Duplicati, reclami aperti all'elenco, un articolo di
consumo ai clienti che l'hanno ordinato.

---

## 4. Sulla fase «AI Insights»

L'architettura la permette senza cambiamenti: gli insight leggerebbero gli
aggregati già calcolati da questa dashboard, non il database. È la stessa
regola del briefing — l'AI interpreta ciò che le si mette davanti, non va a
cercarselo.

Ha però lo stesso limite di tutto il blocco B: finché i numeri sono 14 e 2, un
insight non ha niente da dire.
