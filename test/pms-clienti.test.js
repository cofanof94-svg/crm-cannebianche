const { test } = require('node:test');
const assert = require('node:assert');
const { cercaClienti, getCliente, getSoggiorniCliente } = require('../src/pms/clienti');

function fakePms(recordset) {
  return { calls: [], async query(text, params) { this.calls.push({ text, params }); return recordset; } };
}

test('cercaClienti passa il termine come LIKE e mappa', async () => {
  const pms = fakePms([{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANTONELLA', email: 'a@b.it', Cellulare: '', Citta: 'TRANI' }]);
  const [r] = await cercaClienti(pms, 'bari');
  assert.strictEqual(r.codCli, 47186);
  assert.strictEqual(r.nominativo, 'DI BARI ANTONELLA');
  assert.strictEqual(r.citta, 'TRANI');
  assert.strictEqual(pms.calls[0].params.t0, '%bari%');
});

test('cercaClienti tokenizza: multi-parola in AND, ordine-indipendente, accent-insensitive', async () => {
  const pms = fakePms([]);
  await cercaClienti(pms, 'mar ros');
  assert.strictEqual(pms.calls[0].params.t0, '%mar%');
  assert.strictEqual(pms.calls[0].params.t1, '%ros%');
  assert.match(pms.calls[0].text, /hs\.h LIKE @t0 AND hs\.h LIKE @t1/);
  assert.match(pms.calls[0].text, /COLLATE Latin1_General_CI_AI/);
});

test('cercaClienti: rimuove separatori e jolly; input vuoto → nessuna query', async () => {
  const pms = fakePms([]);
  await cercaClienti(pms, "d'ia.co-x");        // apostrofo/punto/trattino rimossi
  assert.strictEqual(pms.calls[0].params.t0, '%diacox%');
  const pmsJolly = fakePms([]);
  await cercaClienti(pmsJolly, '50%');          // il jolly % viene escapato
  assert.strictEqual(pmsJolly.calls[0].params.t0, '%50[%]%');
  const pmsVuoto = fakePms([]);
  const r = await cercaClienti(pmsVuoto, '   '); // solo spazi → nessun token
  assert.deepStrictEqual(r, []);
  assert.strictEqual(pmsVuoto.calls.length, 0);
});

test('getCliente mappa anagrafica e consensi', async () => {
  const pms = fakePms([{ CodCli: 47186, Cognome: 'DI BARI', Nome: 'ANTONELLA', Telefono: '', Cellulare: '333',
    email: 'a@b.it', Citta: 'TRANI', CodNaz: 'I', dtNascita: '1964-10-17', CodFis: 'XXX', CodVip: '',
    Annotazioni: 'nota pms', Privacy: 'S', Privacy2: 'S', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' }]);
  const a = await getCliente(pms, 47186);
  assert.strictEqual(a.nominativo, 'DI BARI ANTONELLA');
  assert.strictEqual(a.nazione, 'I');
  assert.strictEqual(a.vip, null); // CodVip vuoto → non VIP
  // 'S' = NON autorizzato → consenso false; 'N'/vuoto = consenso true
  assert.deepStrictEqual(a.consensi, { marketing: false, telefonate: false, conservazione: true, cessione: true });
});

test('getCliente restituisce null se non trovato', async () => {
  const pms = fakePms([]);
  assert.strictEqual(await getCliente(pms, 1), null);
});

test('getCliente mappa il VIP (classificazione da TabVip) e il flag indesiderato', async () => {
  const base = { CodCli: 1, Cognome: 'X', Nome: 'Y', Privacy: '', Privacy2: '', PrivacyConservaDati: '', PrivacyCessioneDati: '' };
  // VIP con descrizione
  const c = await getCliente(fakePms([{ ...base, CodVip: 'V5', DesVip: 'PROSECCO IN CAMERA' }]), 1);
  assert.deepStrictEqual(c.vip, { cod: 'V5', descrizione: 'PROSECCO IN CAMERA', indesiderato: false });
  // Ospite indesiderato → riconosciuto dalla descrizione (non dal codice)
  const ind = await getCliente(fakePms([{ ...base, CodVip: 'IN', DesVip: 'OSPITE INDESIDERATO' }]), 1);
  assert.strictEqual(ind.vip.indesiderato, true);
  // Codice senza descrizione in TabVip → fallback al codice
  const fb = await getCliente(fakePms([{ ...base, CodVip: 'ZZ', DesVip: null }]), 1);
  assert.deepStrictEqual(fb.vip, { cod: 'ZZ', descrizione: 'ZZ', indesiderato: false });
  // CodVip vuoto → non VIP
  const no = await getCliente(fakePms([{ ...base, CodVip: '', DesVip: null }]), 1);
  assert.strictEqual(no.vip, null);
});

test('getSoggiorniCliente mappa le righe', async () => {
  const pms = fakePms([{ codpratica: 60397, dtarrivo: '2026-04-17', dtpartenza: '2026-04-19', notti: 2,
    camere: '109', stato: 'Concluso', source: 'DIRETTI', mercato: 'LEISURE INDIVIDUALI', arrangiamento: 855, extra: 40, pianificato: 900 }]);
  const [s] = await getSoggiorniCliente(pms, 47186);
  assert.strictEqual(s.codpratica, 60397);
  assert.strictEqual(s.camere, '109');
  assert.strictEqual(s.arrangiamento, 855);       // arrangiamento per pratica (Matura+StorMatura, codarr non nullo)
  assert.strictEqual(s.extra, 40);                // extra per pratica (city tax esclusa)
  assert.strictEqual(s.importo, 855);             // conclusa → maturato (arrangiamento)
  assert.strictEqual(s.stato, 'Concluso');
  assert.strictEqual(s.source, 'DIRETTI');
  assert.strictEqual(s.mercato, 'LEISURE INDIVIDUALI');
  assert.match(pms.calls[0].text, /IN \(47186\)/);
});

test('getSoggiorniCliente: la query esclude la city tax dagli extra e decodifica la Source', async () => {
  const pms = fakePms([]);
  await getSoggiorniCliente(pms, 47186);
  const sql = pms.calls[0].text;
  assert.match(sql, /codser, ''\)+ <> 'IMP'/);         // city tax (codser=IMP) esclusa
  assert.match(sql, /FROM SourcePrenota src/);          // Source decodificata
  assert.match(sql, /FROM PrenotaProvenienze prov/);    // Mercato (tipologia viaggio) decodificato
  assert.match(sql, /> @dlav THEN 'Pianificata'/);      // prenotazioni future = Pianificata
  assert.match(sql, /< @dlav THEN 'No-show'/);          // arrivo passato mai in casa = No-show
});

test('getSoggiorniCliente: la query marca Eliminata le prenotazioni con DataEliminazione', async () => {
  const pms = fakePms([]);
  await getSoggiorniCliente(pms, 81304);
  const sql = pms.calls[0].text;
  // Il ramo StorPrenota deve etichettare 'Eliminata' (annullate) e non 'Concluso' fisso
  assert.match(sql, /sp\.DataEliminazione IS NOT NULL THEN 'Eliminata'/);
});

test('getSoggiorniCliente: mappa lo stato Eliminata senza alterarlo', async () => {
  const pms = fakePms([{ codpratica: 62152, dtarrivo: '2026-07-28', dtpartenza: '2026-08-04', notti: 7,
    camere: null, stato: 'Eliminata', camereJson: '[]' }]);
  const [s] = await getSoggiorniCliente(pms, 81304);
  assert.strictEqual(s.stato, 'Eliminata');
  assert.strictEqual(s.arrangiamento, 0);
  assert.strictEqual(s.extra, 0);
});

// --- "Nª volta": cosa conta come soggiorno --------------------------------
// L'archivio delle prenotazioni non contiene solo soggiorni. Sui dati veri
// dell'hotel (13/08/2026): 41.337 pratiche archiviate, di cui 12.492 giornate
// (SPA, piscina, cene per esterni), 2.951 senza date e 79 voucher regalo,
// registrati come prenotazioni lunghe un anno perche' quella e' la validita'.
// Contandole tutte, 9.996 ospiti risultavano piu' affezionati di quanto siano e
// 5.363 comparivano come "di ritorno" senza aver mai dormito qui.
const { getStoricoByIds } = require('../src/pms/clienti');

test('il badge conta i soggiorni, le giornate vanno in un conteggio a parte', async () => {
  const pms = fakePms([{ codCli: 70703, n: 1, ultima: '2025-08-10', visite: 6 }]);
  const map = await getStoricoByIds(pms, [70703]);
  assert.deepStrictEqual(map.get(70703), { n: 1, ultima: '2025-08-10', visite: 6 });

  const sql = pms.calls[0].text;
  // Solo le pratiche fra 1 e 200 notti sono soggiorni: sotto c'e' la giornata,
  // sopra il voucher annuale. Le pratiche senza date restano fuori da entrambi,
  // perche' DATEDIFF su una data nulla non rientra in nessun intervallo.
  assert.match(sql, /THEN c\.codpratica END\) AS n/i);
  assert.match(sql, /c\.notti BETWEEN 1 AND 200/i);
  assert.match(sql, /c\.notti = 0 THEN c\.codpratica END\) AS visite/i);
});

test("l'ultima visita e' quella di un soggiorno, non di un voucher", async () => {
  // I voucher hanno una partenza fino a un anno nel futuro: senza il filtro,
  // MAX(dtpartenza) restituirebbe una data che deve ancora arrivare.
  const pms = fakePms([]);
  await getStoricoByIds(pms, [1]);
  assert.match(pms.calls[0].text, /MAX\(CASE WHEN c\.notti BETWEEN 1 AND 200 THEN c\.dtpartenza END\)/i);
});

test('chi e\' venuto solo in giornata non si perde piu\'', async () => {
  // Prima entravano nella mappa solo quelli con n > 0: un cliente abituale
  // della SPA che non ha mai dormito qui risultava sconosciuto.
  const pms = fakePms([{ codCli: 900, n: 0, ultima: null, visite: 3 }]);
  const map = await getStoricoByIds(pms, [900]);
  assert.deepStrictEqual(map.get(900), { n: 0, ultima: null, visite: 3 });
});

test('chi non ha ne\' soggiorni ne\' giornate resta fuori dalla mappa', async () => {
  const pms = fakePms([{ codCli: 901, n: 0, ultima: null, visite: 0 }]);
  const map = await getStoricoByIds(pms, [901]);
  assert.strictEqual(map.has(901), false);
});

// --- Badge "Nª volta" su un ospite con più anagrafiche ----------------------
// Decisione del 20/08/2026. Prima lo storico si leggeva col SOLO codice della
// prenotazione: una pratica intestata al duplicato faceva dire "prima volta" a
// un cliente che la sua scheda dava a tre soggiorni — la stessa applicazione con
// due risposte sullo stesso ospite, cioè proprio quello che la fusione esiste
// per evitare.

// Finto del gestionale: legge il raggruppamento dalla query e conta le pratiche
// DISTINTE di ogni gruppo, come fa COUNT(DISTINCT codpratica) su SQL Server.
function pmsConPratiche(pratiche) {
  return {
    async query(text) {
      const m = text.match(/CASE c\.codCli ((?:WHEN \d+ THEN \d+ ?)+)ELSE c\.codCli END/);
      const rimappa = new Map();
      if (m) for (const w of m[1].matchAll(/WHEN (\d+) THEN (\d+)/g)) rimappa.set(Number(w[1]), Number(w[2]));
      const per = new Map();
      for (const p of pratiche) {
        const k = rimappa.get(p.codCli) || p.codCli;
        if (!per.has(k)) per.set(k, { codCli: k, prat: new Set(), ultima: null });
        const g = per.get(k);
        g.prat.add(p.codpratica);
        if (!g.ultima || p.dtpartenza > g.ultima) g.ultima = p.dtpartenza;
      }
      return [...per.values()].map((g) => ({ codCli: g.codCli, n: g.prat.size, ultima: g.ultima, visite: 0 }));
    },
  };
}

// P4 sta sotto ENTRAMBI i codici: è la stessa pratica, con un codice
// intestatario e l'altro occupante. È il caso che i duplicati producono.
const PRATICHE = [
  { codCli: 1001, codpratica: 'P1', dtpartenza: '2025-06-10' },
  { codCli: 1001, codpratica: 'P2', dtpartenza: '2025-08-01' },
  { codCli: 1201, codpratica: 'P3', dtpartenza: '2026-07-20' },
  { codCli: 1001, codpratica: 'P4', dtpartenza: '2026-08-05' },
  { codCli: 1201, codpratica: 'P4', dtpartenza: '2026-08-05' },
];
const GRUPPI = new Map([[1001, [1001, 1201]], [1201, [1001, 1201]]]);

test('la storia si legge sul gruppo: il duplicato non risulta alla prima visita', () => {
  const pms = pmsConPratiche(PRATICHE);
  return getStoricoByIds(pms, [1001, 1201], GRUPPI).then((m) => {
    assert.strictEqual(m.get(1201).n, 4, 'dal codice duplicato si deve vedere la storia intera');
    assert.deepStrictEqual(m.get(1001), m.get(1201), 'i due codici devono dare la stessa risposta');
  });
});

test('una pratica condivisa fra due codici si conta UNA volta', () => {
  // È il motivo per cui il raggruppamento sta dentro l'interrogazione: sommando
  // i risultati a valle, P4 verrebbe contata due volte e il badge direbbe "5ª".
  const pms = pmsConPratiche(PRATICHE);
  return getStoricoByIds(pms, [1001, 1201], GRUPPI).then((m) => {
    assert.strictEqual(m.get(1001).n, 4);
    assert.notStrictEqual(m.get(1001).n, 5, 'P4 è una pratica sola, non due');
  });
});

test('senza fusioni ogni codice resta per sé, come prima', () => {
  const pms = pmsConPratiche(PRATICHE);
  return getStoricoByIds(pms, [1001, 1201]).then((m) => {
    assert.strictEqual(m.get(1001).n, 3); // P1 P2 P4
    assert.strictEqual(m.get(1201).n, 2); // P3 P4
  });
});

// --- Il caso vero: la mappa dei gruppi NON copre tutti i codici -------------
// Trovato dal collaudo a piu' revisori del 20/08/2026. Negli arrivi `gruppi`
// viene costruita sui codici delle prenotazioni del giorno, mentre la storia si
// chiede su quei codici PIU' tutti i membri dei loro gruppi. I test sopra
// passavano una mappa che copriva tutti gli id — condizione che in esercizio
// non si verifica mai — e nascondevano il difetto.

test('la mappa dei gruppi copre solo il codice della prenotazione', () => {
  // Pratica intestata a 1001, che e' anche l'unica chiave della mappa. Prima
  // 1201 non trovava il proprio gruppo, restava per se' e la storia si spezzava.
  const pms = pmsConPratiche(PRATICHE);
  const soloUnaChiave = new Map([[1001, [1001, 1201]]]);
  return getStoricoByIds(pms, [1001, 1201], soloUnaChiave).then((m) => {
    assert.strictEqual(m.get(1001).n, 4, 'la storia del gruppo va sommata anche da questo lato');
    assert.deepStrictEqual(m.get(1001), m.get(1201));
  });
});

test('un gruppo di tre codici si somma tutto, da qualunque dei tre', () => {
  // Caso reale Brolin: 48758 / 55491 / 31355.
  const pratiche = [
    { codCli: 48758, codpratica: 'B1', dtpartenza: '2023-07-10' },
    { codCli: 48758, codpratica: 'B2', dtpartenza: '2024-07-10' },
    { codCli: 31355, codpratica: 'B3', dtpartenza: '2025-07-10' },
    { codCli: 55491, codpratica: 'B4', dtpartenza: '2026-07-10' },
    { codCli: 55491, codpratica: 'B5', dtpartenza: '2026-08-01' },
  ];
  const membri = [48758, 55491, 31355];
  // Come negli arrivi: la pratica di oggi e' intestata a 55491, quindi la mappa
  // ha una chiave sola.
  const gruppi = new Map([[55491, membri]]);
  const pms = pmsConPratiche(pratiche);
  return getStoricoByIds(pms, membri, gruppi).then((m) => {
    for (const id of membri) {
      assert.strictEqual(m.get(id).n, 5, `dal codice ${id} si devono vedere tutte e cinque`);
    }
    assert.strictEqual(m.get(55491).ultima, '2026-08-01');
  });
});

test('un membro del gruppo non chiesto entra comunque nel conto', () => {
  // Chi chiama passa un codice solo: la storia del gruppo dev'essere intera lo
  // stesso, altrimenti la card mostra un numero piu' basso del vero.
  const pms = pmsConPratiche(PRATICHE);
  const gruppi = new Map([[1001, [1001, 1201]]]);
  return getStoricoByIds(pms, [1001], gruppi).then((m) => {
    assert.strictEqual(m.get(1001).n, 4);
  });
});
