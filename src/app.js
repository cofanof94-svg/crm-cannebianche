const express = require('express');
const session = require('express-session');
const path = require('path');
const { createAuthRouter } = require('./auth/routes');
const { createAdminRouter } = require('./api/admin');
const { createArriviRouter } = require('./api/arrivi');
const { requireAuth } = require('./auth/middleware');

function createApp({ crmDb, pmsDb, sessionSecret }) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
  }));

  // Le risposte API (autenticate/dinamiche) non devono essere memorizzate né
  // rivalidate dal browser: senza questo, un ETag genera 304 e il frontend
  // interpreta il non-200 come "non autenticato".
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/auth', createAuthRouter(crmDb));
  app.use('/api/admin', createAdminRouter(crmDb));
  app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.session.user }));
  app.use('/api', createArriviRouter(pmsDb));

  app.use(express.static(path.join(__dirname, '..', 'web')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('Errore non gestito:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  });
  return app;
}

module.exports = { createApp };
