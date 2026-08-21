// Pagina Analytics.
//
// Sta in un file suo, come export.js, e usa le funzioni globali di app.js
// (api, esc, fmtData, $, $$): l'applicazione non ha un sistema di moduli né un
// passaggio di compilazione, e aggiungere l'uno o l'altro per una pagina
// sarebbe sproporzionato.
//
// Due blocchi con dati di qualità molto diversa, e il motivo per cui sono
// separati: gli ospiti li racconta il gestionale (81.792 anagrafiche, ~2.400
// soggiorni l'anno), la conoscenza che ne abbiamo la racconta il CRM, che
// contiene poche decine di preferenze. Il secondo blocco quindi non misura il
// business ma la COPERTURA: "quanto ne stiamo raccogliendo" è una domanda che
// ha senso anche partendo da zero, "cosa dicono i dati raccolti" no.
//
// OGNI numero di questa pagina porta la sua definizione addosso, con la
// iconcina (i) usata nel resto dell'applicazione. Non è pignoleria: gli stessi
// dati si contano in modi diversi da un riquadro all'altro — i canali contano
// SOGGIORNI, le nazionalità contano PERSONE, il blocco del CRM è quasi tutto
// complessivo e non risente del periodo — e senza dirlo due riquadri vicini
// sembrano confrontabili quando non lo sono.

let analyticsInited = false;
let analyticsPeriodo = '12m';
// Il periodo scelto con i pulsanti si RISOLVE in due date, che finiscono nei
// campi perché si veda su cosa si sta guardando. Ma quelle date non sono una
// scelta dell'operatore: prenderle per tali congelava il periodo al primo
// caricamento — bastava spuntare "Solo ospiti VIP" perché l'intestazione
// smettesse di dire "tutto lo storico" e dicesse "3754 giorni", con il pulsante
// ancora acceso. Qui si tiene distinto chi ha scritto quelle date.
let analyticsDateManuali = false;
// La spunta "solo VIP" sta DENTRO il riquadro dei consumi, che è l'unico posto
// in cui fa qualcosa: nella barra in cima prometteva di filtrare tutta la
// pagina e ne toccava un riquadro su sette — gli altri sei restavano identici
// cifra per cifra, senza nessun avviso (spostata il 20/08/2026).
// Lo stato vive qui e non nell'elemento, perché il riquadro viene ridisegnato a
// ogni caricamento e la casella sparirebbe insieme alla sua spunta.
let analyticsSoloVip = false;

const anNum = (n) => Number(n || 0).toLocaleString('it-IT');

// La iconcina (i): stessa classe e stesso meccanismo del resto dell'app, così
// la spiegazione si legge dove ci si aspetta di trovarla.
const anInfo = (tip) => (tip ? ` <span class="info info-wide" data-tip="${esc(tip)}">i</span>` : '');

// Sotto ogni numero c'era una freccia ▲▼ col confronto sul periodo precedente,
// della stessa lunghezza. Tolta il 18/08/2026, decisione di Mik: in un albergo
// stagionale quel confronto è sbagliato e non solo inutile — trenta giorni di
// agosto contro trenta di luglio danno un "+40%" che racconta la stagione, non
// l'hotel. Il confronto che avrebbe senso è con lo stesso periodo dell'anno
// prima, ed è un altro lavoro. Quello che questa pagina deve dire sul tempo è
// un'altra cosa, e ora la dice: quanto si è raccolto nel periodo (anRitmo).
function anKpi(etichetta, valore, tip) {
  return `<div class="an-kpi">
    <div class="an-kpi-n">${anNum(valore)}</div>
    <div class="an-kpi-l">${esc(etichetta)}${anInfo(tip)}</div>
  </div>`;
}

// "Scritto nel periodo": l'unico numero del blocco CRM che si muove. Gli altri
// quattro sono cumulativi e possono solo salire, quindi da soli non distinguono
// un CRM che cresce piano da uno abbandonato sei mesi fa.
function anRitmo(s) {
  const voci = [
    [s.preferenze, 'preferenza', 'preferenze'],
    [s.allergie, 'allergia', 'allergie'],
    [s.reclami, 'reclamo', 'reclami'],
  ].filter(([n]) => n > 0).map(([n, uno, molti]) => `<b>${anNum(n)}</b> ${n === 1 ? uno : molti}`);
  const testo = voci.length
    ? `Scritto nel periodo: ${voci.join(' · ')}.`
    : 'Nel periodo scelto non è stato registrato niente.';
  return `<p class="an-ritmo${voci.length ? '' : ' an-ritmo-fermo'}">${testo}${anInfo(T.ritmo)}</p>`;
}

// Classifica a barre. Niente libreria di grafici: la barra è la larghezza di un
// elemento in percentuale sul primo della lista, che è tutto quello che serve
// per confrontare a colpo d'occhio.
function anBarre(voci, opzioni) {
  const { suffisso = '', vuoto = 'Nessun dato nel periodo.' } = opzioni || {};
  const righe = (voci || []).filter((v) => v && v.n);
  if (!righe.length) return `<p class="an-vuoto">${esc(vuoto)}</p>`;
  const max = righe[0].n || 1;
  return `<div class="an-barre">${righe.map((v) => `
    <div class="an-barra">
      <span class="an-barra-l" title="${esc(v.voce)}">${esc(v.voce)}</span>
      <span class="an-barra-t"><i style="width:${Math.max(2, Math.round((v.n / max) * 100))}%"></i></span>
      <span class="an-barra-n">${anNum(v.n)}${esc(suffisso)}${v.euro != null ? ` <em>${anNum(v.euro)} €</em>` : ''}</span>
    </div>`).join('')}</div>`;
}

// Andamento mensile: una spezzata in SVG disegnata a mano. Con un mese solo
// (periodo di sette giorni) non si mostra niente — un grafico con un punto non
// aggiunge nulla a quel punto.
function anAndamento(serie, perAnno) {
  const s = (serie || []).filter((p) => p && p.mese);
  if (s.length < 2) return '';
  // Il punto è un mese (`2026-08`) o un anno (`2026`): sotto si scrive "08/26"
  // oppure "2026", e la scelta la fa il server insieme al raggruppamento.
  const etichetta = (p) => (perAnno ? p.mese : `${p.mese.slice(5)}/${p.mese.slice(2, 4)}`);
  const max = Math.max(...s.map((p) => p.n), 1);
  const L = 640;
  const H = 120;
  const pad = 6;
  const x = (i) => pad + (i * (L - pad * 2)) / Math.max(s.length - 1, 1);
  const y = (n) => H - pad - ((n / max) * (H - pad * 2));
  const punti = s.map((p, i) => `${x(i).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ');
  const area = `${pad},${H - pad} ${punti} ${(L - pad).toFixed(1)},${H - pad}`;
  return `<div class="an-trend">
    <svg viewBox="0 0 ${L} ${H}" preserveAspectRatio="none" role="img" aria-label="Soggiorni conclusi per ${perAnno ? 'anno' : 'mese'}">
      <polygon class="an-trend-area" points="${area}"></polygon>
      <polyline class="an-trend-linea" points="${punti}"></polyline>
    </svg>
    <div class="an-trend-x">${s.map((p) => `<span>${esc(etichetta(p))}</span>`).join('')}</div>
  </div>`;
}

function anSezione(titolo, corpo, nota, tip) {
  return `<section class="an-sez">
    <h2 class="an-h">${esc(titolo)}${anInfo(tip)}${nota ? ` <span class="an-nota">${esc(nota)}</span>` : ''}</h2>
    ${corpo}</section>`;
}

// Le definizioni, in un posto solo. Stanno qui e non sparse nel disegno della
// pagina perché sono la parte che va tenuta d'accordo con le interrogazioni:
// quando cambia il modo di contare si cambia qui, accanto al nome del numero.
const T = {
  ospitiSez: 'Numeri presi dal gestionale, che li ha tutti. Un soggiorno entra nel periodo quando ci FINISCE, non quando comincia: a quel punto è concluso e i consumi sono stati registrati tutti.',
  ospiti: 'Quante persone diverse hanno concluso un soggiorno nel periodo. Chi è tornato più volte conta una volta sola. Si conta l’ospite intestatario della prenotazione, non chi lo accompagna in camera. Due anagrafiche della stessa persona non ancora collegate contano due.',
  soggiorni: 'Quante prenotazioni si sono concluse nel periodo, da 1 a 200 notti. Lo stesso ospite può contarne più d’una, quindi il numero non è mai minore di Ospiti unici. Fuori i day use, che non sono soggiorni, e i voucher regalo, registrati come prenotazioni lunghe un anno.',
  diRitorno: 'Quanti, fra gli ospiti del periodo, avevano già dormito qui prima di questo soggiorno. Guarda tutta la loro storia e non solo il periodo scelto: allargare o stringere la finestra non cambia chi è di ritorno.',
  vip: 'Quanti, fra gli ospiti del periodo, hanno OGGI una classificazione VIP in anagrafica. La classificazione non è storicizzata: chi lo è diventato dopo il soggiorno conta lo stesso, e chi non lo è più non conta.',
  nottiMedie: 'Notti totali diviso soggiorni conclusi nel periodo: è la media di un soggiorno, non di un ospite. Chi è venuto due volte pesa due volte.',
  andamento: 'Quanti soggiorni si sono conclusi in ciascun mese: serve a vedere la forma della stagione. Il mese è quello della partenza. Oltre i due anni i punti diventano gli anni, perché un’etichetta per mese su tutto lo storico non si leggerebbe. Su un mese solo il grafico non compare.',
  canali: 'Da dove è arrivata la prenotazione: diretto, portali, tour operator, agenzie. Si contano i SOGGIORNI, non le persone — al contrario delle nazionalità qui accanto. Solo i primi otto canali.',
  nazioni: 'La nazione registrata in anagrafica, scritta con il codice del gestionale. Si contano le PERSONE, non i soggiorni — al contrario dei canali qui accanto. Chi non ce l’ha compare come «Non indicata»: si mostra apposta, nasconderla falserebbe le proporzioni.',
  vipClass: 'Come sono classificati gli ospiti VIP del periodo. Ogni ospite ha una classificazione sola, quindi compare in una riga sola; chi non è VIP non compare affatto. Solo le prime otto.',
  consumi: 'Quante volte ciascun articolo è stato ordinato, non quanti pezzi. Il periodo è quello dell’ordinazione, non del soggiorno. La spunta «Solo ospiti VIP» vale SOLO per questo riquadro e guarda chi occupava la camera: se in famiglia uno solo è VIP, contano tutte le ordinazioni di quella camera.',
  spa: 'Trattamenti SPA addebitati nel periodo: quante volte ciascuno e quanto ha fatto. Sta in un riquadro a parte perché la SPA non passa dalle ordinazioni del ristorante, ed è esclusa dai consumi qui accanto per non contarla due volte.',

  crmSez: 'Qui non si misura l’andamento dell’hotel ma quanto il CRM ha imparato, e quanto viene usato. Salvo dove è scritto il contrario, questi numeri sono COMPLESSIVI: non cambiano cambiando il periodo scelto sopra.',
  ritmo: 'Quante preferenze, allergie e reclami sono stati registrati nel periodo scelto. È l’unico numero di questo blocco che si muove: gli altri sono complessivi e possono solo salire, quindi da soli non distinguono un CRM che cresce piano da uno lasciato lì.',
  conPreferenze: 'Quanti clienti hanno almeno una preferenza registrata nel CRM. Si contano le persone, non le preferenze. È un totale complessivo e non dipende dal periodo scelto.',
  conAllergie: 'Quanti clienti hanno almeno un’allergia o un’intolleranza registrata nel CRM. Si contano le persone. È un totale complessivo e non dipende dal periodo scelto.',
  conNote: 'Quanti clienti hanno una nota personale scritta nella loro scheda. Si contano le persone. È un totale complessivo e non dipende dal periodo scelto.',
  fuse: 'Quante anagrafiche doppie sono state collegate alla scheda principale della stessa persona. Se una persona aveva tre schede e sono state riunite, qui conta due. Il collegamento è reversibile e non cancella niente.',
  qualita: 'Quanti ospiti del periodo hanno l’anagrafica incompleta: sono le persone da completare al prossimo contatto. Senza telefono vuol dire senza fisso e senza cellulare. A differenza del resto del blocco, questo riquadro dipende dal periodo scelto.',
  prefReparto: 'Quante preferenze sono state registrate per ciascun reparto. Qui si contano le PREFERENZE e non le persone: uno stesso cliente può averne più d’una, anche nello stesso reparto. Totale complessivo, non del periodo.',
  accessiUtente: 'Quante volte ciascuno è entrato nell’applicazione nel periodo scelto. Solo gli accessi riusciti. Dice chi la sta usando, non quanto ci lavora dentro. Solo i primi otto.',
  duplicati: 'Gruppi di anagrafiche che sembrano la stessa persona e su cui nessuno ha ancora deciso. Un gruppo esce dalla coda quando tutti i suoi codici sono stati collegati fra loro. Totale complessivo, non del periodo.',
  reclami: 'Reclami ancora aperti, cioè senza una risoluzione registrata. Accanto: quanti ne sono stati raccolti in tutto, e quanti aspettano ancora di essere assegnati a un reparto e a una categoria. Totali complessivi, non del periodo.',
  accessi: 'Accessi riusciti nel periodo, con quante persone diverse sono entrate e in quanti giorni diversi. Risponde a «l’applicazione viene aperta?», non a che cosa ci si fa dentro. I tentativi falliti non compaiono qui.',
  ai: 'Quante volte è stata chiesta una generazione all’AI nel periodo, quante proposte ha restituito e quante ne sono state accettate. Proposte e accettate insieme dicono quanto le proposte sono utili.',
};

function renderAnalytics(d) {
  const o = d.ospiti || {};
  const crm = d.crm || {};
  const c = crm.copertura || {};
  const q = d.qualitaAnagrafica || {};
  const acc = crm.accessi || {};
  const rec = crm.reclami || {};
  // Nullo quando il conteggio non e' stato possibile: il riquadro sparisce
  // invece di mostrare uno zero che sembrerebbe "nessun duplicato".
  const dup = crm.duplicati || null;
  const scritte = crm.scritteNelPeriodo || {};

  // Solo se ci sono almeno due mesi: altrimenti resterebbe l'intestazione di un
  // grafico che non c'è.
  const perAnno = !!d.andamentoPerAnno;
  const trend = anAndamento(d.andamento, perAnno);
  // La spunta sta accanto ai numeri che restringe, non in cima alla pagina: è
  // l'unico riquadro su cui agisce, e da lassù sembrava valere per tutti.
  const spuntaVip = `<label class="check an-vip"><input type="checkbox" id="an-vip"${d.soloVip ? ' checked' : ''} /> Solo ospiti VIP</label>`;

  const blocA = `
    <div class="an-kpis">
      ${anKpi('Ospiti unici', o.ospiti, T.ospiti)}
      ${anKpi('Soggiorni', o.soggiorni, T.soggiorni)}
      ${anKpi('Di ritorno', o.diRitorno, T.diRitorno)}
      ${anKpi('VIP', o.vip, T.vip)}
      ${anKpi('Notti medie', o.nottiMedie, T.nottiMedie)}
    </div>
    ${trend ? anSezione(`Soggiorni conclusi per ${perAnno ? 'anno' : 'mese'}`, trend, null, T.andamento) : ''}
    <div class="an-griglia">
      ${anSezione('Canali di prenotazione', anBarre(d.canali), 'soggiorni', T.canali)}
      ${anSezione('Nazionalità degli ospiti', anBarre(d.nazioni), 'persone', T.nazioni)}
      ${anSezione('Classificazioni VIP', anBarre(d.vip), 'persone', T.vipClass)}
    </div>
    <div class="an-griglia an-griglia-2">
      ${anSezione('Consumi F&B', spuntaVip + anBarre(d.consumi), 'ordinazioni', T.consumi)}
      ${anSezione('SPA', anBarre(d.spa), 'trattamenti', T.spa)}
    </div>`;

  const aiRighe = (crm.ai || []).map((a) => `<div class="an-minore">
      <b>${anNum(a.generati)}</b> ${esc(a.funzione)}${anInfo(T.ai)}
      <small>${anNum(a.proposte)} proposte · ${anNum(a.accettati)} accettate</small></div>`).join('');

  // La nota del riquadro qualità porta il totale su cui è calcolato: "141 senza
  // email" da solo non dice se sono tanti. Il numero è lo stesso di Ospiti
  // unici, ed è l'unica frazione della pagina in cui numeratore e denominatore
  // guardano la stessa popolazione.
  const notaQualita = q.ospiti ? `su ${anNum(q.ospiti)} ospiti del periodo` : 'fra gli ospiti del periodo';

  const blocB = `
    <div class="an-kpis">
      ${anKpi('Con preferenze', c.conPreferenze, T.conPreferenze)}
      ${anKpi('Con allergie', c.conAllergie, T.conAllergie)}
      ${anKpi('Con note personali', c.conNotePersonali, T.conNote)}
      ${anKpi('Anagrafiche collegate', c.anagraficheFuse, T.fuse)}
    </div>
    <p class="an-cop">Clienti di cui conosciamo almeno una preferenza: <b>${anNum(c.conPreferenze)}</b>.
      È il numero da far salire: misura quanto il CRM sta diventando utile.
      <span class="an-su">Sono tutti i clienti conosciuti finora, non solo quelli del periodo.</span></p>
    ${anRitmo(scritte)}
    <div class="an-griglia">
      ${anSezione('Anagrafiche da completare', anBarre([
    { voce: 'Senza email', n: q.senzaEmail },
    { voce: 'Senza telefono', n: q.senzaTelefono },
    { voce: 'Senza data di nascita', n: q.senzaDataNascita },
  ], { vuoto: 'Tutte complete.' }), notaQualita, T.qualita)}
      ${anSezione('Preferenze per reparto', anBarre(crm.preferenzePerReparto), 'in tutto', T.prefReparto)}
      ${anSezione('Chi usa l\'applicazione', anBarre(acc.perUtente, { suffisso: ' accessi', vuoto: 'Nessun accesso registrato nel periodo.' }), 'nel periodo', T.accessiUtente)}
    </div>
    <div class="an-minori">
      ${dup ? `<a class="an-minore" href="#duplicati">
        <b>${anNum(dup.daGestire)}</b> duplicati da gestire${anInfo(T.duplicati)}
        <small>${anNum(dup.gestiti)} già associati · apri la pagina</small></a>` : ''}
      <div class="an-minore"><b>${anNum(rec.aperti)}</b> reclami aperti${anInfo(T.reclami)}
        <small>${anNum(rec.totali)} in tutto · ${anNum(rec.daClassificare)} da classificare</small></div>
      <div class="an-minore"><b>${anNum(acc.riusciti)}</b> accessi${anInfo(T.accessi)}
        <small>${anNum(acc.utentiAttivi)} utenti in ${anNum(acc.giorniConAccessi)} giorni</small></div>
      ${aiRighe || `<div class="an-minore an-minore-vuoto"><b>—</b> uso dell’AI${anInfo(T.ai)}<small>nessuna generazione registrata finora</small></div>`}
    </div>`;

  // Su "tutto lo storico" le due date restano — dicono da quando il gestionale
  // ha memoria, che è un'informazione — ma "4.542 giorni" non lo direbbe
  // nessuno: al posto suo il nome di quello che si sta guardando.
  return `<div class="an-periodo-eco">Periodo <b>${fmtData(d.periodo.da)} → ${fmtData(d.periodo.a)}</b>
      <span>${d.periodo.tutto ? 'tutto lo storico' : `${d.periodo.giorni} giorni`}</span></div>
    ${anSezione('I nostri ospiti', blocA, 'dal gestionale', T.ospitiSez)}
    ${anSezione('Quanto conosciamo gli ospiti', blocB, 'dal CRM', T.crmSez)}`;
}

async function loadAnalytics() {
  const msg = $('#analytics-msg');
  const corpo = $('#analytics-body');
  msg.innerHTML = '<span class="caricamento"><span class="spinner"></span>Caricamento…</span>';
  msg.hidden = false;
  corpo.hidden = true;

  const p = new URLSearchParams();
  const da = $('#an-da').value;
  const a = $('#an-a').value;
  if (analyticsDateManuali && da && a) { p.set('da', da); p.set('a', a); } else { p.set('periodo', analyticsPeriodo); }
  if (analyticsSoloVip) p.set('vip', '1');

  const { status, body } = await api(`/api/analytics?${p.toString()}`);
  if (status !== 200) {
    msg.textContent = (body && body.error) || 'Impossibile calcolare le statistiche.';
    return;
  }
  corpo.innerHTML = renderAnalytics(body);
  msg.hidden = true;
  corpo.hidden = false;
  // Le date del periodo scelto tornano nei campi: si vede su cosa si sta
  // guardando, e da lì si può ritoccare a mano.
  if (!analyticsDateManuali) { $('#an-da').value = body.periodo.da; $('#an-a').value = body.periodo.a; }
}

function initAnalytics() {
  if (!analyticsInited) {
    $('#an-periodi').addEventListener('click', (e) => {
      const b = e.target.closest('[data-periodo]');
      if (!b) return;
      analyticsPeriodo = b.dataset.periodo;
      analyticsDateManuali = false;
      // Il predefinito vince sul personalizzato: lasciare le date vecchie nei
      // campi farebbe credere che il periodo mostrato sia quello.
      $('#an-da').value = '';
      $('#an-a').value = '';
      $$('#an-periodi .chip').forEach((c) => c.classList.toggle('is-on', c === b));
      loadAnalytics();
    });
    // Il periodo personalizzato parte solo con tutte e due le date: ricaricare a
    // metà darebbe un errore ogni volta che si tocca il primo campo.
    ['#an-da', '#an-a'].forEach((sel) => {
      $(sel).addEventListener('change', () => {
        if ($('#an-da').value && $('#an-a').value) {
          analyticsDateManuali = true;
          $$('#an-periodi .chip').forEach((c) => c.classList.remove('is-on'));
          loadAnalytics();
        }
      });
    });
    // Delega su un contenitore fisso: la casella vive dentro il riquadro dei
    // consumi, che viene ridisegnato a ogni caricamento — un ascoltatore
    // attaccato a lei si perderebbe al primo aggiornamento.
    $('#analytics-body').addEventListener('change', (e) => {
      if (e.target && e.target.id === 'an-vip') { analyticsSoloVip = e.target.checked; loadAnalytics(); }
    });
    analyticsInited = true;
  }
  loadAnalytics();
}

// app.js gira per primo e chiama route() alla fine: se si arriva direttamente su
// #analytics, quando route() cerca initAnalytics questo file non è ancora stato
// eseguito. Qui si recupera il caso, come fa export.js con i suoi agganci.
if ((location.hash || '').split('/')[0] === '#analytics' && typeof puo === 'function' && puo('vedi-analytics')) {
  initAnalytics();
}
