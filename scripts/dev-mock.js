// Server di sviluppo con dati finti — NON usa il DB dell'hotel.
//
// Perché: `CB-DH` è il nome del SQL Server sulla rete interna. Fuori da quella
// rete la connessione fallisce (`getaddrinfo ENOTFOUND cb-dh`) e src/server.js si
// ferma prima di app.listen(), quindi l'app non parte affatto. Qui si avvia lo
// STESSO backend (createApp: rotte, auth, arricchimento CRM/PMS, AI) sostituendo
// solo lo strato SQL con due finti database in memoria alimentati da
// scripts/dev-fixtures.js.
//
//   npm run dev:mock     → http://localhost:3000   utente: admin / admin
//
// I dati CRM (preferenze, note, reclami, nucleo, fusioni, profilo) sono
// modificabili e restano in memoria finché il processo vive: riavviando si torna
// alle fixture. I dati PMS sono in sola lettura, come nella realtà.

// Il .env serve solo per ANTHROPIC_API_KEY: le funzioni AI non toccano il DB
// dell'hotel, quindi sono le uniche che si possono provare davvero da fuori. Senza
// questa riga rispondevano sempre 503 e non erano mai state viste girare.
// `quiet` per non stampare il banner di dotenv a ogni avvio.
require('dotenv').config({ quiet: true });

const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');
const F = require('./dev-fixtures');

const PORT = Number(process.env.PORT) || 3000;
const PASSWORD_DEV = 'admin';

// Estrae gli id da una IN-list interpolata: "... IN (1, 2, 3)" → [1,2,3].
function idsDaIn(text) {
  const m = String(text).match(/IN \(([\d,\s]+)\)/);
  return m ? m[1].split(',').map((s) => Number(s.trim())) : [];
}

const anagraByCod = new Map(F.ANAGRAFICHE.map((a) => [a.CodCli, a]));
const nominativo = (a) => [a.Cognome, a.Nome].filter(Boolean).join(' ');

// Notti fra due date ISO.
const notti = (da, a) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / 86400000);

// Riga "prenotazione" nel formato che si aspetta mapRiga() di src/pms/prenotazioni.js.
function rigaPrenota(p, data) {
  const a = anagraByCod.get(p.codCliente) || { Cognome: '', Nome: '' };
  return {
    codpratica: p.codpratica,
    codCliente: p.codCliente,
    cognome: a.Cognome,
    nome: a.Nome,
    dtarrivo: p.dtarrivo,
    dtpartenza: p.dtpartenza,
    notti: notti(p.dtarrivo, p.dtpartenza),
    statoPartenza: p.dtarrivo === p.dtpartenza
      ? 'dayuse'
      : (p.stato === 'checkout' ? 'checkout' : (p.dtpartenza === data ? 'partenza' : 'incasa')),
    camere: p.camere,
    tipologie: p.tipologie,
    paxAdulti: p.paxAdulti,
    paxBambini: p.paxBambini,
    oraArrivo: p.oraArrivo || '',
    inCasa: p.stato === 'arrivo' ? 'N' : 'S',
    trattamento: p.trattamento,
    tariffa: p.tariffa,
    extra: p.extra,
    dtPrenota: F.piu(-40),
    ospitiJson: p.occupanti && p.occupanti.length
      ? JSON.stringify(p.occupanti.map((o) => ({
        codCli: o.codCli,
        nominativo: nominativo(anagraByCod.get(o.codCli) || {}),
        camera: o.camera,
      })))
      : null,
    note: p.note || null,
  };
}

// --- Analytics: numeri finti che però rispondono al periodo ------------------
//
// Prima le fixture erano costanti: si cambiava finestra temporale e non si
// muoveva niente, e la pagina sembrava rotta quando invece era il finto a non
// avere storia. Adesso i numeri si ricavano dal periodo chiesto, con un peso
// stagionale — è un albergo di mare, agosto non è novembre — così il selettore
// si può collaudare da remoto e i riquadri restano coerenti fra loro e con il
// grafico dell'andamento. Restano numeri inventati: servono a vedere la pagina
// viva, non a studiarli.
const PESO_MESE = [0, 0.2, 0.25, 0.5, 0.9, 1.4, 1.7, 2.1, 1.6, 0.8, 0.35, 0.2, 0.2];
const SOMMA_PESI = PESO_MESE.reduce((s, x) => s + x, 0);
const giorniDelMese = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
// Un po' di crescita di anno in anno, se no "tutto lo storico" disegnerebbe una
// riga perfettamente piatta — che è il modo migliore per far credere di nuovo
// che il filtro non funzioni.
const ANNO_RIF = Number(String(F.DATA_LAVORO).slice(0, 4));
const pesoAnno = (anno) => Math.pow(1.07, anno - ANNO_RIF);
// Contributo di un singolo giorno alla "quota di anno" del periodo.
const quotaGiorno = (d) => (PESO_MESE[d.getUTCMonth() + 1] / SOMMA_PESI / giorniDelMese(d)) * pesoAnno(d.getUTCFullYear());

// Che frazione di un anno "pesa" il periodo chiesto. Un anno intero vale 1.
function quotaAnno(da, a) {
  if (!da || !a) return 1;
  let q = 0;
  const d = new Date(`${da}T00:00:00Z`);
  const fine = new Date(`${a}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(fine.getTime())) return 1;
  while (d <= fine) {
    q += quotaGiorno(d);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return q;
}

// I mesi toccati dal periodo, ciascuno con la sua quota: è l'andamento, e la
// somma dei suoi punti torna con il totale dei soggiorni.
function mesiDelPeriodo(da, a) {
  const per = new Map();
  const d = new Date(`${da}T00:00:00Z`);
  const fine = new Date(`${a}T00:00:00Z`);
  while (d <= fine) {
    const mese = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    per.set(mese, (per.get(mese) || 0) + quotaGiorno(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return per;
}

// ---------------------------------------------------------------- PMS (RO) --
const pmsDb = {
  async query(text, params = {}) {
    const t = String(text);

    if (/AS data FROM Persona/.test(t)) return [{ data: F.DATA_LAVORO }];

    // --- Analytics: i valori qui sotto sono riferiti a un ANNO, e vengono
    // ridotti alla quota del periodo chiesto (vedi quotaAnno). Le righe con n a
    // zero le scarta già la pagina, quindi su una settimana d'inverno certe
    // classifiche restano giustamente vuote. ---
    const q = quotaAnno(params.da, params.a);
    const scala = (n) => Math.round(n * q);
    const classifica = (righe) => righe.map((r) => ({ ...r, n: scala(r.n), ...(r.euro == null ? {} : { euro: scala(r.euro) }) }));

    if (/analytics:kpi/.test(t)) {
      const soggiorni = scala(412);
      return [{ soggiorni, ospiti: Math.round(soggiorni * 0.94), notti: Math.round(soggiorni * 4.1), vip: scala(96), diRitorno: scala(71) }];
    }
    if (/analytics:qualita/.test(t)) {
      return [{ ospiti: Math.round(scala(412) * 0.94), senzaEmail: scala(141), senzaTelefono: scala(132), senzaDataNascita: scala(58) }];
    }
    if (/analytics:canali/.test(t)) return classifica([
      { voce: 'DIRETTI', n: 186 }, { voce: 'OTA', n: 121 }, { voce: 'T. OPERATOR', n: 64 }, { voce: 'AGENZIE', n: 41 }]);
    if (/analytics:nazioni/.test(t)) return classifica([
      { voce: 'USA', n: 92 }, { voce: 'I', n: 74 }, { voce: 'GB', n: 58 }, { voce: 'D', n: 31 }, { voce: 'Non indicata', n: 27 }]);
    if (/analytics:vip/.test(t)) return classifica([
      { voce: 'BOLLICINE + FRUTTA FRESCA DI STAGIONE', n: 44 }, { voce: 'SELEZIONE DI BISCOTTI', n: 21 }, { voce: 'VIRTUOSO', n: 9 }]);
    if (/analytics:consumi/.test(t)) return classifica([
      { voce: 'ACQUA NAT. CANNE BIANCHE', n: 1180, euro: 3480, tipo: 'B' },
      { voce: 'CAFFÈ', n: 640, euro: 3900, tipo: 'B' },
      { voce: 'APEROL SPRITZ', n: 402, euro: 11200, tipo: 'B' },
      { voce: 'INSALATA MISTA', n: 318, euro: 3090, tipo: 'F' }]);
    if (/analytics:spa/.test(t)) return classifica([
      { voce: 'PERCORSO INTERNI', n: 118, euro: 2180 }, { voce: 'SERENITY', n: 57, euro: 6620 }]);
    if (/analytics:andamento/.test(t)) {
      // Il server chiede i mesi o gli anni cambiando la lunghezza del CONVERT:
      // il finto riconosce quella, come riconosce tutto il resto.
      const perAnno = /varchar\(4\)/.test(t);
      const punti = new Map();
      for (const [mese, quota] of mesiDelPeriodo(params.da, params.a)) {
        const chiave = perAnno ? mese.slice(0, 4) : mese;
        punti.set(chiave, (punti.get(chiave) || 0) + quota);
      }
      return [...punti].map(([mese, quota]) => ({ mese, n: Math.round(412 * quota) }));
    }
    // Da quando il finto "ha memoria": otto anni, cioè un ordine di grandezza
    // simile all'archivio vero, abbastanza da far scattare i punti per anno.
    if (/analytics:inizio/.test(t)) {
      const d = new Date(`${F.DATA_LAVORO}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() - 8);
      return [{ inizio: d.toISOString().slice(0, 10) }];
    }

    if (/AS arrivi/.test(t)) {
      const d = params.data || F.DATA_LAVORO;
      // Gli ospiti del giorno non entrano nei tre numeri della Home: non fanno
      // check-in, non occupano una camera la notte e non sono una partenza da
      // gestire. Nel gestionale vero restano fuori perché sono marcati 'P'.
      const pernotta = F.PRENOTAZIONI.filter((p) => p.dtarrivo < p.dtpartenza);
      return [{
        arrivi: pernotta.filter((p) => p.dtarrivo === d).length,
        partenze: pernotta.filter((p) => p.dtpartenza === d).length,
        presenti: pernotta.filter((p) => p.stato !== 'arrivo' && p.dtarrivo <= d && p.dtpartenza >= d).length,
      }];
    }

    // --- Importo pianificato (src/pms/importo.js) ---
    if (/FROM TipoPre WHERE codpratica IN/.test(t)) {
      return idsDaIn(t).flatMap((cp) => {
        const p = F.PRENOTAZIONI.find((x) => x.codpratica === cp);
        if (!p || p.stato === 'checkout') return []; // al check-in il PMS svuota TipoPre
        const camere = (p.camere || '').split(',').filter(Boolean).length || 1;
        return [{ codpratica: cp, id: cp, base: p.tariffaNotte, di: p.dtarrivo, df: p.dtpartenza, qta: camere }];
      });
    }
    if (/FROM PianificazioneSogg/.test(t)) {
      return idsDaIn(t).flatMap((cp) => (F.PIANIFICAZIONE[cp] || []).map((r) => ({ codpratica: cp, id: cp, ...r })));
    }
    if (/FROM Prenota p WHERE p\.codpratica IN/.test(t)) {
      return idsDaIn(t).flatMap((cp) => {
        const p = F.PRENOTAZIONI.find((x) => x.codpratica === cp);
        if (!p) return [];
        const n = notti(p.dtarrivo, p.dtpartenza);
        return [{ codpratica: cp, notti: n, nottiFatte: n, maturato: p.tariffaNotte * n, tariffaNotte: p.tariffaNotte }];
      });
    }

    // --- Liste operative ---
    if (/AS statoPartenza/.test(t)) {
      const d = params.data || F.DATA_LAVORO;
      // Una pratica di un giorno intestata a chi quel giorno è già in albergo è
      // una scrittura contabile, non una persona: resta fuori, come nel vero.
      // "Già in albergo" = check-in fatto, non "ha una pratica che copre oggi":
      // i voucher regalo sono prenotazioni lunghe un anno e coprirebbero tutto.
      const pernottaOggi = (codCli) => F.PRENOTAZIONI.some((p) => p.codCliente === codCli
        && p.stato !== 'arrivo' && p.dtarrivo < p.dtpartenza && p.dtarrivo <= d && p.dtpartenza >= d);
      return F.PRENOTAZIONI
        .filter((p) => p.stato !== 'arrivo' && p.dtarrivo <= d && p.dtpartenza >= d)
        .filter((p) => p.dtarrivo !== p.dtpartenza || !pernottaOggi(p.codCliente))
        .map((p) => rigaPrenota(p, d));
    }
    // Arrivi: gli ospiti del giorno non ci sono, come nel gestionale vero (che
    // li tiene fuori perché li marca 'partiti'). La pagina Arrivi prepara chi
    // prende una camera: camera, orario, check-in. Loro non ne hanno nessuno.
    if (/CAST\(p\.dtarrivo AS date\) = CAST\(@data AS date\)/.test(t)) {
      const d = params.data || F.DATA_LAVORO;
      return F.PRENOTAZIONI
        .filter((p) => p.dtarrivo === d && p.dtarrivo < p.dtpartenza)
        .map((p) => rigaPrenota(p, d));
    }

    // Note delle prenotazioni di una persona (proposte di allergia sulla scheda).
    if (/p\.Note AS testo/.test(t)) {
      const ids = idsDaIn(t);
      return F.PRENOTAZIONI
        .filter((p) => p.note && (ids.includes(p.codCliente) || (p.occupanti || []).some((o) => ids.includes(o.codCli))))
        .map((p) => ({ codpratica: p.codpratica, dtarrivo: p.dtarrivo, dtpartenza: p.dtpartenza, testo: p.note }));
    }

    // --- Anagrafiche ---
    if (/WHERE a\.CodCli = @codCli/.test(t)) {
      const a = anagraByCod.get(Number(params.codCli));
      return a ? [a] : [];
    }
    // ATTENZIONE: la query di CONFRONTO (merge guidato) e quella dei CANDIDATI
    // duplicati portano entrambe "AS nPrenotazioni". Riconoscere solo quello
    // faceva rispondere anche ai candidati, che pero' non hanno una IN-list:
    // tornava un elenco vuoto e nella scheda l'alert dei possibili duplicati non
    // compariva mai. Il confronto si distingue perche' filtra per codici noti.
    if (/AS nPrenotazioni[\s\S]*WHERE a\.CodCli IN/.test(t)) {
      return idsDaIn(t).map((id) => anagraByCod.get(id)).filter(Boolean)
        .map((a) => ({ codCli: a.CodCli, Cognome: a.Cognome, Nome: a.Nome, dtNascita: a.dtNascita, codiceFiscale: a.CodFis, Citta: a.Citta, CodNaz: a.CodNaz, email: a.email, Telefono: a.Telefono, Cellulare: a.Cellulare, CodVip: a.CodVip, DesVip: a.DesVip, nPrenotazioni: nPren(a.CodCli) }));
    }
    if (/tv\.desvip AS DesVip[\s\S]*WHERE a\.CodCli IN/.test(t)) {
      return idsDaIn(t).map((id) => anagraByCod.get(id)).filter(Boolean);
    }
    if (/AS cameraInCasa/.test(t)) {
      // La stessa query serve per testo e per CODICE. Quella per codice porta un
      // IN e nessun parametro: senza questo ramo i token sarebbero zero, la
      // condizione risulterebbe vera per tutti e la ricerca restituirebbe
      // l'intera rubrica al posto del solo profilo principale.
      const perCodice = String(t).match(/a\.CodCli IN \(([\d,\s]+)\)/);
      if (perCodice) {
        const voluti = perCodice[1].split(',').map((s) => Number(s.trim()));
        return F.ANAGRAFICHE.filter((a) => voluti.includes(a.CodCli)).map((a) => ({ ...a, cameraInCasa: null }));
      }
      // i token arrivano come '%testo%' (LIKE): via i jolly, poi AND fra i token
      const tokens = Object.values(params).map((v) => String(v).replace(/%/g, '').toLowerCase()).filter(Boolean);
      return F.ANAGRAFICHE
        .filter((a) => {
          const h = `${a.Cognome}${a.Nome}${a.email}${a.Cellulare}${a.Telefono}`.toLowerCase().replace(/[\s.'-]/g, '');
          return tokens.every((tk) => h.includes(tk));
        })
        .slice(0, 20)
        .map((a) => {
          const p = F.PRENOTAZIONI.find((x) => x.codCliente === a.CodCli && x.stato !== 'arrivo' && x.dtarrivo <= F.DATA_LAVORO && x.dtpartenza >= F.DATA_LAVORO);
          return { ...a, cameraInCasa: p ? p.camere : null };
        });
    }

    // --- Storico ("ospite di ritorno" + scheda cliente) ---
    if (/GROUP BY c\.codCli/.test(t)) {
      const ids = idsDaIn(t);
      const out = new Map();
      for (const s of F.STORICO) {
        if (!ids.includes(s.codCli)) continue;
        const cur = out.get(s.codCli) || { codCli: s.codCli, n: 0, ultima: null, visite: 0 };
        // Una pratica senza date non si conta da nessuna parte: è la stessa cosa
        // che fa il SQL vero, dove il CASE sulle notti non scatta perché la
        // sottrazione fra due date mancanti non dà un numero.
        if (!s.dtarrivo || !s.dtpartenza) { out.set(s.codCli, cur); continue; }
        // Le giornate concluse (SPA, piscina, cene) contano a parte: non sono
        // soggiorni e non devono gonfiare il badge "Nª volta".
        if (s.dtarrivo === s.dtpartenza) cur.visite += 1;
        else {
          cur.n += 1;
          if (!cur.ultima || s.dtpartenza > cur.ultima) cur.ultima = s.dtpartenza;
        }
        out.set(s.codCli, cur);
      }
      return [...out.values()];
    }
    if (/AS ospitiJson[\s\S]*FROM StorPrenota sp/.test(t)) {
      const ids = idsDaIn(t);
      const correnti = F.PRENOTAZIONI.filter((p) => ids.includes(p.codCliente) || (p.occupanti || []).some((o) => ids.includes(o.codCli)));
      const concluse = F.STORICO.filter((s) => ids.includes(s.codCli));
      return [
        ...correnti.map((p) => ({
          codpratica: p.codpratica, dtarrivo: p.dtarrivo, dtpartenza: p.dtpartenza,
          notti: notti(p.dtarrivo, p.dtpartenza), camere: p.camere,
          stato: p.stato === 'arrivo' ? 'Pianificata' : (p.stato === 'checkout' ? 'Partito' : 'In casa'),
          source: 'DIRETTI', mercato: 'LEISURE INDIVIDUALI',
          arrangiamento: 0, extra: p.extra, pianificato: 0, ospitiJson: null,
        })),
        ...concluse.map((s) => ({
          codpratica: s.codpratica, dtarrivo: s.dtarrivo, dtpartenza: s.dtpartenza,
          // Senza date il gestionale manda null, non "non è un numero": è la
          // differenza che aveva fatto contare queste pratiche come day use.
          notti: (s.dtarrivo && s.dtpartenza) ? notti(s.dtarrivo, s.dtpartenza) : null,
          camere: s.camere, stato: 'Concluso',
          source: 'OTA', mercato: 'LEISURE INDIVIDUALI',
          arrangiamento: s.arrangiamento, extra: s.extra, pianificato: s.arrangiamento, ospitiJson: null,
        })),
      ];
    }

    // --- Duplicati ---
    if (/a\.CodCli <> @codCli/.test(t)) {
      const me = anagraByCod.get(Number(params.codCli));
      if (!me) return [];
      return F.ANAGRAFICHE
        .filter((a) => a.CodCli !== me.CodCli && a.Cognome === me.Cognome && a.Nome === me.Nome && a.dtNascita && a.dtNascita === me.dtNascita)
        .map((a) => ({ codCli: a.CodCli, Cognome: a.Cognome, Nome: a.Nome, dtNascita: a.dtNascita, codiceFiscale: a.CodFis, match: 'anagrafica', nPrenotazioni: nPren(a.CodCli) }));
    }
    if (/STRING_AGG/.test(t)) {
      const gruppi = new Map();
      for (const a of F.ANAGRAFICHE) {
        if (!a.dtNascita || !a.Cognome) continue;
        const k = `${a.Cognome}|${a.Nome}|${a.dtNascita}`;
        gruppi.set(k, [...(gruppi.get(k) || []), a.CodCli]);
      }
      return [...gruppi.entries()].filter(([, m]) => m.length > 1).map(([k, m]) => {
        const [cognome, nome, chiave] = k.split('|');
        return { tipo: 'ANAGRAFICA', cognome, nome, chiave, n: m.length, membri: m.join(',') };
      });
    }

    // --- Consumi ---
    if (/StorAddebitiComanda/.test(t)) return idsDaIn(t).flatMap((id) => F.GUSTI[id] || []);
    if (/codgrpmerCAT LIKE 'SPA/.test(t)) return idsDaIn(t).flatMap((id) => F.SPA[id] || []);

    // --- Co-occupanti (auto-popolamento nucleo) ---
    if (/AS nShared/.test(t)) {
      const ids = idsDaIn(t);
      const out = new Map();
      for (const p of F.PRENOTAZIONI) {
        const dentro = ids.includes(p.codCliente) || (p.occupanti || []).some((o) => ids.includes(o.codCli));
        if (!dentro) continue;
        for (const o of p.occupanti || []) {
          if (ids.includes(o.codCli)) continue;
          const a = anagraByCod.get(o.codCli);
          if (!a) continue;
          const cur = out.get(o.codCli) || { codCli: o.codCli, Cognome: a.Cognome, Nome: a.Nome, nShared: 0, totPrat: 0 };
          cur.nShared += 1;
          out.set(o.codCli, cur);
        }
      }
      const totPrat = F.PRENOTAZIONI.filter((p) => ids.includes(p.codCliente)).length;
      return [...out.values()].map((r) => ({ ...r, totPrat }));
    }

    return [];
  },
  async close() {},
};

function nPren(codCli) {
  return F.PRENOTAZIONI.filter((p) => p.codCliente === codCli).length
    + F.STORICO.filter((s) => s.codCli === codCli).length;
}

// ---------------------------------------------------------------- CRM (RW) --
// Store in memoria: le scritture dell'app funzionano davvero, così si possono
// provare i flussi completi (aggiungi preferenza, fondi duplicati, salva note…).
const store = {
  users: [],
  preferenze: F.CRM_INIZIALE.preferenze.map((p) => ({ ...p, autore_user_id: 1, created_at: new Date().toISOString() })),
  intolleranze: F.CRM_INIZIALE.intolleranze.map((p) => ({ ...p, autore_user_id: 1, created_at: new Date().toISOString() })),
  complaints: F.CRM_INIZIALE.complaints.map((p) => ({ ...p, autore_user_id: 1, created_at: new Date().toISOString(), resolved_at: null })),
  nucleo: F.CRM_INIZIALE.nucleo.map((p) => ({ ...p, autore_user_id: 1, created_at: new Date().toISOString() })),
  profili: F.CRM_INIZIALE.profili.map((p) => ({ ...p, autore_user_id: 1, updated_at: new Date().toISOString() })),
  merge: [...F.CRM_INIZIALE.merge],
  nucleoScartati: new Set(F.CRM_INIZIALE.nucleoScartati),
};
const prossimoId = (arr) => (arr.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1);
const conAutore = (r) => ({ ...r, autore: (store.users.find((u) => u.id === r.autore_user_id) || {}).username || 'admin' });

const crmDb = {
  async query(text, params = {}) {
    const t = String(text);
    const ids = idsDaIn(t);

    // --- Analytics, blocco CRM ---
    // Calcolato sullo store vero del finto, non inventato: così la pagina mostra
    // gli stessi numeri delle altre schermate e si vede se qualcosa non torna.
    const distinti = (arr) => new Set(arr.map((r) => codiceDi(r)).filter((x) => x != null)).size;
    if (/conPreferenze/.test(t)) {
      return [{
        conPreferenze: distinti(store.preferenze),
        conAllergie: distinti(store.intolleranze),
        conReclami: distinti(store.complaints),
        conNotePersonali: distinti(store.profili.filter((p) => p.note_personali)),
        conNucleo: distinti(store.nucleo),
        anagraficheFuse: store.merge.length,
      }];
    }
    if (/AS preferenze/.test(t)) {
      // Questo riquadro conta quello che è stato SCRITTO nel periodo, non quello
      // che c'è: qui la data va guardata davvero, altrimenti la riga del ritmo
      // resterebbe ferma come lo erano i numeri del gestionale.
      const nel = (righe) => righe.filter((r) => {
        const g = String(r.created_at || '').slice(0, 10);
        return g && (!params.da || g >= params.da) && (!params.a || g <= params.a);
      }).length;
      return [{ preferenze: nel(store.preferenze), allergie: nel(store.intolleranze), reclami: nel(store.complaints) }];
    }
    if (/AS daClassificare/.test(t)) {
      return [{
        totali: store.complaints.length,
        aperti: store.complaints.filter((c) => c.stato === 'aperto').length,
        risolti: store.complaints.filter((c) => c.resolved_at).length,
        daClassificare: store.complaints.filter((c) => !c.reparto || !c.categoria).length,
      }];
    }
    if (/FROM customer_preferences GROUP BY reparto/.test(t)) {
      const per = new Map();
      for (const p of store.preferenze) per.set(p.reparto, (per.get(p.reparto) || 0) + 1);
      return [...per.entries()].map(([voce, n]) => ({ voce, n })).sort((a, b) => b.n - a.n);
    }
    if (/FROM ai_events/.test(t)) return [];
    if (/FROM crm_accessi/.test(t)) {
      // Un accesso finto per far vedere il riquadro pieno invece che vuoto.
      if (/GROUP BY/.test(t)) return [{ voce: 'admin', n: 3 }];
      return [{ riusciti: 3, falliti: 0, utentiAttivi: 1, giorniConAccessi: 1 }];
    }

    // --- users ---
    // Le SCRITTURE prima delle letture, sempre. "DELETE FROM users WHERE id = @id"
    // contiene "FROM users WHERE id": messo dopo, finiva nella SELECT e la
    // cancellazione rispondeva ok senza cancellare niente. Il DB vero non ha
    // questo problema — è il mock che riconosce le query per pezzi di testo.
    if (/INSERT INTO users/.test(t)) {
      const u = { id: prossimoId(store.users), username: params.username, password_hash: params.passwordHash, role: params.role, attivo: 1, nome: params.nome, cognome: params.cognome, email: params.email, created_at: new Date().toISOString() };
      store.users.push(u);
      return [u];
    }
    if (/UPDATE users SET/.test(t)) {
      const u = store.users.find((x) => x.id === params.id);
      if (u) Object.entries(params).forEach(([k, v]) => { if (k !== 'id' && k in u) u[k] = v; });
      return [];
    }
    if (/DELETE FROM users/.test(t)) {
      const i = store.users.findIndex((x) => x.id === params.id);
      if (i >= 0) store.users.splice(i, 1);
      return [];
    }
    if (/FROM users WHERE username/.test(t)) return store.users.filter((u) => u.username === params.username);
    if (/FROM users WHERE id/.test(t)) return store.users.filter((u) => u.id === params.id);
    // La query vera non seleziona password_hash: qui si toglie, altrimenti il
    // finto DB restituisce l'oggetto intero e l'elenco utenti mostra gli hash.
    if (/FROM users ORDER BY username/.test(t)) {
      return store.users.slice()
        .sort((a, b) => String(a.username).localeCompare(String(b.username)))
        .map(({ password_hash: _, ...u }) => u);
    }
    // La query vera è `COUNT(*) AS n`: il finto riconosceva solo `COUNT(1)`, non
    // combaciava, tornava [] e `rows[0].n` esplodeva. Risultato: in sviluppo non si
    // poteva declassare, disattivare o eliminare nessun admin (500), e la
    // salvaguardia "deve restare almeno un admin attivo" non era provabile.
    if (/COUNT\((?:1|\*)\) AS n FROM users/.test(t)) return [{ n: store.users.filter((u) => u.role === 'admin' && u.attivo).length }];

    // --- customer_merge ---
    if (/customer_merge/.test(t)) {
      if (/MERGE customer_merge/.test(t)) {
        const ex = store.merge.find((m) => m.pms_customer_id === params.memberId);
        if (ex) ex.canonical_id = params.principale;
        else store.merge.push({ pms_customer_id: params.memberId, canonical_id: params.principale });
        return [];
      }
      if (/UPDATE customer_merge SET canonical_id/.test(t)) {
        store.merge.forEach((m) => { if (m.canonical_id === params.memberId) m.canonical_id = params.principale; });
        return [];
      }
      if (/DELETE FROM customer_merge/.test(t)) {
        const i = store.merge.findIndex((m) => m.pms_customer_id === params.memberId);
        if (i < 0) return [];
        const [rimosso] = store.merge.splice(i, 1);
        return [{ pms_customer_id: rimosso.pms_customer_id }];
      }
      if (/WHERE pms_customer_id = @codCli/.test(t)) return store.merge.filter((m) => m.pms_customer_id === params.codCli).map((m) => ({ canonical_id: m.canonical_id }));
      if (/WHERE pms_customer_id = @canonicalId/.test(t)) return store.merge.filter((m) => m.pms_customer_id === params.canonicalId).map((m) => ({ canonical_id: m.canonical_id }));
      if (/WHERE canonical_id = @canonicalId/.test(t)) return store.merge.filter((m) => m.canonical_id === params.canonicalId).map((m) => ({ pms_customer_id: m.pms_customer_id }));
      // Quanti codici pende da ciascun principale (ricerca: "+N collegate").
      // Va prima dei filtri per IN, perché la query porta entrambi.
      if (/GROUP BY canonical_id/.test(t)) {
        const per = new Map();
        store.merge.filter((m) => ids.includes(m.canonical_id))
          .forEach((m) => per.set(m.canonical_id, (per.get(m.canonical_id) || 0) + 1));
        return [...per].map(([canonical_id, n]) => ({ canonical_id, n }));
      }
      if (/WHERE pms_customer_id IN/.test(t)) return store.merge.filter((m) => ids.includes(m.pms_customer_id));
      if (/WHERE canonical_id IN/.test(t)) return store.merge.filter((m) => ids.includes(m.canonical_id));
      return store.merge.slice();
    }

    // --- customer_profile ---
    if (/MERGE customer_profile/.test(t)) {
      let p = store.profili.find((x) => x.pms_customer_id === params.pmsCustomerId);
      if (!p) { p = { pms_customer_id: params.pmsCustomerId, lingua: null, note_personali: null }; store.profili.push(p); }
      if (params.lingua !== undefined) p.lingua = params.lingua;
      if (params.notePersonali !== undefined) p.note_personali = params.notePersonali;
      p.autore_user_id = params.autoreUserId;
      p.updated_at = new Date().toISOString();
      return [];
    }
    // Cancellazione su tutto il gruppo di fusione (prima della lettura: vedi la
    // nota sull'ordine nel blocco users).
    if (/UPDATE customer_profile SET note_personali = NULL/.test(t)) {
      store.profili.forEach((p) => { if (ids.includes(p.pms_customer_id)) { p.note_personali = null; p.updated_at = new Date().toISOString(); } });
      return [];
    }
    if (/UPDATE customer_profile SET lingua = NULL/.test(t)) {
      store.profili.forEach((p) => { if (ids.includes(p.pms_customer_id)) { p.lingua = null; p.updated_at = new Date().toISOString(); } });
      return [];
    }
    if (/FROM customer_profile/.test(t)) return store.profili.filter((p) => ids.includes(p.pms_customer_id)).map(conAutore);

    // Appartenenza di una riga al gruppo (usata prima di correggere: vedi
    // appartieneA in src/crm/helpers.js). Va PRIMA delle letture di elenco, che
    // altrimenti la intercettano e rispondono di sì per qualunque id.
    {
      const m = String(t).match(/SELECT TOP 1 id FROM (\w+) WHERE id = @id/);
      if (m) {
        const tabelle = { customer_preferences: store.preferenze, customer_intolerances: store.intolleranze, customer_complaints: store.complaints, customer_travel_party: store.nucleo };
        const righe = tabelle[m[1]] || [];
        const r = righe.find((x) => x.id === params.id && ids.includes(codiceDi(x)));
        return r ? [{ id: r.id }] : [];
      }
    }

    // --- customer_preferences ---
    if (/INSERT INTO customer_preferences/.test(t)) {
      const r = { id: prossimoId(store.preferenze), pms_customer_id: params.pmsCustomerId, autore_user_id: params.autoreUserId, reparto: params.reparto, categoria: params.categoria, testo: params.testo, ambito: params.ambito, created_at: new Date().toISOString() };
      store.preferenze.unshift(r);
      return [{ id: r.id }];
    }
    if (/UPDATE customer_preferences/.test(t)) return aggiorna(store.preferenze, params, ['ambito', 'testo', 'reparto', 'categoria']);
    if (/DELETE FROM customer_preferences/.test(t)) return elimina(store.preferenze, params.id, ids);
    if (/FROM customer_preferences/.test(t)) {
      const soloNucleo = /ambito = 'nucleo'/.test(t);
      return store.preferenze.filter((r) => ids.includes(r.pms_customer_id) && (!soloNucleo || (r.ambito || 'nucleo') === 'nucleo')).map(conAutore);
    }

    // --- customer_intolerances ---
    if (/INSERT INTO customer_intolerances/.test(t)) {
      const r = { id: prossimoId(store.intolleranze), pms_customer_id: params.pmsCustomerId, autore_user_id: params.autoreUserId, testo: params.testo, created_at: new Date().toISOString() };
      store.intolleranze.unshift(r);
      return [{ id: r.id }];
    }
    if (/DELETE FROM customer_intolerances/.test(t)) return elimina(store.intolleranze, params.id, ids);
    if (/FROM customer_intolerances/.test(t)) return store.intolleranze.filter((r) => ids.includes(r.pms_customer_id)).map(conAutore);

    // --- customer_complaints ---
    if (/INSERT INTO customer_complaints/.test(t)) {
      const r = { id: prossimoId(store.complaints), pms_customer_id: params.pmsCustomerId, autore_user_id: params.autoreUserId, testo: params.testo, periodo: params.periodo, reparto: params.reparto, categoria: params.categoria, stato: 'aperto', created_at: new Date().toISOString(), resolved_at: null };
      store.complaints.unshift(r);
      return [{ id: r.id }];
    }
    if (/UPDATE customer_complaints/.test(t)) {
      const r = store.complaints.find((x) => x.id === params.id);
      if (!r) return [];
      if (params.testo !== undefined) r.testo = params.testo;
      if (params.periodo !== undefined) r.periodo = params.periodo;
      if (params.followUp !== undefined) r.follow_up = params.followUp;
      if (params.reparto !== undefined) r.reparto = params.reparto;
      if (params.categoria !== undefined) r.categoria = params.categoria;
      if (params.stato !== undefined) { r.stato = params.stato; r.resolved_at = params.stato === 'risolto' ? new Date().toISOString() : null; }
      return [{ id: r.id }];
    }
    if (/DELETE FROM customer_complaints/.test(t)) return elimina(store.complaints, params.id, ids);
    if (/FROM customer_complaints/.test(t)) {
      return store.complaints.filter((r) => ids.includes(r.pms_customer_id)).map(conAutore)
        .sort((a, b) => (a.stato === 'aperto' ? 0 : 1) - (b.stato === 'aperto' ? 0 : 1));
    }

    // --- customer_travel_party + memoria delle esclusioni ---
    // Il "gruppo nucleo": chi sta nel nucleo di questi codici, e chi li elenca
    // nel proprio. Il finto non lo riconosceva affatto e rispondeva vuoto,
    // quindi le preferenze condivise dal nucleo e le note di anagrafica degli
    // altri membri non si sono mai potute vedere qui (aggiunto il 20/08/2026).
    if (/AS c FROM customer_travel_party/.test(t)) {
      const out = new Set();
      for (const r of store.nucleo) {
        if (ids.includes(r.pms_customer_id) && r.pms_occupant_id != null) out.add(r.pms_occupant_id);
        if (r.pms_occupant_id != null && ids.includes(r.pms_occupant_id)) out.add(r.pms_customer_id);
      }
      return [...out].map((c) => ({ c }));
    }
    if (/INSERT INTO customer_nucleo_scartati/.test(t)) { store.nucleoScartati.add(`${params.pmsCustomerId}|${params.pmsOccupantId}`); return []; }
    if (/FROM customer_nucleo_scartati/.test(t)) {
      return [...store.nucleoScartati]
        .map((k) => k.split('|').map(Number))
        .filter(([c]) => ids.includes(c))
        .map(([, o]) => ({ pms_occupant_id: o }));
    }
    if (/INSERT INTO customer_travel_party/.test(t)) {
      const r = { id: prossimoId(store.nucleo), pms_customer_id: params.pmsCustomerId, autore_user_id: params.autoreUserId, tipo_relazione: params.tipoRelazione, nome: params.nome, cognome: params.cognome, nota: params.nota, pms_occupant_id: params.pmsOccupantId, created_at: new Date().toISOString() };
      store.nucleo.unshift(r);
      return [{ id: r.id }];
    }
    if (/UPDATE customer_travel_party/.test(t)) {
      const r = store.nucleo.find((x) => x.id === params.id);
      if (!r) return [];
      if (params.tipoRelazione !== undefined) r.tipo_relazione = params.tipoRelazione;
      ['nome', 'cognome', 'nota'].forEach((k) => { if (params[k] !== undefined) r[k] = params[k]; });
      return [{ id: r.id }];
    }
    if (/DELETE FROM customer_travel_party/.test(t)) return elimina(store.nucleo, params.id, ids);
    if (/pms_occupant_id AS c/.test(t)) {
      const s = new Set();
      store.nucleo.forEach((n) => {
        if (n.pms_customer_id === params.codCli && n.pms_occupant_id != null) s.add(n.pms_occupant_id);
        if (n.pms_occupant_id === params.codCli) s.add(n.pms_customer_id);
      });
      return [...s].map((c) => ({ c }));
    }
    // Il singolo membro che si sta per cancellare (serve a sapere se era
    // agganciato al gestionale, e quindi se potrebbe tornare da solo).
    if (/SELECT TOP 1 id, pms_customer_id, pms_occupant_id FROM customer_travel_party/.test(t)) {
      const r = store.nucleo.find((x) => x.id === params.id && ids.includes(x.pms_customer_id));
      return r ? [{ id: r.id, pms_customer_id: r.pms_customer_id, pms_occupant_id: r.pms_occupant_id }] : [];
    }
    if (/FROM customer_travel_party/.test(t)) {
      const righe = store.nucleo.filter((r) => ids.includes(r.pms_customer_id));
      return /pms_occupant_id IS NOT NULL/.test(t) ? righe.filter((r) => r.pms_occupant_id != null) : righe.map(conAutore);
    }

    return [];
  },
  async close() {},
};

function aggiorna(arr, params, campi) {
  const r = arr.find((x) => x.id === params.id);
  if (!r) return [];
  campi.forEach((k) => { if (params[k] !== undefined) r[k] = params[k]; });
  return [{ id: r.id }];
}
// `membri`: se la DELETE porta un filtro sul gruppo (WHERE ... AND pms_customer_id
// IN (…)), qui va rispettato. Ignorarlo farebbe cancellare in sviluppo righe che il
// database vero rifiuterebbe: il mock direbbe che funziona una cosa che non funziona.
// Il codice ospite di una riga: le tabelle finte non sono uniformi, alcune tengono
// il nome del parametro (pmsCustomerId), altre quello della colonna.
const codiceDi = (r) => (r && (r.pms_customer_id !== undefined ? r.pms_customer_id : r.pmsCustomerId));

function elimina(arr, id, membri) {
  const i = arr.findIndex((x) => x.id === id
    && (!Array.isArray(membri) || !membri.length || membri.includes(codiceDi(x))));
  if (i < 0) return [];
  arr.splice(i, 1);
  return [{ id }];
}

// ------------------------------------------------------------------- avvio --
// Esportata anche come funzione così la si può montare in un test senza aprire
// una porta (vedi `require.main` in fondo).
async function creaApp() {
  // Un utente per ruolo, stessa password: i permessi si provano solo entrando e
  // uscendo.
  const hash = await hashPassword(PASSWORD_DEV);
  // Si riparte sempre dagli stessi utenti: senza, chiamare creaApp() due volte
  // (cosa che fanno i test) li accodava e la lista usciva doppia.
  store.users.length = 0;
  const utenti = [
    { username: 'admin', role: 'admin', nome: 'Admin', cognome: 'Dev' },
    { username: 'reception', role: 'reception', nome: 'Anna', cognome: 'Ricevimento' },
    { username: 'lettore', role: 'readonly', nome: 'Luca', cognome: 'Consulta' },
  ];
  utenti.forEach((u, i) => store.users.push({
    id: i + 1, username: u.username, password_hash: hash, role: u.role, attivo: 1,
    nome: u.nome, cognome: u.cognome, email: `${u.username}@dev.local`,
    created_at: new Date().toISOString(),
  }));
  return createApp({ crmDb, pmsDb, sessionSecret: 'dev-mock' });
}

async function main() {
  const app = await creaApp();
  app.listen(PORT, () => {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────┐');
    console.log('  │  CRM Direct Holiday — MODALITÀ SVILUPPO (dati finti) │');
    console.log('  └─────────────────────────────────────────────────────┘');
    console.log(`  http://localhost:${PORT}`);
    console.log(`  utenti: admin · reception · lettore   password: ${PASSWORD_DEV}`);
    console.log('          (admin=tutto, reception=opera sui clienti, lettore=sola lettura)');
    console.log(`  data di lavoro simulata: ${F.DATA_LAVORO}`);
    console.log('');
    console.log('  Nessuna connessione al DB dell\'hotel. Le modifiche ai dati CRM');
    console.log('  restano in memoria e si perdono al riavvio.');
    console.log('');
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Avvio mock fallito:', err);
    process.exit(1);
  });
}

module.exports = { creaApp, crmDb, pmsDb, store };
