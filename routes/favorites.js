const express = require('express');
const db = require('../db');
const { newId } = require('../utils/helpers');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, requireRole('customer'), (req, res) => {
  const restaurants = db
    .prepare(
      `SELECT r.* FROM favorites f JOIN restaurants r ON r.id = f.restaurant_id
       WHERE f.customer_id = ? AND f.restaurant_id IS NOT NULL`
    )
    .all(req.user.id);
  const pharmacies = db
    .prepare(
      `SELECT p.* FROM favorites f JOIN pharmacies p ON p.id = f.pharmacy_id
       WHERE f.customer_id = ? AND f.pharmacy_id IS NOT NULL`
    )
    .all(req.user.id);
  res.json({ restaurants, pharmacies });
});

router.post('/restaurant/:id', authenticate, requireRole('customer'), (req, res) => {
  const restaurant = db.prepare('SELECT id FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود.' });
  const existing = db.prepare('SELECT id FROM favorites WHERE customer_id = ? AND restaurant_id = ?').get(req.user.id, req.params.id);
  if (existing) return res.json({ ok: true });
  db.prepare(`INSERT INTO favorites (id, customer_id, restaurant_id, created_at) VALUES (?, ?, ?, datetime('now'))`)
    .run(newId(), req.user.id, req.params.id);
  res.status(201).json({ ok: true });
});

router.delete('/restaurant/:id', authenticate, requireRole('customer'), (req, res) => {
  db.prepare('DELETE FROM favorites WHERE customer_id = ? AND restaurant_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

router.post('/pharmacy/:id', authenticate, requireRole('customer'), (req, res) => {
  const pharmacy = db.prepare('SELECT id FROM pharmacies WHERE id = ?').get(req.params.id);
  if (!pharmacy) return res.status(404).json({ error: 'الصيدلية غير موجودة.' });
  const existing = db.prepare('SELECT id FROM favorites WHERE customer_id = ? AND pharmacy_id = ?').get(req.user.id, req.params.id);
  if (existing) return res.json({ ok: true });
  db.prepare(`INSERT INTO favorites (id, customer_id, pharmacy_id, created_at) VALUES (?, ?, ?, datetime('now'))`)
    .run(newId(), req.user.id, req.params.id);
  res.status(201).json({ ok: true });
});

router.delete('/pharmacy/:id', authenticate, requireRole('customer'), (req, res) => {
  db.prepare('DELETE FROM favorites WHERE customer_id = ? AND pharmacy_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
