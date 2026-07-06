const express = require('express');
const { requireRole } = require('../auth/middleware');
const { listUsers, createUser, setUserActive, setUserRole } = require('../crm/users');
const { hashPassword } = require('../auth/password');

const ROLES = ['admin', 'reception', 'marketing'];

function createAdminRouter(db) {
  const router = express.Router();
  router.use(requireRole('admin'));

  router.get('/users', async (req, res) => {
    res.json({ users: await listUsers(db) });
  });

  router.post('/users', async (req, res) => {
    const { username, password, role } = req.body || {};
    if (!username || !password || !ROLES.includes(role)) {
      return res.status(400).json({ error: 'Dati non validi' });
    }
    const passwordHash = await hashPassword(password);
    const user = await createUser(db, { username, passwordHash, role });
    res.status(201).json({ user });
  });

  router.patch('/users/:id', async (req, res) => {
    const id = Number(req.params.id);
    const { attivo, role } = req.body || {};
    if (role !== undefined) {
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Ruolo non valido' });
      await setUserRole(db, id, role);
    }
    if (attivo !== undefined) await setUserActive(db, id, !!attivo);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createAdminRouter, ROLES };
