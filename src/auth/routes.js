const express = require('express');
const { findUserByUsername } = require('../crm/users');
const { verifyPassword } = require('./password');
const { utenteConPermessi } = require('./permessi');

function createAuthRouter(db) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Credenziali mancanti' });
    }
    const user = await findUserByUsername(db, username);
    if (!user || !user.attivo) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
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
