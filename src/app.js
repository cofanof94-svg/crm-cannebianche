const express = require('express');
const session = require('express-session');
const path = require('path');
const { createAuthRouter } = require('./auth/routes');
const { createAdminRouter } = require('./api/admin');
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

  app.use('/api/auth', createAuthRouter(crmDb));
  app.use('/api/admin', createAdminRouter(crmDb));
  app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.session.user }));

  app.use(express.static(path.join(__dirname, '..', 'web')));
  return app;
}

module.exports = { createApp };
