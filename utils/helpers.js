const { v4: uuidv4 } = require('uuid');
const db = require('../db');

function newId() {
  return uuidv4();
}

function logAudit(ownerId, targetUserId, action, details) {
  db.prepare(
    `INSERT INTO admin_audit_logs (id, owner_id, target_user_id, action, details, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(newId(), ownerId, targetUserId || null, action, details ? JSON.stringify(details) : null);
}

function recordStatusChange(orderId, previousStatus, newStatus, changedBy) {
  db.prepare(
    `INSERT INTO order_status_history (id, order_id, previous_status, new_status, changed_by, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(newId(), orderId, previousStatus, newStatus, changedBy);
}

// Sequential numeric suffix generator for manual-format codes, e.g. SFR-RES-000007
function nextSequentialCode(prefix) {
  const row = db
    .prepare(`SELECT code FROM users WHERE code LIKE ? ORDER BY code DESC LIMIT 1`)
    .get(`${prefix}-%`);
  let next = 1;
  if (row && row.code) {
    const parts = row.code.split('-');
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) next = num + 1;
  }
  return `${prefix}-${String(next).padStart(6, '0')}`;
}

module.exports = { newId, logAudit, recordStatusChange, nextSequentialCode };
