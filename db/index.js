const path = require('path');
const fs = require('fs');
require('dotenv').config();

// NOTE ON PRODUCTION DATABASE:
// This module wires up SQLite for local development, matching the spec's
// "Development: SQLite / Production: PostgreSQL" requirement. To run on
// PostgreSQL in production, swap this file for a `pg` Pool-based adapter
// that exposes the same .prepare/.exec-like surface used across routes,
// or introduce a query-builder (Knex/Prisma) — the schema.sql in this folder
// is written in portable SQL so the migration is mechanical, not a rewrite.

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbFile = process.env.DATABASE_FILE
  ? path.join(__dirname, '..', process.env.DATABASE_FILE)
  : path.join(dataDir, 'fastdrop.sqlite');

const Database = require('better-sqlite3');
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

module.exports = db;
