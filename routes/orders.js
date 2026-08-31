const express = require('express');
const db = require('../db');
const { newId, recordStatusChange } = require('../utils/helpers');
const { getSettingNumber } = require('../utils/settings');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------
// SECURITY NOTE (spec sections 15, 24, 60, 77): every price, subtotal,
// delivery fee, and total below is computed from the database on the
// server. The client only ever sends IDs and quantities. Any price/total
// field sent by the client is ignored entirely — it is never read.
// ---------------------------------------------------------------------

function applyOutstandingFees(customerId) {
  const unpaid = db
    .prepare('SELECT * FROM customer_outstanding_fees WHERE customer_id = ? AND is_paid = 0')
    .all(customerId);
  const total = unpaid.reduce((sum, f) => sum + f.amount, 0);
  return { unpaid, total };
}

function markOutstandingPaid(unpaid, orderId) {
  const stmt = db.prepare(
    `UPDATE customer_outstanding_fees SET is_paid = 1, paid_on_order_id = ?, updated_at = datetime('now') WHERE id = ?`
  );
  for (const f of unpaid) stmt.run(orderId, f.id);
}

function serializeOrder(order) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const history = db
    .prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC')
    .all(order.id);
  let amanat = null;
  if (order.order_type === 'amanat') {
    amanat = db.prepare('SELECT * FROM amanat_orders WHERE order_id = ?').get(order.id);
  }
  let driver = null;
  if (order.driver_id) {
    const d = db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(order.driver_id);
    driver = d || null;
  }
  return { ...order, items, status_history: history, amanat, driver };
}

// GET /api/orders/pending-fees — what a customer currently owes (spec 47-48)
router.get('/pending-fees', authenticate, requireRole('customer'), (req, res) => {
  const { unpaid, total } = applyOutstandingFees(req.user.id);
  res.json({ fees: unpaid, total });
});

// ---------------- CREATE: restaurant order ----------------
router.post('/restaurant', authenticate, requireRole('customer'), (req, res) => {
  const { restaurant_id, items } = req.body || {};
  if (!restaurant_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'بيانات الطلب غير مكتملة.' });
  }
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ? AND is_active = 1').get(restaurant_id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود.' });

  const resolvedItems = [];
  for (const reqItem of items) {
    const qty = parseInt(reqItem.quantity, 10);
    if (!reqItem.menu_item_id || !qty || qty < 1) {
      return res.status(400).json({ error: 'عنصر غير صالح في الطلب.' });
    }
    const menuItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(reqItem.menu_item_id);
    if (!menuItem || menuItem.restaurant_id !== restaurant_id) {
      return res.status(400).json({ error: 'أحد الأصناف غير موجود في هذا المطعم.' });
    }
    if (!menuItem.available) {
      return res.status(400).json({ error: `الصنف "${menuItem.name}" غير متوفر حاليًا.` });
    }
    if (menuItem.price === null) {
      return res.status(400).json({ error: `الصنف "${menuItem.name}" السعر غير محدد ولا يمكن شراؤه.` });
    }
    resolvedItems.push({ menuItem, qty });
  }

  const subtotal = resolvedItems.reduce((sum, r) => sum + r.menuItem.price * r.qty, 0);
  const deliveryFee = getSettingNumber('delivery_fee_restaurant');
  const { unpaid, total: outstandingTotal } = applyOutstandingFees(req.user.id);
  const total = subtotal + deliveryFee + outstandingTotal;

  const orderId = newId();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (id, customer_id, restaurant_id, order_type, status, subtotal, delivery_fee, outstanding_fee_applied, total, created_at, updated_at)
       VALUES (?, ?, ?, 'restaurant', 'pending', ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).run(orderId, req.user.id, restaurant_id, subtotal, deliveryFee, outstandingTotal, total);

    for (const r of resolvedItems) {
      db.prepare(
        `INSERT INTO order_items (id, order_id, menu_item_id, item_name, quantity, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(newId(), orderId, r.menuItem.id, r.menuItem.name, r.qty, r.menuItem.price, r.menuItem.price * r.qty);
    }
    recordStatusChange(orderId, null, 'pending', req.user.id);
    if (unpaid.length) markOutstandingPaid(unpaid, orderId);
  });
  tx();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  res.status(201).json({ order: serializeOrder(order) });
});

// ---------------- CREATE: pharmacy order ----------------
router.post('/pharmacy', authenticate, requireRole('customer'), (req, res) => {
  const { pharmacy_id, items, prescription_file_path } = req.body || {};
  if (!pharmacy_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'بيانات الطلب غير مكتملة.' });
  }
  const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE id = ? AND is_active = 1').get(pharmacy_id);
  if (!pharmacy) return res.status(404).json({ error: 'الصيدلية غير موجودة.' });

  const resolvedItems = [];
  let requiresPrescription = false;
  for (const reqItem of items) {
    const qty = parseInt(reqItem.quantity, 10);
    if (!reqItem.pharmacy_product_id || !qty || qty < 1) {
      return res.status(400).json({ error: 'عنصر غير صالح في الطلب.' });
    }
    const product = db.prepare('SELECT * FROM pharmacy_products WHERE id = ?').get(reqItem.pharmacy_product_id);
    if (!product || product.pharmacy_id !== pharmacy_id) {
      return res.status(400).json({ error: 'أحد المنتجات غير موجود في هذه الصيدلية.' });
    }
    if (!product.available) {
      return res.status(400).json({ error: `المنتج "${product.name}" غير متوفر حاليًا.` });
    }
    if (product.price === null) {
      return res.status(400).json({ error: `المنتج "${product.name}" السعر غير محدد ولا يمكن شراؤه.` });
    }
    if (product.requires_prescription) requiresPrescription = true;
    resolvedItems.push({ product, qty });
  }

  if (requiresPrescription && !prescription_file_path) {
    return res.status(400).json({ error: 'هذا الطلب يحتوي على أدوية تتطلب وصفة طبية. الرجاء رفع الوصفة أولًا.' });
  }

  const subtotal = resolvedItems.reduce((sum, r) => sum + r.product.price * r.qty, 0);
  const deliveryFee = getSettingNumber('delivery_fee_pharmacy');
  const { unpaid, total: outstandingTotal } = applyOutstandingFees(req.user.id);
  const total = subtotal + deliveryFee + outstandingTotal;

  const orderId = newId();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (id, customer_id, pharmacy_id, order_type, status, subtotal, delivery_fee, outstanding_fee_applied, total,
                            requires_prescription_review, prescription_status, created_at, updated_at)
       VALUES (?, ?, ?, 'pharmacy', 'pending', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).run(
      orderId, req.user.id, pharmacy_id, subtotal, deliveryFee, outstandingTotal, total,
      requiresPrescription ? 1 : 0, requiresPrescription ? 'pending' : null
    );
    for (const r of resolvedItems) {
      db.prepare(
        `INSERT INTO order_items (id, order_id, pharmacy_product_id, item_name, quantity, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(newId(), orderId, r.product.id, r.product.name, r.qty, r.product.price, r.product.price * r.qty);
    }
    if (requiresPrescription) {
      db.prepare(
        `INSERT INTO prescriptions (id, order_id, file_path, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', datetime('now'), datetime('now'))`
      ).run(newId(), orderId, prescription_file_path);
    }
    recordStatusChange(orderId, null, 'pending', req.user.id);
    if (unpaid.length) markOutstandingPaid(unpaid, orderId);
  });
  tx();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  res.status(201).json({ order: serializeOrder(order) });
});

// ---------------- CREATE: amanat order ----------------
router.post('/amanat', authenticate, requireRole('customer'), (req, res) => {
  const {
    item_name, item_image, estimated_value, pickup_location, pickup_person_name,
    pickup_phone, delivery_location, recipient_name, recipient_phone, notes,
  } = req.body || {};

  if (!item_name || !pickup_location || !pickup_person_name || !pickup_phone ||
      !delivery_location || !recipient_name || !recipient_phone) {
    return res.status(400).json({ error: 'جميع بيانات الاستلام والتسليم مطلوبة.' });
  }
  if (estimated_value !== undefined && estimated_value !== null &&
      (typeof estimated_value !== 'number' || estimated_value < 0)) {
    return res.status(400).json({ error: 'القيمة التقريبية غير صالحة.' });
  }

  const deliveryFee = getSettingNumber('delivery_fee_amanat');
  const { unpaid, total: outstandingTotal } = applyOutstandingFees(req.user.id);
  const total = deliveryFee + outstandingTotal;

  const orderId = newId();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (id, customer_id, order_type, status, subtotal, delivery_fee, outstanding_fee_applied, total, created_at, updated_at)
       VALUES (?, ?, 'amanat', 'pending', 0, ?, ?, ?, datetime('now'), datetime('now'))`
    ).run(orderId, req.user.id, deliveryFee, outstandingTotal, total);

    db.prepare(
      `INSERT INTO amanat_orders
        (id, order_id, item_name, item_image, estimated_value, pickup_location, pickup_person_name,
         pickup_phone, delivery_location, recipient_name, recipient_phone, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).run(
      newId(), orderId, item_name, item_image || null, estimated_value ?? null, pickup_location,
      pickup_person_name, pickup_phone, delivery_location, recipient_name, recipient_phone, notes || null
    );
    recordStatusChange(orderId, null, 'pending', req.user.id);
    if (unpaid.length) markOutstandingPaid(unpaid, orderId);
  });
  tx();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  res.status(201).json({ order: serializeOrder(order) });
});

// ---------------- READ ----------------
router.get('/mine', authenticate, requireRole('customer'), (req, res) => {
  const orders = db
    .prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC')
    .all(req.user.id)
    .map(serializeOrder);
  res.json({ orders });
});

// Restaurant/pharmacy incoming orders for their own business only.
router.get('/incoming', authenticate, requireRole('restaurant', 'pharmacy'), (req, res) => {
  let orders;
  if (req.user.role === 'restaurant') {
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?').get(req.user.id);
    if (!restaurant) return res.json({ orders: [] });
    orders = db.prepare('SELECT * FROM orders WHERE restaurant_id = ? ORDER BY created_at DESC').all(restaurant.id);
  } else {
    const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE owner_user_id = ?').get(req.user.id);
    if (!pharmacy) return res.json({ orders: [] });
    orders = db.prepare('SELECT * FROM orders WHERE pharmacy_id = ? ORDER BY created_at DESC').all(pharmacy.id);
  }
  res.json({ orders: orders.map(serializeOrder) });
});

// Driver: orders ready for pickup with no driver assigned yet, plus their own assigned orders.
router.get('/available', authenticate, requireRole('driver'), (req, res) => {
  const restaurantPharmacyReady = db
    .prepare(
      `SELECT * FROM orders WHERE driver_id IS NULL AND status = 'ready'
       AND order_type IN ('restaurant','pharmacy') ORDER BY created_at ASC`
    )
    .all();
  const amanatPending = db
    .prepare(`SELECT * FROM orders WHERE driver_id IS NULL AND status = 'pending' AND order_type = 'amanat' ORDER BY created_at ASC`)
    .all();
  res.json({ orders: [...restaurantPharmacyReady, ...amanatPending].map(serializeOrder) });
});

router.get('/assigned', authenticate, requireRole('driver'), (req, res) => {
  const orders = db
    .prepare(`SELECT * FROM orders WHERE driver_id = ? AND status NOT IN ('delivered','cancelled') ORDER BY created_at ASC`)
    .all(req.user.id);
  res.json({ orders: orders.map(serializeOrder) });
});

router.get('/history', authenticate, requireRole('driver'), (req, res) => {
  const orders = db
    .prepare(`SELECT * FROM orders WHERE driver_id = ? AND status IN ('delivered','cancelled') ORDER BY updated_at DESC`)
    .all(req.user.id);
  res.json({ orders: orders.map(serializeOrder) });
});

function canViewOrder(order, user) {
  if (user.role === 'owner') return true;
  if (user.role === 'customer') return order.customer_id === user.id;
  if (user.role === 'driver') return order.driver_id === user.id || (!order.driver_id);
  if (user.role === 'restaurant') {
    const restaurant = db.prepare('SELECT id FROM restaurants WHERE owner_user_id = ?').get(user.id);
    return restaurant && order.restaurant_id === restaurant.id;
  }
  if (user.role === 'pharmacy') {
    const pharmacy = db.prepare('SELECT id FROM pharmacies WHERE owner_user_id = ?').get(user.id);
    return pharmacy && order.pharmacy_id === pharmacy.id;
  }
  return false;
}

router.get('/:id', authenticate, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود.' });
  if (!canViewOrder(order, req.user)) return res.status(403).json({ error: 'لا تملك صلاحية عرض هذا الطلب.' });
  res.json({ order: serializeOrder(order) });
});

// ---------------- STATUS TRANSITIONS ----------------
const TRANSITIONS = {
  restaurant: {
    pending: { accepted: 'restaurant', cancelled: ['customer', 'restaurant', 'owner'] },
    accepted: { preparing: 'restaurant', cancelled: ['restaurant', 'owner'] },
    preparing: { ready: 'restaurant' },
    ready: { picked_up: 'driver' },
    picked_up: { delivering: 'driver' },
    delivering: { delivered: 'driver' },
  },
  pharmacy: {
    pending: { accepted: 'pharmacy', cancelled: ['customer', 'pharmacy', 'owner'] },
    accepted: { preparing: 'pharmacy', cancelled: ['pharmacy', 'owner'] },
    preparing: { ready: 'pharmacy' },
    ready: { picked_up: 'driver' },
    picked_up: { delivering: 'driver' },
    delivering: { delivered: 'driver' },
  },
  amanat: {
    pending: { accepted: 'driver', cancelled: ['customer', 'owner'] },
    accepted: { picked_up: 'driver', cancelled: ['owner'] },
    picked_up: { delivering: 'driver' },
    delivering: { delivered: 'driver' },
  },
};

router.patch('/:id/status', authenticate, (req, res) => {
  const { status: newStatus } = req.body || {};
  if (!newStatus) return res.status(400).json({ error: 'الحالة الجديدة مطلوبة.' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود.' });

  const map = TRANSITIONS[order.order_type];
  const allowedFromCurrent = map[order.status];
  if (!allowedFromCurrent || !(newStatus in allowedFromCurrent)) {
    return res.status(400).json({ error: `لا يمكن تغيير الحالة من "${order.status}" إلى "${newStatus}".` });
  }
  const allowedRoles = allowedFromCurrent[newStatus];
  const allowedRolesArr = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  if (!allowedRolesArr.includes(req.user.role)) {
    return res.status(403).json({ error: 'لا تملك صلاحية تنفيذ هذا التغيير.' });
  }

  // Role-specific ownership checks
  if (req.user.role === 'restaurant') {
    const restaurant = db.prepare('SELECT id FROM restaurants WHERE owner_user_id = ?').get(req.user.id);
    if (!restaurant || order.restaurant_id !== restaurant.id) {
      return res.status(403).json({ error: 'لا تملك صلاحية على هذا الطلب.' });
    }
  }
  if (req.user.role === 'pharmacy') {
    const pharmacy = db.prepare('SELECT id FROM pharmacies WHERE owner_user_id = ?').get(req.user.id);
    if (!pharmacy || order.pharmacy_id !== pharmacy.id) {
      return res.status(403).json({ error: 'لا تملك صلاحية على هذا الطلب.' });
    }
    if (order.requires_prescription_review && order.prescription_status !== 'approved' &&
        ['accepted', 'preparing', 'ready'].includes(newStatus)) {
      return res.status(400).json({ error: 'يجب مراجعة الوصفة الطبية والموافقة عليها قبل المتابعة.' });
    }
  }
  if (req.user.role === 'customer' && order.customer_id !== req.user.id) {
    return res.status(403).json({ error: 'لا تملك صلاحية على هذا الطلب.' });
  }
  if (req.user.role === 'driver') {
    if (order.driver_id && order.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'هذا الطلب مسند لسائق آخر.' });
    }
  }

  const previousStatus = order.status;
  const tx = db.transaction(() => {
    // Driver claims the order at the moment of the first driver-performed transition.
    if (req.user.role === 'driver' && !order.driver_id) {
      db.prepare('UPDATE orders SET driver_id = ? WHERE id = ?').run(req.user.id, order.id);
    }

    // Cancellation fee logic (spec 46-48): once a business has already accepted
    // and started work, cancelling adds the already-committed delivery fee to
    // the customer's outstanding balance rather than inventing a new number.
    if (newStatus === 'cancelled' && previousStatus !== 'pending' && req.user.role !== 'owner') {
      const fee = order.delivery_fee;
      db.prepare('UPDATE orders SET cancellation_fee = ? WHERE id = ?').run(fee, order.id);
      if (fee > 0) {
        db.prepare(
          `INSERT INTO customer_outstanding_fees (id, customer_id, order_id, amount, reason, is_paid, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`
        ).run(newId(), order.customer_id, order.id, fee, 'رسوم إلغاء بعد بدء التنفيذ');
      }
    }

    db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(newStatus, order.id);
    recordStatusChange(order.id, previousStatus, newStatus, req.user.id);
  });
  tx();

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  res.json({ order: serializeOrder(updated) });
});

// ---------------- PRESCRIPTION REVIEW (pharmacy role) ----------------
router.patch('/:id/prescription', authenticate, requireRole('pharmacy'), (req, res) => {
  const { decision, notes } = req.body || {}; // decision: 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'القرار غير صالح.' });
  }
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || order.order_type !== 'pharmacy') return res.status(404).json({ error: 'الطلب غير موجود.' });
  const pharmacy = db.prepare('SELECT id FROM pharmacies WHERE owner_user_id = ?').get(req.user.id);
  if (!pharmacy || order.pharmacy_id !== pharmacy.id) {
    return res.status(403).json({ error: 'لا تملك صلاحية على هذا الطلب.' });
  }
  const prescription = db.prepare('SELECT * FROM prescriptions WHERE order_id = ?').get(order.id);
  if (!prescription) return res.status(404).json({ error: 'لا توجد وصفة مرفقة بهذا الطلب.' });

  db.prepare(`UPDATE prescriptions SET status = ?, reviewed_by = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(decision, req.user.id, notes || null, prescription.id);
  db.prepare(`UPDATE orders SET prescription_status = ?, updated_at = datetime('now') WHERE id = ?`).run(decision, order.id);

  res.json({ order: serializeOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)) });
});

module.exports = router;
