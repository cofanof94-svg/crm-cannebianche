const express = require('express');
const {
  listUsers,
  createUser,
  getUserById,
  countActiveAdmins,
  updateUser,
  deleteUser,
} = require('../crm/users');
const { hashPassword } = require('../auth/password');
const { NOMI_RUOLI, RUOLI } = require('../auth/permessi');
const { intParam } = require('./param');

// I ruoli assegnabili sono quelli definiti in auth/permessi.js: qui non se ne
// inventano altri, altrimenti si potrebbe creare un utente con un ruolo che il
// controllo dei permessi non conosce.
const ROLES = NOMI_RUOLI;

// Sul DB vero la colonna è NVARCHAR(50) NOT NULL UNIQUE: ci entrava di tutto,
// compreso uno username fatto di soli spazi o un numero. Con un account così poi
// non si fa più login, e per toglierlo bisogna mettere le mani nel database.
const USERNAME_MAX = 50;
function nomeUtenteValido(v) {
  if (typeof v !== 'string') return { errore: 'Username non valido' };
  const t = v.trim();
  if (!t) return { errore: 'Username mancante' };
  if (t.length > USERNAME_MAX) return { errore: `Username: massimo ${USERNAME_MAX} caratteri` };
  if (/\s/.test(t)) return { errore: 'Username senza spazi' };
  return { valore: t };
}

function createAdminRouter(db) {
  const router = express.Router();
  // L'accesso è già filtrato dalla guardia su /api (serve 'gestisci-utenti'):
  // non si ripete qui il nome del ruolo, che è esattamente la cosa da non fare.

  router.get('/users', async (req, res) => {
    res.json({ users: await listUsers(db) });
  });

  // Elenco dei ruoli assegnabili, con etichetta e descrizione: il menu a tendina
  // della pagina Utenti si costruisce da qui, così un ruolo nuovo compare da solo.
  router.get('/ruoli', (req, res) => {
    res.json({
      ruoli: NOMI_RUOLI.map((nome) => ({
        nome, etichetta: RUOLI[nome].etichetta, descrizione: RUOLI[nome].descrizione, permessi: RUOLI[nome].permessi,
      })),
    });
  });

  router.post('/users', async (req, res) => {
    const { password, role, nome = null, cognome = null, email = null } = req.body || {};
    const u = nomeUtenteValido((req.body || {}).username);
    if (u.errore) return res.status(400).json({ error: u.errore });
    const username = u.valore;
    if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'Password mancante' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Ruolo non valido' });
    const passwordHash = await hashPassword(password);
    try {
      const user = await createUser(db, { username, passwordHash, role, nome, cognome, email });
      res.status(201).json({ user });
    } catch (e) {
      if (e && (e.number === 2627 || e.number === 2601)) {
        return res.status(409).json({ error: 'Username già esistente' });
      }
      throw e;
    }
  });

  router.patch('/users/:id', async (req, res) => {
    const id = intParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'ID non valido' });
    // Rispondere "ok" su un utente che non esiste nasconde un errore: chi ha
    // sbagliato id crede di aver modificato qualcosa.
    if (!(await getUserById(db, id))) return res.status(404).json({ error: 'Utente non trovato' });
    const { username, role, attivo, nome, cognome, email, password } = req.body || {};
    let nuovoUsername;
    if (username !== undefined) {
      const u = nomeUtenteValido(username);
      if (u.errore) return res.status(400).json({ error: u.errore });
      nuovoUsername = u.valore;
    }
    const cambiaAttivo = attivo !== undefined;
    const nuovoAttivo = !!attivo;
    const disattiva = cambiaAttivo && !nuovoAttivo;
    // Un admin non può cambiare il PROPRIO ruolo (verso un ruolo diverso) o disattivarsi
    if (id === req.session.user.id && ((role !== undefined && role !== req.session.user.role) || disattiva)) {
      return res.status(400).json({ error: 'Non puoi modificare il tuo ruolo o stato' });
    }
    if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Ruolo non valido' });
    // Non lasciare il sistema senza admin attivi
    const rimuoveAdmin = (role !== undefined && role !== 'admin') || disattiva;
    if (rimuoveAdmin) {
      const target = await getUserById(db, id);
      if (target && target.role === 'admin' && target.attivo) {
        const n = await countActiveAdmins(db);
        if (n <= 1) return res.status(400).json({ error: 'Deve restare almeno un admin attivo' });
      }
    }
    const campi = {};
    if (nuovoUsername !== undefined) campi.username = nuovoUsername;
    if (role !== undefined) campi.role = role;
    if (cambiaAttivo) campi.attivo = nuovoAttivo ? 1 : 0;
    if (nome !== undefined) campi.nome = nome;
    if (cognome !== undefined) campi.cognome = cognome;
    if (email !== undefined) campi.email = email;
    if (password) campi.password_hash = await hashPassword(password);
    try {
      await updateUser(db, id, campi);
      res.json({ ok: true });
    } catch (e) {
      if (e && (e.number === 2627 || e.number === 2601)) {
        return res.status(409).json({ error: 'Username già esistente' });
      }
      throw e;
    }
  });

  router.delete('/users/:id', async (req, res) => {
    const id = intParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'ID non valido' });
    if (id === req.session.user.id) return res.status(400).json({ error: 'Non puoi eliminare il tuo account' });
    const target = await getUserById(db, id);
    // "Utente eliminato" su un id che non esiste è una bugia comoda: chi ha
    // sbagliato riga se ne accorge solo molto dopo.
    if (!target) return res.status(404).json({ error: 'Utente non trovato' });
    if (target.role === 'admin' && target.attivo) {
      const n = await countActiveAdmins(db);
      if (n <= 1) return res.status(400).json({ error: 'Deve restare almeno un admin attivo' });
    }
    try {
      await deleteUser(db, id);
      res.json({ ok: true });
    } catch (e) {
      if (e && e.number === 547) {
        return res.status(409).json({ error: 'Impossibile eliminare: utente con dati collegati' });
      }
      throw e;
    }
  });

  return router;
}

module.exports = { createAdminRouter, ROLES };
