const db = require('../db');

// Fee settings default to 0 (not an invented number, an explicit "unset"
// placeholder) until the Owner configures real values from the dashboard.
const DEFAULTS = {
  delivery_fee_restaurant: '0',
  delivery_fee_pharmacy: '0',
  delivery_fee_amanat: '0',
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  if (row) return row.value;
  return DEFAULTS[key] !== undefined ? DEFAULTS[key] : null;
}

function getSettingNumber(key) {
  const v = getSetting(key);
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, String(value));
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  const result = { ...DEFAULTS };
  for (const r of rows) result[r.key] = r.value;
  return result;
}

module.exports = { getSetting, getSettingNumber, setSetting, getAllSettings };
