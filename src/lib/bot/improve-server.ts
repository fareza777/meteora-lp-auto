import "server-only";
import { getDb, nowMs } from "../db";
import { notifyUser } from "../notifications";
import { getPaperSummary } from "../portfolio";
import { getBots, getPaperAccount, getPositions, getUserSettings, logActivity } from "../store";
import type { BotRecord, ImprovementState, TradingMode } from "../types";
import { computeImprovement, improveHeatLabel } from "./improve";

export function loadImprovementState(
  userId: string,
  mode: TradingMode,
  now = nowMs(),
): ImprovementState {
  const settings = getUserSettings(userId);
  const closed = getPositions(userId, { mode, status: "closed", limit: 500 });
  const bots = getBots(userId).filter((bot) => bot.mode === mode);
  const autoImproveEnabled = bots.some(
    (bot) => bot.status === "running" && bot.config.autoImprove,
  );

  if (mode === "paper") {
    const account = getPaperAccount(userId);
    const paper = getPaperSummary(userId).summary;
    return computeImprovement({
      mode,
      closed,
      risk: settings.risk,
      equity: paper.equity,
      initialCapital: account.initialCapital,
      peakEquity: Math.max(account.peakEquity, paper.equity),
      dayPnlPct: paper.dayPnlPct,
      now,
      autoImproveEnabled,
    });
  }

  const open = getPositions(userId, { mode, status: "open", limit: 200 });
  const all = [...closed, ...open];
  const initialCapital = Math.max(1, all.reduce((sum, position) => sum + position.capitalUsd, 0));
  const openPnl = open.reduce(
    (sum, position) =>
      sum +
      position.currentValueUsd +
      position.unclaimedFeesUsd +
      position.claimedFeesUsd -
      position.capitalUsd,
    0,
  );
  const chronological = [...closed].sort(
    (a, b) => (a.closedAt ?? a.updatedAt) - (b.closedAt ?? b.updatedAt),
  );
  let running = initialCapital;
  let peak = initialCapital;
  for (const position of chronological) {
    running += position.pnlUsd;
    peak = Math.max(peak, running);
  }
  const equity = running + openPnl;
  peak = Math.max(peak, equity);

  return computeImprovement({
    mode,
    closed,
    risk: settings.risk,
    equity,
    initialCapital,
    peakEquity: peak,
    dayPnlPct: 0,
    now,
    autoImproveEnabled,
  });
}

export function announceImprovement(bot: BotRecord, state: ImprovementState): void {
  if (!bot.config.autoImprove) return;
  const now = nowMs();
  const key = `improve:notice:${bot.userId}:${bot.id}`;
  const signature = JSON.stringify({
    heat: state.heat,
    pause: state.pauseReason,
    scale: Number(state.capitalScale.toFixed(3)),
    floor: state.entryScoreFloorDelta,
    rotation: state.rotationDeltaBonus,
    rebalance: state.rebalanceMinutesBonus,
    blocked: state.blockedPools.map((pool) => `${pool.poolAddress}:${pool.blockedUntil}`),
    strategies: state.strategies
      .filter((strategy) => strategy.adjustment !== 0)
      .map((strategy) => `${strategy.strategy}:${strategy.adjustment}`),
    trades: state.sampleTrades,
  });
  const row = getDb()
    .prepare("SELECT value_json FROM kv_cache WHERE key = ? AND expires_at > ?")
    .get(key, now) as { value_json: string } | undefined;
  if (row?.value_json === signature) return;

  getDb()
    .prepare("INSERT OR REPLACE INTO kv_cache (key, value_json, expires_at) VALUES (?, ?, ?)")
    .run(key, signature, now + 30 * 86_400_000);

  if (state.pauseEntries) {
    logActivity({
      userId: bot.userId,
      botId: bot.id,
      level: "warning",
      category: "improve",
      message: `Auto-improve paused new entries · ${state.pauseReason}`,
      metadata: { heat: state.heat, capitalScale: state.capitalScale },
    });
    void notifyUser(
      bot.userId,
      "risk",
      `Tide auto-improve paused new entries\n${state.pauseReason}\nCapital scale: ${Math.round(
        state.capitalScale * 100,
      )}% · score floor ${state.entryScoreFloorDelta >= 0 ? "+" : ""}${state.entryScoreFloorDelta}`,
    );
    return;
  }

  const previous = row ? (JSON.parse(row.value_json) as { heat?: string } | null) : null;
  const heatChanged = previous?.heat !== state.heat;
  logActivity({
    userId: bot.userId,
    botId: bot.id,
    level: state.heat === "cold" ? "warning" : "info",
    category: "improve",
    message: `Auto-improve ${previous ? "adjusted" : "armed"} · ${improveHeatLabel(
      state.heat,
    )} · ${state.actions.slice(0, 3).join(" · ")}`,
    metadata: {
      heat: state.heat,
      trades: state.sampleTrades,
      netPnl: state.netPnl,
      capitalScale: state.capitalScale,
      entryScoreFloorDelta: state.entryScoreFloorDelta,
      blockedPools: state.blockedPools.map((pool) => pool.poolName),
    },
  });
  if (state.heat === "cold" || heatChanged) {
    void notifyUser(
      bot.userId,
      "summary",
      `Tide auto-improve · ${improveHeatLabel(state.heat)}\n${state.actions
        .slice(0, 3)
        .join("\n")}`,
    );
  }
}
