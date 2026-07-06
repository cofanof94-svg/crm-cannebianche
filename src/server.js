const { loadConfig } = require('./config');
const { connectCrm } = require('./db/crm');
const { connectPms } = require('./db/pms');
const { createApp } = require('./app');

async function main() {
  const config = loadConfig();
  const crmDb = await connectCrm(config.crm);
  const pmsDb = await connectPms(config.pms);
  const app = createApp({ crmDb, pmsDb, sessionSecret: config.sessionSecret });
  app.listen(config.port, () => {
    console.log(`CRM in ascolto su http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Avvio fallito:', err.message);
  process.exit(1);
});
