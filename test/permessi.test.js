const { test } = require('node:test');
const assert = require('node:assert');
const { PERMESSI, RUOLI, NOMI_RUOLI, permessiDi, puo, utenteConPermessi } = require('../src/auth/permessi');
const { permessoPer } = require('../src/auth/middleware');

const utente = (role) => ({ id: 1, username: 'x', role });

test('i tre ruoli della Fase 1, e nessun altro', () => {
  assert.deepStrictEqual(NOMI_RUOLI, ['readonly', 'reception', 'admin']);
});

test('read only consulta e basta', () => {
  const u = utente('readonly');
  assert.strictEqual(puo(u, PERMESSI.LEGGI), true);
  for (const p of [PERMESSI.SCRIVI, PERMESSI.USA_AI, PERMESSI.GESTISCI_UTENTI, PERMESSI.VEDI_ANALYTICS]) {
    assert.strictEqual(puo(u, p), false, `readonly non deve avere ${p}`);
  }
});

test('reception: piena operatività sul cliente, nessuna amministrazione', () => {
  const u = utente('reception');
  for (const p of [PERMESSI.LEGGI, PERMESSI.SCRIVI, PERMESSI.USA_AI]) {
    assert.strictEqual(puo(u, p), true, `reception deve avere ${p}`);
  }
  // I due divieti espliciti del ticket.
  assert.strictEqual(puo(u, PERMESSI.GESTISCI_UTENTI), false);
  assert.strictEqual(puo(u, PERMESSI.VEDI_ANALYTICS), false);
});

test('admin: tutto quello che sa fare la reception, più il resto', () => {
  const u = utente('admin');
  for (const p of Object.values(PERMESSI)) assert.strictEqual(puo(u, p), true, `admin deve avere ${p}`);
  // "Admin = Reception + …": ogni permesso della reception deve esserci.
  for (const p of RUOLI.reception.permessi) assert.ok(RUOLI.admin.permessi.includes(p), p);
});

test('un ruolo sconosciuto scivola in sola lettura, non in pieni poteri', () => {
  // Il vecchio 'marketing', o un valore scritto a mano nel DB. La cosa importante
  // è che il ripiego sia il ruolo MENO potente, non il primo dell'elenco.
  for (const ignoto of ['marketing', 'ROLE_SPA', '', null, undefined, 'ADMIN']) {
    const u = utente(ignoto);
    assert.strictEqual(puo(u, PERMESSI.SCRIVI), false, `"${ignoto}" non deve poter scrivere`);
    assert.strictEqual(puo(u, PERMESSI.GESTISCI_UTENTI), false, `"${ignoto}" non deve gestire utenti`);
  }
  // 'ADMIN' maiuscolo NON è 'admin': il confronto è esatto, niente sorprese.
  assert.deepStrictEqual(permessiDi('ADMIN'), RUOLI.readonly.permessi);
});

test('senza utente non si può niente', () => {
  assert.strictEqual(puo(null, PERMESSI.LEGGI), false);
  assert.strictEqual(puo(undefined, PERMESSI.SCRIVI), false);
  assert.strictEqual(puo(utente('admin'), null), false);
  assert.strictEqual(puo(utente('admin'), 'permesso-inventato'), false);
});

test('al frontend arrivano i permessi risolti, non il ruolo da interpretare', () => {
  const u = utenteConPermessi(utente('reception'));
  assert.deepStrictEqual(u.permessi, RUOLI.reception.permessi);
  assert.strictEqual(u.username, 'x'); // il resto dell'utente non si perde
  assert.strictEqual(utenteConPermessi(null), null);
});

// --- La guardia: quale permesso serve per una rotta -------------------------

test('per difetto: leggere è leggere, tutto il resto è scrivere', () => {
  assert.strictEqual(permessoPer('GET', '/clienti/47186'), PERMESSI.LEGGI);
  assert.strictEqual(permessoPer('HEAD', '/arrivi'), PERMESSI.LEGGI);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.strictEqual(permessoPer(m, '/clienti/47186/preferenze'), PERMESSI.SCRIVI, m);
  }
  // Un metodo che non conosciamo finisce fra le scritture, non fra le letture.
  assert.strictEqual(permessoPer('PROPFIND', '/qualcosa'), PERMESSI.SCRIVI);
});

test('una rotta nuova nasce protetta senza che nessuno la registri', () => {
  // È il requisito 3 del ticket: vale per endpoint che oggi non esistono.
  assert.strictEqual(permessoPer('POST', '/clienti/1/qualcosa-che-inventeremo'), PERMESSI.SCRIVI);
  assert.strictEqual(permessoPer('DELETE', '/rotta/mai/vista'), PERMESSI.SCRIVI);
});

test('la barra finale non cambia il permesso richiesto', () => {
  // Express instrada allo stesso posto con o senza barra finale, quindi
  // `…/briefing/` eseguiva l'AI chiedendo il permesso di SCRIVERE. Le regole di
  // amministrazione e Analytics chiudevano già con `(\/|$)`, quella dell'AI no.
  // Oggi nessun ruolo scrive senza poter usare l'AI, ma il giorno del ruolo di
  // reparto il buco si aprirebbe da solo.
  for (const rotta of ['/clienti/47186/briefing/', '/clienti/47186/suggerimenti/']) {
    assert.strictEqual(permessoPer('POST', rotta), PERMESSI.USA_AI, rotta);
  }
  assert.strictEqual(permessoPer('GET', '/admin/users/'), PERMESSI.GESTISCI_UTENTI);
  assert.strictEqual(permessoPer('GET', '/analytics/'), PERMESSI.VEDI_ANALYTICS);
});

test('le eccezioni: AI, amministrazione e la futura Analytics', () => {
  assert.strictEqual(permessoPer('POST', '/clienti/47186/briefing'), PERMESSI.USA_AI);
  assert.strictEqual(permessoPer('POST', '/clienti/47186/suggerimenti'), PERMESSI.USA_AI);
  assert.strictEqual(permessoPer('GET', '/admin/users'), PERMESSI.GESTISCI_UTENTI);
  assert.strictEqual(permessoPer('POST', '/admin/users'), PERMESSI.GESTISCI_UTENTI);
  // Analytics non esiste ancora: la regola c'è già, per URL diretto e API.
  assert.strictEqual(permessoPer('GET', '/analytics'), PERMESSI.VEDI_ANALYTICS);
  assert.strictEqual(permessoPer('GET', '/analytics/preferenze'), PERMESSI.VEDI_ANALYTICS);
});

test('le maiuscole nell\'URL non aggirano le eccezioni', () => {
  // Buco vero, trovato durante il collaudo: Express instrada senza guardare le
  // maiuscole, le regole invece le guardavano. /api/ADMIN/users finiva sul router
  // degli utenti con il permesso "scrivi", quindi la reception si creava un
  // amministratore con una lettera maiuscola.
  for (const p of ['/ADMIN/users', '/Admin/users', '/aDmIn/users', '/admin/USERS']) {
    assert.strictEqual(permessoPer('GET', p), PERMESSI.GESTISCI_UTENTI, p);
    assert.strictEqual(permessoPer('POST', p), PERMESSI.GESTISCI_UTENTI, p);
  }
  assert.strictEqual(permessoPer('GET', '/Analytics'), PERMESSI.VEDI_ANALYTICS);
  assert.strictEqual(permessoPer('POST', '/CLIENTI/47186/BRIEFING'), PERMESSI.USA_AI);
  // Anche il metodo: minuscolo non deve diventare "sconosciuto" e cambiare esito.
  assert.strictEqual(permessoPer('get', '/clienti/1'), PERMESSI.LEGGI);
  assert.strictEqual(permessoPer('post', '/clienti/1/preferenze'), PERMESSI.SCRIVI);
});

test('le eccezioni non sono più larghe di quanto sembrano', () => {
  // "/administratore" non è "/admin/", e una GET su un cliente non diventa AI
  // solo perché la parola compare nel percorso.
  assert.strictEqual(permessoPer('GET', '/administratore'), PERMESSI.LEGGI);
  assert.strictEqual(permessoPer('GET', '/clienti/47186/briefing'), PERMESSI.LEGGI);
  assert.strictEqual(permessoPer('POST', '/clienti/abc/briefing'), PERMESSI.SCRIVI); // id non numerico
});
