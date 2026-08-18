const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// I tooltip sono l'unica documentazione che l'utente legge davvero, e sono anche
// la prima cosa che smette di essere vera quando il comportamento cambia. Questi
// test non giudicano lo stile: fissano le affermazioni che il 18/08/2026 erano
// diventate FALSE, e la regola che nessuna pastiglia resti senza spiegazione.

const web = (f) => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8');
const HTML = web('index.html');
const APP = web('app.js');
const AN = web('analytics.js');

const tips = (src) => [...src.matchAll(/data-tip="([^"]*)"/g)].map((m) => m[1]);

test('nessun tooltip dice più che il nucleo si compila solo alla prima apertura', () => {
  // Dal 14/08 il controllo si rifà a ogni apertura della scheda.
  const nucleo = tips(HTML).find((x) => x.startsWith("Chi viaggia con l'ospite"));
  assert.ok(nucleo, 'il tooltip del nucleo dev\'essere ancora lì');
  assert.doesNotMatch(nucleo, /prima apertura/i);
  assert.match(nucleo, /a ogni apertura/i);
  assert.match(nucleo, /non torna/i, 'va detto che chi si toglie non rientra');
});

test('prima e ultima visita: i day use sono visite, non soggiorni', () => {
  const v = tips(HTML).find((x) => x.startsWith("Prima e ultima volta"));
  assert.ok(v);
  assert.match(v, /day use/i);
  assert.doesNotMatch(v, /soggiorno valido/i, 'la vecchia formula contraddiceva la regola del 18/08');
});

test('i soggiorni non comprendono i day use, e lo dicono', () => {
  const s = tips(HTML).find((x) => x.includes('dormito qui'));
  assert.ok(s);
  assert.match(s, /day use/i);
  assert.match(s, /valore storico/i, 'va detto che la spesa resta');
});

test('nessun tooltip parla il linguaggio del database', () => {
  // "codalb" è il nome di una colonna: chi sta al banco non deve incontrarlo.
  const tecnici = [/codalb/i, /codclinterm/i, /codpratica/i, /StorPrenota/i, /flgincasa/i, /\bNVARCHAR\b/i,
    /\bCodVip\b/, /\bAnagra\b/, /\bStorMatura\b/, /\bStorComanda\b/, /\bCodNaz\b/];
  for (const t of tips(HTML).concat(tips(APP), Object.values(anTips()))) {
    for (const brutto of tecnici) {
      assert.doesNotMatch(t, brutto, `tooltip troppo tecnico: ${t.slice(0, 70)}…`);
    }
  }
});

test('ogni pastiglia di filtro spiega che cosa comprende', () => {
  // "Alert" è il caso peggiore: nessuno può indovinare che sono le allergie
  // OPPURE gli ospiti indesiderati.
  for (const nome of ['BRIEF_CHIPS', 'INCASA_CHIPS']) {
    const inizio = APP.indexOf(`const ${nome} = [`);
    assert.notStrictEqual(inizio, -1, `${nome} non trovato`);
    const blocco = APP.slice(inizio, APP.indexOf('\n];', inizio));
    const chiavi = [...blocco.matchAll(/\{ key: '([^']+)'/g)].map((m) => m[1]);
    const conTip = [...blocco.matchAll(/tip: '/g)].length;
    assert.strictEqual(conTip, chiavi.length, `${nome}: ${chiavi.length} pastiglie ma ${conTip} spiegazioni`);
  }
  const alert = APP.match(/key: 'alert'[\s\S]*?tip: '([^']*(?:\'[^']*)*)'/);
  assert.ok(alert && /indesiderato/.test(alert[1]), 'la pastiglia Alert deve dire che comprende gli indesiderati');
});

test('in Analytics non torna il confronto col periodo precedente', () => {
  // Tolto il 18/08/2026: in un albergo stagionale confrontare agosto con luglio
  // racconta la stagione, non l'hotel. Se un giorno si rifà, dev'essere con lo
  // stesso periodo dell'anno prima — un altro calcolo, non questo.
  assert.doesNotMatch(AN, /an-delta/);
  assert.doesNotMatch(AN, /anDelta/);
  assert.doesNotMatch(AN, /confronto con \$\{fmtData/);
});

// Le definizioni dei numeri di Analytics, estratte dall'oggetto T di
// web/analytics.js: sono la parte che va tenuta d'accordo con le
// interrogazioni, e questi test ne fissano le affermazioni che non possono
// diventare false in silenzio.
const anTips = () => {
  const inizio = AN.indexOf('const T = {');
  assert.notStrictEqual(inizio, -1, 'le definizioni di Analytics non si trovano più');
  const blocco = AN.slice(inizio, AN.indexOf('\n};', inizio));
  const voci = {};
  for (const m of blocco.matchAll(/^  (\w+): '([^']*)',$/gm)) voci[m[1]] = m[2];
  return voci;
};

test('il conteggio VIP di Analytics dichiara di misurare il presente', () => {
  // Il VIP non è storicizzato: il numero cambia da solo quando qualcuno tocca
  // una classificazione in anagrafica.
  const vip = anTips().vip;
  assert.ok(vip, 'manca la definizione del riquadro VIP');
  assert.match(vip, /OGGI/);
  assert.match(vip, /non è storicizzat/);
});

test('ogni numero di Analytics ha la sua definizione', () => {
  // Un riquadro senza (i) è un numero che l'utente deve indovinare.
  const senzaTip = [...AN.matchAll(/\$\{anKpi\((.*)\)\}/g)].filter((m) => !/T\.\w+/.test(m[1]));
  assert.deepStrictEqual(senzaTip.map((m) => m[1]), [], 'ci sono riquadri KPI senza spiegazione');
  const sezioni = [...AN.matchAll(/anSezione\('([^']+)'[^\n]*\)/g)];
  assert.ok(sezioni.length >= 8, `trovate solo ${sezioni.length} sezioni: la ricerca non guarda dove crede`);
  for (const s of sezioni) {
    assert.match(s[0], /T\.\w+/, `la sezione "${s[1]}" non ha una spiegazione`);
  }
});

test('le definizioni di Analytics dicono che cosa contano', () => {
  // Due riquadri affiancati che contano cose diverse sono la trappola peggiore
  // della pagina: i canali contano soggiorni, le nazionalità contano persone.
  const t = anTips();
  assert.match(t.canali, /SOGGIORNI/);
  assert.match(t.nazioni, /PERSONE/);
  assert.match(t.prefReparto, /PREFERENZE/);
  // Ospiti unici e Soggiorni si assomigliano e non lo sono: va detto in che
  // rapporto stanno.
  assert.match(t.ospiti, /una volta sola/);
  assert.match(t.soggiorni, /Ospiti unici/);
  // Il blocco del CRM è quasi tutto complessivo, quello del gestionale no.
  assert.match(t.crmSez, /non cambiano cambiando il periodo/);
  for (const k of ['conPreferenze', 'conAllergie', 'conNote']) {
    assert.match(t[k], /non dipende dal periodo/, `${k} non dice di essere complessivo`);
  }
  // L'eccezione dentro il blocco complessivo va dichiarata, altrimenti si legge
  // con la regola del vicino.
  assert.match(t.qualita, /dipende dal periodo scelto/);
});

test('il blocco CRM dice anche quanto si è raccolto nel periodo', () => {
  // I quattro numeri complessivi possono solo salire: da soli non distinguono un
  // CRM che cresce piano da uno lasciato lì. La riga del ritmo è l'unica che
  // risponde a "stiamo raccogliendo?", ed è il dato che il server calcolava e
  // buttava via.
  assert.match(AN, /crm\.scritteNelPeriodo/, 'il ritmo non è collegato al dato del server');
  assert.match(AN, /\$\{anRitmo\(scritte\)\}/, 'la riga del ritmo non è disegnata');
  const t = anTips().ritmo;
  assert.ok(t, 'la riga del ritmo non ha la sua spiegazione');
  assert.match(t, /nel periodo scelto/i);
  // Il singolare esiste: "1 preferenze" è il genere di dettaglio che fa sembrare
  // sciatta una pagina per il resto curata.
  assert.match(AN, /n === 1 \? uno : molti/);
});

test('la copertura non mescola due popolazioni diverse', () => {
  // La riga diceva "N su M ospiti del periodo" con N complessivo e M del
  // periodo: su una finestra corta poteva mostrare più clienti che ospiti.
  const cop = AN.slice(AN.indexOf('class="an-cop"'), AN.indexOf('</p>', AN.indexOf('class="an-cop"')));
  assert.doesNotMatch(cop, /ospiti del periodo/, 'numeratore complessivo e denominatore del periodo');
  assert.match(cop, /non solo quelli del periodo/, 'va detto che il numero è complessivo');
});

test('nessun tooltip contiene una data', () => {
  // L'applicazione è ancora in sviluppo e non l'ha usata nessuno: i dati sono
  // di prova. Una data in un suggerimento ("si raccoglie dal 13/08") racconta
  // la storia dello sviluppo, che a chi legge non serve, e invecchia da sola.
  // Le date delle decisioni stanno nei commenti e nel documento funzionale,
  // non davanti all'utente.
  const dentroCodice = [...APP.matchAll(/tip: '([^']*)'/g)].map((m) => m[1]);
  const dentroAnalytics = [...AN.matchAll(/<small>([^<]*)<\/small>/g)].map((m) => m[1]);
  const tutti = tips(HTML).concat(tips(APP), dentroCodice, dentroAnalytics, Object.values(anTips()));
  assert.ok(tutti.length > 20, `trovati solo ${tutti.length} testi: la ricerca non guarda dove crede`);
  for (const x of tutti) {
    assert.doesNotMatch(x, /\d{1,2}\/\d{1,2}\/20\d\d/, `data nell'interfaccia: ${x.slice(0, 70)}…`);
    assert.doesNotMatch(x, /\bdal \d{1,2}\/\d{1,2}\b/, `data nell'interfaccia: ${x.slice(0, 70)}…`);
  }
});


test('i tooltip restano brevi', () => {
  // Non sono documentazione: se servono più di trecento caratteri, la schermata
  // ha un problema che un tooltip non risolve.
  for (const t of tips(HTML).concat(tips(APP), Object.values(anTips()))) {
    assert.ok(t.length <= 340, `tooltip troppo lungo (${t.length}): ${t.slice(0, 60)}…`);
  }
});
