const express = require('express');
const { findUserByUsername } = require('../crm/users');
const { verifyPassword } = require('./password');

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
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ user: req.session.user });
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  return router;
}

module.exports = { createAuthRouter };
