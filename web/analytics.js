// Pagina Analytics.
//
// Sta in un file suo, come export.js, e usa le funzioni globali di app.js
// (api, esc, fmtData, $, $$): l'applicazione non ha un sistema di moduli né un
// passaggio di compilazione, e aggiungere l'uno o l'altro per una pagina
// sarebbe sproporzionato.
//
// Due blocchi con dati di qualità molto diversa, e il motivo per cui sono
// separati: gli ospiti li racconta il gestionale (81.792 anagrafiche, ~2.400
// soggiorni l'anno), la conoscenza che ne abbiamo la racconta il CRM, che al
// 13/08/2026 conteneva 64 preferenze su 14 clienti. Il secondo blocco quindi non
// misura il business ma la COPERTURA: "quanto ne stiamo raccogliendo" è una
// domanda che ha senso anche partendo da zero, "cosa dicono i dati raccolti" no.

let analyticsInited = false;
let analyticsPeriodo = '12m';

const anNum = (n) => Number(n || 0).toLocaleString('it-IT');

// La freccia del confronto col periodo precedente. Quando prima non c'era nulla
// il server manda null e qui non si disegna niente: una crescita percentuale
// calcolata su zero è un numero senza significato che sembra un risultato.
function anDelta(v) {
  if (v == null) return '';
  if (v === 0) return '<span class="an-delta an-delta-fermo">= stabile</span>';
  const su = v > 0;
  return `<span class="an-delta ${su ? 'an-delta-su' : 'an-delta-giu'}">${su ? '▲' : '▼'} ${Math.abs(v)}%</span>`;
}

function anKpi(etichetta, valore, delta, tip) {
  return `<div class="an-kpi"${tip ? ` title="${esc(tip)}"` : ''}>
    <div class="an-kpi-n">${anNum(valore)}</div>
    <div class="an-kpi-l">${esc(etichetta)}</div>
    ${anDelta(delta)}</div>`;
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
function anAndamento(serie) {
  const s = (serie || []).filter((p) => p && p.mese);
  if (s.length < 2) return '';
  const max = Math.max(...s.map((p) => p.n), 1);
  const L = 640;
  const H = 120;
  const pad = 6;
  const x = (i) => pad + (i * (L - pad * 2)) / Math.max(s.length - 1, 1);
  const y = (n) => H - pad - ((n / max) * (H - pad * 2));
  const punti = s.map((p, i) => `${x(i).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ');
  const area = `${pad},${H - pad} ${punti} ${(L - pad).toFixed(1)},${H - pad}`;
  return `<div class="an-trend">
    <svg viewBox="0 0 ${L} ${H}" preserveAspectRatio="none" role="img" aria-label="Soggiorni per mese">
      <polygon class="an-trend-area" points="${area}"></polygon>
      <polyline class="an-trend-linea" points="${punti}"></polyline>
    </svg>
    <div class="an-trend-x">${s.map((p) => `<span>${esc(p.mese.slice(5))}/${esc(p.mese.slice(2, 4))}</span>`).join('')}</div>
  </div>`;
}

function anSezione(titolo, corpo, nota) {
  return `<section class="an-sez">
    <h2 class="an-h">${esc(titolo)}${nota ? ` <span class="an-nota">${esc(nota)}</span>` : ''}</h2>
    ${corpo}</section>`;
}

function renderAnalytics(d) {
  const o = d.ospiti || {};
  const crm = d.crm || {};
  const c = crm.copertura || {};
  const q = d.qualitaAnagrafica || {};
  const acc = crm.accessi || {};
  const rec = crm.reclami || {};
  const conf = o.confronto || {};

  // La copertura si legge come frazione degli ospiti del periodo: "14" da solo
  // non dice niente, "14 su 2.400" dice tutto.
  const suOspiti = (n) => (q.ospiti ? ` <span class="an-su">su ${anNum(q.ospiti)} ospiti del periodo</span>` : '');

  const blocA = `
    <div class="an-kpis">
      ${anKpi('Ospiti unici', o.ospiti, conf.ospiti, 'Persone distinte che hanno concluso un soggiorno nel periodo')}
      ${anKpi('Soggiorni', o.soggiorni, conf.soggiorni, 'Da 1 a 200 notti: le giornate e i voucher non sono soggiorni')}
      ${anKpi('Di ritorno', o.diRitorno, conf.diRitorno, 'Ospiti che avevano gia soggiornato qui prima di questo soggiorno')}
      ${anKpi('VIP', o.vip, conf.vip, 'Ospiti con una classificazione VIP in anagrafica')}
      ${anKpi('Notti medie', o.nottiMedie, conf.nottiMedie, 'Notti per soggiorno')}
    </div>
    ${anAndamento(d.andamento)}
    <div class="an-griglia">
      ${anSezione('Da dove arrivano', anBarre(d.canali))}
      ${anSezione('Provenienza', anBarre(d.nazioni))}
      ${anSezione('Classificazioni VIP', anBarre(d.vip))}
    </div>
    <div class="an-griglia an-griglia-2">
      ${anSezione('Consumi F&B', anBarre(d.consumi), d.soloVip ? 'solo ospiti VIP' : 'ordinazioni')}
      ${anSezione('SPA', anBarre(d.spa), 'trattamenti')}
    </div>`;

  const aiRighe = (crm.ai || []).map((a) => `<div class="an-minore">
      <b>${anNum(a.generati)}</b> ${esc(a.funzione)}
      <small>${anNum(a.proposte)} proposte · ${anNum(a.accettati)} accettate</small></div>`).join('');

  const blocB = `
    <div class="an-kpis">
      ${anKpi('Con preferenze', c.conPreferenze, null, 'Clienti con almeno una preferenza registrata')}
      ${anKpi('Con allergie', c.conAllergie, null, 'Clienti con almeno un\'allergia registrata')}
      ${anKpi('Con note personali', c.conNotePersonali, null, 'Profili con una nota personale')}
      ${anKpi('Anagrafiche fuse', c.anagraficheFuse, null, 'Duplicati gia associati')}
    </div>
    <p class="an-cop">Clienti con almeno una preferenza: <b>${anNum(c.conPreferenze)}</b>${suOspiti(c.conPreferenze)}.
      È il numero da far salire: misura quanto il CRM sta diventando utile.</p>
    <div class="an-griglia">
      ${anSezione('Anagrafiche da completare', anBarre([
    { voce: 'Senza email', n: q.senzaEmail },
    { voce: 'Senza telefono', n: q.senzaTelefono },
    { voce: 'Senza data di nascita', n: q.senzaDataNascita },
  ], { vuoto: 'Tutte complete.' }), 'fra gli ospiti del periodo')}
      ${anSezione('Preferenze per reparto', anBarre(crm.preferenzePerReparto))}
      ${anSezione('Chi usa l\'applicazione', anBarre(acc.perUtente, { suffisso: ' accessi', vuoto: 'Nessun accesso registrato nel periodo.' }))}
    </div>
    <div class="an-minori">
      <a class="an-minore" href="#duplicati"><b>${anNum(rec.aperti)}</b> reclami aperti
        <small>${anNum(rec.totali)} in tutto · ${anNum(rec.daClassificare)} da classificare</small></a>
      <div class="an-minore"><b>${anNum(acc.riusciti)}</b> accessi
        <small>${anNum(acc.utentiAttivi)} utenti in ${anNum(acc.giorniConAccessi)} giorni</small></div>
      ${aiRighe || '<div class="an-minore an-minore-vuoto"><b>—</b> uso dell\'AI<small>si raccoglie dal 13/08/2026</small></div>'}
    </div>`;

  return `<div class="an-periodo-eco">Periodo <b>${fmtData(d.periodo.da)} → ${fmtData(d.periodo.a)}</b>
      <span>${d.periodo.giorni} giorni · confronto con ${fmtData(d.periodo.precedente.da)} → ${fmtData(d.periodo.precedente.a)}</span></div>
    ${anSezione('I nostri ospiti', blocA, 'dal gestionale')}
    ${anSezione('Quanto conosciamo gli ospiti', blocB, 'dal CRM')}`;
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
  if (da && a) { p.set('da', da); p.set('a', a); } else { p.set('periodo', analyticsPeriodo); }
  if ($('#an-vip').checked) p.set('vip', '1');

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
  if (!da || !a) { $('#an-da').value = body.periodo.da; $('#an-a').value = body.periodo.a; }
}

function initAnalytics() {
  if (!analyticsInited) {
    $('#an-periodi').addEventListener('click', (e) => {
      const b = e.target.closest('[data-periodo]');
      if (!b) return;
      analyticsPeriodo = b.dataset.periodo;
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
          $$('#an-periodi .chip').forEach((c) => c.classList.remove('is-on'));
          loadAnalytics();
        }
      });
    });
    $('#an-vip').addEventListener('change', loadAnalytics);
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
