const express = require('express');
const db = require('../db');
const { hashPassword } = require('../utils/auth');
const { newId, logAudit, nextSequentialCode } = require('../utils/helpers');
const { validateCodeFormat } = require('../utils/auth');
const { authenticate, requireRole } = require('../middleware/auth');
const { getAllSettings, setSetting } = require('../utils/settings');

const router = express.Router();
router.use(authenticate, requireRole('owner'));

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, code: u.code, is_active: !!u.is_active, created_at: u.created_at };
}

// ---------------- STATISTICS (section 67 — real DB counts only, never fake) ----------------
router.get('/stats', (req, res) => {
  const count = (sql, ...params) => db.prepare(sql).get(...params).c;
  res.json({
    customers: count("SELECT COUNT(*) as c FROM users WHERE role = 'customer'"),
    restaurants: count('SELECT COUNT(*) as c FROM restaurants'),
    pharmacies: count('SELECT COUNT(*) as c FROM pharmacies'),
    drivers: count("SELECT COUNT(*) as c FROM users WHERE role = 'driver'"),
    orders_total: count('SELECT COUNT(*) as c FROM orders'),
    orders_pending: count("SELECT COUNT(*) as c FROM orders WHERE status NOT IN ('delivered','cancelled')"),
    orders_delivered: count("SELECT COUNT(*) as c FROM orders WHERE status = 'delivered'"),
    orders_cancelled: count("SELECT COUNT(*) as c FROM orders WHERE status = 'cancelled'"),
    reviews_total: count('SELECT COUNT(*) as c FROM reviews'),
    outstanding_fees_unpaid: db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM customer_outstanding_fees WHERE is_paid = 0').get().s,
  });
});

router.get('/audit-logs', (req, res) => {
  const logs = db.prepare('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 500').all();
  res.json({ logs });
});

// ---------------- SETTINGS (delivery fees, section 45/75 — owner-configured, never hardcoded) ----------------
router.get('/settings', (req, res) => res.json({ settings: getAllSettings() }));

router.patch('/settings', (req, res) => {
  const allowed = ['delivery_fee_restaurant', 'delivery_fee_pharmacy', 'delivery_fee_amanat'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const n = parseFloat(req.body[key]);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: `قيمة غير صالحة لـ ${key}` });
      setSetting(key, n);
    }
  }
  res.json({ settings: getAllSettings() });
});

// ============================================================
// GENERIC ACCOUNT MANAGEMENT (restaurant / pharmacy / driver)
// ============================================================

const CODE_PREFIX = { restaurant: 'SFR-RES', pharmacy: 'SFR-PHA', driver: 'SFR-DRV' };

function listAccounts(role) {
  return db.prepare('SELECT * FROM users WHERE role = ? ORDER BY created_at DESC').all(role).map(publicUser);
}

router.get('/restaurants', (req, res) => res.json({ accounts: listAccounts('restaurant') }));
router.get('/pharmacies', (req, res) => res.json({ accounts: listAccounts('pharmacy') }));
router.get('/drivers', (req, res) => res.json({ accounts: listAccounts('driver') }));

// Create restaurant account + restaurant record together
router.post('/restaurants', (req, res) => {
  const { name, email, phone, password, code, restaurant_name, description, location, category } = req.body || {};
  if (!name || !email || !password || !restaurant_name) {
    return res.status(400).json({ error: 'الاسم والبريد وكلمة المرور واسم المطعم مطلوبة.' });
  }
  const finalCode = code || nextSequentialCode('SFR-RES');
  if (!validateCodeFormat('restaurant', finalCode)) {
    return res.status(400).json({ error: 'صيغة الكود غير صحيحة. المطلوب: SFR-RES-XXXXXX' });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())) {
    return res.status(409).json({ error: 'البريد الإلكتروني مستخدم مسبقًا.' });
  }
  if (db.prepare('SELECT id FROM users WHERE code = ?').get(finalCode)) {
    return res.status(409).json({ error: 'هذا الكود مستخدم مسبقًا.' });
  }

  const userId = newId();
  const restaurantId = newId();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, phone, role, code, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'restaurant', ?, 1, datetime('now'), datetime('now'))`
    ).run(userId, name, email.toLowerCase(), hashPassword(password), phone || null, finalCode);
    db.prepare(
      `INSERT INTO restaurants (id, name, description, location, category, owner_user_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
    ).run(restaurantId, restaurant_name, description || null, location || null, category || null, userId);
    logAudit(req.user.id, userId, 'create_restaurant_account', { restaurant_name, code: finalCode });
  });
  tx();
  res.status(201).json({
    account: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)),
    restaurant: db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId),
  });
});

router.post('/pharmacies', (req, res) => {
  const { name, email, phone, password, code, pharmacy_name, description, location, plus_code } = req.body || {};
  if (!name || !email || !password || !pharmacy_name) {
    return res.status(400).json({ error: 'الاسم والبريد وكلمة المرور واسم الصيدلية مطلوبة.' });
  }
  const finalCode = code || nextSequentialCode('SFR-PHA');
  if (!validateCodeFormat('pharmacy', finalCode)) {
    return res.status(400).json({ error: 'صيغة الكود غير صحيحة. المطلوب: SFR-PHA-XXXXXX' });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())) {
    return res.status(409).json({ error: 'البريد الإلكتروني مستخدم مسبقًا.' });
  }
  if (db.prepare('SELECT id FROM users WHERE code = ?').get(finalCode)) {
    return res.status(409).json({ error: 'هذا الكود مستخدم مسبقًا.' });
  }

  const userId = newId();
  const pharmacyId = newId();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, phone, role, code, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pharmacy', ?, 1, datetime('now'), datetime('now'))`
    ).run(userId, name, email.toLowerCase(), hashPassword(password), phone || null, finalCode);
    db.prepare(
      `INSERT INTO pharmacies (id, name, description, location, plus_code, phone, owner_user_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
    ).run(pharmacyId, pharmacy_name, description || null, location || null, plus_code || null, phone || null, userId);
    logAudit(req.user.id, userId, 'create_pharmacy_account', { pharmacy_name, code: finalCode });
  });
  tx();
  res.status(201).json({
    account: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)),
    pharmacy: db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(pharmacyId),
  });
});

router.post('/drivers', (req, res) => {
  const { name, email, phone, password, code } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'الاسم والبريد وكلمة المرور مطلوبة.' });
  }
  const finalCode = code || nextSequentialCode('SFR-DRV');
  if (!validateCodeFormat('driver', finalCode)) {
    return res.status(400).json({ error: 'صيغة الكود غير صحيحة. المطلوب: SFR-DRV-XXXXXX' });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())) {
    return res.status(409).json({ error: 'البريد الإلكتروني مستخدم مسبقًا.' });
  }
  if (db.prepare('SELECT id FROM users WHERE code = ?').get(finalCode)) {
    return res.status(409).json({ error: 'هذا الكود مستخدم مسبقًا.' });
  }
  const userId = newId();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, phone, role, code, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'driver', ?, 1, datetime('now'), datetime('now'))`
    ).run(userId, name, email.toLowerCase(), hashPassword(password), phone || null, finalCode);
    db.prepare(`INSERT INTO delivery_drivers (id, user_id, is_available, created_at, updated_at) VALUES (?, ?, 1, datetime('now'), datetime('now'))`)
      .run(newId(), userId);
    logAudit(req.user.id, userId, 'create_driver_account', { code: finalCode });
  });
  tx();
  res.status(201).json({ account: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) });
});

// ---- Shared account actions: change password / change code / disable / enable / delete ----
function loadAccountOfRole(role) {
  return (req, res, next) => {
    const account = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.userId, role);
    if (!account) return res.status(404).json({ error: 'الحساب غير موجود.' });
    req.targetAccount = account;
    next();
  };
}

function registerAccountActions(role) {
  const base = `/${role}s`; // /restaurants, /pharmacys(fixed below), /drivers
  const path = role === 'pharmacy' ? '/pharmacies' : base;

  router.patch(`${path}/:userId/password`, loadAccountOfRole(role), (req, res) => {
    const { password } = req.body || {};
    if (!password || password.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.' });
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(hashPassword(password), req.targetAccount.id);
    logAudit(req.user.id, req.targetAccount.id, 'change_password', { role });
    res.json({ ok: true });
  });

  router.patch(`${path}/:userId/code`, loadAccountOfRole(role), (req, res) => {
    const { code } = req.body || {};
    if (!code || !validateCodeFormat(role, code)) {
      return res.status(400).json({ error: 'صيغة الكود غير صحيحة.' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE code = ? AND id != ?').get(code, req.targetAccount.id);
    if (existing) return res.status(409).json({ error: 'هذا الكود مستخدم مسبقًا.' });
    db.prepare(`UPDATE users SET code = ?, updated_at = datetime('now') WHERE id = ?`).run(code, req.targetAccount.id);
    logAudit(req.user.id, req.targetAccount.id, 'change_code', { role, new_code: code });
    res.json({ ok: true, code });
  });

  router.patch(`${path}/:userId/disable`, loadAccountOfRole(role), (req, res) => {
    db.prepare(`UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(req.targetAccount.id);
    logAudit(req.user.id, req.targetAccount.id, 'disable_account', { role });
    res.json({ ok: true });
  });

  router.patch(`${path}/:userId/enable`, loadAccountOfRole(role), (req, res) => {
    db.prepare(`UPDATE users SET is_active = 1, updated_at = datetime('now') WHERE id = ?`).run(req.targetAccount.id);
    logAudit(req.user.id, req.targetAccount.id, 'enable_account', { role });
    res.json({ ok: true });
  });

  router.patch(`${path}/:userId`, loadAccountOfRole(role), (req, res) => {
    const fields = ['name', 'phone'];
    const updates = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(req.body[f]);
      }
    }
    if (updates.length) {
      updates.push("updated_at = datetime('now')");
      params.push(req.targetAccount.id);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
    // Also allow editing the linked business record in the same call for convenience
    if (role === 'restaurant' && req.body.restaurant) {
      const restaurant = db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?').get(req.targetAccount.id);
      if (restaurant) {
        const rFields = ['name', 'description', 'location', 'image', 'category'];
        const rUpdates = [];
        const rParams = [];
        for (const f of rFields) {
          if (req.body.restaurant[f] !== undefined) {
            rUpdates.push(`${f} = ?`);
            rParams.push(req.body.restaurant[f]);
          }
        }
        if (rUpdates.length) {
          rUpdates.push("updated_at = datetime('now')");
          rParams.push(restaurant.id);
          db.prepare(`UPDATE restaurants SET ${rUpdates.join(', ')} WHERE id = ?`).run(...rParams);
        }
      }
    }
    if (role === 'pharmacy' && req.body.pharmacy) {
      const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE owner_user_id = ?').get(req.targetAccount.id);
      if (pharmacy) {
        const pFields = ['name', 'description', 'location', 'plus_code', 'image', 'phone'];
        const pUpdates = [];
        const pParams = [];
        for (const f of pFields) {
          if (req.body.pharmacy[f] !== undefined) {
            pUpdates.push(`${f} = ?`);
            pParams.push(req.body.pharmacy[f]);
          }
        }
        if (pUpdates.length) {
          pUpdates.push("updated_at = datetime('now')");
          pParams.push(pharmacy.id);
          db.prepare(`UPDATE pharmacies SET ${pUpdates.join(', ')} WHERE id = ?`).run(...pParams);
        }
      }
    }
    logAudit(req.user.id, req.targetAccount.id, 'edit_account', { role });
    res.json({ account: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.targetAccount.id)) });
  });

  // Soft delete: disable login, keep historical orders/reviews intact (spec 17)
  router.delete(`${path}/:userId`, loadAccountOfRole(role), (req, res) => {
    db.prepare(`UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(req.targetAccount.id);
    if (role === 'restaurant') {
      db.prepare(`UPDATE restaurants SET is_active = 0, updated_at = datetime('now') WHERE owner_user_id = ?`).run(req.targetAccount.id);
    }
    if (role === 'pharmacy') {
      db.prepare(`UPDATE pharmacies SET is_active = 0, updated_at = datetime('now') WHERE owner_user_id = ?`).run(req.targetAccount.id);
    }
    logAudit(req.user.id, req.targetAccount.id, 'delete_account', { role });
    res.json({ ok: true });
  });
}

registerAccountActions('restaurant');
registerAccountActions('pharmacy');
registerAccountActions('driver');

// ---------------- CUSTOMERS (read-only oversight) ----------------
router.get('/customers', (req, res) => {
  const customers = db.prepare(`SELECT * FROM users WHERE role = 'customer' ORDER BY created_at DESC`).all().map(publicUser);
  res.json({ accounts: customers });
});

router.patch('/customers/:userId/disable', loadAccountOfRole('customer'), (req, res) => {
  db.prepare(`UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(req.targetAccount.id);
  logAudit(req.user.id, req.targetAccount.id, 'disable_account', { role: 'customer' });
  res.json({ ok: true });
});

router.patch('/customers/:userId/enable', loadAccountOfRole('customer'), (req, res) => {
  db.prepare(`UPDATE users SET is_active = 1, updated_at = datetime('now') WHERE id = ?`).run(req.targetAccount.id);
  logAudit(req.user.id, req.targetAccount.id, 'enable_account', { role: 'customer' });
  res.json({ ok: true });
});

// ---------------- ORDERS / AMANAT OVERSIGHT ----------------
router.get('/orders', (req, res) => {
  const { type, status } = req.query;
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (type) { sql += ' AND order_type = ?'; params.push(type); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  const orders = db.prepare(sql).all(...params);
  res.json({ orders });
});

router.get('/amanat', (req, res) => {
  const orders = db
    .prepare(
      `SELECT o.*, a.item_name, a.pickup_location, a.delivery_location, a.recipient_name
       FROM orders o JOIN amanat_orders a ON a.order_id = o.id
       ORDER BY o.created_at DESC LIMIT 500`
    )
    .all();
  res.json({ orders });
});

router.get('/outstanding-fees', (req, res) => {
  const fees = db
    .prepare(
      `SELECT f.*, u.name as customer_name, u.email as customer_email FROM customer_outstanding_fees f
       JOIN users u ON u.id = f.customer_id ORDER BY f.created_at DESC`
    )
    .all();
  res.json({ fees });
});

router.get('/reviews', (req, res) => {
  const reviews = db
    .prepare(
      `SELECT reviews.*, users.name as customer_name FROM reviews
       JOIN users ON users.id = reviews.customer_id ORDER BY created_at DESC LIMIT 500`
    )
    .all();
  res.json({ reviews });
});

module.exports = router;
