/**
 * Resets the paper portfolio with a full SQLite backup first.
 *
 * Usage:
 *   npm run reset:paper -- --yes
 *   npm run reset:paper -- --yes --wallet <solana-address> --balance 25000
 *   npm run reset:paper -- --yes --start Aurora
 *
 * Live positions, live transactions and the execution wallet are never touched.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

function loadEnvFile(name: string) {
  const path = resolve(process.cwd(), name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function startingBalance(): number {
  const raw = argValue("--balance") ?? process.env.PAPER_STARTING_BALANCE ?? "25000";
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error("Starting balance must be a positive number.");
    process.exit(1);
  }
  return Math.round(value * 100) / 100;
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      [
        "Usage: npm run reset:paper -- --yes [--wallet <solana-address>] [--balance <usd>] [--start <bot name>]",
        "",
        "Backs up data/tide.db, clears the paper book and restarts one strategy.",
        "Live data, the execution wallet and login sessions are preserved.",
      ].join("\n"),
    );
    return;
  }

  if (!process.argv.includes("--yes")) {
    console.error("This clears the paper book. Re-run with --yes to confirm.");
    process.exit(1);
  }

  const balance = startingBalance();
  const wallet = argValue("--wallet");
  const startName = argValue("--start") ?? "Aurora";

  const { getDb } = await import("../src/lib/db");
  const db = getDb();

  const users = (wallet
    ? db.prepare("SELECT id, auth_wallet FROM users WHERE auth_wallet = ?").all(wallet)
    : db.prepare("SELECT id, auth_wallet FROM users ORDER BY created_at ASC").all()) as Array<{
    id: string;
    auth_wallet: string;
  }>;
  if (!users.length) {
    console.error(wallet ? `No workspace found for ${wallet}.` : "No user workspace found.");
    process.exit(1);
  }
  if (users.length > 1) {
    console.error("Multiple workspaces found. Pass --wallet to choose one.");
    process.exit(1);
  }
  const user = users[0];

  const paperOpen = (
    db.prepare("SELECT COUNT(*) AS n FROM positions WHERE user_id = ? AND mode = 'paper'").get(user.id) as {
      n: number;
    }
  ).n;
  const liveOpen = (
    db.prepare("SELECT COUNT(*) AS n FROM positions WHERE user_id = ? AND mode = 'live'").get(user.id) as {
      n: number;
    }
  ).n;
  const liveTx = (
    db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND mode = 'live'").get(user.id) as {
      n: number;
    }
  ).n;

  db.pragma("wal_checkpoint(TRUNCATE)");
  const backupDir = resolve(process.cwd(), "data", "backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = resolve(backupDir, `tide-before-paper-reset-${stamp(new Date())}.db`);
  db.prepare("VACUUM INTO ?").run(backupPath);

  const now = Date.now();
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const reset = db.transaction(() => {
    db.prepare("DELETE FROM positions WHERE user_id = ? AND mode = 'paper'").run(user.id);
    db.prepare("DELETE FROM transactions WHERE user_id = ? AND mode = 'paper'").run(user.id);
    db.prepare("DELETE FROM equity_snapshots WHERE user_id = ?").run(user.id);

    if (!liveOpen && !liveTx) {
      db.prepare(
        "DELETE FROM activity_logs WHERE user_id = ? AND category IN ('entry','exit','fees','improve')",
      ).run(user.id);
    }

    db.prepare(
      `INSERT INTO equity_snapshots (id, user_id, ts, equity, cash, positions_value, pnl, fees)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0)`,
    ).run(randomUUID(), user.id, now, balance, balance);

    db.prepare(
      `INSERT INTO paper_accounts (user_id, initial_capital, cash, peak_equity, day_start_equity, day_key, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         initial_capital = excluded.initial_capital,
         cash = excluded.cash,
         peak_equity = excluded.peak_equity,
         day_start_equity = excluded.day_start_equity,
         day_key = excluded.day_key,
         updated_at = excluded.updated_at`,
    ).run(user.id, balance, balance, balance, balance, dayKey, now);

    db.prepare("DELETE FROM kv_cache WHERE key LIKE ? OR key LIKE ?").run(
      `improve:notice:${user.id}:%`,
      `daily-summary:${user.id}:%`,
    );

    const bots = db
      .prepare("SELECT id, name, mode, status, config_json FROM bots WHERE user_id = ? AND mode = 'paper'")
      .all(user.id) as Array<{
      id: string;
      name: string;
      mode: string;
      status: string;
      config_json: string;
    }>;
    const hasRunner = bots.some((bot) => bot.status === "running" && !bot.name.startsWith("Manual desk"));
    const fallback = bots.find((bot) => !bot.name.startsWith("Manual desk"));
    let started: string | null = null;
    for (const bot of bots) {
      const config = {
        ...(JSON.parse(bot.config_json) as Record<string, unknown>),
        autoImprove: true,
      };
      const isManual = bot.name.startsWith("Manual desk");
      let status = bot.status === "running" ? "running" : "paused";
      if (isManual) status = "paused";
      if (!hasRunner && !isManual && bot.name === startName) status = "running";
      if (!hasRunner && !isManual && !bots.some((item) => item.name === startName) && bot.id === fallback?.id) {
        status = "running";
      }
      if (status === "running") started = bot.name;
      db.prepare(
        "UPDATE bots SET status = ?, config_json = ?, last_run_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?",
      ).run(status, JSON.stringify(config), now, bot.id);
    }

    db.prepare(
      "INSERT INTO activity_logs (id, user_id, bot_id, level, category, message, metadata_json, created_at) VALUES (?, ?, NULL, 'info', 'account', ?, NULL, ?)",
    ).run(
      randomUUID(),
      user.id,
      `Paper portfolio reset · $${balance.toLocaleString("en-US")} starting balance${started ? ` · ${started} running` : ""}`,
      now,
    );
  });
  reset();

  const remaining = db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM positions WHERE user_id = ? AND mode = 'paper') AS positions, (SELECT COUNT(*) FROM transactions WHERE user_id = ? AND mode = 'paper') AS transactions",
    )
    .get(user.id, user.id) as { positions: number; transactions: number };

  console.log("");
  console.log("  Paper portfolio reset");
  console.log("  ─────────────────────────────────────────────");
  console.log(`  wallet       ${user.auth_wallet}`);
  console.log(`  balance      $${balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  console.log(`  cleared      ${paperOpen} paper position${paperOpen === 1 ? "" : "s"}`);
  console.log(`  live         ${liveOpen} position${liveOpen === 1 ? "" : "s"} · ${liveTx} transaction${liveTx === 1 ? "" : "s"} untouched`);
  console.log(`  remaining    ${remaining.positions} paper positions · ${remaining.transactions} paper transactions`);
  console.log(`  backup       ${backupPath}`);
  console.log("");

  db.close();
}

main().catch((error) => {
  console.error("");
  console.error("Reset failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
