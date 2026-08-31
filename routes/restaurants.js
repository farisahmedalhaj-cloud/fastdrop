const express = require('express');
const db = require('../db');
const { newId } = require('../utils/helpers');
const { authenticate, optionalAuthenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function formatMenuItem(m) {
  return { ...m, price: m.price === null ? null : m.price, available: !!m.available };
}

// Public: list + search restaurants. Database-backed (spec section 31/65).
router.get('/', optionalAuthenticate, (req, res) => {
  const { q, category } = req.query;
  let sql = 'SELECT * FROM restaurants WHERE is_active = 1';
  const params = [];
  if (q) {
    sql += ' AND (name LIKE ? OR description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY name ASC';
  const restaurants = db.prepare(sql).all(...params);

  // attach average rating (database-backed, never invented)
  const withRating = restaurants.map((r) => {
    const rating = db
      .prepare('SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE restaurant_id = ?')
      .get(r.id);
    return { ...r, is_active: !!r.is_active, rating_avg: rating.avg, rating_count: rating.count };
  });
  res.json({ restaurants: withRating });
});

// Restaurant dashboard: "my restaurant" record for the logged-in restaurant account
router.get('/mine', authenticate, requireRole('restaurant'), (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'لا يوجد مطعم مرتبط بهذا الحساب.' });
  res.json({ restaurant });
});

router.get('/:id', optionalAuthenticate, (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant || !restaurant.is_active) {
    return res.status(404).json({ error: 'المطعم غير موجود.' });
  }
  const menu = db
    .prepare('SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY category, name')
    .all(req.params.id)
    .map(formatMenuItem);
  const rating = db
    .prepare('SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE restaurant_id = ?')
    .get(req.params.id);
  res.json({ restaurant, menu, rating_avg: rating.avg, rating_count: rating.count });
});

// --- Ownership check helper ---
function loadOwnedRestaurant(req, res) {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) {
    res.status(404).json({ error: 'المطعم غير موجود.' });
    return null;
  }
  if (restaurant.owner_user_id !== req.user.id) {
    res.status(403).json({ error: 'لا تملك صلاحية تعديل هذا المطعم.' });
    return null;
  }
  return restaurant;
}

// --- Menu management (restaurant role, ownership enforced server-side) ---
router.post('/:id/menu', authenticate, requireRole('restaurant'), (req, res) => {
  const restaurant = loadOwnedRestaurant(req, res);
  if (!restaurant) return;
  const { name, description, category, price, image } = req.body || {};
  if (!name) return res.status(400).json({ error: 'اسم الصنف مطلوب.' });
  if (price !== undefined && price !== null && (typeof price !== 'number' || price < 0)) {
    return res.status(400).json({ error: 'السعر غير صالح.' });
  }
  const id = newId();
  db.prepare(
    `INSERT INTO menu_items (id, restaurant_id, name, description, category, price, image, available, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
  ).run(id, restaurant.id, name, description || null, category || null, price ?? null, image || null);
  res.status(201).json({ item: formatMenuItem(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id)) });
});

router.patch('/:id/menu/:itemId', authenticate, requireRole('restaurant'), (req, res) => {
  const restaurant = loadOwnedRestaurant(req, res);
  if (!restaurant) return;
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?').get(req.params.itemId, restaurant.id);
  if (!item) return res.status(404).json({ error: 'الصنف غير موجود.' });

  const fields = ['name', 'description', 'category', 'price', 'image', 'available'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      if (f === 'price' && req.body.price !== null && (typeof req.body.price !== 'number' || req.body.price < 0)) {
        return res.status(400).json({ error: 'السعر غير صالح.' });
      }
      updates.push(`${f} = ?`);
      params.push(f === 'available' ? (req.body.available ? 1 : 0) : req.body[f]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'لا توجد بيانات للتحديث.' });
  updates.push("updated_at = datetime('now')");
  params.push(req.params.itemId);
  db.prepare(`UPDATE menu_items SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ item: formatMenuItem(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.itemId)) });
});

router.delete('/:id/menu/:itemId', authenticate, requireRole('restaurant'), (req, res) => {
  const restaurant = loadOwnedRestaurant(req, res);
  if (!restaurant) return;
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?').get(req.params.itemId, restaurant.id);
  if (!item) return res.status(404).json({ error: 'الصنف غير موجود.' });
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.itemId);
  res.json({ ok: true });
});

router.patch('/:id', authenticate, requireRole('restaurant'), (req, res) => {
  const restaurant = loadOwnedRestaurant(req, res);
  if (!restaurant) return;
  const fields = ['name', 'description', 'location', 'image', 'category'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      params.push(req.body[f]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'لا توجد بيانات للتحديث.' });
  updates.push("updated_at = datetime('now')");
  params.push(restaurant.id);
  db.prepare(`UPDATE restaurants SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ restaurant: db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurant.id) });
});

router.get('/:id/reviews', (req, res) => {
  const reviews = db
    .prepare(
      `SELECT reviews.*, users.name as customer_name FROM reviews
       JOIN users ON users.id = reviews.customer_id
       WHERE restaurant_id = ? ORDER BY created_at DESC`
    )
    .all(req.params.id);
  res.json({ reviews });
});

module.exports = router;
