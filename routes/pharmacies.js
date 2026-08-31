const express = require('express');
const db = require('../db');
const { newId } = require('../utils/helpers');
const { authenticate, optionalAuthenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function formatProduct(p) {
  return {
    ...p,
    price: p.price === null ? null : p.price,
    available: !!p.available,
    requires_prescription: !!p.requires_prescription,
    requires_pharmacist_review: !!p.requires_pharmacist_review,
  };
}

router.get('/categories', (req, res) => {
  res.json({ categories: db.prepare('SELECT * FROM pharmacy_categories ORDER BY name').all() });
});

router.get('/', optionalAuthenticate, (req, res) => {
  const { q } = req.query;
  let sql = 'SELECT * FROM pharmacies WHERE is_active = 1';
  const params = [];
  if (q) {
    sql += ' AND (name LIKE ? OR location LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY name ASC';
  res.json({ pharmacies: db.prepare(sql).all(...params) });
});

// Cross-pharmacy medicine search (spec section 33). Always database-backed,
// never a frontend-only filter: this query scans pharmacy_products across
// every active pharmacy so a customer searching "Panadol" sees every pharmacy
// that actually stocks it, with the real price/availability from each.
router.get('/search', (req, res) => {
  const { medicine } = req.query;
  if (!medicine || !medicine.trim()) {
    return res.status(400).json({ error: 'اكتب اسم الدواء للبحث.' });
  }
  const rows = db
    .prepare(
      `SELECT pp.*, ph.name as pharmacy_name, ph.location as pharmacy_location,
              ph.id as pharmacy_id_ref
       FROM pharmacy_products pp
       JOIN pharmacies ph ON ph.id = pp.pharmacy_id
       WHERE ph.is_active = 1
         AND (pp.name LIKE ? OR pp.active_ingredient LIKE ?)
       ORDER BY pp.name ASC`
    )
    .all(`%${medicine}%`, `%${medicine}%`);

  const results = rows.map((r) => {
    const rating = db
      .prepare('SELECT AVG(rating) as avg FROM reviews WHERE pharmacy_id = ?')
      .get(r.pharmacy_id);
    return {
      product: formatProduct(r),
      pharmacy: { id: r.pharmacy_id, name: r.pharmacy_name, location: r.pharmacy_location, rating_avg: rating.avg },
    };
  });
  res.json({ query: medicine, count: results.length, results });
});

router.get('/mine', authenticate, requireRole('pharmacy'), (req, res) => {
  const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE owner_user_id = ?').get(req.user.id);
  if (!pharmacy) return res.status(404).json({ error: 'لا توجد صيدلية مرتبطة بهذا الحساب.' });
  res.json({ pharmacy });
});

router.get('/:id', optionalAuthenticate, (req, res) => {
  const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(req.params.id);
  if (!pharmacy || !pharmacy.is_active) return res.status(404).json({ error: 'الصيدلية غير موجودة.' });
  const products = db
    .prepare('SELECT * FROM pharmacy_products WHERE pharmacy_id = ? ORDER BY category_id, name')
    .all(req.params.id)
    .map(formatProduct);
  res.json({ pharmacy, products });
});

function loadOwnedPharmacy(req, res) {
  const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(req.params.id);
  if (!pharmacy) {
    res.status(404).json({ error: 'الصيدلية غير موجودة.' });
    return null;
  }
  if (pharmacy.owner_user_id !== req.user.id) {
    res.status(403).json({ error: 'لا تملك صلاحية تعديل هذه الصيدلية.' });
    return null;
  }
  return pharmacy;
}

router.post('/:id/products', authenticate, requireRole('pharmacy'), (req, res) => {
  const pharmacy = loadOwnedPharmacy(req, res);
  if (!pharmacy) return;
  const {
    name, description, active_ingredient, strength, form, category_id,
    price, image, requires_prescription, requires_pharmacist_review,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'اسم المنتج مطلوب.' });
  if (price !== undefined && price !== null && (typeof price !== 'number' || price < 0)) {
    return res.status(400).json({ error: 'السعر غير صالح.' });
  }
  const id = newId();
  db.prepare(
    `INSERT INTO pharmacy_products
      (id, pharmacy_id, name, description, active_ingredient, strength, form, category_id,
       price, image, available, requires_prescription, requires_pharmacist_review, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))`
  ).run(
    id, pharmacy.id, name, description || null, active_ingredient || null, strength || null,
    form || null, category_id || null, price ?? null, image || null,
    requires_prescription ? 1 : 0, requires_pharmacist_review ? 1 : 0
  );
  res.status(201).json({ product: formatProduct(db.prepare('SELECT * FROM pharmacy_products WHERE id = ?').get(id)) });
});

router.patch('/:id/products/:productId', authenticate, requireRole('pharmacy'), (req, res) => {
  const pharmacy = loadOwnedPharmacy(req, res);
  if (!pharmacy) return;
  const product = db.prepare('SELECT * FROM pharmacy_products WHERE id = ? AND pharmacy_id = ?').get(req.params.productId, pharmacy.id);
  if (!product) return res.status(404).json({ error: 'المنتج غير موجود.' });

  const fields = [
    'name', 'description', 'active_ingredient', 'strength', 'form', 'category_id',
    'price', 'image', 'available', 'requires_prescription', 'requires_pharmacist_review',
  ];
  const boolFields = ['available', 'requires_prescription', 'requires_pharmacist_review'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      if (f === 'price' && req.body.price !== null && (typeof req.body.price !== 'number' || req.body.price < 0)) {
        return res.status(400).json({ error: 'السعر غير صالح.' });
      }
      updates.push(`${f} = ?`);
      params.push(boolFields.includes(f) ? (req.body[f] ? 1 : 0) : req.body[f]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'لا توجد بيانات للتحديث.' });
  updates.push("updated_at = datetime('now')");
  params.push(req.params.productId);
  db.prepare(`UPDATE pharmacy_products SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ product: formatProduct(db.prepare('SELECT * FROM pharmacy_products WHERE id = ?').get(req.params.productId)) });
});

router.delete('/:id/products/:productId', authenticate, requireRole('pharmacy'), (req, res) => {
  const pharmacy = loadOwnedPharmacy(req, res);
  if (!pharmacy) return;
  const product = db.prepare('SELECT * FROM pharmacy_products WHERE id = ? AND pharmacy_id = ?').get(req.params.productId, pharmacy.id);
  if (!product) return res.status(404).json({ error: 'المنتج غير موجود.' });
  db.prepare('DELETE FROM pharmacy_products WHERE id = ?').run(req.params.productId);
  res.json({ ok: true });
});

router.patch('/:id', authenticate, requireRole('pharmacy'), (req, res) => {
  const pharmacy = loadOwnedPharmacy(req, res);
  if (!pharmacy) return;
  const fields = ['name', 'description', 'location', 'plus_code', 'image', 'phone'];
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
  params.push(pharmacy.id);
  db.prepare(`UPDATE pharmacies SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ pharmacy: db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(pharmacy.id) });
});

router.get('/:id/reviews', (req, res) => {
  const reviews = db
    .prepare(
      `SELECT reviews.*, users.name as customer_name FROM reviews
       JOIN users ON users.id = reviews.customer_id
       WHERE pharmacy_id = ? ORDER BY created_at DESC`
    )
    .all(req.params.id);
  res.json({ reviews });
});

module.exports = router;
