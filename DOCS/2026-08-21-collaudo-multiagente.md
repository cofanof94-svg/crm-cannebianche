# Collaudo a più revisori — come si fa, e cosa ha trovato

**21/08/2026.** Prima di spingere ventuno commit su GitHub, l'intero blocco di
modifiche è stato passato a sei revisori indipendenti. Questo documento serve a
**rifarlo** la prossima volta, non a raccontare questa.

---

## Perché non basta `npm test`

La suite verifica che il codice faccia quello che i test dicono. Non verifica che
i test dicano la cosa giusta. Tre dei difetti più gravi trovati qui stavano
esattamente lì:

| Difetto | Perché la suite era verde |
|---|---|
| Il raggruppamento dello storico non funzionava | il test passava una mappa che copriva **tutti** gli id — condizione che in esercizio non si verifica mai |
| Il voucher regalo non stava in nessuna categoria | la fixture dell'invariante non conteneva un voucher |
| `keine Nussallergie` proponeva un'allergia alle noci | il test copriva solo la forma staccata, non quella composta, che in tedesco è la norma |

Un revisore che parte dal **comportamento** e non dai test trova queste cose. Un
test aggiunto da chi ha scritto la correzione, no: eredita gli stessi presupposti.

---

## La forma: sei revisori, poi una verifica

```
        ┌─ allergie ─────────┐
        ├─ fusioni e gruppi ─┤
        ├─ conteggi ─────────┤     ogni segnalazione
        ├─ rotte cliente ────┤ ──► viene RIPRODOTTA ──► correzione + test
        ├─ interfaccia ──────┤     prima di toccare
        └─ accessi e stats ──┘     una riga
```

**Un'area per revisore**, divisa per *dove fa male all'ospite*, non per cartella:
le allergie stanno insieme perché finiscono tutte in cucina, non perché stanno
nello stesso file.

**Nessuno dei revisori tocca il progetto.** Scrivono solo nella cartella
temporanea. Chi corregge è uno solo, e prima riproduce.

### Le regole date a ogni revisore

1. **Riproduci prima di riportare.** Uno script che chiama la funzione vera e
   stampa l'output sbagliato, oppure un ragionamento riga per riga che chiunque
   può seguire. Una sensazione non è un difetto.
2. **Niente falsi positivi.** Ciò che non si riesce a dimostrare va in una
   sezione a parte, "sospetti non dimostrati".
3. **Niente stile, niente buone pratiche.** Solo ciò che *si comporta male* per
   chi lavora in reception.
4. **Il server finto non valida il SQL** — lo riconosce per espressione regolare.
   Una query nuova va **letta**, non provata.
5. Ogni difetto porta: file e riga, cosa vede l'operatore, la prova, la gravità.

L'ultima regola è quella che regge tutto: **"cosa vede l'operatore"** costringe a
tradurre un difetto in una scena. Se la scena non si riesce a scrivere, spesso il
difetto non c'è.

### Cosa fa chi coordina

- **Riproduce ogni segnalazione da solo**, prima di correggere. Qui una
  segnalazione su cinque si è rivelata un difetto **preesistente** e non una
  regressione: la distinzione cambia cosa si corregge e cosa si decide con Mik.
  Il modo più rapido di stabilirlo è confrontare con la versione precedente:

  ```
  git show origin/main:src/crm/allergie-note.js > prima/allergie-note.js
  ```
  e far girare gli stessi casi sulle due versioni. La tabella *prima / adesso*
  dice da sola se abbiamo rotto qualcosa o se era già così.

- **Prova al contrario** su ogni test nuovo: mettere da parte la correzione,
  lasciare il test, verificare che diventi **rosso**. Un test che passa anche
  senza la correzione non difende niente.

- **Verifica a schermo** ciò che i revisori non possono toccare (a nessuno di
  loro è permesso avviare il server): la porta resta a chi coordina.

---

## Come si rilancia

Sei richieste, tre alla volta. Ognuna contiene: il contesto tecnico, l'elenco dei
file dell'area, i commit da revisionare, cosa cercare in particolare, le cinque
regole, il formato della risposta.

I commit da revisionare si prendono così:

```bash
git log origin/main..main --oneline
```

Tre alla volta e non sei: sei in parallelo avevano già esaurito la sessione una
volta.

---

## Esito del 20-21/08/2026

Ventuno commit, ventotto file. **Diciassette difetti dimostrati**, di cui sette
regressioni nostre. Tutti chiusi. Da 593 a 622 test.

I tre che valeva la pena trovare:

**In cucina, in due direzioni opposte.** `Keine Nussallergie` — la forma normale
in tedesco — proponeva un'allergia alle noci a chi scriveva di *non* averla: la
scomposizione del composto staccava la sostanza dal marcatore e la negazione non
combaciava più. E all'opposto, «Allergica al pesce, non ha altre allergie» non
proponeva niente: la negazione in coda zittiva l'allergia dichiarata prima.

**Il badge che funzionava solo nei test.** La correzione del 20/08 leggeva la
storia sul gruppo, ma la mappa dei gruppi arriva indicizzata sui codici del
giorno mentre la storia si chiede su tutti i membri: funzionava solo per le
coppie con la pratica intestata al codice più alto. Per il gruppo Brolin, "3ª
volta" invece di "5ª".

**Un sottoinsieme più grande dell'insieme.** La spunta "Solo ospiti VIP" contava
ogni ordinazione una volta **per occupante VIP** della camera. Con la spunta i
numeri potevano essere più alti che senza.

Nessuna di queste tre si vedeva dalla suite verde.
