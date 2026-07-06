async function findUserByUsername(db, username) {
  const rows = await db.query(
    'SELECT id, username, password_hash, role, attivo FROM users WHERE username = @username',
    { username }
  );
  return rows[0] || null;
}

async function createUser(db, { username, passwordHash, role }) {
  const rows = await db.query(
    `INSERT INTO users (username, password_hash, role, attivo, created_at)
     OUTPUT INSERTED.id, INSERTED.username, INSERTED.role, INSERTED.attivo
     VALUES (@username, @passwordHash, @role, 1, SYSUTCDATETIME())`,
    { username, passwordHash, role }
  );
  return rows[0];
}

async function listUsers(db) {
  return db.query(
    'SELECT id, username, role, attivo, created_at FROM users ORDER BY username',
    {}
  );
}

async function setUserActive(db, id, attivo) {
  await db.query('UPDATE users SET attivo = @attivo WHERE id = @id', {
    id, attivo: attivo ? 1 : 0,
  });
}

async function setUserRole(db, id, role) {
  await db.query('UPDATE users SET role = @role WHERE id = @id', { id, role });
}

async function getUserById(db, id) {
  const rows = await db.query(
    'SELECT id, username, role, attivo FROM users WHERE id = @id',
    { id }
  );
  return rows[0] || null;
}

async function countActiveAdmins(db) {
  const rows = await db.query(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND attivo = 1",
    {}
  );
  return rows[0].n;
}

module.exports = {
  findUserByUsername,
  createUser,
  listUsers,
  setUserActive,
  setUserRole,
  getUserById,
  countActiveAdmins,
};
