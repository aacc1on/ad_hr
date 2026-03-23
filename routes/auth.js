/**
 * routes/auth.js
 * Login, logout, and optional register routes.
 */

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcrypt');
const db       = require('../config/db');
const { notAuthenticated } = require('../middleware/auth');
const { logAudit }         = require('../services/loggerService');

// GET /login
router.get('/login', notAuthenticated, (req, res) => {
  res.render('login', { error: null });
});

// POST /login
router.post('/login', notAuthenticated, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render('login', { error: 'Username and password are required' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.render('login', { error: 'Invalid username or password' });
    }

    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.role     = user.role;

    logAudit({
      userId:   user.id,
      username: user.username,
      action:   'LOGIN',
      detail:   'Successful login',
      ip:       req.ip,
    });

    res.redirect('/');
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.render('login', { error: 'An error occurred. Please try again.' });
  }
});

// GET /register
router.get('/register', notAuthenticated, (req, res) => {
  res.render('register', { error: null, success: null });
});

// POST /register
router.post('/register', notAuthenticated, (req, res) => {
  const { username, password, email } = req.body;
  const minLen = parseInt(process.env.PASSWORD_MIN_LENGTH || '8');

  if (!username || !password || password.length < minLen) {
    return res.render('register', {
      error:   `Username and password (min ${minLen} characters) are required`,
      success: null,
    });
  }

  try {
    const hashed = bcrypt.hashSync(password, 10);
    db.prepare(
      'INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)'
    ).run(username, hashed, email || null, 'analyst');

    res.render('register', {
      error:   null,
      success: 'Account created! You can now log in.',
    });
  } catch (err) {
    const msg = err.message.includes('UNIQUE')
      ? 'Username or email already exists'
      : 'Registration failed. Please try again.';
    res.render('register', { error: msg, success: null });
  }
});

// GET /logout
router.get('/logout', (req, res) => {
  const { userId, username } = req.session;
  req.session.destroy(() => {
    logAudit({ userId, username, action: 'LOGOUT', detail: 'User logged out', ip: req.ip });
    res.redirect('/login');
  });
});

module.exports = router;
