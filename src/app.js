const express = require('express');
const session = require('express-session');
const path = require('path');
const { createAuthRouter } = require('./auth/routes');
const { createAdminRouter } = require('./api/admin');
const { createArriviRouter } = require('./api/arrivi');
const { createClientiRouter } = require('./api/clienti');
const { requireAuth, guardiaPermessi } = require('./auth/middleware');
const { utenteConPermessi } = require('./auth/permessi');

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

  // Login e logout restano pubblici: sono montati PRIMA della guardia, che da qui
  // in avanti pretende una sessione e il permesso giusto per ogni rotta.
  app.use('/api/auth', createAuthRouter(crmDb));

  // Un solo punto di controllo per tutte le API. Sta qui, e non dentro i singoli
  // router, perché una rotta nuova deve nascere protetta anche se chi la scrive
  // non ci pensa: è l'unico modo perché il requisito valga anche in futuro.
  app.use('/api', guardiaPermessi());

  app.use('/api/admin', createAdminRouter(crmDb));
  app.get('/api/me', requireAuth, (req, res) => res.json({ user: utenteConPermessi(req.session.user) }));
  app.use('/api', createArriviRouter(pmsDb, crmDb));
  app.use('/api', createClientiRouter(pmsDb, crmDb));

  // no-cache: il browser rivalida sempre i file statici col server (ETag/Last-Modified),
  // così una modifica a index.html/app.js/styles.css si vede subito senza cache stantia.
  app.use(express.static(path.join(__dirname, '..', 'web'), {
    setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache'); },
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Corpo JSON malformato: è un errore di chi chiama, non un guasto del server.
    // Finiva nel ramo generico, quindi rispondeva 500 e riempiva i log di stack per
    // una richiesta scritta male — nascondendo i 500 veri.
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Corpo della richiesta non valido' });
    }
    console.error('Errore non gestito:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  });
  return app;
}

module.exports = { createApp };
