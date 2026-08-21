// Genera il PDF del manuale della reception.
//
//   node scripts/manuale-pdf.js
//
// Il markdown diventa HTML con lo stesso convertitore dell'analisi funzionale
// (`scripts/analisi-pdf.js`), e Chrome fa l'impaginazione: nel progetto non
// entrano dipendenze per stampare un documento.
//
// Lo STILE però è tutto suo, e non è un vezzo. L'analisi funzionale la legge chi
// costruisce l'applicazione, seduto: carattere con le grazie, testo giustificato,
// un capitolo per pagina. Questo lo consulta chi sta in piedi al banco con un
// ospite davanti: carattere senza grazie, tabelle larghe, titoli che si trovano
// scorrendo con il pollice, e nessuna pagina mezza vuota.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { blocchi, chrome } = require('./analisi-pdf');

const RADICE = path.join(__dirname, '..');
const SORGENTE = path.join(RADICE, 'DOCS', '2026-08-21-manuale-reception.md');
const USCITA = path.join(RADICE, 'DOCS', '2026-08-21-manuale-reception.pdf');
const TEMPORANEO = path.join(RADICE, 'DOCS', '.manuale-reception.tmp.html');

const STILE = `
@page { size: A4; margin: 16mm 15mm 14mm; }
* { box-sizing: border-box; }
body {
  font: 10.5pt/1.5 "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  color: #26231f; margin: 0;
}
h1, h2, h3 { line-height: 1.2; break-after: avoid; }
/* Ogni capitolo su pagina nuova: al banco si apre a una pagina e si legge
   quella, non si segue il filo del discorso. */
h2 {
  font-size: 17pt; color: #6b4f2a; margin: 0 0 5mm;
  padding: 0 0 2.5mm; border-bottom: 2pt solid #c9a227; break-before: page;
}
h3 { font-size: 11.5pt; color: #8a6a3b; margin: 6mm 0 2mm; }
p { margin: 0 0 2.8mm; }
ul, ol { margin: 0 0 3mm; padding-left: 5.5mm; }
li { margin: 0 0 1.6mm; }
strong { color: #1a1815; }
code {
  font-family: "Consolas", "Courier New", monospace; font-size: 9pt;
  background: #f4efe6; border-radius: 2pt; padding: 0 1.5pt;
}
/* Le tabelle sono il cuore di questo documento: sono la forma in cui una
   reception legge davvero, una riga per volta. */
table {
  width: 100%; border-collapse: collapse; margin: 0 0 4mm; font-size: 9.5pt;
}
th, td { border: 0.4pt solid #ddd3c0; padding: 2mm 2.5mm; text-align: left; vertical-align: top; }
th { background: #6b4f2a; color: #fff; font-weight: 600; font-size: 9pt; }
tr { break-inside: avoid; }
tr:nth-child(even) td { background: #faf7f1; }
thead { display: table-header-group; }
/* Prima colonna in evidenza: è quella che si cerca con l'occhio. */
td:first-child { font-weight: 600; color: #4a3c28; }
/* Le citazioni sono gli avvertimenti: devono fermare lo sguardo. */
blockquote {
  margin: 0 0 4mm; padding: 3mm 4mm; background: #fdf6e3;
  border-left: 3pt solid #c9a227; break-inside: avoid; font-size: 10pt;
}
blockquote p:last-child { margin-bottom: 0; }
hr { border: 0; border-top: 0.4pt solid #e3d9c6; margin: 6mm 0; }
em { color: #6f6250; }
.copertina { break-after: page; padding-top: 55mm; text-align: center; }
.copertina .occhiello {
  font-size: 9pt; letter-spacing: .18em; text-transform: uppercase; color: #a08b63;
}
.copertina h1 { font-size: 32pt; color: #6b4f2a; margin: 6mm 0 4mm; }
.copertina .sotto { font-size: 12.5pt; color: #6f6250; }
.copertina .righe { margin-top: 22mm; font-size: 9.5pt; color: #8a8175; }
.copertina .avviso {
  margin: 26mm auto 0; max-width: 120mm; text-align: left;
  background: #fdf6e3; border-left: 3pt solid #c9a227; padding: 4mm 5mm;
  font-size: 9.5pt; color: #4a443c;
}
.copertina + h1, .copertina + h2 { break-before: avoid; }
`;

const COPERTINA = `
<div class="copertina">
  <div class="occhiello">Hotel Canne Bianche &middot; Torre Canne</div>
  <h1>Manuale della reception</h1>
  <div class="sotto">Come si usa il CRM, pagina per pagina</div>
  <div class="righe">CRM sopra il gestionale Direct Holiday</div>
  <div class="avviso">
    <b>Non serve leggerlo tutto.</b> &Egrave; fatto per essere aperto alla pagina
    che serve: ogni capitolo &egrave; una schermata dell'applicazione, e l'ultimo
    &mdash; <i>Se qualcosa non torna</i> &mdash; risponde alle domande che
    vengono davvero.
  </div>
</div>`;

function main() {
  const md = fs.readFileSync(SORGENTE, 'utf8');
  // Il titolo sta in copertina: ripeterlo in cima alla prima pagina sembrerebbe
  // un errore di impaginazione.
  const senzaTitolo = md.replace(/^#\s+.*\r?\n/, '');
  const titolo = (/^#\s+(.*)$/m.exec(md) || [, 'Manuale della reception'])[1];

  const html = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>${titolo}</title><style>${STILE}</style></head>
<body>${COPERTINA}${blocchi(senzaTitolo)}</body></html>`;
  fs.writeFileSync(TEMPORANEO, html, 'utf8');

  execFileSync(chrome(), [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${USCITA}`,
    '--no-sandbox',
    `file:///${TEMPORANEO.replace(/\\/g, '/')}`,
  ], { stdio: 'pipe', timeout: 120000 });

  // Con MANUALE_TIENI_HTML=1 l'HTML resta su disco: serve a controllare
  // l'impaginazione in un browser vero senza rigenerare il PDF a ogni ritocco.
  if (!process.env.MANUALE_TIENI_HTML) fs.unlinkSync(TEMPORANEO);
  const kb = Math.round(fs.statSync(USCITA).size / 1024);
  console.log(`PDF scritto: ${USCITA} (${kb} KB)`);
}

main();
