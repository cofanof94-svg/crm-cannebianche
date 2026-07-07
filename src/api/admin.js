const express = require('express');
const { requireRole } = require('../auth/middleware');
const {
  listUsers,
  createUser,
  setUserActive,
  setUserRole,
  getUserById,
  countActiveAdmins,
  updateUser,
  deleteUser,
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
    const { username, password, role, nome = null, cognome = null, email = null } = req.body || {};
    if (!username || !password || !ROLES.includes(role)) {
      return res.status(400).json({ error: 'Dati non validi' });
    }
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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const { username, role, attivo, nome, cognome, email, password } = req.body || {};
    const disattiva = attivo === false || attivo === 0;
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
    if (username !== undefined) campi.username = username;
    if (role !== undefined) campi.role = role;
    if (attivo !== undefined) campi.attivo = attivo ? 1 : 0;
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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    if (id === req.session.user.id) return res.status(400).json({ error: 'Non puoi eliminare il tuo account' });
    const target = await getUserById(db, id);
    if (target && target.role === 'admin' && target.attivo) {
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
