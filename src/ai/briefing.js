// Guest Briefing (AI) — Fase B Dashboard Arrivi 2.0.
//
// SOLO su richiesta dell'operatore (mai automatico). Per un ospite di rilievo
// (VIP / personaggio pubblico / istituzionale) genera un briefing BREVISSIMO per
// la reception usando ESCLUSIVAMENTE fonti web PUBBLICHE e affidabili, sempre
// citate. Nessun dato privato/sensibile. Se non è un personaggio pubblico o non
// ci sono fonti affidabili → "Nessuna informazione pubblica rilevante.".
//
// Modulo puro: il client Anthropic è iniettato (mock nei test). Usa il server tool
// di ricerca web (web_search_20260209) che aggiunge automaticamente le citazioni.

const SYSTEM = [
  "Sei l'assistente concierge di un hotel 5 stelle (Canne Bianche Lifestyle Hotel, Torre Canne).",
  'Compito: preparare un BRIEFING BREVISSIMO per la reception su un ospite di rilievo, usando SOLO fonti web PUBBLICHE e AFFIDABILI.',
  "Usa lo strumento di ricerca web per verificare se l'ospite è un personaggio pubblico (istituzionale, imprenditore noto, personaggio dello spettacolo/sport/cultura, ecc.).",
  '',
  'REGOLE FERREE:',
  '- Usa SOLO informazioni pubbliche e verificabili; CITA sempre le fonti.',
  "- Includi SOLO ciò che è utile all'accoglienza: ruolo/professione pubblica, motivo di notorietà, eventuali preferenze note pubblicamente, come rivolgersi (titolo/appellativo).",
  '- NON includere dati privati o sensibili: salute, vita sentimentale/familiare, orientamento, religione, opinioni politiche, patrimonio, indirizzi, recapiti.',
  '- Se la persona NON è chiaramente un personaggio pubblico, oppure non trovi fonti affidabili, rispondi ESATTAMENTE: "Nessuna informazione pubblica rilevante." e nient\'altro. Non inventare, non indovinare.',
  '- In caso di omonimia o incertezza sull\'identità, NON attribuire informazioni: dichiara che non è possibile identificare l\'ospite con certezza.',
  '- Massimo 4-5 righe. Tono professionale e sobrio.',
].join('\n');

// Blocco identità minimo per disambiguare la ricerca. Le note interne sono contesto
// e NON vanno pubblicate/ricercate come fatti.
function costruisciFatti({ nominativo, citta, nazione, vip, note } = {}) {
  const nome = (nominativo == null ? '' : String(nominativo)).trim();
  if (!nome) return '';
  const parti = [`Ospite da preparare: ${nome}`];
  const prov = [citta, nazione].map((s) => (s == null ? '' : String(s)).trim()).filter(Boolean).join(', ');
  if (prov) parti.push(`Possibile provenienza (per disambiguare): ${prov}`);
  const v = vip && vip.descrizione ? String(vip.descrizione).trim() : '';
  if (v) parti.push(`Classificazione interna VIP: ${v}`);
  const n = (note == null ? '' : String(note)).trim();
  if (n) parti.push(`Contesto interno (NON pubblicare, solo per capire di chi si tratta): ${n}`);
  return parti.join('\n');
}

function haFatti(fatti) {
  return typeof fatti === 'string' && fatti.trim().length > 0;
}

// Nessun structured output: la ricerca web produce testo con citazioni. Manteniamo
// max_tokens contenuto (briefing breve). thinking non usato per semplicità/robustezza.
function buildRequest(fatti, { model = 'claude-sonnet-5', maxTokens = 2000, maxUses = 5 } = {}) {
  return {
    model,
    max_tokens: maxTokens,
    system: SYSTEM,
    messages: [{ role: 'user', content: `${fatti}\n\nPrepara il briefing seguendo le regole.` }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }],
  };
}

// Estrae {url, titolo} da una lista eterogenea di citazioni/risultati.
function estraiFonti(blocchi) {
  const fonti = [];
  const visti = new Set();
  const aggiungi = (url, titolo) => {
    const u = (url == null ? '' : String(url)).trim();
    if (!u || visti.has(u)) return;
    visti.add(u);
    fonti.push({ url: u, titolo: (titolo == null ? '' : String(titolo)).trim() || u });
  };
  for (const b of blocchi || []) {
    if (!b) continue;
    // citazioni agganciate ai blocchi di testo
    for (const c of b.citations || []) aggiungi(c && c.url, c && c.title);
    // risultati del tool di ricerca web
    if (Array.isArray(b.content)) for (const r of b.content) if (r && r.url) aggiungi(r.url, r.title);
  }
  return fonti;
}

function parseBriefing(resp) {
  const blocchi = (resp && resp.content) || [];
  const testo = blocchi.filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
  const fonti = estraiFonti(blocchi);
  const pubblico = !!testo && !/nessuna informazione pubblica/i.test(testo);
  return { testo: testo || 'Nessuna informazione pubblica rilevante.', fonti: pubblico ? fonti : [], pubblico };
}

async function briefing(client, fatti, opts = {}) {
  if (!haFatti(fatti)) return { testo: 'Nessuna informazione pubblica rilevante.', fonti: [], pubblico: false };
  const resp = await client.messages.create(buildRequest(fatti, opts));
  return parseBriefing(resp);
}

module.exports = { SYSTEM, costruisciFatti, haFatti, buildRequest, estraiFonti, parseBriefing, briefing };
