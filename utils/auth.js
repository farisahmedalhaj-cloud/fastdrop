const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!JWT_SECRET) {
  // Fail loudly rather than silently signing tokens with an empty secret.
  throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set a real secret.');
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Code format validation per spec section 72
const CODE_PATTERNS = {
  restaurant: /^SFR-RES-\d{6}$/,
  pharmacy: /^SFR-PHA-\d{6}$/,
  driver: /^SFR-DRV-\d{6}$/,
  owner: /^SFR-OWN-\d{4}$/,
};

function validateCodeFormat(role, code) {
  const pattern = CODE_PATTERNS[role];
  if (!pattern) return false;
  return pattern.test(code);
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  validateCodeFormat,
  CODE_PATTERNS,
};
