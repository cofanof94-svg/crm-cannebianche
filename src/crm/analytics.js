// Analytics — la parte che legge il CRM: quanto del patrimonio informativo è
// stato costruito, e quanto l'applicazione viene usata.
//
// Questa metà della dashboard NON misura il business, misura la COPERTURA. Il
// motivo sta nei numeri: al 13/08/2026 il CRM contiene 64 preferenze su 14
// clienti distinti e due reclami, contro le 81.792 anagrafiche e i ~2.400
// soggiorni l'anno del gestionale. Riquadri con dentro "14" e "2" non sono
// sbagliati, sono veri e inutili — a meno di cambiare la domanda: non "cosa
// dicono i dati raccolti" ma "quanto ne stiamo raccogliendo".
//
// È la stessa ragione per cui qui NON ci sono percentuali di risoluzione dei
// reclami né tassi di adozione dell'AI: su due casi un numero in percentuale
// sembra preciso e non lo è. Torneranno quando ci saranno righe.

const numero = (v) => (v == null ? 0 : Number(v));

// Quanti clienti DISTINTI il CRM conosce, per tipo di informazione. Cumulativo e
// non filtrato per periodo: la copertura è ciò che si è costruito finora, non
// ciò che si è fatto negli ultimi sette giorni.
const SQL_COPERTURA = `
SELECT
  (SELECT COUNT(DISTINCT pms_customer_id) FROM customer_preferences)  AS conPreferenze,
  (SELECT COUNT(DISTINCT pms_customer_id) FROM customer_intolerances) AS conAllergie,
  (SELECT COUNT(DISTINCT pms_customer_id) FROM customer_complaints)   AS conReclami,
  (SELECT COUNT(DISTINCT pms_customer_id) FROM customer_profile
    WHERE note_personali IS NOT NULL AND LTRIM(RTRIM(note_personali)) <> '') AS conNotePersonali,
  (SELECT COUNT(DISTINCT pms_customer_id) FROM customer_travel_party)  AS conNucleo,
  (SELECT COUNT(*) FROM customer_merge) AS anagraficheFuse`;

// Quello che è stato scritto NEL periodo: è il ritmo di lavoro, e insieme alla
// copertura dice se il CRM sta crescendo o è fermo.
const SQL_SCRITTE = `
SELECT
  (SELECT COUNT(*) FROM customer_preferences  WHERE CAST(created_at AS date) BETWEEN @da AND @a) AS preferenze,
  (SELECT COUNT(*) FROM customer_intolerances WHERE CAST(created_at AS date) BETWEEN @da AND @a) AS allergie,
  (SELECT COUNT(*) FROM customer_complaints   WHERE CAST(created_at AS date) BETWEEN @da AND @a) AS reclami`;

// Reclami: solo conteggi grezzi, niente percentuali (vedi l'intestazione).
const SQL_RECLAMI = `
SELECT
  COUNT(*) AS totali,
  SUM(CASE WHEN stato = 'aperto' THEN 1 ELSE 0 END) AS aperti,
  SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS risolti,
  SUM(CASE WHEN reparto IS NULL OR categoria IS NULL THEN 1 ELSE 0 END) AS daClassificare
FROM customer_complaints`;

// Preferenze per reparto: l'unica classifica del blocco CRM che ha senso oggi,
// e anche lei va letta sapendo che le righe sono poche.
const SQL_PREF_REPARTO = `
SELECT TOP 8 reparto AS voce, COUNT(*) AS n
FROM customer_preferences GROUP BY reparto ORDER BY COUNT(*) DESC`;

// Uso dell'AI. Le righe partono dal 13/08/2026: prima le chiamate finivano solo
// in un console.log, quindi qualunque numero precedente sarebbe inventato.
const SQL_AI = `
SELECT funzione, azione,
  COUNT(*) AS n,
  SUM(CASE WHEN esito = 'guasto' THEN 1 ELSE 0 END) AS guasti,
  SUM(ISNULL(n_proposte, 0)) AS proposte
FROM ai_events
WHERE CAST(created_at AS date) BETWEEN @da AND @a
GROUP BY funzione, azione`;

// Accessi: la risposta a "lo stanno usando?". Di chi scrive sapevamo già tutto;
// chi consulta e basta non lasciava traccia da nessuna parte.
const SQL_ACCESSI = `
SELECT
  SUM(CASE WHEN esito = 'ok' THEN 1 ELSE 0 END) AS riusciti,
  SUM(CASE WHEN esito <> 'ok' THEN 1 ELSE 0 END) AS falliti,
  COUNT(DISTINCT CASE WHEN esito = 'ok' THEN utente_id END) AS utentiAttivi,
  COUNT(DISTINCT CASE WHEN esito = 'ok' THEN CAST(created_at AS date) END) AS giorniConAccessi
FROM crm_accessi
WHERE CAST(created_at AS date) BETWEEN @da AND @a`;

const SQL_ACCESSI_PER_UTENTE = `
SELECT TOP 8 ISNULL(u.username, a.username) AS voce, COUNT(*) AS n
FROM crm_accessi a
LEFT JOIN users u ON u.id = a.utente_id
WHERE a.esito = 'ok' AND CAST(a.created_at AS date) BETWEEN @da AND @a
GROUP BY ISNULL(u.username, a.username)
ORDER BY COUNT(*) DESC`;

// Le tabelle del registro sono nate il 13/08/2026: su un database dove le
// migrazioni non sono ancora passate, interrogarle è un errore. La dashboard
// però deve aprirsi lo stesso e dire "non ancora raccolto", che è la verità:
// far fallire l'intera pagina per una sezione vuota sarebbe sproporzionato.
async function forse(db, sql, params, seNonCe) {
  try {
    return await db.query(sql, params);
  } catch (err) {
    console.warn(`[analytics] sezione non disponibile: ${err.message}`);
    return seNonCe;
  }
}

async function getAnalyticsCrm(crmDb, { da, a }) {
  const [copertura, scritte, reclami, prefReparto, ai, accessi, accessiUtente] = await Promise.all([
    crmDb.query(SQL_COPERTURA, {}),
    crmDb.query(SQL_SCRITTE, { da, a }),
    crmDb.query(SQL_RECLAMI, {}),
    crmDb.query(SQL_PREF_REPARTO, {}),
    forse(crmDb, SQL_AI, { da, a }, []),
    forse(crmDb, SQL_ACCESSI, { da, a }, [{}]),
    forse(crmDb, SQL_ACCESSI_PER_UTENTE, { da, a }, []),
  ]);

  const c = copertura[0] || {};
  const s = scritte[0] || {};
  const r = reclami[0] || {};
  const acc = (accessi && accessi[0]) || {};

  // L'AI si riassume in due numeri per funzione: quante volte è stata chiamata e
  // quante proposte sono state accettate. Il rapporto è il tasso di adozione, ma
  // NON lo si calcola qui: con pochi eventi darebbe percentuali ballerine, e chi
  // guarda deve vedere i due numeri e farsi l'idea da sé.
  const perFunzione = {};
  for (const riga of ai || []) {
    const f = perFunzione[riga.funzione] || (perFunzione[riga.funzione] = { funzione: riga.funzione, generati: 0, proposte: 0, accettati: 0, guasti: 0 });
    if (riga.azione === 'generato') {
      f.generati += numero(riga.n);
      f.proposte += numero(riga.proposte);
      f.guasti += numero(riga.guasti);
    } else if (riga.azione === 'accettato') {
      f.accettati += numero(riga.n);
    }
  }

  return {
    copertura: {
      conPreferenze: numero(c.conPreferenze),
      conAllergie: numero(c.conAllergie),
      conReclami: numero(c.conReclami),
      conNotePersonali: numero(c.conNotePersonali),
      conNucleo: numero(c.conNucleo),
      anagraficheFuse: numero(c.anagraficheFuse),
    },
    scritteNelPeriodo: {
      preferenze: numero(s.preferenze),
      allergie: numero(s.allergie),
      reclami: numero(s.reclami),
    },
    reclami: {
      totali: numero(r.totali),
      aperti: numero(r.aperti),
      risolti: numero(r.risolti),
      daClassificare: numero(r.daClassificare),
    },
    preferenzePerReparto: (prefReparto || []).map((x) => ({ voce: String(x.voce || '—'), n: numero(x.n) })),
    ai: Object.values(perFunzione),
    accessi: {
      riusciti: numero(acc.riusciti),
      falliti: numero(acc.falliti),
      utentiAttivi: numero(acc.utentiAttivi),
      giorniConAccessi: numero(acc.giorniConAccessi),
      perUtente: (accessiUtente || []).map((x) => ({ voce: String(x.voce || '—'), n: numero(x.n) })),
    },
  };
}

module.exports = { getAnalyticsCrm };
