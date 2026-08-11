// Ruoli e permessi del CRM.
//
// Un solo posto dove sta scritto chi può fare cosa. Il resto dell'applicazione non
// nomina mai un ruolo: chiede un PERMESSO. Così aggiungere un ruolo (o cambiare
// idea su cosa può fare la reception) è una riga qui, non una caccia agli `if`
// sparsi per il codice.
//
// Evoluzione prevista (fuori scopo oggi, ma è il motivo di questa forma):
//   - REPARTO come concetto separato dal ruolo: l'utente avrà anche un reparto, e
//     `puo()` prenderà un contesto ("questa preferenza è del mio reparto?").
//     Il ruolo dice COSA puoi fare, il reparto SU COSA: due colonne, non un ruolo
//     ROLE_SPA che mescola le due cose e va riscritto al primo reparto nuovo.
//   - WORKFLOW di validazione: sarà un permesso in più (es. 'valida'), dato a chi
//     approva le proposte degli altri reparti. Nessuna riprogettazione.

const LEGGI = 'leggi';
const SCRIVI = 'scrivi';
const USA_AI = 'usa-ai';
const GESTISCI_UTENTI = 'gestisci-utenti';
const VEDI_ANALYTICS = 'vedi-analytics';

const PERMESSI = { LEGGI, SCRIVI, USA_AI, GESTISCI_UTENTI, VEDI_ANALYTICS };

// L'ordine conta: è quello in cui i ruoli compaiono nel menu a tendina di Utenti,
// dal meno al più potente.
const RUOLI = {
  readonly: {
    etichetta: 'Sola lettura',
    descrizione: 'Consulta tutto, non modifica nulla.',
    permessi: [LEGGI],
  },
  reception: {
    etichetta: 'Reception',
    descrizione: "Piena operatività sul cliente. Non amministra l'applicazione.",
    permessi: [LEGGI, SCRIVI, USA_AI],
  },
  admin: {
    etichetta: 'Amministratore',
    descrizione: 'Reception, più la gestione utenti e le funzioni direzionali.',
    permessi: [LEGGI, SCRIVI, USA_AI, GESTISCI_UTENTI, VEDI_ANALYTICS],
  },
};

const NOMI_RUOLI = Object.keys(RUOLI);

// Un ruolo che non conosciamo (utente creato da una versione precedente, es. il
// vecchio 'marketing') prende i permessi di sola lettura: chi ha un account resta
// operativo per consultare, ma non scrive nulla finché un admin non gli assegna un
// ruolo vero. Meglio uno che non riesce a salvare di uno che modifica senza titolo.
const RUOLO_DI_RIPIEGO = 'readonly';
const ruoliIgnotiVisti = new Set();

function permessiDi(ruolo) {
  const r = RUOLI[ruolo];
  if (r) return r.permessi;
  if (ruolo && !ruoliIgnotiVisti.has(ruolo)) {
    ruoliIgnotiVisti.add(ruolo); // una riga di log per ruolo, non una per richiesta
    console.warn(`[permessi] ruolo sconosciuto "${ruolo}": trattato come ${RUOLO_DI_RIPIEGO}`);
  }
  return RUOLI[RUOLO_DI_RIPIEGO].permessi;
}

// L'unica domanda che il resto dell'applicazione pone.
//
// Quando arriveranno i reparti questa funzione prenderà un terzo argomento con il
// contesto (di quale reparto è il dato che si sta toccando) e i punti di chiamata
// resteranno quelli che sono.
function puo(utente, permesso) {
  if (!utente || !permesso) return false;
  return permessiDi(utente.role).includes(permesso);
}

// Quello che il frontend riceve al login: mai il ruolo da interpretare a schermo,
// ma la lista dei permessi già risolta. Se un domani cambia la tabella qui sopra,
// l'interfaccia si adegua senza modifiche.
function utenteConPermessi(utente) {
  if (!utente) return utente;
  return { ...utente, permessi: permessiDi(utente.role) };
}

module.exports = { PERMESSI, RUOLI, NOMI_RUOLI, RUOLO_DI_RIPIEGO, permessiDi, puo, utenteConPermessi };
