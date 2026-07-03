const sql = require('mssql');
const { createDb } = require('./query');

async function connectCrm(config) {
  const pool = new sql.ConnectionPool({
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: { encrypt: true, trustServerCertificate: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  });
  await pool.connect();
  return createDb(pool);
}

module.exports = { connectCrm };
