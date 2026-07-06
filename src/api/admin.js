const express = require('express');
const { requireRole } = require('../auth/middleware');
const {
  listUsers,
  createUser,
  setUserActive,
  setUserRole,
  getUserById,
  countActiveAdmins,
} = require('../crm/users');
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
    try {
      const user = await createUser(db, { username, passwordHash, role });
      res.status(201).json({ user });
    } catch (e) {
      if (e && (e.number === 2627 || e.number === 2601)) {
        return res.status(409).json({ error: 'Username già esistente' });
      }
      throw e;
    }
  });

  router.patch('/users/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'ID non valido' });
    }
    const { attivo, role } = req.body || {};
    const disattiva = attivo === false || attivo === 0;
    // Un admin non può cambiare il proprio ruolo o disattivarsi
    if (id === req.session.user.id && (role !== undefined || disattiva)) {
      return res.status(400).json({ error: 'Non puoi modificare il tuo ruolo o stato' });
    }
    if (role !== undefined && !ROLES.includes(role)) {
      return res.status(400).json({ error: 'Ruolo non valido' });
    }
    // Non lasciare il sistema senza admin attivi
    const rimuoveAdmin = (role !== undefined && role !== 'admin') || disattiva;
    if (rimuoveAdmin) {
      const target = await getUserById(db, id);
      if (target && target.role === 'admin' && target.attivo) {
        const n = await countActiveAdmins(db);
        if (n <= 1) {
          return res.status(400).json({ error: 'Deve restare almeno un admin attivo' });
        }
      }
    }
    if (role !== undefined) await setUserRole(db, id, role);
    if (attivo !== undefined) await setUserActive(db, id, !!attivo);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createAdminRouter, ROLES };
