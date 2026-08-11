// Costruzione lazy del client Anthropic per le funzioni AI (Fase 3 filone C).
//
// Ritorna null se l'SDK non è installato o manca ANTHROPIC_API_KEY, così l'app
// parte comunque e l'endpoint può rispondere 503 "AI non configurata" invece di
// crashare. Prerequisiti per l'uso dal vivo:
//   1) npm install @anthropic-ai/sdk
//   2) ANTHROPIC_API_KEY=... (e opzionale ANTHROPIC_MODEL, default claude-opus-5) nel .env

let cached; // undefined = non ancora provato; null = non disponibile; oggetto = ok

function getAiClient() {
  if (cached !== undefined) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    cached = null;
    return cached;
  }
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch {
    cached = null; // SDK non installato
    return cached;
  }
  cached = {
    client: new Anthropic({ apiKey }),
    // Sonnet 5: buon giudizio a costo contenuto per una sintesi come questa.
    // Override con ANTHROPIC_MODEL (es. claude-opus-5 per max qualità, claude-haiku-4-5 per min costo).
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    // Il briefing fa un mestiere più difficile: capire se la pagina trovata è
    // davvero l'ospite, buttare via ciò che alla reception non serve e riassumere
    // in parole chiave invece di ricopiare. Provato dal vivo sullo stesso ospite,
    // Sonnet incollava frasi intere dai comunicati stampa in inglese, Opus no.
    // Si paga di più, ma il briefing lo si chiede a mano poche volte al giorno.
    modelBriefing: process.env.ANTHROPIC_MODEL_BRIEFING || 'claude-opus-5',
  };
  return cached;
}

// Traduce un errore dell'SDK Anthropic in un messaggio che abbia senso per chi sta
// in reception. Senza, un credito esaurito arrivava a schermo come "Errore durante
// la generazione": nessuno poteva capire che bastava ricaricare, e sarebbe partita
// una segnalazione di bug per un problema di fatturazione.
//
// Ritorna null se l'errore non è riconosciuto: in quel caso è giusto che risalga e
// diventi un 500 nei log, invece di essere nascosto sotto un messaggio rassicurante.
function guastoAi(err) {
  const stato = err && err.status;
  const dett = err && err.error && err.error.error;
  const testo = String((dett && dett.message) || (err && err.message) || '');
  if (/credit balance/i.test(testo)) {
    return 'Credito AI esaurito: ricaricare il piano Anthropic. Le altre funzioni del CRM non sono toccate.';
  }
  if (stato === 401 || /invalid x-api-key|authentication/i.test(testo)) {
    return 'Chiave API Anthropic non valida o scaduta: da sistemare nel file .env.';
  }
  if (stato === 429) return 'Troppe richieste all\'AI in poco tempo: riprovare fra qualche minuto.';
  if (stato === 529 || stato === 503) return 'Servizio AI momentaneamente non disponibile: riprovare fra qualche minuto.';
  return null;
}

// Per i test: azzera la cache così un cambio di env viene rivalutato.
function _reset() {
  cached = undefined;
}

module.exports = { getAiClient, guastoAi, _reset };
