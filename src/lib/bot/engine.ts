import "server-only";
import { analyzePool } from "../analytics/strategy";
import { getUserById } from "../auth";
import { withLock } from "../concurrency";
import { nowMs } from "../db";
import { getPoolDetail } from "../market/meteora";
import { discoverOpportunities, type Opportunity } from "../market/scanner";
import { notifyUser } from "../notifications";
import { getPaperSummary } from "../portfolio";
import { redactSecrets } from "../security";
import {
  getPosition,
  getPositions,
  getUserSettings,
  logActivity,
  pauseAllBots,
  updateBotRun,
} from "../store";
import { closeAllLivePositions, closeLivePosition, claimLiveFees, getLiveReadiness, openLiveDlmmPosition, syncLivePositions } from "../trading/live";
import {
  applyPaperMark,
  claimPaperFees,
  closePaperPosition,
  openPaperPosition,
  PaperError,
  recommendedPaperAction,
  syncPaperAccountSnapshot,
} from "../trading/paper";
import type {
  BotRecord,
  ImprovementState,
  LiveReadiness,
  PoolAnalysis,
  PoolSnapshot,
  PositionRecord,
  TradingMode,
} from "../types";
import {
  applyGuardToBot,
  candidateCapitalUsd,
  candidateGuardScore,
  strategyHintFor,
} from "./improve";
import { announceImprovement, loadImprovementState } from "./improve-server";
import { evaluateRisk, tightStops, type RiskState } from "./risk";

const PAPER_CLAIM_MIN_USD = 1;
const LIVE_CLAIM_MIN_USD = 5;
const PAPER_ENTRIES_PER_TICK = 2;
const LIVE_ENTRIES_PER_TICK = 1;
const LIVE_MARK_STALE_MS = 12 * 60_000;

export interface BotRunResult {
  botId: string;
  opened: number;
  closed: number;
  claims: number;
  rotated: number;
  skipped: string | null;
  error: string | null;
  actions: string[];
}

function poolKey(protocol: string, address: string): string {
  return `${protocol}:${address}`;
}

function describeError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : "Unknown error").slice(0, 400);
}

async function loadPools(positions: PositionRecord[]): Promise<Map<string, PoolSnapshot>> {
  const pools = new Map<string, PoolSnapshot>();
  const seen = new Set<string>();
  await Promise.all(
    positions.map(async (position) => {
      const key = poolKey(position.protocol, position.poolAddress);
      if (seen.has(key)) return;
      seen.add(key);
      try {
        pools.set(key, await getPoolDetail(position.protocol, position.poolAddress));
      } catch {
        // A stale mark is preferable to halting the whole cycle on one pool.
      }
    }),
  );
  return pools;
}

async function markPaperBook(
  userId: string,
  positions: PositionRecord[],
  pools: Map<string, PoolSnapshot>,
  now: number,
): Promise<void> {
  if (!positions.length) return;
  await withLock(`portfolio:${userId}`, async () => {
    for (const position of positions) {
      const pool = pools.get(poolKey(position.protocol, position.poolAddress));
      if (pool) applyPaperMark(position, pool, now);
    }
    syncPaperAccountSnapshot(userId);
  });
}

function recordError(bot: BotRecord, error: unknown, result: BotRunResult): void {
  const message = describeError(error);
  result.error = message;
  if (bot.lastError === message) return;
  logActivity({
    userId: bot.userId,
    botId: bot.id,
    level: "error",
    category: "bot",
    message: `${bot.name}: ${message}`,
  });
  void notifyUser(bot.userId, "error", `Tide autopilot error\n${bot.name}\n${message}`);
}

async function enforceHalt(
  bot: BotRecord,
  risk: RiskState,
  pools: Map<string, PoolSnapshot>,
): Promise<{ closed: number; errors: string[] }> {
  const reason = risk.reasons[0] ?? "Risk limit reached";
  const errors: string[] = [];
  let closed = 0;

  if (bot.mode === "paper") {
    const open = getPositions(bot.userId, { mode: "paper", status: "open" });
    for (const position of open) {
      try {
        await closePaperPosition({
          userId: bot.userId,
          positionId: position.id,
          reason: `Risk halt: ${reason}`,
          pool: pools.get(poolKey(position.protocol, position.poolAddress)),
          actor: "risk",
        });
        closed += 1;
      } catch (error) {
        errors.push(describeError(error));
      }
    }
  } else {
    const result = await closeAllLivePositions({
      userId: bot.userId,
      reason: `Risk halt: ${reason}`,
      actor: "risk",
    }).catch((error) => ({ closed: 0, errors: [describeError(error)] }));
    closed = result.closed;
    errors.push(...result.errors);
  }

  const paused = pauseAllBots(bot.userId);
  logActivity({
    userId: bot.userId,
    botId: bot.id,
    level: "error",
    category: "risk",
    message: `Risk halt: ${reason}. Closed ${closed} position(s), paused ${paused} bot(s).`,
    metadata: { errors },
  });
  void notifyUser(
    bot.userId,
    "risk",
    `Tide RISK HALT\n${reason}\nClosed ${closed} position(s); all bots paused.\n${errors.slice(0, 3).join("\n")}`,
  );
  return { closed, errors };
}

function eligibleCandidates(opportunities: Opportunity[], mode: TradingMode, exclude: Set<string>): Opportunity[] {
  return opportunities.filter((candidate) => {
    if (!candidate.eligible) return false;
    if (mode === "live" && candidate.analysis.pool.protocol !== "dlmm") return false;
    return !exclude.has(candidate.analysis.pool.address);
  });
}

function recentlyClosedPools(userId: string, mode: TradingMode, cooldownMs: number): Set<string> {
  const closed = getPositions(userId, { mode, status: "closed", limit: 100 });
  const cutoff = nowMs() - cooldownMs;
  return new Set(
    closed.filter((position) => (position.closedAt ?? 0) >= cutoff).map((position) => position.poolAddress),
  );
}

function compoundedBot(bot: BotRecord, userId: string): BotRecord {
  if (!bot.config.compound) return bot;
  const summary = getPaperSummary(userId).summary;
  const growth = Math.min(1.75, Math.max(1, summary.equity / Math.max(1, summary.initialCapital)));
  return {
    ...bot,
    config: {
      ...bot.config,
      capitalPerPositionUsd: Math.round(bot.config.capitalPerPositionUsd * growth),
    },
  };
}

async function enterPaper(
  bot: BotRecord,
  result: BotRunResult,
  candidates: Opportunity[],
  slots: number,
  guard: ImprovementState,
): Promise<void> {
  const entryBot = compoundedBot(bot, bot.userId);
  let attempts = 0;
  for (const candidate of candidates) {
    if (attempts >= Math.min(slots, PAPER_ENTRIES_PER_TICK)) break;
    attempts += 1;
    try {
      const sizedBot: BotRecord = {
        ...entryBot,
        config: {
          ...entryBot.config,
          capitalPerPositionUsd: candidateCapitalUsd(entryBot, candidate.analysis, guard),
        },
      };
      const position = await openPaperPosition({
        userId: bot.userId,
        bot: sizedBot,
        analysis: candidate.analysis,
        reason: "Autopilot entry",
        strategyOverride: strategyHintFor(entryBot, candidate.analysis, guard),
      });
      result.opened += 1;
      result.actions.push(`Opened ${position.poolName}`);
    } catch (error) {
      if (error instanceof PaperError) continue;
      recordError(bot, error, result);
      break;
    }
  }
}

async function enterLive(
  bot: BotRecord,
  result: BotRunResult,
  candidates: Opportunity[],
  slots: number,
  guard: ImprovementState,
): Promise<void> {
  const attempt = Math.min(slots, LIVE_ENTRIES_PER_TICK);
  for (const candidate of candidates.slice(0, Math.max(1, attempt))) {
    try {
      const sizedBot: BotRecord = {
        ...bot,
        config: {
          ...bot.config,
          capitalPerPositionUsd: candidateCapitalUsd(bot, candidate.analysis, guard),
        },
      };
      const position = await openLiveDlmmPosition({
        userId: bot.userId,
        bot: sizedBot,
        analysis: candidate.analysis,
        actor: "bot",
        strategyOverride: strategyHintFor(bot, candidate.analysis, guard),
      });
      result.opened += 1;
      result.actions.push(`Opened live ${position.poolName}`);
    } catch (error) {
      recordError(bot, error, result);
    }
    break;
  }
}

async function rotatePaper(
  bot: BotRecord,
  result: BotRunResult,
  candidates: Opportunity[],
  pools: Map<string, PoolSnapshot>,
  cooldownMs: number,
  stopLossPct: number,
  guard: ImprovementState,
): Promise<boolean> {
  const now = nowMs();
  const botOpen = getPositions(bot.userId, { mode: "paper", status: "open" }).filter(
    (position) => position.botId === bot.id,
  );
  if (!botOpen.length) return false;
  if (botOpen.some((position) => now - position.openedAt < cooldownMs)) return false;

  const scored: Array<{ position: PositionRecord; analysis: PoolAnalysis; snapshot: PoolSnapshot }> = [];
  for (const position of botOpen) {
    const snapshot = pools.get(poolKey(position.protocol, position.poolAddress));
    if (!snapshot) continue;
    scored.push({ position, analysis: analyzePool(snapshot), snapshot });
  }
  if (!scored.length) return false;
  const worst = scored.reduce((min, item) => (item.analysis.netAprPct < min.analysis.netAprPct ? item : min));
  if (worst.position.pnlPct < -Math.min(stopLossPct, 2)) return false;
  if (guard.heat === "cold" && worst.position.pnlUsd > 0) return false;

  const openAddresses = new Set(botOpen.map((position) => position.poolAddress));
  const best = candidates
    .filter((candidate) => !openAddresses.has(candidate.analysis.pool.address))
    .find(
      (candidate) =>
        candidate.analysis.netAprPct >= worst.analysis.netAprPct + Math.max(4, bot.config.rotationMinDelta),
    );
  if (!best) return false;

  try {
    await closePaperPosition({
      userId: bot.userId,
      positionId: worst.position.id,
      reason: `Rotation to ${best.analysis.pool.name}`,
      pool: worst.snapshot,
      actor: "bot",
    });
    result.closed += 1;
    const targetBot = compoundedBot(bot, bot.userId);
    const sizedTarget: BotRecord = {
      ...targetBot,
      config: {
        ...targetBot.config,
        capitalPerPositionUsd: candidateCapitalUsd(targetBot, best.analysis, guard),
      },
    };
    const position = await openPaperPosition({
      userId: bot.userId,
      bot: sizedTarget,
      analysis: best.analysis,
      reason: `Rotation from ${worst.position.poolName}`,
      strategyOverride: strategyHintFor(targetBot, best.analysis, guard),
    });
    result.rotated += 1;
    result.actions.push(`Rotated ${worst.position.poolName} → ${position.poolName}`);
    return true;
  } catch (error) {
    if (!(error instanceof PaperError)) recordError(bot, error, result);
    return false;
  }
}

async function rotateLive(
  bot: BotRecord,
  result: BotRunResult,
  candidates: Opportunity[],
  cooldownMs: number,
  stopLossPct: number,
  guard: ImprovementState,
): Promise<boolean> {
  const readiness = getLiveReadiness(bot.userId);
  if (!readiness.canTrade) return false;
  const now = nowMs();
  const botOpen = getPositions(bot.userId, { mode: "live", status: "open" }).filter(
    (position) => position.botId === bot.id && position.protocol === "dlmm",
  );
  if (!botOpen.length) return false;
  if (botOpen.some((position) => now - position.openedAt < cooldownMs * 2)) return false;

  const scored: Array<{ position: PositionRecord; analysis: PoolAnalysis }> = [];
  for (const position of botOpen) {
    try {
      const snapshot = await getPoolDetail("dlmm", position.poolAddress);
      scored.push({ position, analysis: analyzePool(snapshot) });
    } catch {
      // Skip pools that cannot be priced right now.
    }
  }
  if (!scored.length) return false;
  const worst = scored.reduce((min, item) => (item.analysis.netAprPct < min.analysis.netAprPct ? item : min));
  if (worst.position.pnlPct < -Math.min(stopLossPct, 2)) return false;
  if (guard.heat === "cold" && worst.position.pnlUsd > 0) return false;

  const openAddresses = new Set(botOpen.map((position) => position.poolAddress));
  const best = candidates
    .filter((candidate) => !openAddresses.has(candidate.analysis.pool.address))
    .find(
      (candidate) =>
        candidate.analysis.netAprPct >=
        worst.analysis.netAprPct + Math.max(10, bot.config.rotationMinDelta),
    );
  if (!best) return false;

  try {
    await closeLivePosition({
      userId: bot.userId,
      positionId: worst.position.id,
      reason: `Rotation to ${best.analysis.pool.name}`,
      actor: "bot",
      requireArming: true,
    });
    result.closed += 1;
    const sizedTarget: BotRecord = {
      ...bot,
      config: {
        ...bot.config,
        capitalPerPositionUsd: candidateCapitalUsd(bot, best.analysis, guard),
      },
    };
    const position = await openLiveDlmmPosition({
      userId: bot.userId,
      bot: sizedTarget,
      analysis: best.analysis,
      actor: "bot",
      strategyOverride: strategyHintFor(bot, best.analysis, guard),
    });
    result.rotated += 1;
    result.actions.push(`Live rotation ${worst.position.poolName} → ${position.poolName}`);
    return true;
  } catch (error) {
    recordError(bot, error, result);
    return false;
  }
}

export async function runBotOnce(bot: BotRecord, options: { force?: boolean } = {}): Promise<BotRunResult> {
  const result: BotRunResult = {
    botId: bot.id,
    opened: 0,
    closed: 0,
    claims: 0,
    rotated: 0,
    skipped: null,
    error: null,
    actions: [],
  };
  if (bot.status !== "running" && !options.force) {
    result.skipped = "Bot is paused";
    return result;
  }
  const user = getUserById(bot.userId);
  if (!user) {
    result.skipped = "Owner account not found";
    return result;
  }

  return withLock(`bot:${bot.id}`, async () => {
    const userId = bot.userId;
    const mode = bot.mode;
    const settings = getUserSettings(userId);
    const startedAt = nowMs();

    if (user.killSwitch) {
      result.skipped = "Kill switch is active";
      updateBotRun(bot.id, { lastRunAt: startedAt, lastError: null });
      return result;
    }

    let pools = new Map<string, PoolSnapshot>();
    let readiness: LiveReadiness | null = null;
    let liveFresh = false;

    if (mode === "paper") {
      const open = getPositions(userId, { mode: "paper", status: "open" });
      pools = await loadPools(open);
      await markPaperBook(userId, open, pools, startedAt);
    } else {
      readiness = getLiveReadiness(userId);
      if (readiness.rpcReady && readiness.wallet) {
        try {
          await syncLivePositions(userId);
          liveFresh = true;
        } catch (error) {
          recordError(bot, error, result);
        }
      } else {
        result.skipped = readiness.reason ?? "Live venue is not ready";
      }
    }

    const risk = evaluateRisk(userId, mode, user.killSwitch);
    if (risk.halt) {
      const outcome = await enforceHalt(bot, risk, pools).catch((error) => ({
        closed: 0,
        errors: [describeError(error)],
      }));
      result.closed += outcome.closed;
      result.skipped = risk.reasons[0] ?? "Risk halt";
      updateBotRun(bot.id, { lastRunAt: startedAt, lastError: result.skipped });
      return result;
    }

    const stops = tightStops(settings.risk, bot.config);
    const now = nowMs();
    const decisionBot = applyGuardToBot(bot, loadImprovementState(userId, mode, now));

    if (mode === "paper") {
      const openBot = getPositions(userId, { mode: "paper", status: "open" }).filter(
        (position) => position.botId === bot.id,
      );
      for (const position of openBot) {
        const fresh = getPosition(userId, position.id);
        if (!fresh || fresh.status !== "open") continue;
        const decision = recommendedPaperAction(fresh, {
          stopLossPct: stops.stopLossPct,
          takeProfitPct: stops.takeProfitPct,
          outOfRangeMinutes: decisionBot.config.rebalanceOutOfRangeMinutes,
          claimIntervalMinutes: bot.config.claimIntervalMinutes,
          now,
        });
        if (decision === "hold") continue;
        try {
          if (decision === "claim") {
            if (fresh.unclaimedFeesUsd < PAPER_CLAIM_MIN_USD) continue;
            await claimPaperFees({ userId, positionId: fresh.id, actor: "bot" });
            result.claims += 1;
            result.actions.push(`Claimed fees ${fresh.poolName}`);
            continue;
          }
          const reason =
            decision === "stop_loss"
              ? `Stop loss ${stops.stopLossPct}%`
              : decision === "take_profit"
                ? `Take profit ${stops.takeProfitPct}%`
                : `Out of range ${decisionBot.config.rebalanceOutOfRangeMinutes}m`;
          await closePaperPosition({
            userId,
            positionId: fresh.id,
            reason,
            pool: pools.get(poolKey(fresh.protocol, fresh.poolAddress)),
            actor: decision === "stop_loss" ? "risk" : "bot",
          });
          result.closed += 1;
          result.actions.push(`Closed ${fresh.poolName}: ${reason}`);
        } catch (error) {
          recordError(bot, error, result);
        }
      }
    } else if (liveFresh) {
      const openBot = getPositions(userId, { mode: "live", status: "open" }).filter(
        (position) => position.botId === bot.id && position.protocol === "dlmm",
      );
      for (const position of openBot) {
        const fresh = getPosition(userId, position.id);
        if (!fresh || fresh.status !== "open") continue;
        if (now - fresh.updatedAt > LIVE_MARK_STALE_MS) continue;
        const lastClaim = fresh.lastClaimedAt ?? fresh.openedAt;
        const decision =
          fresh.pnlPct <= -stops.stopLossPct
            ? "stop_loss"
            : fresh.pnlPct >= stops.takeProfitPct
              ? "take_profit"
              : !fresh.inRange &&
                  fresh.outOfRangeSince &&
                  now - fresh.outOfRangeSince >=
                    decisionBot.config.rebalanceOutOfRangeMinutes * 60_000
                ? "out_of_range"
                : fresh.unclaimedFeesUsd >= LIVE_CLAIM_MIN_USD &&
                    now - lastClaim >= bot.config.claimIntervalMinutes * 60_000
                  ? "claim"
                  : "hold";
        if (decision === "hold") continue;
        try {
          if (decision === "claim") {
            await claimLiveFees({ userId, positionId: fresh.id, actor: "bot" });
            result.claims += 1;
            result.actions.push(`Claimed live fees ${fresh.poolName}`);
            continue;
          }
          const reason =
            decision === "stop_loss"
              ? `Live stop loss ${stops.stopLossPct}%`
              : decision === "take_profit"
                ? `Live take profit ${stops.takeProfitPct}%`
                : `Live out of range ${decisionBot.config.rebalanceOutOfRangeMinutes}m`;
          await closeLivePosition({
            userId,
            positionId: fresh.id,
            reason,
            actor: decision === "stop_loss" ? "risk" : "bot",
            requireArming: false,
          });
          result.closed += 1;
          result.actions.push(`Closed live ${fresh.poolName}: ${reason}`);
        } catch (error) {
          recordError(bot, error, result);
        }
      }
    }

    const improvement = loadImprovementState(userId, mode, nowMs());
    announceImprovement(bot, improvement);
    if (bot.config.autoImprove && improvement.pauseEntries) {
      result.skipped = `Auto-improve pause: ${improvement.pauseReason}`;
      updateBotRun(bot.id, { lastRunAt: startedAt, lastError: null });
      return result;
    }
    const guardedBot = applyGuardToBot(bot, improvement);

    const openNow = getPositions(userId, { mode, status: "open" });
    const botOpenNow = openNow.filter((position) => position.botId === bot.id);
    const slotCap = Math.min(guardedBot.config.maxOpenPositions, settings.risk.maxOpenPositions);
    const portfolioSlots = Math.max(0, settings.risk.maxOpenPositions - openNow.length);
    const slots = Math.max(0, Math.min(slotCap - botOpenNow.length, portfolioSlots));
    const wantsRotation = guardedBot.config.rotationEnabled && botOpenNow.length >= slotCap;

    let candidates: Opportunity[] = [];
    if (slots > 0 || wantsRotation) {
      const cooldownMs = guardedBot.config.cooldownMinutes * 60_000;
      const exclude = new Set(openNow.map((position) => position.poolAddress));
      for (const pool of recentlyClosedPools(userId, mode, cooldownMs)) exclude.add(pool);
      if (guardedBot.config.autoImprove) {
        for (const pool of improvement.blockedPools) exclude.add(pool.poolAddress);
      }
      try {
        const opportunities = await discoverOpportunities({
          risk: settings.risk,
          config: guardedBot.config,
          excludePools: [...exclude],
        });
        candidates = eligibleCandidates(opportunities, mode, exclude);
        if (guardedBot.config.autoImprove && candidates.length > 1) {
          candidates = [...candidates].sort(
            (a, b) =>
              candidateGuardScore(b.analysis, improvement) -
              candidateGuardScore(a.analysis, improvement),
          );
        }
      } catch (error) {
        recordError(bot, error, result);
      }
    }

    if (slots > 0 && candidates.length) {
      if (mode === "paper") {
        await enterPaper(guardedBot, result, candidates, slots, improvement);
      } else {
        readiness = getLiveReadiness(userId);
        if (readiness.canTrade) {
          await enterLive(guardedBot, result, candidates, slots, improvement);
        } else {
          result.skipped = readiness.reason ?? "Live venue is not ready";
        }
      }
    }

    if (wantsRotation && candidates.length) {
      const cooldownMs = guardedBot.config.cooldownMinutes * 60_000;
      const recentRotation = getPositions(userId, { mode, status: "closed", limit: 20 }).some(
        (position) =>
          position.botId === bot.id &&
          position.closeReason?.startsWith("Rotation") &&
          (position.closedAt ?? 0) >= now - cooldownMs,
      );
      if (!recentRotation) {
        if (mode === "paper") {
          await rotatePaper(
            guardedBot,
            result,
            candidates,
            pools,
            cooldownMs,
            stops.stopLossPct,
            improvement,
          );
        } else if (getLiveReadiness(userId).canTrade) {
          await rotateLive(
            guardedBot,
            result,
            candidates,
            cooldownMs,
            stops.stopLossPct,
            improvement,
          );
        }
      }
    }

    updateBotRun(bot.id, { lastRunAt: startedAt, lastError: result.error });
    return result;
  });
}

export type { RiskState };
