async function findUserByUsername(db, username) {
  const rows = await db.query(
    'SELECT id, username, password_hash, role, attivo FROM users WHERE username = @username',
    { username }
  );
  return rows[0] || null;
}

async function createUser(db, { username, passwordHash, role, nome = null, cognome = null, email = null }) {
  const rows = await db.query(
    `INSERT INTO users (username, password_hash, role, attivo, created_at, nome, cognome, email)
     OUTPUT INSERTED.id, INSERTED.username, INSERTED.role, INSERTED.attivo, INSERTED.nome, INSERTED.cognome, INSERTED.email
     VALUES (@username, @passwordHash, @role, 1, SYSUTCDATETIME(), @nome, @cognome, @email)`,
    { username, passwordHash, role, nome, cognome, email }
  );
  return rows[0];
}

async function listUsers(db) {
  return db.query(
    'SELECT id, username, nome, cognome, email, role, attivo, created_at FROM users ORDER BY username',
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

const CAMPI_MODIFICABILI = ['username', 'role', 'attivo', 'nome', 'cognome', 'email', 'password_hash'];

async function updateUser(db, id, campi) {
  const keys = Object.keys(campi || {}).filter((k) => CAMPI_MODIFICABILI.includes(k));
  if (keys.length === 0) return;
  const params = { id };
  for (const k of keys) params[k] = campi[k];
  const set = keys.map((k) => `${k} = @${k}`).join(', ');
  await db.query(`UPDATE users SET ${set} WHERE id = @id`, params);
}

async function deleteUser(db, id) {
  await db.query('DELETE FROM users WHERE id = @id', { id });
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
  updateUser,
  deleteUser,
};
