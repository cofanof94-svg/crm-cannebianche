# SPECS — CRM Direct Holiday · Fase 3: Preferenze intelligenti

- **Data:** 2026-08-03
- **Autore:** Mik
- **Stato:** Design — proposta (da approvare e pianificare)
- **Contesto:** La scheda ospite 360° è completa e verificata sui dati reali (anagrafica, storico prenotazioni con stati, cumulativi/LTV, note/complaints/preferenze/intolleranze/nucleo, brand Canne Bianche). Questa fase fa il salto dal **"quanto ha speso"** al **"cosa gli piace"**: capire i gusti dell'ospite e strutturarli, per un servizio personalizzato e per il marketing.

---

## 1. Obiettivo

Trasformare informazioni oggi **sparse e non strutturate** (note libere del gestionale, consumi al ristorante) in **preferenze strutturate del CRM** (`customer_preferences`, `customer_intolerances`, …), riducendo il lavoro manuale con un **assistente AI a conferma umana**.

Tre filoni complementari:
- **A. Consumi F&B** — cosa ordina davvero l'ospite (piatti, vini) → pattern di gusto.
- **B. Note anagrafica** — le preferenze già scritte in testo libero dagli operatori.
- **C. Assistente AI** — legge A+B e **propone** voci strutturate; l'operatore **conferma**.

## 1bis. Decisioni sui "gusti" (prese 2026-08-03)

- **Output = sintesi, non registro.** NON si salva ogni consumo: si salvano poche **preferenze ricorrenti** ("sempre vino bianco, mai carne rossa, caffè leccese"). Gli episodi isolati si scartano. Obiettivo: **pochi dati, corretti e sensati**, per un servizio 5 stelle.
- **Approccio ibrido (anti-allucinazione):** i **fatti** (conteggi/pattern) li calcola il sistema in modo deterministico dai dati PMS; l'**AI** li **sintetizza** in preferenze leggibili partendo da quei numeri (non inventa). L'**operatore conferma** prima del salvataggio.
- **Soglia:** basta una **forte prevalenza anche in un solo soggiorno** (non serve la ripetizione su più visite). Comunque *prevalenza*, non singolo ordine.
- **Pattern negativi inclusi:** "mai/evita X" (es. mai carne rossa). Da inferire solo con una **base minima di ordini** perché l'assenza sia significativa.
- **Ambito:** **F&B + SPA/trattamenti + note anagrafica**. → l'inclusione delle note rende **l'AI (filone C) centrale** e la **governance privacy un prerequisito** (vedi §5).
- **Granularità:** **categoria + tratto saliente** (es. "vini bianchi", "caffè leccese", "predilige pesce") → mappa su `customer_preferences` (reparto/categoria/testo).

### Cautele sulla qualità del dato (decise da gestire)
- **Attribuzione per camera, non per persona:** i consumi sono agganciati a `codalb` (camera/conto); con famiglie/coppie un consumo può essere di un accompagnatore. Attribuire con cautela / segnalare l'incertezza (rilevante soprattutto per i pattern negativi).
- **Escludere voci interne/omaggio:** welcome, complimentary, "proprietà/direzione", righe a 0€ → non sono gusti dell'ospite.

## 2. Fonti dati PMS (verificate sui dati reali il 2026-08-03)

### A. Consumi F&B (dettaglio ristorante/bar)
- **`Matura`** ha già `codser`, `codart`, `Descrizio`, `flgFoodBeverage`, `CodPortata` — a volte l'articolo è specifico (es. `codart='TE INFUSI'`), spesso è sintetico per reparto.
- **Dettaglio completo** nelle tabelle POS: `Comanda`, `ComandaDettCamere`, `ComandaDettTavoli`, `AddebitiComanda` (+ versioni `Stor*`). Qui c'è ogni singolo consumo.
- **`MagArtico`** = catalogo prodotti: `codart` → `desart`, con dettagli **enologici** (`Annata`, `Regione`, `Vitigno`, `Azienda`, `TipoBottiglia`) e `flgFoodBeverage`, gruppi merceologici. Permette di dare un nome/categoria ai consumi.
- **Aggancio all'ospite:** consumi → `codalb` (camera/conto) → prenotazione → `codclinterm`.

### B. Note anagrafica (già lette, sola lettura)
- **`Anagra.Annotazioni`, `Anagra.Memo`, `Anagra.Amenities`** contengono preferenze reali in testo libero. Esempio verificato (DE IACO 2117): *"gradiscono Coca Zero — come amenities frutta fresca (non prosecco)… lei vegetariana… cuscini in piuma d'oca… se divano letto aggiungere topper"*. Sono già Preferenze/Intolleranze, solo non strutturate.

### C. CRM esistente (destinazione)
- `customer_preferences` (reparto, categoria, testo), `customer_intolerances`, `customer_profile.lingua`, `customer_travel_party`, `customer_complaints`. Già pronte dalla Fase 2.

## 3. Cosa costruiamo

### A. Analisi consumi F&B (`pms/` sola lettura)
- Funzione che, per un `CodCli`, aggrega i consumi F&B (da `Comanda*`/`Matura` + `MagArtico`) in un **profilo di gusto**: es. categorie più frequenti (vini rossi, pesce, dolci), articoli ricorrenti, spesa F&B.
- Output usato sia in scheda (una sezione "Gusti / consumi F&B") sia come input per l'AI (C).

### B. Note anagrafica come fonte
- Le note già mostrate diventano anche **input strutturabile**: passate all'assistente AI (C) insieme al profilo consumi.

### C. Assistente AI "Suggerisci preferenze"
- Pulsante nella scheda ospite → il backend invia a un **LLM** (Claude) un prompt con: note anagrafica + profilo consumi F&B + tassonomie del CRM (reparti/categorie).
- L'LLM restituisce **voci candidate strutturate**: `{ tipo: intolleranza|preferenza, reparto, categoria, testo }` con eventuale confidenza e citazione della fonte.
- **Human-in-the-loop:** l'operatore vede i suggerimenti in una lista, **spunta/modifica/scarta**, e solo quelli approvati vengono inseriti nelle tabelle CRM (con autore = utente, + traccia "suggerito da AI").
- **Nessun inserimento automatico cieco.**

## 4. Architettura

```
Scheda ospite ──"Suggerisci preferenze"──▶ POST /api/clienti/:codCli/ai-preferenze
                                              │
                    ┌─────────────────────────┼──────────────────────────┐
                    ▼                         ▼                          ▼
        pms/ consumi F&B (SELECT)   Anagra note (SELECT)        crm/ tassonomie
                    └─────────────► prompt ◄──────────────────────┘
                                     │
                                 LLM (Claude) — estrazione strutturata
                                     │
                        lista suggerimenti (JSON) → UI conferma → INSERT su CRM
```
- Nuovo modulo `src/ai/` (client LLM + costruzione prompt + parsing risposta).
- Il PMS resta **sola lettura**; le scritture vanno solo sulle tabelle CRM esistenti.

## 4bis. Come si attiva (NON è in tempo reale)

Chiarimento importante: **l'AI non è "sempre in ascolto" e non registra i singoli ordini.** Gli ordini li scrive il PMS (POS ristorante → `Comanda*`); il CRM li **legge** (SELECT). L'analisi guarda i **pattern nel tempo**, non l'ordine singolo. Due modi possibili (scelta **da prendere**):

- **Su richiesta (pull):** l'operatore apre la scheda e clicca "Suggerisci preferenze" → analisi di *quel* cliente in quel momento → suggerimenti → conferma. Semplice, economico, conferma umana per natura.
- **Batch notturno:** un job (come l'import) pre-calcola i suggerimenti per i clienti con nuovi consumi; l'operatore li trova pronti da rivedere. Migliore alla scala.

In entrambi i casi: **mai per singolo ordine**, **mai inserimento automatico**.

## 5. Privacy e governance (da decidere PRIMA di costruire)

⚠️ **Punto cardine.** Inviare note e consumi a un LLM significa trattare **dati personali degli ospiti** con un servizio terzo. Da valutare con la Direzione/DPO:
- Base giuridica e informativa (i consensi GDPR sono già in anagrafica).
- **Minimizzazione:** inviare solo il testo necessario, evitando dati identificativi non indispensabili (pseudonimizzazione dove possibile).
- **Provider/deployment:** scelta del modello/hosting conforme; nessuna conservazione lato provider oltre il necessario.
- **Audit:** log di cosa è stato inviato e dei suggerimenti approvati.

Finché questo non è chiaro, si può partire dai filoni **A** e **B** (tutto interno, nessun LLM esterno) e attivare **C** solo dopo l'ok.

## 6. Modello AI

- Modello **Claude** (ultima generazione disponibile); scelta esatta e costi in fase di piano — la valutazione tecnica dell'API/modelli va fatta con la **reference `claude-api`** al momento dell'implementazione (non fissare qui un ID che invecchia).
- Estrazione strutturata via **tool use / output JSON** con schema fisso (tipo/reparto/categoria/testo), per risposte affidabili e parsabili.
- Umano sempre nel loop.

## 7. Fasi incrementali (proposta)

1. **A — Consumi F&B**: lettura/aggregazione dai Comanda + MagArtico, sezione "Gusti F&B" in scheda. *(interno, nessun LLM)*
2. **B — Note come fonte**: rendere le note anagrafica facilmente convertibili (anche solo copia rapida verso Preferenze). *(interno)*
3. **C — Assistente AI**: dopo l'ok privacy, il tool di suggerimento con conferma.

## 8. Aperti / decisioni da prendere

- Governance privacy per l'uso dell'LLM (blocca C, non A/B).
- Profondità dell'analisi F&B (solo categorie/pattern, o dettaglio articoli).
- Dove mostrare i "Gusti F&B": nuova sezione o dentro Preferenze.
- Tracciamento origine di una preferenza (manuale / AI / PMS).
- Volume/performance: l'analisi consumi su tanti Comanda può essere pesante → valutare pre-aggregazione (come per l'import).

## 9. Definizione di "fatto"

- Scheda ospite con un profilo **consumi/gusti F&B** derivato dal PMS.
- Un **assistente AI** che, su richiesta, propone preferenze/intolleranze strutturate a partire da note + consumi, con **conferma umana** prima di scrivere sul CRM.
- Governance privacy documentata e rispettata; PMS sempre in sola lettura.

---

**Prerequisiti tecnici già pronti (Fase 2):** tabelle `customer_preferences`/`customer_intolerances`, tassonomie (reparti/categorie), scheda ospite. **Da esplorare in fase di piano:** struttura esatta delle tabelle `Comanda*` e loro aggancio a `codalb`.
