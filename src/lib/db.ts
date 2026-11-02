import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Db = Database.Database;

const globalForDb = globalThis as unknown as { tideDb?: Db };

function hasColumn(db: Db, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function ensureColumn(db: Db, table: string, column: string, definition: string) {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function initialize(db: Db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      auth_wallet TEXT NOT NULL UNIQUE,
      display_name TEXT,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      live_armed INTEGER NOT NULL DEFAULT 0,
      live_armed_until INTEGER,
      kill_switch INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS nonces (
      nonce TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      purpose TEXT NOT NULL,
      user_id TEXT,
      message TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS nonces_expiry_idx ON nonces(expires_at);

    CREATE TABLE IF NOT EXISTS execution_wallets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      pubkey TEXT NOT NULL,
      encrypted_secret TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_accounts (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      initial_capital REAL NOT NULL,
      cash REAL NOT NULL,
      peak_equity REAL NOT NULL,
      day_start_equity REAL NOT NULL,
      day_key TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      risk_json TEXT NOT NULL,
      notifications_json TEXT NOT NULL,
      telegram_token_enc TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      config_json TEXT NOT NULL,
      last_run_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, name)
    );
    CREATE INDEX IF NOT EXISTS bots_user_idx ON bots(user_id);
    CREATE INDEX IF NOT EXISTS bots_status_idx ON bots(status);

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
      mode TEXT NOT NULL,
      protocol TEXT NOT NULL,
      pool_address TEXT NOT NULL,
      pool_name TEXT NOT NULL,
      strategy TEXT NOT NULL,
      status TEXT NOT NULL,
      capital_usd REAL NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      lower_bin INTEGER NOT NULL,
      upper_bin INTEGER NOT NULL,
      lower_price REAL NOT NULL,
      upper_price REAL NOT NULL,
      token_x_mint TEXT NOT NULL,
      token_y_mint TEXT NOT NULL,
      token_x_symbol TEXT NOT NULL,
      token_y_symbol TEXT NOT NULL,
      token_x_decimals INTEGER NOT NULL,
      token_y_decimals INTEGER NOT NULL,
      entry_x_amount REAL NOT NULL,
      entry_y_amount REAL NOT NULL,
      current_x_amount REAL NOT NULL,
      current_y_amount REAL NOT NULL,
      token_x_price_usd REAL NOT NULL DEFAULT 0,
      token_y_price_usd REAL NOT NULL DEFAULT 0,
      current_value_usd REAL NOT NULL DEFAULT 0,
      fee_daily_pct REAL NOT NULL DEFAULT 0,
      unclaimed_fees_usd REAL NOT NULL DEFAULT 0,
      claimed_fees_usd REAL NOT NULL DEFAULT 0,
      il_usd REAL NOT NULL DEFAULT 0,
      pnl_usd REAL NOT NULL DEFAULT 0,
      pnl_pct REAL NOT NULL DEFAULT 0,
      in_range INTEGER NOT NULL DEFAULT 1,
      out_of_range_since INTEGER,
      last_claimed_at INTEGER,
      position_address TEXT,
      nft_mint TEXT,
      opened_at INTEGER NOT NULL,
      last_accrued_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER,
      close_reason TEXT,
      close_proceeds_usd REAL,
      tx_open TEXT,
      tx_close TEXT
    );
    CREATE INDEX IF NOT EXISTS positions_user_idx ON positions(user_id);
    CREATE INDEX IF NOT EXISTS positions_bot_idx ON positions(bot_id);
    CREATE INDEX IF NOT EXISTS positions_status_idx ON positions(user_id, mode, status);
    CREATE INDEX IF NOT EXISTS positions_pool_idx ON positions(pool_address);

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bot_id TEXT,
      position_id TEXT,
      mode TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      signature TEXT,
      amount_usd REAL NOT NULL DEFAULT 0,
      fee_usd REAL NOT NULL DEFAULT 0,
      network_fee_usd REAL NOT NULL DEFAULT 0,
      pool_name TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS transactions_user_idx ON transactions(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bot_id TEXT,
      level TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS activity_user_idx ON activity_logs(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS equity_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ts INTEGER NOT NULL,
      equity REAL NOT NULL,
      cash REAL NOT NULL,
      positions_value REAL NOT NULL,
      pnl REAL NOT NULL,
      fees REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS equity_user_idx ON equity_snapshots(user_id, ts DESC);

    CREATE TABLE IF NOT EXISTS backtests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pool_name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      config_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS backtests_user_idx ON backtests(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS kv_cache (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  ensureColumn(db, "users", "kill_switch", "INTEGER NOT NULL DEFAULT 0");
  db.pragma("user_version = 2");
}

export function getDb(): Db {
  if (globalForDb.tideDb) return globalForDb.tideDb;

  const path = process.env.DATABASE_PATH || "./data/tide.db";
  if (path !== ":memory:") mkdirSync(dirname(resolve(/* turbopackIgnore: true */ path)), { recursive: true });
  const db = new Database(path);
  initialize(db);
  globalForDb.tideDb = db;
  return db;
}

export function isSqliteReady(): boolean {
  try {
    getDb().prepare("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}

export function nowMs(): number {
  return Date.now();
}
