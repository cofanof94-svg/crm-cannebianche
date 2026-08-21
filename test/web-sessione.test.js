const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Quando la sessione cade mentre si lavora, `api()` riporta al login. Il commit
// del 20/08 lo fa, ma lasciava due cose a metà, trovate dal collaudo a più
// revisori del giorno dopo:
//
//  1. la pastiglia di errore continuava a promettere «Il testo è rimasto nel
//     campo: puoi riprovare» — scritta sopra la schermata di accesso, dove quel
//     campo non c'è più, e falsa, perché al rientro la scheda si ridisegna dal
//     server;
//  2. la schermata di accesso compariva nuda, senza dire perché.
//
// E una finestra aperta con showModal() rende inerte il resto della pagina:
// senza chiuderla non si può nemmeno scrivere nel modulo di accesso.

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');

function estrai(nome) {
  const inizio = SRC.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inizio, -1, `${nome} non trovata in web/app.js`);
  return SRC.slice(inizio, SRC.indexOf('\n}', inizio) + 2);
}

// DOM minimo: solo quello che showLogin tocca.
function finto() {
  const chiuse = [];
  const el = (id) => ({ id, hidden: false, textContent: '' });
  const nodi = { '#app': el('app'), '#login-view': el('login-view'), '#login-error': el('login-error') };
  const doc = {
    querySelectorAll: (sel) => {
      assert.strictEqual(sel, 'dialog[open]');
      return [{ close: () => chiuse.push('a') }, { close: () => chiuse.push('b') }];
    },
  };
  const showLogin = new Function('$', 'document', 'currentUserRef', `
    let currentUser = null;
    ${estrai('showLogin')}
    return showLogin;
  `)((s) => nodi[s], doc);
  return { showLogin, nodi, chiuse };
}

test('la sessione scaduta dice perché, invece di far comparire il login nudo', () => {
  const { showLogin, nodi } = finto();
  showLogin('Sessione scaduta: rientra per continuare.');
  assert.strictEqual(nodi['#app'].hidden, true);
  assert.strictEqual(nodi['#login-view'].hidden, false);
  assert.match(nodi['#login-error'].textContent, /sessione scaduta/i);
});

test('uscendo apposta non compare nessun allarme', () => {
  // showLogin() la chiamano anche l'avvio e il pulsante Esci: lì non c'è niente
  // da spiegare, e un messaggio di errore sarebbe solo rumore.
  const { showLogin, nodi } = finto();
  showLogin();
  assert.strictEqual(nodi['#login-error'].textContent, '');
});

test('le finestre aperte si chiudono: altrimenti bloccano il modulo di accesso', () => {
  const { showLogin, chiuse } = finto();
  showLogin('Sessione scaduta.');
  assert.deepStrictEqual(chiuse, ['a', 'b'], 'ogni <dialog> aperto va chiuso');
});

test('il messaggio del 401 dice cosa è successo e cosa aspettarsi', () => {
  const m = SRC.match(/showLogin\('([^']+)'\)/);
  assert.ok(m, 'il 401 deve passare un motivo a showLogin');
  assert.match(m[1], /sessione scaduta/i);
  // Non basta dire che è scaduta: va detto che il lavoro non salvato è perso,
  // perché è la domanda che l'operatore si fa subito dopo.
  assert.match(m[1], /riscrivere|perso|non era ancora salvato/i);
});

test('la modale dell\'export sta fuori da #app: è il motivo per cui si chiude', () => {
  // Le altre quattro stanno dentro #app e diventano invisibili; questa no, e
  // resterebbe a video sopra la schermata di accesso.
  const i = HTML.indexOf('id="export-dialog"');
  const app = HTML.indexOf('id="app"');
  assert.ok(i > 0 && app > 0);
  const chiusuraApp = HTML.lastIndexOf('</div>', i);
  assert.ok(chiusuraApp > app, 'se un giorno la si sposta dentro #app, questo test va riletto');
});
