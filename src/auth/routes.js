const express = require('express');
const { findUserByUsername } = require('../crm/users');
const { verifyPassword } = require('./password');
const { utenteConPermessi } = require('./permessi');
const { registraAccesso } = require('../crm/registro');

function createAuthRouter(db) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Credenziali mancanti' });
    }
    const user = await findUserByUsername(db, username);
    // Il messaggio all'utente resta uno solo — non si deve capire dall'esterno
    // se un nome utente esiste — ma nel registro i due casi si distinguono:
    // "utente disattivato che continua a provare" è un'informazione che serve.
    if (!user || !user.attivo) {
      await registraAccesso(db, {
        utenteId: user ? user.id : null,
        username,
        esito: user ? 'disattivato' : 'credenziali',
      });
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      await registraAccesso(db, { utenteId: user.id, username, esito: 'credenziali' });
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
    await registraAccesso(db, { utenteId: user.id, username: user.username, esito: 'ok' });
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Errore di sessione' });
      req.session.user = { id: user.id, username: user.username, role: user.role };
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'Errore di sessione' });
        // In sessione si tiene il ruolo, non i permessi: se domani la tabella dei
        // permessi cambia, valgono subito anche per chi è già connesso. Al
        // frontend invece si mandano risolti, così non deve interpretare nulla.
        res.json({ user: utenteConPermessi(req.session.user) });
      });
    });
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });

  return router;
}

module.exports = { createAuthRouter };
