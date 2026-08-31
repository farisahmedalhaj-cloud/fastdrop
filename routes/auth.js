const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { hashPassword, verifyPassword, signToken } = require('../utils/auth');
const { newId } = require('../utils/helpers');
const { authenticate, COOKIE_NAME } = require('../middleware/auth');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة جدًا. حاول لاحقًا.' },
});

function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    // SameSite=None is required for the cookie to be sent on cross-site
    // fetch requests (frontend and backend are on different subdomains in
    // production, e.g. Railway). Browsers require Secure=true whenever
    // SameSite=None is used, which is satisfied since production runs over
    // HTTPS. Locally (http://localhost) we fall back to Lax/non-secure.
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    is_active: !!u.is_active,
  };
}

// Customer self-registration only. Restaurant/Pharmacy/Driver/Owner accounts
// are provisioned by the Owner (see routes/owner.js) or the seed script,
// never through open self-registration, per spec section 9-11.
router.post('/register', authLimiter, (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'الاسم والبريد الإلكتروني وكلمة المرور مطلوبة.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجل مسبقًا.' });
  }
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, phone, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'customer', 1, datetime('now'), datetime('now'))`
  ).run(id, name, email.toLowerCase(), hashPassword(password), phone || null);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.status(201).json({ user: publicUser(user) });
});

// Unified login. Customers log in with email+password only.
// Restaurant/Pharmacy/Driver/Owner must also provide their assigned code,
// and the code must match the account's *current* role and code exactly.
router.post('/login', authLimiter, (req, res) => {
  const { email, password, code } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'هذا الحساب معطل. تواصل مع الإدارة.' });
  }
  if (user.role !== 'customer') {
    if (!code) {
      return res.status(400).json({ error: 'رمز الحساب مطلوب لهذا النوع من الحسابات.' });
    }
    if (code !== user.code) {
      return res.status(401).json({ error: 'رمز الحساب غير صحيح.' });
    }
  }
  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
