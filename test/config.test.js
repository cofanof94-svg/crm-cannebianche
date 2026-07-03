const { test } = require('node:test');
const assert = require('node:assert');

function withEnv(vars, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, vars);
  try { return fn(); } finally { process.env = saved; }
}

test('loadConfig legge le variabili obbligatorie', () => {
  delete require.cache[require.resolve('../src/config')];
  withEnv({
    PORT: '4000', SESSION_SECRET: 's3cret',
    PMS_SERVER: 'TSASS', PMS_PORT: '2022', PMS_DATABASE: 'HolidayCanneBianche',
    PMS_USER: 'g.mangano', PMS_PASSWORD: 'pw',
    CRM_SERVER: 'CRMSRV', CRM_PORT: '1433', CRM_DATABASE: 'CRM_DirectHoliday',
    CRM_USER: 'crm', CRM_PASSWORD: 'pw2',
  }, () => {
    const { loadConfig } = require('../src/config');
    const c = loadConfig();
    assert.strictEqual(c.port, 4000);
    assert.strictEqual(c.pms.server, 'TSASS');
    assert.strictEqual(c.pms.port, 2022);
    assert.strictEqual(c.crm.database, 'CRM_DirectHoliday');
  });
});

test('loadConfig lancia se manca una variabile', () => {
  delete require.cache[require.resolve('../src/config')];
  withEnv({ SESSION_SECRET: '', PMS_SERVER: '' }, () => {
    const { loadConfig } = require('../src/config');
    assert.throws(() => loadConfig(), /SESSION_SECRET/);
  });
});
