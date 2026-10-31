'use strict';
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const filename = path.resolve(__dirname, process.env.DATABASE_PATH || './data/traceability.sqlite');
fs.mkdirSync(path.dirname(filename), { recursive: true });
const db = new Database(filename);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = FULL');
db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY,
      qr_code TEXT NOT NULL UNIQUE CHECK(length(qr_code) BETWEEN 1 AND 200),
      box TEXT NOT NULL CHECK(length(box) BETWEEN 1 AND 100),
      pallet TEXT NOT NULL CHECK(length(pallet) BETWEEN 1 AND 100),
      operator_id TEXT NOT NULL CHECK(length(operator_id) BETWEEN 1 AND 100),
      final_status TEXT NOT NULL DEFAULT 'NOK' CHECK(final_status IN ('OK','NOK')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS checkpoint_results (
      id INTEGER PRIMARY KEY,
      part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
      checkpoint_number INTEGER NOT NULL CHECK(checkpoint_number BETWEEN 1 AND 30),
      status TEXT NOT NULL CHECK(status IN ('OK','NOK')),
      measured_value REAL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(part_id, checkpoint_number)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_parts_created ON parts(created_at, id);
    CREATE INDEX IF NOT EXISTS idx_parts_status ON parts(final_status, created_at);
    CREATE INDEX IF NOT EXISTS idx_parts_operator ON parts(operator_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_parts_box ON parts(box, created_at);
    CREATE INDEX IF NOT EXISTS idx_parts_pallet ON parts(pallet, created_at);
  `);
})();
module.exports = db;
