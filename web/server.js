'use strict';

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_DURATION_MS = 1000 * 60 * 60 * 6;
const LOGIN_WINDOW_MS = 1000 * 60 * 15;
const LOGIN_MAX_ATTEMPTS = 8;

function timingSafeEquals(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isValidHexColor(value) {
  return typeof value === 'string' && /^#?[0-9a-fA-F]{6}$/.test(value.trim());
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createWebApp(bot) {
  const app = express();
  const production = process.env.NODE_ENV === 'production';
  const panelUser = process.env.WEB_USER || '12';
  const panelPass = process.env.WEB_PASS || '12';
  // Si aún no configuraste SESSION_SECRET, se genera uno seguro para esta ejecución.
  // Railway lo reiniciará al redeploy; define la variable para conservar sesiones entre reinicios.
  const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
  const loginAttempts = new Map();

  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none';",
    );
    next();
  });

  app.use(express.static(path.join(__dirname, 'public'), { maxAge: production ? '1h' : 0 }));
  app.get('/assets/banner.gif', (req, res) => res.sendFile(path.join(PROJECT_ROOT, 'DKTl8K1.gif')));
  app.get('/assets/logo.gif', (req, res) => res.sendFile(path.join(PROJECT_ROOT, 'gif_1.gif')));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use(session({
    name: 'x_panel_session',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: production,
      maxAge: SESSION_DURATION_MS,
    },
  }));

  function rejectUnauthenticated(req, res) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, message: 'Sesión no válida. Inicia sesión nuevamente.' });
    return res.redirect('/login');
  }

  function requireAuth(req, res, next) {
    if (req.session?.authenticated === true) return next();
    return rejectUnauthenticated(req, res);
  }

  function requireSameOrigin(req, res, next) {
    const origin = req.get('origin');
    const host = req.get('host');
    if (origin && host) {
      try {
        if (new URL(origin).host !== host) return res.status(403).json({ ok: false, message: 'Origen de solicitud no permitido.' });
      } catch {
        return res.status(403).json({ ok: false, message: 'Origen de solicitud no válido.' });
      }
    }
    return next();
  }

  function attemptRecord(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry || now - entry.startedAt > LOGIN_WINDOW_MS) {
      const fresh = { startedAt: now, count: 0 };
      loginAttempts.set(ip, fresh);
      return fresh;
    }
    return entry;
  }

  function dashboardData(req) {
    return {
      user: req.session.user,
      overview: bot.getOverview(),
    };
  }

  app.get('/health', (req, res) => {
    const overview = bot.getOverview();
    res.status(200).json({ status: 'ok', botReady: overview.ready, timestamp: new Date().toISOString() });
  });

  app.get('/', (req, res) => (req.session?.authenticated ? res.redirect('/dashboard') : res.redirect('/login')));

  app.get('/login', (req, res) => {
    if (req.session?.authenticated) return res.redirect('/dashboard');
    return res.render('login', { error: null });
  });

  app.post('/login', requireSameOrigin, (req, res) => {
    const record = attemptRecord(req.ip);
    if (record.count >= LOGIN_MAX_ATTEMPTS) {
      return res.status(429).render('login', { error: 'Demasiados intentos. Espera unos minutos e inténtalo otra vez.' });
    }

    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const correct = timingSafeEquals(username, panelUser) && timingSafeEquals(password, panelPass);

    if (!correct) {
      record.count += 1;
      return res.status(401).render('login', { error: 'Usuario o contraseña incorrectos.' });
    }

    loginAttempts.delete(req.ip);
    req.session.regenerate((error) => {
      if (error) return res.status(500).render('login', { error: 'No se pudo crear la sesión. Intenta de nuevo.' });
      req.session.authenticated = true;
      req.session.user = username;
      return res.redirect('/dashboard');
    });
  });

  app.post('/logout', requireAuth, requireSameOrigin, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('x_panel_session');
      return res.redirect('/login');
    });
  });

  app.get('/dashboard', requireAuth, (req, res) => res.render('dashboard', dashboardData(req)));

  app.get('/api/overview', requireAuth, (req, res) => {
    res.json({ ok: true, ...bot.getOverview() });
  });

  app.get('/api/logs', requireAuth, (req, res) => {
    res.json({ ok: true, logs: bot.getLogs() });
  });

  app.delete('/api/logs', requireAuth, requireSameOrigin, (req, res) => {
    bot.clearLogs();
    res.json({ ok: true, message: 'Logs limpiados.' });
  });

  app.get('/api/tickets', requireAuth, (req, res) => {
    res.json({ ok: true, tickets: bot.getTickets() });
  });

  app.post('/api/tickets/:channelId/close', requireAuth, requireSameOrigin, asyncRoute(async (req, res) => {
    const result = await bot.closeTicket(req.params.channelId, `Panel web (${req.session.user})`);
    res.status(result.ok ? 200 : 400).json({ ok: result.ok, message: result.message });
  }));

  app.put('/api/security', requireAuth, requireSameOrigin, (req, res) => {
    const result = bot.updateSecurity(req.body.module, req.body.enabled);
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/voice/connect', requireAuth, requireSameOrigin, asyncRoute(async (req, res) => {
    const result = await bot.connectVoice(String(req.body.channelId || ''));
    res.status(result.ok ? 200 : 400).json(result);
  }));

  app.post('/api/voice/disconnect', requireAuth, requireSameOrigin, (req, res) => {
    const result = bot.disconnectVoice();
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/presence', requireAuth, requireSameOrigin, (req, res) => {
    const result = bot.updatePresence({ status: req.body.status, activity: req.body.activity });
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/embed/predefined', requireAuth, requireSameOrigin, asyncRoute(async (req, res) => {
    const result = await bot.sendPredefinedEmbed(String(req.body.type || ''), String(req.body.channelId || ''));
    res.status(result.ok ? 200 : 400).json(result);
  }));

  app.post('/api/embed/custom', requireAuth, requireSameOrigin, asyncRoute(async (req, res) => {
    const title = String(req.body.title || '').trim().slice(0, 256);
    const description = String(req.body.description || '').trim().slice(0, 4_096);
    const footer = String(req.body.footer || '').trim().slice(0, 2_048);
    const rawColor = String(req.body.color || '#00ff88').trim();
    if (!title && !description) return res.status(400).json({ ok: false, message: 'Agrega al menos un título o una descripción.' });
    if (!isValidHexColor(rawColor)) return res.status(400).json({ ok: false, message: 'El color debe ser hexadecimal, por ejemplo #00ff88.' });

    const result = await bot.sendCustomEmbed({
      channelId: String(req.body.channelId || ''),
      title,
      description,
      footer,
      color: Number.parseInt(rawColor.replace('#', ''), 16),
    });
    res.status(result.ok ? 200 : 400).json(result);
  }));

  app.get('/api/settings/export', requireAuth, (req, res) => {
    const fileName = `x-panel-settings-${new Date().toISOString().slice(0, 10)}.json`;
    res.attachment(fileName).json(bot.exportSettings());
  });

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, message: 'Ruta no encontrada.' });
    return res.status(404).render('login', { error: 'La página solicitada no existe.' });
  });

  app.use((error, req, res, next) => {
    console.error('[WEB] Error no controlado:', error);
    if (res.headersSent) return next(error);
    if (req.path.startsWith('/api/')) return res.status(500).json({ ok: false, message: 'Error interno del panel.' });
    return res.status(500).render('login', { error: 'Error interno del panel.' });
  });

  return app;
}

module.exports = { createWebApp };
