const { loadConfig } = require('../src/config');
const { connectCrm } = require('../src/db/crm');
const { hashPassword } = require('../src/auth/password');
const { createUser, findUserByUsername } = require('../src/crm/users');

async function main() {
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error('Imposta ADMIN_PASSWORD nell\'ambiente prima del seed');

  const config = loadConfig();
  const db = await connectCrm(config.crm);
  if (await findUserByUsername(db, username)) {
    console.log(`Utente '${username}' già esistente, nessuna azione.`);
    await db.close();
    return;
  }
  const passwordHash = await hashPassword(password);
  const user = await createUser(db, { username, passwordHash, role: 'admin' });
  console.log(`Creato admin id=${user.id} username=${user.username}`);
  await db.close();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
