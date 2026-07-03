require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Variabile ambiente mancante: ${name}`);
  return v;
}

function loadConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    sessionSecret: required('SESSION_SECRET'),
    pms: {
      server: required('PMS_SERVER'),
      port: Number(required('PMS_PORT')),
      database: required('PMS_DATABASE'),
      user: required('PMS_USER'),
      password: required('PMS_PASSWORD'),
    },
    crm: {
      server: required('CRM_SERVER'),
      port: Number(required('CRM_PORT')),
      database: required('CRM_DATABASE'),
      user: required('CRM_USER'),
      password: required('CRM_PASSWORD'),
    },
  };
}

module.exports = { loadConfig };
