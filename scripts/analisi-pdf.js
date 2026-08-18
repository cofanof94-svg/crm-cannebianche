// Genera il PDF dell'analisi funzionale.
//
//   node scripts/analisi-pdf.js
//
// Perché non una libreria: il progetto non ha dipendenze per il frontend e non
// ne vogliamo una per stampare un documento. Su questa macchina Python non c'è,
// quindi nemmeno reportlab. Chrome però c'è su ogni postazione, sa impaginare
// l'HTML meglio di qualunque libreria e sa stampare in PDF da riga di comando:
// il markdown diventa HTML qui, e l'impaginazione la fa lui.
//
// Il convertitore non è un motore markdown completo: gestisce esattamente ciò
// che il documento usa (titoli, tabelle, citazioni, elenchi anche annidati,
// grassetto, corsivo, codice, link, righe orizzontali). Se un giorno il
// documento userà qualcosa di nuovo, va aggiunto qui.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RADICE = path.join(__dirname, '..');
const SORGENTE = path.join(RADICE, 'DOCS', '2026-08-12-analisi-funzionale.md');
const USCITA = path.join(RADICE, 'DOCS', '2026-08-12-analisi-funzionale.pdf');
const TEMPORANEO = path.join(RADICE, 'DOCS', '.analisi-funzionale.tmp.html');

// Chrome, dove Windows lo mette di solito. Il primo che esiste vince.
const CANDIDATI_CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

// --- da markdown a HTML ------------------------------------------------------

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Le marche del documento ([DOC], [TEST], [CODICE], [DECISO]) sono scritte come
// codice inline: qui diventano pastiglie colorate, perché sono la cosa che si
// cerca con l'occhio scorrendo la pagina.
const MARCHE = { DOC: 'doc', TEST: 'test', CODICE: 'codice', DECISO: 'deciso' };

function inline(testo) {
  const codici = [];
  // I codici si mettono da parte PRIMA di ogni altra sostituzione: dentro un
  // codice, `**` e `_` non sono formattazione ma testo.
  let s = String(testo).replace(/`([^`]+)`/g, (_, c) => {
    const marca = /^\[(DOC|TEST|CODICE|DECISO)\]$/.exec(c.trim());
    codici.push(marca
      ? `<span class="marca m-${MARCHE[marca[1]]}">${marca[1]}</span>`
      : `<code>${esc(c)}</code>`);
    return `\u0000${codici.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codici[Number(i)]);
}

const isTabella = (righe, i) => /^\s*\|/.test(righe[i] || '')
  && /^\s*\|[\s:|-]+\|\s*$/.test(righe[i + 1] || '');

function celle(riga) {
  return riga.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

// Livello di annidamento di un punto elenco: due spazi = un livello.
const rientro = (riga) => Math.floor((/^(\s*)/.exec(riga)[1].length) / 2);

function blocchi(testo) {
  const righe = String(testo).split(/\r?\n/);
  const out = [];
  let i = 0;
  let paragrafo = [];

  const chiudiParagrafo = () => {
    if (paragrafo.length) out.push(`<p>${inline(paragrafo.join(' '))}</p>`);
    paragrafo = [];
  };

  while (i < righe.length) {
    const riga = righe[i];

    if (!riga.trim()) { chiudiParagrafo(); i += 1; continue; }

    // Riga orizzontale: nel documento separa le sezioni, e le sezioni cominciano
    // già su una pagina nuova — quindi non serve disegnarla.
    if (/^\s*---+\s*$/.test(riga)) { chiudiParagrafo(); i += 1; continue; }

    const titolo = /^(#{1,6})\s+(.*)$/.exec(riga);
    if (titolo) {
      chiudiParagrafo();
      const liv = titolo[1].length;
      out.push(`<h${liv}>${inline(titolo[2])}</h${liv}>`);
      i += 1;
      continue;
    }

    if (isTabella(righe, i)) {
      chiudiParagrafo();
      const intestazione = celle(righe[i]);
      i += 2;
      const corpo = [];
      while (i < righe.length && /^\s*\|/.test(righe[i])) { corpo.push(celle(righe[i])); i += 1; }
      const th = intestazione.map((c) => `<th>${inline(c)}</th>`).join('');
      const tr = corpo.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`);
      continue;
    }

    if (/^\s*>/.test(riga)) {
      chiudiParagrafo();
      const dentro = [];
      while (i < righe.length && /^\s*>/.test(righe[i])) {
        dentro.push(righe[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${blocchi(dentro.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(riga)) {
      chiudiParagrafo();
      out.push(elenco(righe, i));
      i = elenco.fine;
      continue;
    }

    paragrafo.push(riga.trim());
    i += 1;
  }
  chiudiParagrafo();
  return out.join('\n');
}

// Un elenco, con i suoi eventuali sotto-elenchi. Ritorna l'HTML e lascia in
// `elenco.fine` la prima riga non consumata (un ritorno multiplo renderebbe il
// chiamante più confuso di così).
function elenco(righe, inizio) {
  const base = rientro(righe[inizio]);
  const ordinato = /^\s*\d+\.\s/.test(righe[inizio]);
  const voci = [];
  let i = inizio;

  while (i < righe.length) {
    const riga = righe[i];
    if (!riga.trim()) {
      // Una riga vuota chiude l'elenco solo se dopo non riprende allo stesso
      // livello: nel documento capitano elenchi con una riga in mezzo.
      const dopo = righe[i + 1] || '';
      if (!/^\s*([-*]|\d+\.)\s+/.test(dopo) || rientro(dopo) < base) break;
      i += 1;
      continue;
    }
    const punto = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(riga);
    if (!punto || rientro(riga) < base) break;
    if (rientro(riga) > base) {
      const dentro = elenco(righe, i);
      voci[voci.length - 1] = (voci[voci.length - 1] || '') + dentro;
      i = elenco.fine;
      continue;
    }
    voci.push(inline(punto[2]));
    i += 1;
  }

  elenco.fine = i;
  const tag = ordinato ? 'ol' : 'ul';
  return `<${tag}>${voci.map((v) => `<li>${v}</li>`).join('')}</${tag}>`;
}

// --- la pagina --------------------------------------------------------------

const STILE = `
@page { size: A4; margin: 18mm 16mm 16mm; }
* { box-sizing: border-box; }
body {
  font: 10.5pt/1.55 "Georgia", "Times New Roman", serif;
  color: #23201c; margin: 0; hyphens: auto;
}
h1, h2, h3, h4, h5, h6 {
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  color: #6b4f2a; line-height: 1.25; break-after: avoid;
}
h1 { font-size: 24pt; margin: 0 0 6mm; }
/* Ogni sezione numerata comincia su una pagina nuova: sono ventun capitoli e
   si consultano uno per volta, non si leggono di filato. */
h2 {
  font-size: 15pt; margin: 0 0 4mm; padding-bottom: 2mm;
  border-bottom: 1.5pt solid #c9a227; break-before: page;
}
h3 { font-size: 12pt; margin: 6mm 0 2mm; }
h4 { font-size: 10.5pt; margin: 4mm 0 1.5mm; color: #8a6a3b; }
p { margin: 0 0 2.6mm; text-align: justify; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin: 0 0 1.4mm; }
li > ul, li > ol { margin: 1.4mm 0 0; }
a { color: #6b4f2a; text-decoration: none; border-bottom: 0.4pt dotted #b9a37e; }
code {
  font-family: "Consolas", "Courier New", monospace; font-size: 8.8pt;
  background: #f4efe6; border: 0.4pt solid #e3d9c6; border-radius: 2pt;
  padding: 0 1.2pt; white-space: nowrap;
}
del { color: #8b8175; }
table {
  width: 100%; border-collapse: collapse; margin: 0 0 3.5mm;
  font-family: "Segoe UI", Arial, sans-serif; font-size: 8.8pt; break-inside: auto;
}
th, td { border: 0.4pt solid #d8cdb8; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
th { background: #f4efe6; color: #6b4f2a; font-weight: 600; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
blockquote {
  margin: 0 0 3.5mm; padding: 2.5mm 4mm; background: #faf7f1;
  border-left: 2pt solid #c9a227; break-inside: avoid;
}
blockquote p:last-child, blockquote ul:last-child, blockquote ol:last-child { margin-bottom: 0; }
/* Le marche: si cercano con l'occhio, quindi hanno un colore ciascuna. */
.marca {
  font-family: "Segoe UI", Arial, sans-serif; font-size: 6.8pt; font-weight: 700;
  letter-spacing: .04em; padding: 0.5pt 1.6pt; border-radius: 2pt;
  vertical-align: 1pt; white-space: nowrap;
}
.m-doc    { background: #e7edf6; color: #2c4a73; }
.m-test   { background: #e6f0e8; color: #2f5c3a; }
.m-codice { background: #f1ece2; color: #6f6250; }
.m-deciso { background: #f7e9cf; color: #8a5a12; }
.copertina { break-after: page; padding-top: 45mm; text-align: center; }
.copertina .occhiello {
  font-family: "Segoe UI", Arial, sans-serif; font-size: 9pt; letter-spacing: .16em;
  text-transform: uppercase; color: #a08b63;
}
.copertina h1 { font-size: 30pt; margin: 5mm 0 3mm; border: 0; }
.copertina .sotto { font-size: 12pt; color: #6f6250; font-style: italic; }
.copertina .righe { margin-top: 18mm; font-size: 9.5pt; color: #6f6250; }
.copertina .legenda {
  margin: 22mm auto 0; max-width: 118mm; text-align: left;
  font-family: "Segoe UI", Arial, sans-serif; font-size: 8.6pt; color: #4a443c;
}
.copertina .legenda div { margin-bottom: 1.8mm; }
/* Il primo titolo dopo la copertina non deve aggiungere un'altra pagina. */
.copertina + h1, .copertina + h2 { break-before: avoid; }
`;

function pagina(corpo, titolo) {
  const copertina = `
<div class="copertina">
  <div class="occhiello">Hotel Canne Bianche · Torre Canne</div>
  <h1>${titolo}</h1>
  <div class="sotto">Che cosa fa l'applicazione e con quali regole,<br>dal punto di vista di chi la usa</div>
  <div class="righe">CRM sopra il gestionale Direct Holiday</div>
  <div class="legenda">
    <div><span class="marca m-doc">DOC</span> &nbsp;requisito scritto in un documento o in un ticket</div>
    <div><span class="marca m-test">TEST</span> &nbsp;fissato da un test: se cambia, la suite se ne accorge</div>
    <div><span class="marca m-codice">CODICE</span> &nbsp;dedotto leggendo il codice, nessuno l'ha scritto come requisito</div>
    <div><span class="marca m-deciso">DECISO</span> &nbsp;discusso e deciso con il committente: è un requisito</div>
  </div>
</div>`;
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>${titolo}</title><style>${STILE}</style></head>
<body>${copertina}${corpo}</body></html>`;
}

// --- esecuzione -------------------------------------------------------------

function chrome() {
  for (const c of CANDIDATI_CHROME) if (fs.existsSync(c)) return c;
  throw new Error('Chrome (o Edge) non trovato: senza browser non si stampa il PDF.');
}

function main() {
  const md = fs.readFileSync(SORGENTE, 'utf8');
  // Il titolo va in copertina, quindi la prima riga `# ...` del markdown si
  // toglie: ripeterla due volte sembrerebbe un errore di impaginazione.
  const senzaTitolo = md.replace(/^#\s+.*\r?\n/, '');
  const titolo = (/^#\s+(.*)$/m.exec(md) || [, 'Analisi funzionale'])[1];

  fs.writeFileSync(TEMPORANEO, pagina(blocchi(senzaTitolo), titolo), 'utf8');

  const eseguibile = chrome();
  execFileSync(eseguibile, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${USCITA}`,
    // Sandbox spento: è un browser lanciato su un file locale nostro, e su
    // Windows senza questo l'avvio in headless a volte non ritorna.
    '--no-sandbox',
    `file:///${TEMPORANEO.replace(/\\/g, '/')}`,
  ], { stdio: 'pipe', timeout: 120000 });

  // Con ANALISI_TIENI_HTML=1 l'HTML intermedio resta su disco: è il modo per
  // controllare l'impaginazione in un browser vero senza rigenerare il PDF a
  // ogni ritocco dello stile.
  if (!process.env.ANALISI_TIENI_HTML) fs.unlinkSync(TEMPORANEO);
  const kb = Math.round(fs.statSync(USCITA).size / 1024);
  console.log(`PDF scritto: ${USCITA} (${kb} KB)`);
  if (process.env.ANALISI_TIENI_HTML) console.log(`HTML tenuto: ${TEMPORANEO}`);
}

main();
