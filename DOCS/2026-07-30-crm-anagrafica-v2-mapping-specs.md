# SPECS — CRM Direct Holiday · Anagrafica v2: mappatura desiderata → dati

- **Data:** 2026-07-30
- **Autore:** Mik (decisioni) · mappatura verificata sui dati reali
- **Stato:** Decisioni approvate — da qui derivano schema CRM e design import
- **Contesto:** Analisi del file desiderata `Anagrafica_CRM_v2.xlsx` (fogli "Legenda" + "Specifica campi", 48 campi) confrontato con lo schema reale dei due DB (PMS `HolidayCanneBianche` sola lettura, CRM `HolidayCanneBianche_CRM` read/write). Questo documento **congela le decisioni** prese; non è ancora un piano di implementazione.

---

## 1. Obiettivo

Stabilire, per ciascuno dei 48 campi desiderati, **da dove nasce il dato** e **chi lo scrive**, così da poter progettare: (a) le nuove tabelle del DB CRM per i dati manuali, (b) le letture PMS aggiuntive, (c) la strategia di import/snapshot. Il vincolo cardine resta invariato: **il PMS è in sola lettura** (garantito dai permessi del DB), quindi ogni campo "Import PMS" si può solo leggere, mai modificare.

## 2. Classi di disponibilità

- ✅ **Già in casa** — presente nei DB e già esposto/calcolato nell'app.
- 🟡 **In casa, non usato** — presente nel PMS, non ancora mostrato/derivato: basta leggerlo.
- 🟢 **Da creare (CRM)** — dato manuale nuovo: nuova tabella nel DB CRM.
- 🔴 **Non disponibile** — non presente e non ricavabile senza fonte esterna.

Conteggio finale: **20 ✅ · 18 🟡 · 5 🟢** (+ i punti risolti dalle decisioni §4).

## 3. Fonti dati confermate (verificate sui dati reali il 2026-07-30)

- **Anagrafica:** `Anagra` (PK `CodCli`). Campi utili non ancora usati: `Sesso`, `CodNazCittadinanza`, `CodVip` (codice), `Amenities`.
- **Prenotazioni:** `Prenota` ∪ `StorPrenota`. Ospite/referente = `codclinterm`. Campi chiave: `dtprenota` (booking window), `CodMotivo`, `ListaCodAmenities`, `DataEliminazione` (+ `Motivo`, testo libero).
- **Camera/occupanti:** `Alberg.codcli` (una riga per occupante) → nomi accompagnatori; camera = `COALESCE(AlbergDay.codcam, TipoPre.codcam)`; tipologia camera = `TipoPre.codtip` → lookup `Tipologie`.
- **Importi (maturato):** `Matura` ∪ `StorMatura` per `codalb`. Arrangiamento (`codarr` valorizzato) / Extra (`codarr` vuoto, non distinta). **City tax** = righe `codser = 'IMP'` ("City Tax del GG/MM"), oggi dentro gli Extra.
- **Tassonomie prenotazione (due, distinte):**
  - **Source** (canale vendita): `Prenota.CodSource` → `SourcePrenota` (DIRETTI / AGENZIE / T.OPERATOR / OTA / TRAVELCLUB / GDS / DMC).
  - **Mercato/segmento**: `Prenota.CodProvenienza` → `PrenotaProvenienze` (LEISURE INDIVIDUALI / GROUP / MEETING / CONGRESSI / INCENTIVE / SPA / EVENTO / CELEBRATION / FAM · PRESS TRIP / INFLUENCER…).
- **Commissioni OTA:** `Movcass.CommissioniEur` (per un eventuale ricavo netto futuro).
- **Trattamento:** `codarr` → `Arrangia`. **Consensi:** flag `Anagra.Privacy*` (logica invertita: `'S'` = NON autorizzato).

## 4. Decisioni approvate (sui punti dubbi)

1. **Lingua** → 🟢 **campo manuale nel CRM**. Il PMS non la memorizza sull'ospite (tabella `Lingue` vuota; nessun campo lingua su `Anagra`/`Prenota`).
2. **Mezzo comunicazione** → ❌ **rimosso** dai desiderata. Nel PMS `CodMezzoCom` è il canale di *arrivo* della prenotazione, non la preferenza di contatto; WhatsApp non esiste.
3. **Mercato** = `PrenotaProvenienze`; **Source** = `SourcePrenota`. Entrambi decodificati in nome esteso. Nota: il **portale OTA specifico** (Booking.com vs Expedia) non è distinto nel Source (solo "OTA" generico) → non disponibile in modo pulito.
4. **Stato prenotazione** → solo **Confermata / Completata / Cancellata**. **Cancellata** = `DataEliminazione IS NOT NULL`. **Nessun No-show**: il PMS non ha un flag dedicato e `Motivo` è testo libero inaffidabile.
5. **City tax** → **esclusa dai ricavi/LTV** (è tassa di passaggio). Filtro: `Matura.codser = 'IMP'`.
6. **Importo tot / LTV** → base = **lordo folio `Matura`** (arrangiamento + extra, **city tax esclusa**). Il **netto-OTA** (`Movcass.CommissioniEur`) è rimandato a un report finance separato.
7. **Architettura dati** → **ibrido**:
   - **Live** (lettura real-time PMS) per l'operativo: Arrivi, Clienti in casa, scheda ospite.
   - **Import periodico** nel CRM per: **storico prenotazioni**, **cumulativi** e **campi-snapshot** (VIP-prenotazione e Amenities congelati al momento del soggiorno — la lettura live non può fotografarli).

## 5. Esito per sezione del file desiderata

### Anagrafica
✅ Cod Cliente, Nome, Cognome, Data di nascita, Email, Tel, Consenso Privacy · ✅ VIP (flag; 🟡 il codice) · 🟡 Sesso, Nazionalità (join `Nazioni`) · 🟢 **Lingua** (manuale) · ❌ Mezzo comunicazione (rimosso) · 🔴 Data consenso (il PMS tiene il flag, non la data → eventualmente tracciata nel CRM).

### Relazione (tutti manuali → CRM)
🟢 Intolleranze · 🟢 Reparto preferenza · 🟢 Preferenze (categorizzate) · ✅ **Claim** = tabella `customer_complaints` già esistente (manca solo il "periodo indicativo": piccola aggiunta).

### Cumulativo (calcolati)
✅ N soggiorni (già; escludere Eliminate + record spazzatura StorPrenota) · 🟡 Notti totali, LTV, Spesa media soggiorno/rooms/servizi, Ultima Source. Tutti derivati dai soggiorni validi con la base importo di §4.6.

### Nucleo di viaggio
🟡 Nome/Cognome accompagnatori (da occupanti `Alberg`→`Anagra`, già usati negli "Ospiti in camera") · 🟢 Tipo relazione, Nota accompagnatore (manuali → CRM).

### Prenotazioni
✅ N pratica, Arrivo, Partenza, N notti, Camera, Trattamento, Pax, Note, Importo room (=Arrangiamenti), Importo servizi (=Extra) · 🟡 Dt prenotazione, Booking window (derivato), Source, Mercato, Motivo, Tipologia camera (join `Tipologie`), Amenities, Importo tot · Stato → §4.4 · VIP (prenotazione) → snapshot via import (§4.7).

## 6. Punti ancora aperti (da rifinire nei piani successivi)

- **VIP-prenotazione** come snapshot storico: richiede l'import (congela `Anagra.CodVip`/provenienza al momento del soggiorno).
- **"Periodo"** nei Claim: aggiungere un campo periodo/riferimento a `customer_complaints`.
- **Cumulativi robusti**: filtrare i record di servizio di `StorPrenota` (DOPPIA / test / prova / fittizia / ERRORE / edit — `Motivo` testo libero) per non gonfiare N soggiorni e LTV.
- **Import ibrido**: quali tabelle copiare, cadenza, chiave di sync, aggancio col live (design dedicato).

## 7. Definizione di "fatto" (per questo documento)

- Ogni campo dei desiderata ha una classe di disponibilità e una fonte decise.
- I punti dubbi hanno una decisione esplicita (§4).
- Da qui possono partire, indipendenti: lo **schema delle nuove tabelle CRM** (§5, campi 🟢) e il **design dell'import ibrido** (§4.7, §6).

---

**Artefatti collegati:** `Anagrafica_CRM_v2.xlsx` (desiderata originale, in Downloads) · `Anagrafica_CRM_v2_MAPPATURA.xlsx` (versione annotata con le 3 colonne Disponibilità/Fonte/Note).
