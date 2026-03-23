/**
 * config/db.js
 * SQLite database initialization and schema setup.
 * Uses better-sqlite3 for synchronous API (simpler, faster for single-user).
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Resolve database path from env or default
const dbPath = process.env.DATABASE_PATH || './data/app.db';
const dataDir = path.dirname(path.resolve(dbPath));

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Open (or create) the database file
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * initializeSchema()
 * Creates all required tables and indexes if they don't exist.
 * Safe to call on every startup.
 */
function initializeSchema() {
  db.exec(`
    -- ─────────────────────────────────────────
    -- Users: platform accounts
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT    UNIQUE NOT NULL,
      password     TEXT    NOT NULL,
      email        TEXT    UNIQUE,
      role         TEXT    DEFAULT 'analyst',
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ─────────────────────────────────────────
    -- Analysis runs: one record per reconciliation job
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS analysis_runs (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL,
      analysis_name      TEXT    NOT NULL,
      ad_file_name       TEXT,
      hr_file_names      TEXT,          -- JSON array of file names
      status             TEXT    DEFAULT 'processing',
      total_ad_records   INTEGER DEFAULT 0,
      total_hr_records   INTEGER DEFAULT 0,
      duplicates_skipped INTEGER DEFAULT 0,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- ─────────────────────────────────────────
    -- AD records: parsed from AD CSV export
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ad_records (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id      INTEGER NOT NULL,
      sam_account_name TEXT,
      mail             TEXT,
      display_name     TEXT,
      department       TEXT,
      title            TEXT,
      tabel_number     TEXT,   -- normalized to 6 digits
      extensionAttr1   TEXT,   -- extensionAttribute1 (raw Tabel from AD)
      extensionAttr10  TEXT,   -- extensionAttribute10 (EMP/DRV marker)
      account_expiry   TEXT,
      last_logon       TEXT,
      distinguished_name TEXT,
      FOREIGN KEY (analysis_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
    );

    -- ─────────────────────────────────────────
    -- HR records: merged from one or many Excel files
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS hr_records (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id     INTEGER NOT NULL,
      employee_name   TEXT,
      email           TEXT,
      tabel_number    TEXT,   -- normalized to 6 digits
      department      TEXT,
      position        TEXT,
      source_file     TEXT,   -- which uploaded file this came from
      source_sheet    TEXT,   -- which sheet inside that file
      FOREIGN KEY (analysis_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
    );

    -- ─────────────────────────────────────────
    -- Reconciliation results: one row per issue/match
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS reconciliation_results (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id      INTEGER NOT NULL,
      category         TEXT    NOT NULL,   -- MATCHED | GHOST_ACCOUNT | MISSING_ACCOUNT | TABEL_MISMATCH | EMAIL_MISMATCH | MISSING_ATTR1 | DRIVER | DUPLICATE_TABEL
      severity         TEXT    DEFAULT 'INFO',
      ad_record_id     INTEGER,
      hr_record_id     INTEGER,
      match_score      REAL    DEFAULT 0,
      description      TEXT,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (analysis_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
    );

    -- ─────────────────────────────────────────
    -- Audit log: every user action
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER,
      action      TEXT,
      resource    TEXT,
      description TEXT,
      ip_address  TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Performance indexes
    CREATE INDEX IF NOT EXISTS idx_ar_user      ON analysis_runs(user_id);
    CREATE INDEX IF NOT EXISTS idx_ad_analysis  ON ad_records(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_hr_analysis  ON hr_records(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_rr_analysis  ON reconciliation_results(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_rr_category  ON reconciliation_results(category);
  `);

  console.log('[DB] Schema initialized');
}

// Run schema on module load
try {
  initializeSchema();
} catch (err) {
  console.error('[DB] Initialization failed:', err.message);
  process.exit(1);
}

module.exports = db;
