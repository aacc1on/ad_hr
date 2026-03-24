/**
 * server.js
 * Application entry point.
 * Sets up Express, session, routes, and the default admin account.
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path    = require('path');
const db      = require('./config/db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────────────────────
// Core middleware
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-please-change',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    // secure:   process.env.NODE_ENV === 'production',
    secure: false, // For development; set to true in production with HTTPS
    httpOnly: true,
    sameSite: 'strict',
    maxAge:   parseInt(process.env.SESSION_MAX_AGE || '86400000'),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// View engine
// ─────────────────────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Make session user available in all templates
app.use((req, res, next) => {
  res.locals.user = req.session.userId
    ? { id: req.session.userId, username: req.session.username, role: req.session.role }
    : null;
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
app.use(require('./routes/auth'));
app.use('/',        require('./routes/upload'));
app.use('/results', require('./routes/results'));

// 404
app.use((req, res) => res.status(404).render('404', { message: 'Page not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('[App Error]', err.message);
  res.status(500).render('error', {
    message: 'An unexpected error occurred',
    error:   process.env.NODE_ENV === 'development' ? err.message : '',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap: create default admin account if it doesn't exist
// ─────────────────────────────────────────────────────────────────────────────
(function ensureAdminExists() {
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!exists) {
    const bcrypt = require('bcrypt');
    const hash   = bcrypt.hashSync('admin123', 10);
    db.prepare(
      "INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, 'admin')"
    ).run('admin', hash, 'admin@company.am');
    console.log('[Bootstrap] Default admin created  →  admin / admin123');
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  AD ↔ HR Reconciliation Platform`);
  console.log(`📡  http://localhost:${PORT}`);
  console.log(`🔑  Default login: admin / admin123`);
  console.log(`📂  Logs: ${process.env.LOG_DIR || './logs'}\n`);
});

module.exports = app;
