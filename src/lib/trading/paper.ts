import "server-only";
import { withLock } from "../concurrency";
import { getDb, nowMs } from "../db";
import { eligibilityFailures, recommendedRange } from "../analytics/strategy";
import { accrueFeeUsd, entrySides, estimatePaperFeeDailyPct, markLpPosition } from "../analytics/lpMath";
import { economicPrice, economicRange, getPoolOrientation, isQuoteToken } from "../market/orientation";
import { getPoolDetail } from "../market/meteora";
import { notifyUser } from "../notifications";
import { getPaperSummary, updatePaperAccountAfterMark } from "../portfolio";
import {
  getOpenPositionsForPool,
  getPaperAccount,
  getPosition,
  getPositions,
  getUserSettings,
  insertPosition,
  logActivity,
  recordEquitySnapshot,
  recordTransaction,
  savePaperAccount,
  updatePosition,
} from "../store";
import type {
  BotRecord,
  PoolAnalysis,
  PoolSnapshot,
  PositionRecord,
  StrategyName,
  TradingMode,
} from "../types";

const PAPER_NETWORK_FEE_USD = 0.02;
const MIN_POSITION_USD = 25;

export class PaperError extends Error {}

function resolveStrategy(
  bot: BotRecord,
  analysis: PoolAnalysis,
  override?: StrategyName,
): StrategyName {
  if (bot.config.strategy === "auto" && override) return override;
  if (bot.config.strategy === "auto") return analysis.recommendedStrategy;
  if (bot.config.strategy === "curve") return "Curve";
  if (bot.config.strategy === "bidask") return "BidAsk";
  return "Spot";
}

function quotePrice(pool: PoolSnapshot): number {
  const orientation = getPoolOrientation(pool);
  if (orientation && orientation.quotePriceUsd > 0) return orientation.quotePriceUsd;
  if (pool.tokenY.priceUsd > 0) return pool.tokenY.priceUsd;
  if (pool.tokenX.priceUsd > 0 && pool.currentPrice > 0) return pool.tokenX.priceUsd / pool.currentPrice;
  return 1;
}

function widthForStrategy(baseWidth: number, strategy: StrategyName): number {
  const factor = strategy === "Curve" ? 0.72 : strategy === "BidAsk" ? 1.35 : 1;
  return Math.min(85, Math.max(1.2, baseWidth * factor));
}

export function syncPaperAccountSnapshot(userId: string): ReturnType<typeof getPaperSummary> {
  const state = getPaperSummary(userId);
  updatePaperAccountAfterMark(userId, state.summary);
  recordEquitySnapshot({
    userId,
    equity: state.summary.equity,
    cash: state.summary.cash,
    positionsValue: state.summary.positionsValue,
    pnl: state.summary.totalPnl,
    fees: state.summary.feeIncome,
  });
  return state;
}

export async function openPaperPosition(input: {
  userId: string;
  bot: BotRecord;
  analysis: PoolAnalysis;
  reason?: string;
  strategyOverride?: StrategyName;
}): Promise<PositionRecord> {
  const { userId, bot, analysis } = input;
  if (bot.mode !== "paper") throw new PaperError("This bot is not in paper mode.");
  return withLock(`portfolio:${userId}`, async () => {
    const settings = getUserSettings(userId);
    const account = getPaperAccount(userId);
    const state = getPaperSummary(userId);
    const positions = getPositions(userId, { mode: "paper", status: "open" });
    if (positions.some((p) => p.poolAddress === analysis.pool.address)) {
      throw new PaperError("A position is already open in this pool.");
    }
    const botPositions = positions.filter((p) => p.botId === bot.id);
    if (botPositions.length >= bot.config.maxOpenPositions) {
      throw new PaperError("This bot has reached its position limit.");
    }
    if (positions.length >= settings.risk.maxOpenPositions) {
      throw new PaperError("Portfolio position limit reached.");
    }
    if (state.summary.dayPnlPct <= -settings.risk.dailyLossLimitPct) {
      throw new PaperError("Daily loss limit is active. Autopilot entry is locked.");
    }
    if (state.summary.maxDrawdownPct >= settings.risk.maxDrawdownPct) {
      throw new PaperError("Drawdown limit is active. Autopilot entry is locked.");
    }
    const failures = eligibilityFailures(analysis, {
      risk: settings.risk,
      botConfig: bot.config,
    });
    if (failures.length) throw new PaperError(failures[0]);
    if (analysis.riskFlags.some((flag) => flag.severity === "critical")) {
      throw new PaperError("Critical pool risk detected. Entry blocked.");
    }

    const equity = state.summary.equity;
    const currentExposure = positions.reduce((sum, p) => sum + p.capitalUsd, 0);
    const exposureCapacity = equity * (settings.risk.maxTotalExposurePct / 100) - currentExposure;
    const poolCapacity = equity * (settings.risk.maxCapitalPerPoolPct / 100);
    const capital = Math.min(
      bot.config.capitalPerPositionUsd,
      poolCapacity,
      exposureCapacity,
      account.cash - PAPER_NETWORK_FEE_USD,
    );
    if (!Number.isFinite(capital) || capital < MIN_POSITION_USD) {
      throw new PaperError("Not enough deployable cash within the risk limits.");
    }

    const strategy = resolveStrategy(bot, analysis, input.strategyOverride);
    const baseWidth = bot.config.rangeMode === "manual" ? bot.config.rangeWidthPct : analysis.range.widthPct;
    const widthPct = widthForStrategy(baseWidth, strategy);
    const range = recommendedRange(analysis.pool, widthPct, strategy);
    const orientation = getPoolOrientation(analysis.pool);
    if (!orientation) throw new PaperError("Pool has no recognised USD quote asset.");
    const quoteUsd = orientation.quotePriceUsd > 0 ? orientation.quotePriceUsd : quotePrice(analysis.pool);
    const economic = economicRange(range.lowerPrice, range.upperPrice, orientation);
    const entryPrice = economicPrice(analysis.pool.currentPrice, orientation);
    const entry = entrySides({
      capitalUsd: capital,
      entryPrice,
      lowerPrice: economic.lowerPrice,
      upperPrice: economic.upperPrice,
      quotePriceUsd: quoteUsd,
    });
    if (entry.totalUsd <= 0) throw new PaperError("Could not construct a valid LP position range.");
    const xAmount = orientation.baseIsX ? entry.x : entry.y;
    const yAmount = orientation.baseIsX ? entry.y : entry.x;
    const xPrice = orientation.baseIsX ? orientation.basePriceUsd : quoteUsd;
    const yPriceU = orientation.baseIsX ? quoteUsd : orientation.basePriceUsd;

    const feeDailyPct = estimatePaperFeeDailyPct(
      analysis.pool,
      Math.min(100, ((range.upperPrice - range.lowerPrice) / analysis.pool.currentPrice) * 100),
      Math.max(analysis.volatilityPct, 0.5),
    );
    const now = nowMs();
    const positionDraft: Omit<PositionRecord, "id"> = {
      userId,
      botId: bot.id,
      mode: "paper",
      protocol: analysis.pool.protocol,
      poolAddress: analysis.pool.address,
      poolName: analysis.pool.name,
      strategy,
      status: "open",
      capitalUsd: capital,
      entryPrice: analysis.pool.currentPrice,
      currentPrice: analysis.pool.currentPrice,
      lowerBin: range.lowerBin,
      upperBin: range.upperBin,
      lowerPrice: range.lowerPrice,
      upperPrice: range.upperPrice,
      tokenXMint: analysis.pool.tokenX.address,
      tokenYMint: analysis.pool.tokenY.address,
      tokenXSymbol: analysis.pool.tokenX.symbol,
      tokenYSymbol: analysis.pool.tokenY.symbol,
      tokenXDecimals: analysis.pool.tokenX.decimals,
      tokenYDecimals: analysis.pool.tokenY.decimals,
      entryXAmount: xAmount,
      entryYAmount: yAmount,
      currentXAmount: xAmount,
      currentYAmount: yAmount,
      tokenXPriceUsd: xPrice,
      tokenYPriceUsd: yPriceU,
      currentValueUsd: capital,
      feeDailyPct,
      unclaimedFeesUsd: 0,
      claimedFeesUsd: 0,
      ilUsd: 0,
      pnlUsd: 0,
      pnlPct: 0,
      inRange: true,
      outOfRangeSince: null,
      lastClaimedAt: null,
      positionAddress: null,
      nftMint: null,
      openedAt: now,
      lastAccruedAt: now,
      updatedAt: now,
      closedAt: null,
      closeReason: null,
      closeProceedsUsd: null,
      txOpen: null,
      txClose: null,
    };

    const save = getDb().transaction(() => {
      const position = insertPosition(positionDraft);
      savePaperAccount({ ...account, cash: account.cash - capital - PAPER_NETWORK_FEE_USD });
      recordTransaction({
        userId,
        botId: bot.id,
        positionId: position.id,
        mode: "paper",
        type: "open",
        status: "simulated",
        amountUsd: capital,
        networkFeeUsd: PAPER_NETWORK_FEE_USD,
        poolName: analysis.pool.name,
        metadata: {
          protocol: analysis.pool.protocol,
          poolAddress: analysis.pool.address,
          strategy,
          lowerPrice: range.lowerPrice,
          upperPrice: range.upperPrice,
          score: analysis.score,
        },
      });
      logActivity({
        userId,
        botId: bot.id,
        level: "success",
        category: "entry",
        message: `Opened ${strategy} LP in ${analysis.pool.name} with $${capital.toFixed(0)} · ${range.widthPct.toFixed(1)}% range · score ${analysis.score}`,
        metadata: { positionId: position.id, protocol: analysis.pool.protocol },
      });
      return position;
    });
    const position = save();
    syncPaperAccountSnapshot(userId);

    void notifyUser(
      userId,
      "open",
      `Tide paper entry\n${analysis.pool.name} · ${strategy}\nCapital: $${capital.toFixed(0)}\nRange: $${range.lowerPrice.toPrecision(5)} – $${range.upperPrice.toPrecision(5)}\nOpportunity score: ${analysis.score}/100`,
    );
    return position;
  });
}

interface MarkAdjustment {
  position: PositionRecord;
  earlierInRange: boolean;
  newlyOutOfRange: boolean;
}

export function applyPaperMark(
  position: PositionRecord,
  pool: PoolSnapshot,
  now = nowMs(),
): MarkAdjustment {
  const orientation = getPoolOrientation(pool);
  const baseIsX = orientation ? orientation.baseIsX : !isQuoteToken(pool.tokenX);
  const quoteUsd = orientation
    ? orientation.quotePriceUsd
    : pool.tokenY.priceUsd > 0
      ? pool.tokenY.priceUsd
      : quotePrice(pool);
  const fallback = {
    baseIsX,
    base: baseIsX ? pool.tokenX : pool.tokenY,
    quote: baseIsX ? pool.tokenY : pool.tokenX,
    quotePerBase: pool.currentPrice,
    basePriceUsd: 0,
    quotePriceUsd: quoteUsd,
  };
  const view = orientation ?? fallback;
  const current = economicPrice(pool.currentPrice, view);
  const bounds = economicRange(position.lowerPrice, position.upperPrice, view);
  const mark = markLpPosition(
    {
      capitalUsd: position.capitalUsd,
      entryPrice: economicPrice(position.entryPrice, view),
      lowerPrice: bounds.lowerPrice,
      upperPrice: bounds.upperPrice,
      quotePriceUsd: quoteUsd,
    },
    current,
  );
  if (mark.holdValueUsd <= 0) {
    return { position, earlierInRange: position.inRange, newlyOutOfRange: false };
  }
  const fee = accrueFeeUsd({
    capitalUsd: position.capitalUsd,
    feeDailyPct: position.feeDailyPct,
    elapsedMs: now - position.lastAccruedAt,
    inRange: mark.inRange,
  });
  const unclaimed = position.unclaimedFeesUsd + fee;
  const currentValue = mark.liquidityValueUsd;
  const pnl = currentValue + unclaimed + position.claimedFeesUsd - position.capitalUsd;
  const pnlPct = (pnl / Math.max(1, position.capitalUsd)) * 100;
  const outOfRangeSince = mark.inRange ? null : (position.outOfRangeSince ?? now);
  const xAmount = baseIsX ? mark.x : mark.y;
  const yAmount = baseIsX ? mark.y : mark.x;
  const xPrice = baseIsX ? (pool.tokenX.priceUsd || current * quoteUsd) : quoteUsd;
  const yPriceValue = baseIsX ? quoteUsd : (pool.tokenY.priceUsd || quoteUsd);
  updatePosition(position.id, {
    current_price: pool.currentPrice,
    current_x_amount: xAmount,
    current_y_amount: yAmount,
    token_x_price_usd: xPrice,
    token_y_price_usd: yPriceValue,
    current_value_usd: currentValue,
    unclaimed_fees_usd: unclaimed,
    il_usd: mark.ilUsd,
    pnl_usd: pnl,
    pnl_pct: pnlPct,
    in_range: mark.inRange ? 1 : 0,
    out_of_range_since: outOfRangeSince,
    last_accrued_at: now,
    updated_at: now,
  });
  return {
    position: {
      ...position,
      currentPrice: pool.currentPrice,
      currentXAmount: xAmount,
      currentYAmount: yAmount,
      tokenXPriceUsd: xPrice,
      tokenYPriceUsd: yPriceValue,
      currentValueUsd: currentValue,
      unclaimedFeesUsd: unclaimed,
      ilUsd: mark.ilUsd,
      pnlUsd: pnl,
      pnlPct,
      inRange: mark.inRange,
      outOfRangeSince,
      lastAccruedAt: now,
      updatedAt: now,
    },
    earlierInRange: position.inRange,
    newlyOutOfRange: position.inRange && !mark.inRange,
  };
}

export async function markAllOpenPaperPositions(
  pools: Map<string, PoolSnapshot>,
  now = nowMs(),
): Promise<number> {
  const rows = getDb()
    .prepare("SELECT DISTINCT user_id FROM positions WHERE status = 'open' AND mode = 'paper'")
    .all() as Array<{ user_id: string }>;
  let marked = 0;
  for (const row of rows) {
    await withLock(`portfolio:${row.user_id}`, async () => {
      const positions = getPositions(row.user_id, { mode: "paper", status: "open" });
      for (const position of positions) {
        const pool = pools.get(`${position.protocol}:${position.poolAddress}`);
        if (!pool) continue;
        applyPaperMark(position, pool, now);
        marked += 1;
      }
      if (positions.length) syncPaperAccountSnapshot(row.user_id);
    });
  }
  return marked;
}

/** Refresh one user's paper book with live pool marks before serving a dashboard. */
export async function refreshPaperPositionsForUser(userId: string, now = nowMs()): Promise<number> {
  const positions = getPositions(userId, { mode: "paper", status: "open" });
  if (!positions.length) return 0;
  const pools = new Map<string, PoolSnapshot>();
  await Promise.all(
    [...new Map(positions.map((position) => [`${position.protocol}:${position.poolAddress}`, position])).values()].map(
      async (position) => {
        try {
          const pool = await getPoolDetail(position.protocol, position.poolAddress);
          pools.set(`${position.protocol}:${position.poolAddress}`, pool);
        } catch {
          // Keep the previous mark when a pool endpoint is briefly unavailable.
        }
      },
    ),
  );
  return withLock(`portfolio:${userId}`, async () => {
    const fresh = getPositions(userId, { mode: "paper", status: "open" });
    let marked = 0;
    for (const position of fresh) {
      const pool = pools.get(`${position.protocol}:${position.poolAddress}`);
      if (!pool) continue;
      applyPaperMark(position, pool, now);
      marked += 1;
    }
    if (fresh.length) syncPaperAccountSnapshot(userId);
    return marked;
  });
}

export async function claimPaperFees(input: {
  userId: string;
  positionId: string;
  actor: "manual" | "bot";
}): Promise<PositionRecord> {
  return withLock(`portfolio:${input.userId}`, async () => {
    const position = getPosition(input.userId, input.positionId);
    if (!position || position.status !== "open") throw new PaperError("Open position not found.");
    if (position.unclaimedFeesUsd < 0.02) throw new PaperError("No fees available to claim.");
    const amount = position.unclaimedFeesUsd;
    const fee = PAPER_NETWORK_FEE_USD;
    const account = getPaperAccount(input.userId);
    const now = nowMs();
    const tx = getDb().transaction(() => {
      savePaperAccount({ ...account, cash: account.cash + Math.max(0, amount - fee) });
      updatePosition(position.id, {
        claimed_fees_usd: position.claimedFeesUsd + amount,
        unclaimed_fees_usd: 0,
        pnl_usd: position.currentValueUsd + position.claimedFeesUsd + amount - position.capitalUsd,
        last_claimed_at: now,
        updated_at: now,
      });
      recordTransaction({
        userId: input.userId,
        botId: position.botId,
        positionId: position.id,
        mode: "paper",
        type: "claim",
        status: "simulated",
        amountUsd: amount,
        feeUsd: 0,
        networkFeeUsd: fee,
        poolName: position.poolName,
        metadata: { actor: input.actor },
      });
      logActivity({
        userId: input.userId,
        botId: position.botId,
        level: "info",
        category: "fees",
        message: `Claimed $${amount.toFixed(2)} simulated fees from ${position.poolName}`,
        metadata: { positionId: position.id },
      });
    });
    tx();
    syncPaperAccountSnapshot(input.userId);
    return getPosition(input.userId, position.id)!;
  });
}

export async function closePaperPosition(input: {
  userId: string;
  positionId: string;
  reason: string;
  pool?: PoolSnapshot;
  actor?: "manual" | "bot" | "risk";
}): Promise<PositionRecord> {
  return withLock(`portfolio:${input.userId}`, async () => {
    let position = getPosition(input.userId, input.positionId);
    if (!position || position.status !== "open") throw new PaperError("Open position not found.");
    if (input.pool) position = applyPaperMark(position, input.pool).position;
    const proceeds = position.currentValueUsd + position.unclaimedFeesUsd;
    const totalFees = position.claimedFeesUsd + position.unclaimedFeesUsd;
    const pnl = proceeds + position.claimedFeesUsd - position.capitalUsd;
    const account = getPaperAccount(input.userId);
    const now = nowMs();
    const tx = getDb().transaction(() => {
      savePaperAccount({
        ...account,
        cash: account.cash + Math.max(0, proceeds - PAPER_NETWORK_FEE_USD),
      });
      updatePosition(position!.id, {
        status: "closed",
        current_value_usd: 0,
        claimed_fees_usd: totalFees,
        unclaimed_fees_usd: 0,
        pnl_usd: pnl,
        pnl_pct: (pnl / Math.max(1, position!.capitalUsd)) * 100,
        close_reason: input.reason,
        close_proceeds_usd: proceeds,
        closed_at: now,
        updated_at: now,
        last_accrued_at: now,
      });
      recordTransaction({
        userId: input.userId,
        botId: position!.botId,
        positionId: position!.id,
        mode: "paper",
        type: "close",
        status: "simulated",
        amountUsd: proceeds,
        networkFeeUsd: PAPER_NETWORK_FEE_USD,
        poolName: position!.poolName,
        metadata: { reason: input.reason, pnl, actor: input.actor ?? "manual" },
      });
      logActivity({
        userId: input.userId,
        botId: position!.botId,
        level: pnl >= 0 ? "success" : "warning",
        category: "exit",
        message: `Closed ${position!.poolName} · ${input.reason} · PnL $${pnl.toFixed(2)} (${((pnl / Math.max(1, position!.capitalUsd)) * 100).toFixed(2)}%)`,
        metadata: { positionId: position!.id, proceeds },
      });
    });
    tx();
    syncPaperAccountSnapshot(input.userId);
    const closed = getPosition(input.userId, position.id)!;
    void notifyUser(
      input.userId,
      "close",
      `Tide paper exit\n${closed.poolName} · ${input.reason}\nPnL: $${pnl.toFixed(2)} (${closed.pnlPct.toFixed(2)}%)\nProceeds: $${proceeds.toFixed(2)}`,
    );
    return closed;
  });
}

export async function closePaperPositionForPool(
  userId: string,
  poolAddress: string,
): Promise<void> {
  const open = getOpenPositionsForPool(poolAddress).filter(
    (position) => position.userId === userId && position.mode === "paper" && position.status === "open",
  );
  for (const position of open) {
    await closePaperPosition({
      userId,
      positionId: position.id,
      reason: "Emergency exit",
      actor: "risk",
    });
  }
}

export function recommendedPaperAction(
  position: PositionRecord,
  input: {
    stopLossPct: number;
    takeProfitPct: number;
    outOfRangeMinutes: number;
    claimIntervalMinutes: number;
    now?: number;
  },
): "stop_loss" | "take_profit" | "out_of_range" | "claim" | "hold" {
  const now = input.now ?? nowMs();
  if (position.pnlPct <= -Math.abs(input.stopLossPct)) return "stop_loss";
  if (position.pnlPct >= Math.abs(input.takeProfitPct)) return "take_profit";
  if (
    !position.inRange &&
    position.outOfRangeSince &&
    now - position.outOfRangeSince >= input.outOfRangeMinutes * 60_000
  ) {
    return "out_of_range";
  }
  const lastClaim = position.lastClaimedAt ?? position.openedAt;
  if (
    position.unclaimedFeesUsd >= 1 &&
    now - lastClaim >= input.claimIntervalMinutes * 60_000
  ) {
    return "claim";
  }
  return "hold";
}

export { PAPER_NETWORK_FEE_USD, MIN_POSITION_USD };
