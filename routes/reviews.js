const express = require('express');
const db = require('../db');
const { newId } = require('../utils/helpers');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireRole('customer'), (req, res) => {
  const { order_id, rating, comment } = req.body || {};
  const ratingNum = parseInt(rating, 10);
  if (!order_id || !ratingNum || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'رقم الطلب والتقييم (1-5) مطلوبان.' });
  }
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود.' });
  if (order.customer_id !== req.user.id) {
    return res.status(403).json({ error: 'لا يمكنك تقييم طلب ليس لك.' });
  }
  if (order.status !== 'delivered') {
    return res.status(400).json({ error: 'يمكن تقييم الطلبات المكتملة فقط.' });
  }
  const existing = db.prepare('SELECT id FROM reviews WHERE order_id = ?').get(order_id);
  if (existing) return res.status(409).json({ error: 'تم تقييم هذا الطلب مسبقًا.' });

  const id = newId();
  db.prepare(
    `INSERT INTO reviews (id, customer_id, restaurant_id, pharmacy_id, order_id, rating, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(id, req.user.id, order.restaurant_id || null, order.pharmacy_id || null, order_id, ratingNum, comment || null);

  res.status(201).json({ review: db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) });
});

module.exports = router;
