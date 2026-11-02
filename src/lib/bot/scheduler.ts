import "server-only";
import { getConfig } from "../config";
import { getDb, nowMs } from "../db";
import { getAllUserIds, getRunningBots, getUserSettings, logActivity, updateBotRun } from "../store";
import { notifyUser } from "../notifications";
import { getPaperSummary } from "../portfolio";
import { getScanUniverse } from "../market/meteora";
import { markAllOpenPaperPositions } from "../trading/paper";
import { redactSecrets } from "../security";
import { runBotOnce } from "./engine";

const MARK_INTERVAL_MS = 5 * 60_000;
const MAX_BOT_CONCURRENCY = 2;

type SchedulerState = {
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastMarkAt: number;
  lastSummaryDay: string | null;
};

const globalForScheduler = globalThis as unknown as { tideScheduler?: SchedulerState };
const state: SchedulerState = (globalForScheduler.tideScheduler ??= {
  timer: null,
  running: false,
  lastMarkAt: 0,
  lastSummaryDay: null,
});

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

async function markPaperPortfolios(now: number): Promise<void> {
  if (now - state.lastMarkAt < MARK_INTERVAL_MS) return;
  state.lastMarkAt = now;
  try {
    const universe = await getScanUniverse();
    const pools = new Map(universe.pools.map((pool) => [`${pool.protocol}:${pool.address}`, pool]));
    await markAllOpenPaperPositions(pools, now);
  } catch (error) {
    console.warn("[bot] paper marking skipped", error instanceof Error ? error.message : "unknown");
  }
}

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

async function sendDailySummaries(now: number): Promise<void> {
  const hour = new Date(now).getUTCHours();
  if (hour < 23) return;
  const dayKey = new Date(now).toISOString().slice(0, 10);
  if (state.lastSummaryDay === dayKey) return;
  state.lastSummaryDay = dayKey;
  const db = getDb();
  for (const userId of getAllUserIds()) {
    const settings = getUserSettings(userId);
    if (!settings.notifications.telegramEnabled || !settings.notifications.dailySummary) continue;
    const key = `daily-summary:${userId}:${dayKey}`;
    const sent = db.prepare("SELECT 1 FROM kv_cache WHERE key = ? AND expires_at > ?").get(key, now);
    if (sent) continue;
    try {
      const paper = getPaperSummary(userId).summary;
      const message = [
        "Tide daily summary (UTC)",
        `Paper equity: $${formatUsd(paper.equity)} (${paper.totalPnlPct >= 0 ? "+" : ""}${paper.totalPnlPct.toFixed(2)}%)`,
        `Paper PnL: $${formatUsd(paper.totalPnl)} · fees $${formatUsd(paper.feeIncome)}`,
        `Open positions: ${paper.openPositions} · win rate ${paper.winRate.toFixed(0)}%`,
        `Realised APR est: ${paper.estAprPct.toFixed(1)}% · drawdown ${paper.maxDrawdownPct.toFixed(2)}%`,
      ].join("\n");
      await notifyUser(userId, "summary", message);
      db.prepare("INSERT OR REPLACE INTO kv_cache (key, value_json, expires_at) VALUES (?, ?, ?)").run(
        key,
        JSON.stringify({ sentAt: now }),
        now + 36 * 3_600_000,
      );
    } catch (error) {
      console.warn("[bot] daily summary failed", error instanceof Error ? error.message : "unknown");
    }
  }
}

async function tick(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    const bots = getRunningBots();
    const now = nowMs();
    const due = bots.filter((bot) => {
      const interval = Math.max(20, bot.config.intervalSeconds) * 1_000;
      return !bot.lastRunAt || now - bot.lastRunAt >= interval;
    });
    await mapLimit(due, MAX_BOT_CONCURRENCY, async (bot) => {
      try {
        await runBotOnce(bot);
      } catch (error) {
        const message = redactSecrets(error instanceof Error ? error.message : "Unknown bot error").slice(0, 400);
        updateBotRun(bot.id, { lastRunAt: nowMs(), lastError: message });
        logActivity({
          userId: bot.userId,
          botId: bot.id,
          level: "error",
          category: "bot",
          message: `${bot.name} cycle failed: ${message}`,
        });
        if (bot.lastError !== message) {
          void notifyUser(bot.userId, "error", `Tide autopilot failure\n${bot.name}\n${message}`);
        }
      }
    });
    await markPaperPortfolios(now);
    await sendDailySummaries(now);
  } catch (error) {
    console.warn("[bot] scheduler tick failed", error instanceof Error ? error.message : "unknown");
  } finally {
    state.running = false;
  }
}

export function startBotScheduler(): void {
  if (state.timer) return;
  const config = getConfig();
  if (!config.botEnabled) {
    console.info("[bot] scheduler disabled by BOT_ENABLED");
    return;
  }
  const interval = Math.max(5_000, config.botTickMs);
  state.timer = setInterval(() => {
    void tick();
  }, interval);
  if (typeof state.timer.unref === "function") state.timer.unref();
  console.info(`[bot] scheduler started · tick ${interval}ms`);
  void tick();
}

export function stopBotSchedulerForTests(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.running = false;
  state.lastMarkAt = 0;
  state.lastSummaryDay = null;
}
