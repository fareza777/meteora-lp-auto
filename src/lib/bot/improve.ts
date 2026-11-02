import type {
  BotConfig,
  BotRecord,
  ImprovementState,
  ImproveHeat,
  PoolAnalysis,
  PoolFeedback,
  PositionRecord,
  RiskSettings,
  StrategyFeedback,
  StrategyName,
  TradingMode,
} from "../types";

export const IMPROVE_WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_POSITION_USD = 25;
const STRATEGY_ORDER: StrategyName[] = ["Spot", "Curve", "BidAsk"];

const FALLBACK_ORDER: Record<StrategyName, StrategyName[]> = {
  BidAsk: ["BidAsk", "Spot", "Curve"],
  Spot: ["Spot", "Curve", "BidAsk"],
  Curve: ["Curve", "Spot", "BidAsk"],
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function usd(value: number): string {
  const abs = Math.abs(value);
  const formatted = abs >= 1_000 ? Math.round(abs).toLocaleString("en-US") : abs.toFixed(0);
  return `${value < 0 ? "-" : ""}$${formatted}`;
}

function pct(value: number, digits = 0): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function isStopLoss(reason: string | null): boolean {
  return /stop[\s_-]?loss/i.test(reason ?? "");
}

export interface ImprovementInput {
  mode: TradingMode;
  closed: PositionRecord[];
  risk: RiskSettings;
  equity: number;
  initialCapital: number;
  peakEquity: number;
  dayPnlPct: number;
  now: number;
  autoImproveEnabled?: boolean;
  windowDays?: number;
}

interface PoolAccumulator {
  poolAddress: string;
  poolName: string;
  trades: number;
  wins: number;
  losses: number;
  stopLosses: number;
  netPnl: number;
  capital: number;
  lastClosedAt: number;
  lastStopAt: number | null;
}

interface StrategyAccumulator {
  strategy: StrategyName;
  trades: number;
  wins: number;
  netPnl: number;
}

function emptyStrategy(): StrategyAccumulator {
  return { strategy: "Spot", trades: 0, wins: 0, netPnl: 0 };
}

function strategyAccumulator(strategy: StrategyName): StrategyAccumulator {
  return { ...emptyStrategy(), strategy };
}

/**
 * Derives a performance guard from realised trades. The guard is deliberately
 * asymmetric: losses tighten quality and size quickly, wins earn a small and
 * capped amount of extra risk.
 */
export function computeImprovement(input: ImprovementInput): ImprovementState {
  const {
    mode,
    closed,
    risk,
    equity,
    initialCapital,
    peakEquity,
    dayPnlPct,
    now,
    autoImproveEnabled = true,
  } = input;
  const windowDays = input.windowDays ?? IMPROVE_WINDOW_DAYS;
  const cutoff = now - windowDays * DAY_MS;
  const recent = closed.filter((position) => (position.closedAt ?? position.updatedAt) >= cutoff);
  const totalTrades = recent.length;
  const netPnl = recent.reduce((sum, position) => sum + position.pnlUsd, 0);
  const wins = recent.filter((position) => position.pnlUsd > 0).length;
  const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
  const stopLosses = recent.filter((position) => isStopLoss(position.closeReason)).length;
  const drawdownPct = peakEquity > 0 ? Math.max(0, ((peakEquity - equity) / peakEquity) * 100) : 0;
  const totalPnlPct = initialCapital > 0 ? ((equity - initialCapital) / initialCapital) * 100 : 0;
  const recentPnlPct = initialCapital > 0 ? (netPnl / initialCapital) * 100 : 0;

  const ordered = [...closed].sort(
    (a, b) => (b.closedAt ?? b.updatedAt) - (a.closedAt ?? a.updatedAt),
  );
  let consecutiveLosses = 0;
  for (const position of ordered) {
    if (position.pnlUsd < 0) consecutiveLosses += 1;
    else break;
  }

  const cold =
    drawdownPct >= risk.maxDrawdownPct * 0.8 ||
    totalPnlPct <= -Math.max(3, risk.maxDrawdownPct * 0.35) ||
    consecutiveLosses >= 3 ||
    (totalTrades >= 4 && recentPnlPct <= -1.5);
  const cooling =
    !cold &&
    (drawdownPct >= risk.maxDrawdownPct * 0.5 ||
      totalPnlPct < -0.5 ||
      (totalTrades >= 3 && netPnl < 0) ||
      (totalTrades >= 6 && winRate < 40));
  const hot =
    !cold &&
    !cooling &&
    totalTrades >= 5 &&
    winRate >= 55 &&
    netPnl > 0 &&
    totalPnlPct > 0 &&
    drawdownPct < risk.maxDrawdownPct * 0.35;

  const heat: ImproveHeat = cold ? "cold" : cooling ? "cooling" : hot ? "hot" : "steady";

  let entryScoreFloorDelta = cold ? 8 : cooling ? 4 : hot ? -2 : 0;
  if (consecutiveLosses >= 4) entryScoreFloorDelta += 2;
  entryScoreFloorDelta = clamp(entryScoreFloorDelta, -2, 12);

  let capitalScale = cold ? 0.5 : cooling ? 0.7 : hot ? 1.05 : 1;
  if (drawdownPct >= risk.maxDrawdownPct * 0.75) capitalScale *= 0.55;
  else if (drawdownPct >= risk.maxDrawdownPct * 0.6) capitalScale *= 0.75;
  capitalScale = clamp(capitalScale, 0.25, 1.1);

  const rotationDeltaBonus = cold ? 8 : cooling ? 4 : 0;
  const rebalanceMinutesBonus = cold ? 30 : cooling ? 15 : 0;

  const pauseReasons: string[] = [];
  let pauseUntil: number | null = null;
  if (drawdownPct >= risk.maxDrawdownPct * 0.85) {
    pauseReasons.push(
      `drawdown brake ${drawdownPct.toFixed(1)}% (soft limit ${(risk.maxDrawdownPct * 0.85).toFixed(1)}%)`,
    );
  }
  if (dayPnlPct <= -Math.abs(risk.dailyLossLimitPct) * 0.7) {
    pauseReasons.push(
      `daily loss brake ${dayPnlPct.toFixed(2)}% (soft limit ${(-Math.abs(risk.dailyLossLimitPct) * 0.7).toFixed(2)}%)`,
    );
  }
  if (consecutiveLosses >= 4) {
    const lastClose = ordered[0]?.closedAt ?? ordered[0]?.updatedAt ?? now;
    const until = lastClose + 2 * HOUR_MS;
    if (until > now) {
      pauseReasons.push(`${consecutiveLosses} consecutive losing trades`);
      pauseUntil = until;
    }
  }
  const pauseEntries = pauseReasons.length > 0;
  const pauseReason = pauseEntries ? pauseReasons.join(" · ") : null;

  const poolMap = new Map<string, PoolAccumulator>();
  const strategyMap = new Map<StrategyName, StrategyAccumulator>(
    STRATEGY_ORDER.map((strategy) => [strategy, strategyAccumulator(strategy)]),
  );

  for (const position of recent) {
    const closedAt = position.closedAt ?? position.updatedAt;
    const stop = isStopLoss(position.closeReason);
    const pool = poolMap.get(position.poolAddress) ?? {
      poolAddress: position.poolAddress,
      poolName: position.poolName,
      trades: 0,
      wins: 0,
      losses: 0,
      stopLosses: 0,
      netPnl: 0,
      capital: 0,
      lastClosedAt: 0,
      lastStopAt: null,
    };
    pool.trades += 1;
    if (position.pnlUsd > 0) pool.wins += 1;
    if (position.pnlUsd < 0) pool.losses += 1;
    if (stop) {
      pool.stopLosses += 1;
      pool.lastStopAt = Math.max(pool.lastStopAt ?? 0, closedAt);
    }
    pool.netPnl += position.pnlUsd;
    pool.capital += position.capitalUsd;
    pool.lastClosedAt = Math.max(pool.lastClosedAt, closedAt);
    poolMap.set(position.poolAddress, pool);

    const strategy = strategyMap.get(position.strategy) ?? strategyAccumulator(position.strategy);
    strategy.trades += 1;
    if (position.pnlUsd > 0) strategy.wins += 1;
    strategy.netPnl += position.pnlUsd;
    strategyMap.set(position.strategy, strategy);
  }

  const poolFeedback: PoolFeedback[] = [];
  const blockedPools: PoolFeedback[] = [];
  for (const pool of poolMap.values()) {
    const winRatePool = pool.trades ? (pool.wins / pool.trades) * 100 : 0;
    const avgCapital = pool.trades ? pool.capital / pool.trades : 0;
    let blockedUntil = 0;
    const reasons: string[] = [];

    if (pool.stopLosses >= 2) {
      blockedUntil = Math.max(blockedUntil, (pool.lastStopAt ?? pool.lastClosedAt) + 48 * HOUR_MS);
      reasons.push(`${pool.stopLosses} stop-loss exits`);
    } else if (pool.stopLosses === 1) {
      blockedUntil = Math.max(blockedUntil, (pool.lastStopAt ?? pool.lastClosedAt) + 12 * HOUR_MS);
      reasons.push("recent stop-loss");
    }
    if (pool.netPnl <= -Math.max(150, avgCapital * 0.1)) {
      blockedUntil = Math.max(blockedUntil, pool.lastClosedAt + 72 * HOUR_MS);
      reasons.push(`net ${usd(pool.netPnl)}`);
    } else if (pool.netPnl <= -Math.max(75, avgCapital * 0.05) && pool.trades >= 2) {
      blockedUntil = Math.max(blockedUntil, pool.lastClosedAt + 24 * HOUR_MS);
      reasons.push(`net ${usd(pool.netPnl)}`);
    }
    if (pool.wins === 0 && pool.trades >= 3) {
      blockedUntil = Math.max(blockedUntil, pool.lastClosedAt + 24 * HOUR_MS);
      reasons.push(`${pool.trades} losses without a win`);
    }

    const blocked = blockedUntil > now;
    const feedback: PoolFeedback = {
      poolAddress: pool.poolAddress,
      poolName: pool.poolName,
      trades: pool.trades,
      wins: pool.wins,
      losses: pool.losses,
      stopLosses: pool.stopLosses,
      netPnl: pool.netPnl,
      winRate: winRatePool,
      lastClosedAt: pool.lastClosedAt,
      lastStopAt: pool.lastStopAt,
      blockedUntil: blocked ? blockedUntil : null,
      blockReason: blocked ? reasons.join(" · ") : null,
      scoreAdjustment: pool.trades >= 2 ? (pool.netPnl > 0 ? 2 : pool.netPnl < 0 ? -4 : 0) : 0,
    };
    poolFeedback.push(feedback);
    if (blocked) blockedPools.push(feedback);
  }

  poolFeedback.sort((a, b) => a.netPnl - b.netPnl);
  blockedPools.sort((a, b) => (b.blockedUntil ?? 0) - (a.blockedUntil ?? 0));

  const strategies: StrategyFeedback[] = [...strategyMap.values()].map((strategy) => {
    const strategyWinRate = strategy.trades ? (strategy.wins / strategy.trades) * 100 : 0;
    let adjustment = 0;
    if (strategy.trades >= 3) {
      if (strategy.netPnl <= -100 || strategyWinRate < 35) adjustment = -9;
      else if (strategy.netPnl < 0) adjustment = -4;
      else if (strategy.netPnl >= 50 && strategyWinRate >= 50) adjustment = 2;
    }
    return {
      strategy: strategy.strategy,
      trades: strategy.trades,
      wins: strategy.wins,
      netPnl: strategy.netPnl,
      winRate: strategyWinRate,
      adjustment,
      status: adjustment < 0 ? "penalized" : adjustment > 0 ? "boost" : "neutral",
    };
  });

  const actions: string[] = [];
  if (totalTrades === 0) {
    actions.push("Performance guard is learning from the first closed trades.");
  } else {
    if (heat === "cold") actions.push(`Cold guard: ${totalTrades} recent trades produced ${usd(netPnl)}.`);
    else if (heat === "cooling") actions.push(`Cooling: recent edge is negative (${usd(netPnl)}).`);
    else if (heat === "hot") actions.push(`Hot streak confirmed across ${totalTrades} trades.`);
    if (capitalScale < 0.999) actions.push(`Position sizing cut to ${Math.round(capitalScale * 100)}%.`);
    else if (capitalScale > 1.001) actions.push(`Position sizing raised to ${Math.round(capitalScale * 100)}%.`);
    if (entryScoreFloorDelta !== 0) {
      actions.push(`Entry score floor ${pct(entryScoreFloorDelta)}.`);
    }
    if (rotationDeltaBonus > 0) actions.push(`Rotation edge raised by ${rotationDeltaBonus}% APR.`);
    if (rebalanceMinutesBonus > 0) {
      actions.push(`Out-of-range grace extended by ${rebalanceMinutesBonus} minutes.`);
    }
    if (pauseEntries) actions.push(`New entries paused: ${pauseReason}.`);
    if (blockedPools.length) {
      actions.push(
        `${blockedPools.length} pool${blockedPools.length === 1 ? "" : "s"} blocked after repeated losses.`,
      );
    }
    for (const strategy of strategies) {
      if (strategy.adjustment < 0) {
        actions.push(
          `${strategy.strategy} penalised ${strategy.adjustment} (${strategy.trades} trades, ${usd(strategy.netPnl)}).`,
        );
      }
    }
  }

  return {
    mode,
    enabled: autoImproveEnabled,
    heat,
    evaluatedAt: now,
    windowDays,
    sampleTrades: totalTrades,
    totalTrades: closed.length,
    netPnl,
    winRate,
    stopLosses,
    consecutiveLosses,
    drawdownPct,
    totalPnlPct,
    entryScoreFloorDelta,
    capitalScale,
    rotationDeltaBonus,
    rebalanceMinutesBonus,
    pauseEntries,
    pauseReason,
    pauseUntil,
    blockedPools,
    pools: poolFeedback.slice(0, 8),
    strategies,
    actions: actions.slice(0, 8),
  };
}

export function improveHeatLabel(heat: ImproveHeat): string {
  if (heat === "hot") return "Hot";
  if (heat === "cooling") return "Cooling";
  if (heat === "cold") return "Cold guard";
  return "Steady";
}

export function improveHeatTone(heat: ImproveHeat): "green" | "accent" | "amber" | "red" {
  if (heat === "hot") return "green";
  if (heat === "cooling") return "amber";
  if (heat === "cold") return "red";
  return "accent";
}

export function strategyFeedbackFor(
  state: ImprovementState,
  strategy: StrategyName,
): StrategyFeedback | undefined {
  return state.strategies.find((item) => item.strategy === strategy);
}

export function strategyForGuard(
  recommended: StrategyName,
  state: ImprovementState,
): StrategyName {
  const order = FALLBACK_ORDER[recommended];
  const adjustment = (strategy: StrategyName) => strategyFeedbackFor(state, strategy)?.adjustment ?? 0;
  let best = recommended;
  let bestAdjustment = adjustment(recommended);
  for (const strategy of order) {
    const value = adjustment(strategy);
    if (value > bestAdjustment) {
      best = strategy;
      bestAdjustment = value;
    }
  }
  return best;
}

export function strategyHintFor(
  bot: BotRecord,
  analysis: PoolAnalysis,
  state: ImprovementState,
): StrategyName | undefined {
  if (!bot.config.autoImprove || bot.config.strategy !== "auto") return undefined;
  const chosen = strategyForGuard(analysis.recommendedStrategy, state);
  return chosen === analysis.recommendedStrategy ? undefined : chosen;
}

export function candidateGuardScore(analysis: PoolAnalysis, state: ImprovementState): number {
  const pool = state.pools.find((item) => item.poolAddress === analysis.pool.address);
  const strategy = strategyForGuard(analysis.recommendedStrategy, state);
  const strategyAdjustment = strategyFeedbackFor(state, strategy)?.adjustment ?? 0;
  return analysis.score + (pool?.scoreAdjustment ?? 0) + strategyAdjustment * 0.5;
}

export function candidateCapitalUsd(
  bot: BotRecord,
  analysis: PoolAnalysis,
  state: ImprovementState,
): number {
  const base = bot.config.capitalPerPositionUsd;
  if (!bot.config.autoImprove) return base;
  const riskScale = clamp(1 - Math.max(0, analysis.riskScore - 25) / 200, 0.65, 1);
  return Math.max(MIN_POSITION_USD, Math.round(base * state.capitalScale * riskScale));
}

export function applyGuardToBot(bot: BotRecord, state: ImprovementState): BotRecord {
  if (!bot.config.autoImprove) return bot;
  const config: BotConfig = {
    ...bot.config,
    minScore: clamp(bot.config.minScore + state.entryScoreFloorDelta, 0, 95),
    rotationMinDelta: clamp(bot.config.rotationMinDelta + state.rotationDeltaBonus, 1, 500),
    rebalanceOutOfRangeMinutes: clamp(
      bot.config.rebalanceOutOfRangeMinutes + state.rebalanceMinutesBonus,
      1,
      1_440,
    ),
  };
  return { ...bot, config };
}
