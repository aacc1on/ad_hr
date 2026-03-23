/**
 * middleware/auth.js
 * Authentication guards for Express routes.
 */

/**
 * isAuthenticated
 * Blocks unauthenticated requests, redirects to /login.
 */
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/login');
}

/**
 * notAuthenticated
 * Redirects already-logged-in users away from login/register pages.
 */
function notAuthenticated(req, res, next) {
  if (req.session && req.session.userId) return res.redirect('/');
  next();
}

module.exports = { isAuthenticated, notAuthenticated };
