// Fase 3 filone C — "Suggerisci preferenze" (AI on-demand).
//
// Legge i FATTI già strutturati dell'ospite (gusti F&B, note CRM, intolleranze e
// preferenze già registrate) e chiede a Claude di proporre preferenze/intolleranze
// SINTETIZZATE — non l'elenco degli ordini, ma il tratto (es. "caffè: preferisce
// leccese", non ogni caffè). L'operatore conferma a mano: qui NON si salva nulla.
//
// Decisioni prese col cliente:
//  - on-demand (nessun ascolto continuo, nessun salvataggio automatico)
//  - una forte prevalenza anche in un solo soggiorno vale come segnale
//  - includere i tratti negativi (es. "non gradisce X")
//  - ambito: F&B (gusti) + note anagrafica; SPA quando avremo i consumi trattamenti
//  - granularità media: categoria + tratto, non il singolo consumo
//
// Il modulo è puro: il client Anthropic è iniettato (mock nei test). Le liste chiuse
// (reparto/categoria) sono vincolate via structured outputs → l'AI non può proporre
// valori che il POST di salvataggio poi rifiuterebbe.

const { REPARTI, CATEGORIE } = require('../crm/preferenze');

// Schema dell'output vincolato. reparto/categoria ammettono '' (usato dalle
// intolleranze, che non hanno reparto). enum → nessun valore fuori lista.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    suggerimenti: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tipo: { type: 'string', enum: ['preferenza', 'intolleranza'] },
          reparto: { type: 'string', enum: ['', ...REPARTI] },
          categoria: { type: 'string', enum: ['', ...CATEGORIE] },
          testo: { type: 'string' },
          motivo: { type: 'string' },
          confidenza: { type: 'string', enum: ['alta', 'media', 'bassa'] },
        },
        required: ['tipo', 'reparto', 'categoria', 'testo', 'motivo', 'confidenza'],
      },
    },
  },
  required: ['suggerimenti'],
};

const SYSTEM = [
  "Sei l'assistente CRM di un hotel 5 stelle (Canne Bianche Lifestyle Hotel, Torre Canne).",
  'Dai FATTI di un ospite proponi SOLO NUOVE preferenze, utili a personalizzare il servizio.',
  'Regole:',
  '- Considera TUTTE le fonti con pari peso: note anagrafica (PMS), note CRM, consumi F&B, trattamenti SPA, dati CRM. Nessuna fonte prevale sulle altre.',
  '- Sintetizza il TRATTO, non il singolo consumo: "Caffè: preferisce leccese", non "ha ordinato 3 caffè leccese".',
  '- Proponi solo preferenze NUOVE: non riproporre nulla già presente fra preferenze/intolleranze registrate, né fra quelle già proposte in questa sessione.',
  '- Il confronto è SEMANTICO, non testuale: se una proposta esprime lo stesso concetto di una già presente/proposta è un duplicato e va OMESSA (es. "Adora la Coca-Cola Zero" ≡ "Piace molto la Coca-Cola Zero").',
  '- Inferenze equilibrate: deduci una preferenza solo se sostenuta da evidenze RIPETUTE o comunque solide (prevalenza netta, nota esplicita). Evita affermazioni eccessive o basate su un singolo indizio debole.',
  '- Includi anche i tratti NEGATIVI se emergono dalle note (es. "Non gradisce il piano terra").',
  "- Le intolleranze/allergie sono un dato di SICUREZZA: proponile come tipo 'intolleranza' (reparto/categoria vuoti) solo se esplicite nelle note.",
  "- Per le preferenze scegli reparto (destinatario) e categoria coerenti; il testo è breve e operativo.",
  "- I trattamenti SPA ricorrenti sono preferenze reparto 'SPA' (es. 'Predilige il massaggio Serenity', 'Abituale del percorso benessere').",
  '- Massimo 8 suggerimenti. Se non ci sono nuove preferenze solide, restituisci una lista VUOTA. Non inventare.',
  '- confidenza: "alta" solo con evidenza forte e ripetuta; "bassa" per indizi deboli.',
].join('\n');

// Costruisce il blocco FATTI testuale, minimizzando i dati inviati: niente
// identificativi/cognomi, solo i segnali utili alle preferenze.
function costruisciFatti({ gusti, spa, note, notePms, intolleranze, preferenze, giaMostrate } = {}) {
  const parti = [];

  const items = (gusti && gusti.items) || [];
  if (items.length) {
    const righe = items
      .slice(0, 30)
      .map((i) => `- [${i.categoria}] ${i.nome} — ${i.volte}x`)
      .join('\n');
    parti.push(`CONSUMI F&B (aggregati per camera+date del soggiorno):\n${righe}`);
  }

  const spaItems = (spa && spa.items) || [];
  if (spaItems.length) {
    const righe = spaItems
      .slice(0, 25)
      .map((i) => `- [${i.categoria}] ${i.nome} — ${i.volte}x`)
      .join('\n');
    parti.push(`TRATTAMENTI SPA / BENESSERE (dagli extra):\n${righe}`);
  }

  // Note anagrafica dal PMS (pari peso con le note CRM).
  const testoPms = (notePms == null ? '' : String(notePms)).trim();
  if (testoPms) {
    parti.push(`NOTE ANAGRAFICA (PMS):\n${testoPms}`);
  }

  const testiNote = (note || []).map((n) => (n.testo || '').trim()).filter(Boolean);
  if (testiNote.length) {
    parti.push(`NOTE CRM:\n${testiNote.map((t) => `- ${t}`).join('\n')}`);
  }

  const testiInt = (intolleranze || []).map((i) => (i.testo || '').trim()).filter(Boolean);
  if (testiInt.length) {
    parti.push(`INTOLLERANZE GIÀ REGISTRATE (non riproporre):\n${testiInt.map((t) => `- ${t}`).join('\n')}`);
  }

  const testiPref = (preferenze || [])
    .map((p) => `${p.reparto}/${p.categoria}: ${(p.testo || '').trim()}`)
    .filter((s) => s.trim().endsWith(':') === false);
  if (testiPref.length) {
    parti.push(`PREFERENZE GIÀ REGISTRATE (non riproporre):\n${testiPref.map((t) => `- ${t}`).join('\n')}`);
  }

  // Proposte già mostrate in questa sessione: da NON riproporre (confronto semantico).
  const testiGia = (giaMostrate || []).map((t) => (t == null ? '' : String(t)).trim()).filter(Boolean);
  if (testiGia.length) {
    parti.push(`GIÀ PROPOSTE IN QUESTA SESSIONE (non riproporre):\n${testiGia.map((t) => `- ${t}`).join('\n')}`);
  }

  return parti.join('\n\n');
}

// true se ci sono abbastanza fatti per interrogare l'AI.
function haFatti(fatti) {
  return typeof fatti === 'string' && fatti.trim().length > 0;
}

function buildRequest(fatti, { model = 'claude-sonnet-5', maxTokens = 2000 } = {}) {
  const req = {
    model,
    max_tokens: maxTokens,
    system: SYSTEM,
    messages: [{ role: 'user', content: `FATTI dell'ospite:\n\n${fatti}` }],
    output_config: {
      format: { type: 'json_schema', schema: SCHEMA },
    },
  };
  // Adaptive thinking (utile per la sintesi) su Opus/Sonnet 4.6+; Haiku 4.5 non lo
  // supporta → lo omettiamo per restare compatibili se qualcuno usa un Haiku.
  if (!/haiku/i.test(model)) req.thinking = { type: 'adaptive' };
  return req;
}

// Estrae il JSON dal messaggio di risposta e normalizza i suggerimenti scartando
// quelli non validi (reparto/categoria fuori lista per le preferenze).
function parseSuggerimenti(resp) {
  const blocchi = (resp && resp.content) || [];
  const testo = blocchi.filter((b) => b && b.type === 'text').map((b) => b.text).join('');
  if (!testo.trim()) return [];
  let dati;
  try {
    dati = JSON.parse(testo);
  } catch {
    return [];
  }
  const raw = Array.isArray(dati && dati.suggerimenti) ? dati.suggerimenti : [];
  const out = [];
  for (const s of raw) {
    const tipo = s && s.tipo === 'intolleranza' ? 'intolleranza' : 'preferenza';
    const testoS = (s && s.testo != null ? String(s.testo) : '').trim();
    if (!testoS) continue;
    const motivo = (s && s.motivo != null ? String(s.motivo) : '').trim();
    const confidenza = ['alta', 'media', 'bassa'].includes(s && s.confidenza) ? s.confidenza : 'media';
    if (tipo === 'intolleranza') {
      out.push({ tipo, reparto: null, categoria: null, testo: testoS, motivo, confidenza });
      continue;
    }
    const reparto = s && REPARTI.includes(s.reparto) ? s.reparto : null;
    const categoria = s && CATEGORIE.includes(s.categoria) ? s.categoria : null;
    if (!reparto || !categoria) continue; // preferenza non salvabile → scartata
    out.push({ tipo, reparto, categoria, testo: testoS, motivo, confidenza });
  }
  return out;
}

// Interroga l'AI e ritorna i suggerimenti normalizzati. client: oggetto con
// .messages.create(...) (SDK Anthropic o mock).
async function suggerisci(client, fatti, opts = {}) {
  if (!haFatti(fatti)) return [];
  const resp = await client.messages.create(buildRequest(fatti, opts));
  return parseSuggerimenti(resp);
}

module.exports = { SCHEMA, SYSTEM, costruisciFatti, haFatti, buildRequest, parseSuggerimenti, suggerisci };
