import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { getPaperSummary } from "@/lib/portfolio";
import { insertPosition } from "@/lib/store";
import { makePosition } from "./helpers/fixtures";

const userId = "user-pnl-reconcile";

function seed() {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    "INSERT INTO users (id, auth_wallet, display_name, created_at, last_seen_at) VALUES (?, ?, NULL, ?, ?)",
  ).run(userId, "PnlReconcileWallet1111111111111111111111111", now, now);
  db.prepare(
    `INSERT INTO paper_accounts
      (user_id, initial_capital, cash, peak_equity, day_start_equity, day_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, 25_000, 22_990, 25_000, 25_000, new Date(now).toISOString().slice(0, 10), now);
  db.prepare(
    `INSERT INTO bots (id, user_id, name, status, mode, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("bot-pnl", userId, "P&L audit bot", "paused", "paper", "{}", now, now);
  insertPosition(
    makePosition({
      id: "position-open",
      userId,
      botId: "bot-pnl",
      capitalUsd: 2_000,
      currentValueUsd: 2_020,
      unclaimedFeesUsd: 5,
      pnlUsd: 25,
      pnlPct: 1.25,
    }),
  );
  insertPosition(
    makePosition({
      id: "position-closed",
      userId,
      botId: "bot-pnl",
      status: "closed",
      capitalUsd: 2_000,
      currentValueUsd: 0,
      unclaimedFeesUsd: 0,
      pnlUsd: -10,
      pnlPct: -0.5,
      closedAt: now,
      closeReason: "manual",
      closeProceedsUsd: 1_990,
    }),
  );
}

describe("paper summary P&L", () => {
  it("reconciles the open book with realised results and net P&L", () => {
    seed();
    const { summary } = getPaperSummary(userId);
    expect(summary.unrealizedPnl).toBeCloseTo(25);
    expect(summary.realizedPnl).toBeCloseTo(-10);
    expect(summary.totalPnl).toBeCloseTo(15);
    expect(summary.realizedPnl + summary.unrealizedPnl).toBeCloseTo(summary.totalPnl);
  });
});
