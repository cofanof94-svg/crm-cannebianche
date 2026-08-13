const { getUserById } = require('../crm/users');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  next();
}

// Il ruolo (e l'essere attivo) vengono letti al login e messi nella sessione.
// Senza questa guardia non li rilegge più nessuno, e la conseguenza è che
// declassare o disattivare qualcuno NON ha effetto finché non esce e rientra:
// resta dentro con i permessi vecchi anche per ore, visto che la sessione dura
// otto ore. Visto succedere in hotel il 13/08/2026 declassando un utente a sola
// lettura e trovandolo ancora operativo nell'altra finestra.
//
// Quindi a ogni richiesta si rilegge la riga dell'utente. È una lettura per
// chiave primaria su una tabella di tre righe: il costo è trascurabile rispetto
// a lasciare in giro permessi revocati.
function sessioneAggiornata(crmDb) {
  return async (req, res, next) => {
    const sessione = req.session && req.session.user;
    if (!sessione) return next(); // non autenticato: se ne occupa requireAuth
    try {
      const attuale = await getUserById(crmDb, sessione.id);
      // Utente eliminato o disattivato: la sessione muore adesso, non al logout.
      if (!attuale || !attuale.attivo) {
        return req.session.destroy(() => res.status(401).json({ error: 'Sessione non più valida' }));
      }
      if (attuale.role !== sessione.role) {
        console.log(`[permessi] ${sessione.username}: ruolo cambiato da ${sessione.role} a ${attuale.role}`);
        sessione.role = attuale.role;
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
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
  // Il percorso si normalizza PRIMA di confrontarlo. Express instrada senza
  // guardare le maiuscole (`case sensitive routing` è spento di serie), quindi
  // /api/ADMIN/users arrivava al router degli utenti mentre la regola
  // /^\/admin/ non ci vedeva niente: la richiesta ricadeva sulla regola generica
  // e bastava scrivere una lettera maiuscola perché la reception si creasse un
  // amministratore. Chi decide il permesso deve vedere il percorso come lo vede
  // chi instrada, non come lo ha scritto il chiamante.
  const p = String(percorso || '').toLowerCase();
  const m = String(metodo || '').toUpperCase();
  for (const r of REGOLE) {
    if (r.metodo && r.metodo !== m) continue;
    if (r.re.test(p)) return r.permesso;
  }
  return SOLA_LETTURA.has(m) ? PERMESSI.LEGGI : PERMESSI.SCRIVI;
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

module.exports = { requireAuth, requireRole, guardiaPermessi, permessoPer, sessioneAggiornata };
