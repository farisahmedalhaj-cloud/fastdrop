const { verifyToken } = require('../utils/auth');
const db = require('../db');

const COOKIE_NAME = process.env.COOKIE_NAME || 'fastdrop_token';

// Reads the JWT from the HttpOnly cookie (or Authorization header as a
// fallback for non-browser clients / testing tools), verifies it, loads
// the current user from the database (so disabled/deleted accounts are
// rejected immediately even with a still-valid token), and attaches it
// to req.user.
function authenticate(req, res, next) {
  let token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }
  if (!token) {
    return res.status(401).json({ error: 'غير مصرح. الرجاء تسجيل الدخول.' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية. الرجاء تسجيل الدخول مجددًا.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (!user) {
    return res.status(401).json({ error: 'المستخدم غير موجود.' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'هذا الحساب معطل حاليًا.' });
  }
  req.user = user;
  next();
}

// Optional auth: attaches req.user if a valid session exists, but never blocks.
function optionalAuthenticate(req, res, next) {
  let token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }
  if (!token) return next();
  const payload = verifyToken(token);
  if (!payload) return next();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (user && user.is_active) req.user = user;
  next();
}

// Role guard: usage requireRole('owner') or requireRole('restaurant','owner')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'غير مصرح.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'لا تملك صلاحية الوصول لهذا المورد.' });
    }
    next();
  };
}

module.exports = { authenticate, optionalAuthenticate, requireRole, COOKIE_NAME };
