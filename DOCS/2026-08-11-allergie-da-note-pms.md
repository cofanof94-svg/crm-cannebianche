# Allergie proposte dalle note PMS — Design e regole

> Funzionalità **consegnata** l'11/08/2026 (commit `f7e2410`), in prova.
> Documento di riferimento per capire cosa fa, perché è fatta così, e cosa
> rivalutare dopo i test sul campo.

## 1. Cosa fa

Legge la nota libera della prenotazione (`Prenota.Note`, già presente nei dati
che le pagine Arrivi e In casa caricano) e **propone** le allergie/intolleranze
che vi riconosce. Le proposte compaiono nella card, con la frase da cui nascono,
un menu per scegliere a chi attribuirle e i pulsanti *Aggiungi* / *Ignora*.

**Non scrive nulla senza conferma.**

## 2. Le due decisioni di progetto

### 2.1 Proposta, non scrittura automatica
Il ticket chiedeva il popolamento automatico. È stato scartato per due motivi
osservati nelle note vere, nessuno dei quali si risolve con più codice:

- **Attribuzione.** La nota è della *pratica*, non della persona. «La signora è
  celiaca» in una prenotazione con quattro ospiti non dice quale signora.
  Scriverla d'ufficio sull'intestatario può mettere l'allergia sulla persona
  sbagliata — peggio del non averla, perché sposta l'attenzione della cucina sul
  commensale sbagliato. Il menu di scelta risolve esattamente questo.
- **Negazione.** «Il bambino NON è allergico alle arachidi» si scrive davvero.

Effetto collaterale gradito: il requisito "evitare sovrascritture e
duplicazioni" è soddisfatto per costruzione.

### 2.2 Regole, non AI
Il vocabolario è di ~20 termini. Le regole sono istantanee, gratuite e
**spiegabili**: la proposta mostra la frase, l'operatore giudica in due secondi.
L'AI resta una possibile fase 2, ma da decidere su falsi negativi reali.

## 3. Le regole in breve

`src/crm/allergie-note.js` — funzione pura, 13 test in `test/allergie-note.test.js`.

| Nota | Esito | Regola |
|---|---|---|
| `Allergia alle arachidi` | ⚠ Arachidi | marcatore + sostanza |
| `La signora è celiaca` | ⚠ Celiachia | termine autonomo |
| `Gradisce la torta alle noci` | — | sostanza **senza** marcatore |
| `Non è allergico alle arachidi` | — | negazione |
| `I genitori non hanno altre allergie` | — | negazione con aggettivo in mezzo |
| `No glutine` | ⚠ Glutine | il "no" cade sulla **sostanza** |
| `No allergie` | — | il "no" cade sull'**allergia** |
| `Allergica ai pollini di betulla` | ⚠ Pollini di betulla | sostanza fuori elenco |

- **Sostanze** (glutine, lattosio, arachidi, crostacei, nichel, lattice…): valgono
  solo con un **marcatore** nella stessa frase (allergia, intolleranza, senza,
  evitare, niente, no, vietato, non può).
- **Termini autonomi**: celiachia, favismo.
- La negazione si valuta **frase per frase**, così non contagia il resto.
- **Diete escluse di proposito** (vegetariano, vegano): non sono dati di
  sicurezza e sporcherebbero la card Allergie. Il loro posto sono le preferenze.

## 4. Ambito

Gira **solo** sulle note che Arrivi e In casa già caricano: arrivi della data
mostrata e presenti in questo momento. Il vincolo "niente popolamento massivo"
vale per costruzione, senza codice che lo imponga. Nessuna query nuova, nessun
job schedulato, nessuna migrazione.

## 5. Ciclo di vita di una proposta

| Azione | Durata |
|---|---|
| **Aggiungi** | definitiva: l'allergia è salvata e il server non la ripropone (confronto a livello di prenotazione) |
| **Ignora** | fino al ricaricamento dell'app (Set in memoria, chiave `pratica\|termine`) |
| nessuna azione | riappare a ogni caricamento della pagina |

## 6. Da rivalutare dopo i test

1. **Persistenza di "Ignora"**. Oggi dura quanto la sessione del browser. Se i
   falsi positivi tornano a scocciare ogni mattina serve una tabella
   (`customer_allergie_ignorate`) → migrazione → 🟡 da fare in hotel.
   Da decidere con dati d'uso, non per ipotesi.
2. **Vocabolario**. Ogni allergia scritta nelle note e NON riconosciuta va
   aggiunta a `SOSTANZE` in `src/crm/allergie-note.js` (con un test). È il modo
   più economico di migliorare la resa.
3. **Falsi positivi**. Se ne emergono di ricorrenti, prima di complicare le
   regole valutare se il problema è la frase o il marcatore.
4. **Annotazioni anagrafica** (`Anagra.Annotazioni`): oggi non lette. Sono
   per-persona, quindi senza il problema di attribuzione — basterebbe aggiungere
   la colonna alla query batch già esistente.
