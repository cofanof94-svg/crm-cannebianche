function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Non autenticato' });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Permesso negato' });
    }
    next();
  };
}

// --- Guardia dei permessi su tutte le API ------------------------------------
//
// Il controllo NON si mette endpoint per endpoint: sono già una ventina e
// bisognerebbe ricordarsene a ogni funzionalità nuova, per sempre. Basta
// dimenticarne uno e il buco non lo vede nessuno, perché l'interfaccia il
// pulsante non lo mostra comunque.
//
// Qui il criterio è il METODO HTTP, che dice già cosa sta succedendo: si legge
// oppure si modifica. Le eccezioni sono poche e stanno tutte nella tabella qui
// sotto. Una rotta nuova nasce protetta senza che nessuno faccia niente.
const { PERMESSI, puo } = require('./permessi');

// Prima regola che corrisponde vince. I percorsi sono quelli visti da dentro
// /api: la rotta /api/admin/users qui è /admin/users.
const REGOLE = [
  // Le funzioni AI non scrivono nel CRM, ma costano e producono contenuto:
  // non le diamo a un profilo di sola consultazione.
  { metodo: 'POST', re: /^\/clienti\/\d+\/(briefing|suggerimenti)$/, permesso: PERMESSI.USA_AI },
  { re: /^\/admin(\/|$)/, permesso: PERMESSI.GESTISCI_UTENTI },
  // Analytics non esiste ancora: la regola c'è già, così il giorno che nasce è
  // protetta anche da URL diretto, che è esattamente il requisito.
  { re: /^\/analytics(\/|$)/, permesso: PERMESSI.VEDI_ANALYTICS },
];

// Tutto ciò che non è una lettura è una scrittura: un metodo che non conosciamo
// finisce fra le scritture, non fra le letture.
const SOLA_LETTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

function permessoPer(metodo, percorso) {
  for (const r of REGOLE) {
    if (r.metodo && r.metodo !== metodo) continue;
    if (r.re.test(percorso)) return r.permesso;
  }
  return SOLA_LETTURA.has(metodo) ? PERMESSI.LEGGI : PERMESSI.SCRIVI;
}

const SPIEGAZIONI = {
  [PERMESSI.SCRIVI]: 'Il tuo profilo è di sola consultazione: non puoi modificare i dati.',
  [PERMESSI.USA_AI]: 'Il tuo profilo non può usare le funzioni AI.',
  [PERMESSI.GESTISCI_UTENTI]: 'Solo un amministratore può gestire gli utenti.',
  [PERMESSI.VEDI_ANALYTICS]: 'La sezione Analytics è riservata agli amministratori.',
  [PERMESSI.LEGGI]: 'Il tuo profilo non può consultare questa sezione.',
};

function guardiaPermessi() {
  return (req, res, next) => {
    const utente = req.session && req.session.user;
    if (!utente) return res.status(401).json({ error: 'Non autenticato' });
    const permesso = permessoPer(req.method, req.path);
    if (puo(utente, permesso)) return next();
    // `permesso` nella risposta serve all'interfaccia per dire la cosa giusta,
    // e nei log per capire quale regola ha bloccato.
    console.warn(`[permessi] negato ${req.method} ${req.path} a ${utente.username} (${utente.role}): serve "${permesso}"`);
    return res.status(403).json({ error: SPIEGAZIONI[permesso] || 'Permesso negato', permesso });
  };
}

module.exports = { requireAuth, requireRole, guardiaPermessi, permessoPer };
