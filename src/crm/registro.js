// Registro di ciò che succede: accessi e uso dell'AI.
//
// È l'unica parte del CRM che scrive per essere guardata dopo, non per far
// funzionare qualcosa adesso. Da qui la regola che la governa tutta:
//
//   REGISTRARE NON DEVE MAI FAR FALLIRE L'AZIONE REGISTRATA.
//
// Se la tabella non c'è (migrazione non ancora lanciata), se il database è
// occupato, se cambia una colonna: l'errore finisce nei log e l'utente non se ne
// accorge. Il contrario — un briefing che va in errore perché non si è potuto
// annotare che è stato fatto — sarebbe assurdo.

async function annota(fn) {
  try {
    await fn();
  } catch (err) {
    // Una riga sola, senza stack: qui un guasto non è un incidente da indagare
    // subito, è un dato che si perde. Lo stack riempirebbe i log nascondendo i
    // guasti veri.
    console.warn(`[registro] non registrato: ${err.message}`);
  }
}

// --- Accessi -----------------------------------------------------------------
// Anche i tentativi falliti: chi sbaglia password tre volte al giorno è un
// problema di adozione, non di sicurezza, e va visto. `utenteId` è nullo quando
// il nome utente non esiste: il tentativo si conta lo stesso.
const ESITI_ACCESSO = ['ok', 'credenziali', 'disattivato'];

function registraAccesso(db, { utenteId = null, username, esito }) {
  if (!ESITI_ACCESSO.includes(esito)) throw new Error(`esito accesso non previsto: ${esito}`);
  return annota(() => db.query(
    `INSERT INTO crm_accessi (utente_id, username, esito)
     VALUES (@utenteId, @username, @esito)`,
    { utenteId, username: String(username || '').slice(0, 50), esito }
  ));
}

// --- Uso dell'AI -------------------------------------------------------------
// Due tipi di riga. 'generato' è la chiamata: quante proposte ha prodotto e
// com'è andata. 'accettato' è l'operatore che ne conferma una. Il rapporto fra
// i due è il tasso di adozione, cioè l'unica misura che dice se l'AI serve.
//
// L'"ignorato" non si registra apposta: una proposta scartata è
// indistinguibile da una semplicemente non guardata, e contarle insieme darebbe
// un numero che sembra preciso e non lo è.
const FUNZIONI_AI = ['briefing', 'suggerimenti', 'note-personali'];

function registraAi(db, { funzione, azione, codCli = null, utenteId, nProposte = null, esito = 'ok', dettaglio = null }) {
  if (!FUNZIONI_AI.includes(funzione)) throw new Error(`funzione AI non prevista: ${funzione}`);
  return annota(() => db.query(
    `INSERT INTO ai_events (funzione, azione, pms_customer_id, utente_id, n_proposte, esito, dettaglio)
     VALUES (@funzione, @azione, @codCli, @utenteId, @nProposte, @esito, @dettaglio)`,
    {
      funzione,
      azione,
      codCli,
      utenteId,
      nProposte,
      esito,
      dettaglio: dettaglio == null ? null : String(dettaglio).slice(0, 400),
    }
  ));
}

module.exports = { registraAccesso, registraAi, FUNZIONI_AI, ESITI_ACCESSO };
