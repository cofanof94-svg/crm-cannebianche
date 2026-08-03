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
  };
  return cached;
}

// Per i test: azzera la cache così un cambio di env viene rivalutato.
function _reset() {
  cached = undefined;
}

module.exports = { getAiClient, _reset };
