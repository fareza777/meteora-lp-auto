import "server-only";
import { analyzePool, priceRangeFromWidth } from "../analytics/strategy";
import { estimatePaperFeeDailyPct, markLpPosition } from "../analytics/lpMath";
import { getOhlcv, getPoolDetail } from "../market/meteora";
import { economicPrice, getPoolOrientation } from "../market/orientation";
import type {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  EquityPoint,
  StrategyName,
} from "../types";

export class BacktestError extends Error {}

interface SimPosition {
  entryPrice: number;
  lowerPrice: number;
  upperPrice: number;
  capital: number;
  entryEquity: number;
  fees: number;
  openedAt: number;
}

function round(value: number, places = 2): number {
  const p = 10 ** places;
  return Math.round(value * p) / p;
}

function pickStrategy(choice: BacktestConfig["strategy"], auto: StrategyName): StrategyName {
  if (choice === "auto") return auto;
  if (choice === "curve") return "Curve";
  if (choice === "bidask") return "BidAsk";
  return "Spot";
}

function maxDrawdown(curve: EquityPoint[]): number {
  let peak = curve[0]?.equity ?? 0;
  let worst = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) worst = Math.max(worst, ((peak - point.equity) / peak) * 100);
  }
  return worst;
}

function sharpeRatio(returns: number[], stepMs: number): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(Math.max(0, variance));
  if (!std) return 0;
  const periodsPerYear = (365 * 86_400_000) / Math.max(1, stepMs);
  return round((mean / std) * Math.sqrt(periodsPerYear), 2);
}

/**
 * Historical LP simulation. It is deliberately conservative and honest about
 * its limits: fees use the pool's current fee rate scaled by range
 * concentration, and exits fill at candle close rather than intrabar.
 */
export async function runBacktest(
  input: Omit<BacktestConfig, "poolName">,
): Promise<{ config: BacktestConfig; result: BacktestResult }> {
  const pool = await getPoolDetail(input.protocol, input.poolAddress);
  const orientation = getPoolOrientation(pool);
  if (!orientation) throw new BacktestError("This pool has no recognised USD quote asset.");
  const now = Date.now();
  const candles = await getOhlcv(
    input.protocol,
    input.poolAddress,
    input.timeframe,
    now - input.days * 86_400_000,
    now,
  );
  if (candles.length < 12) {
    throw new BacktestError("Not enough price history for this pool and timeframe. Try a longer window.");
  }
  const config: BacktestConfig = { ...input, poolName: pool.name };
  const analysis = analyzePool(pool, { candles });
  const strategy = pickStrategy(input.strategy, analysis.recommendedStrategy);
  const strategyCapture = strategy === "Curve" ? 1.08 : strategy === "BidAsk" ? 0.94 : 1;
  const baseDailyPct = estimatePaperFeeDailyPct(
    pool,
    input.rangeWidthPct,
    Math.max(analysis.volatilityPct, 0.5),
  );
  const dailyFeePct = baseDailyPct * input.feeCaptureRatio * strategyCapture;
  const quotePriceUsd = orientation.quotePriceUsd > 0 ? orientation.quotePriceUsd : 1;

  const steps = candles
    .slice(1)
    .map((candle, index) => candle.timestamp - candles[index].timestamp)
    .sort((a, b) => a - b);
  const stepMs = steps[Math.floor(steps.length / 2)] || 3_600_000;
  const cooldownMs = input.rebalanceCooldownHours * 3_600_000;
  const costRate = input.costBpsPerRebalance / 10_000;

  let equity = input.capitalUsd;
  let position: SimPosition | null = null;
  let totalFees = 0;
  let totalCosts = 0;
  let rebalances = 0;
  let inRangeCandles = 0;
  let openCandles = 0;
  let lastRebalanceAt = -Infinity;
  let lastClosedAt = -Infinity;
  const trades: BacktestTrade[] = [];
  const curve: EquityPoint[] = [
    {
      ts: candles[0].timestamp - stepMs,
      equity,
      cash: equity,
      positionsValue: 0,
      pnl: 0,
      fees: 0,
    },
  ];
  const returns: number[] = [];
  let previousEquity = equity;

  function rangeFor(price: number) {
    return priceRangeFromWidth(price, input.rangeWidthPct);
  }

  function openPosition(price: number, ts: number): void {
    if (equity < 1) return;
    const entryCost = equity * costRate;
    totalCosts += entryCost;
    const deployed = equity - entryCost;
    const range = rangeFor(price);
    position = {
      entryPrice: price,
      lowerPrice: range.lowerPrice,
      upperPrice: range.upperPrice,
      capital: deployed,
      entryEquity: equity,
      fees: 0,
      openedAt: ts,
    };
    lastRebalanceAt = ts;
    equity = deployed;
  }

  function mark(price: number): number {
    if (!position) return 0;
    return markLpPosition(
      {
        capitalUsd: position.capital,
        entryPrice: position.entryPrice,
        lowerPrice: position.lowerPrice,
        upperPrice: position.upperPrice,
        quotePriceUsd,
      },
      price,
    ).liquidityValueUsd;
  }

  function closePosition(price: number, ts: number, reason: string): void {
    if (!position) return;
    const proceeds = mark(price) + position.fees;
    const exitCost = proceeds * costRate;
    totalCosts += exitCost;
    const finalEquity = Math.max(0, proceeds - exitCost);
    const pnl = finalEquity - position.entryEquity;
    trades.push({
      openedAt: position.openedAt,
      closedAt: ts,
      entryPrice: position.entryPrice,
      exitPrice: price,
      lowerPrice: position.lowerPrice,
      upperPrice: position.upperPrice,
      feesUsd: round(position.fees),
      pnlUsd: round(pnl),
      pnlPct: round((pnl / Math.max(1, position.entryEquity)) * 100),
      reason,
    });
    equity = finalEquity;
    position = null;
    lastClosedAt = ts;
  }

  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    const closePrice = economicPrice(candle.close, orientation);
    const priceA = economicPrice(candle.low, orientation);
    const priceB = economicPrice(candle.high, orientation);
    const candleLow = Math.min(priceA, priceB);
    const candleHigh = Math.max(priceA, priceB);
    const dtDays = Math.max(0, candle.timestamp - previous.timestamp) / 86_400_000;

    if (!position) {
      if (candle.timestamp - lastClosedAt >= cooldownMs) openPosition(closePrice, candle.timestamp);
    } else {
      const active = position as SimPosition;
      openCandles += 1;
      const overlapped = candleHigh >= active.lowerPrice && candleLow <= active.upperPrice;
      if (overlapped && dailyFeePct > 0) {
        inRangeCandles += 1;
        const fee = active.capital * (dailyFeePct / 100) * dtDays;
        active.fees += fee;
        totalFees += fee;
      }
      const markValue = mark(closePrice);
      const pnlPct =
        ((markValue + active.fees - active.capital) / Math.max(1, active.capital)) * 100;
      if (pnlPct <= -Math.abs(input.stopLossPct)) {
        closePosition(closePrice, candle.timestamp, "Stop loss");
      } else if (pnlPct >= Math.abs(input.takeProfitPct)) {
        closePosition(closePrice, candle.timestamp, "Take profit");
      } else if (
        input.rebalanceOutOfRange &&
        (closePrice < active.lowerPrice || closePrice > active.upperPrice) &&
        candle.timestamp - lastRebalanceAt >= cooldownMs
      ) {
        closePosition(closePrice, candle.timestamp, "Out of range rebalance");
        rebalances += 1;
        openPosition(closePrice, candle.timestamp);
      }
    }

    const openNow = position as SimPosition | null;
    const positionsValue = openNow ? mark(closePrice) : 0;
    const currentEquity = openNow ? positionsValue + openNow.fees : equity;
    equity = currentEquity;
    curve.push({
      ts: candle.timestamp,
      equity: currentEquity,
      cash: Math.max(0, currentEquity - positionsValue),
      positionsValue,
      pnl: currentEquity - input.capitalUsd,
      fees: totalFees,
    });
    if (previousEquity > 0) returns.push(currentEquity / previousEquity - 1);
    previousEquity = currentEquity;
  }

  const lastCandle = candles[candles.length - 1];
  const lastPrice = economicPrice(lastCandle.close, orientation);
  const openAtEnd = position as SimPosition | null;
  if (openAtEnd) {
    const pnl = equity - openAtEnd.entryEquity;
    trades.push({
      openedAt: openAtEnd.openedAt,
      closedAt: null,
      entryPrice: openAtEnd.entryPrice,
      exitPrice: lastPrice,
      lowerPrice: openAtEnd.lowerPrice,
      upperPrice: openAtEnd.upperPrice,
      feesUsd: round(openAtEnd.fees),
      pnlUsd: round(pnl),
      pnlPct: round((pnl / Math.max(1, openAtEnd.entryEquity)) * 100),
      reason: "Open at end of test",
    });
  }

  const days = Math.max(1 / 24, input.days);
  const finalEquity = Math.max(0, equity);
  const totalReturnPct = ((finalEquity - input.capitalUsd) / Math.max(1, input.capitalUsd)) * 100;
  const annualizedPct =
    finalEquity > 0
      ? (Math.pow(finalEquity / input.capitalUsd, 365 / days) - 1) * 100
      : -100;
  const closedTrades = trades.filter((trade) => trade.closedAt !== null);
  const wins = closedTrades.filter((trade) => trade.pnlUsd > 0).length;

  const result: BacktestResult = {
    initialCapital: input.capitalUsd,
    finalEquity: round(finalEquity),
    totalReturnPct: round(totalReturnPct),
    annualizedPct: round(Math.max(-100, Math.min(100_000, Number.isFinite(annualizedPct) ? annualizedPct : 0))),
    maxDrawdownPct: round(maxDrawdown(curve)),
    timeInRangePct: round(openCandles ? (inRangeCandles / openCandles) * 100 : 0),
    feesUsd: round(totalFees),
    costsUsd: round(totalCosts),
    rebalances,
    winRate: round(closedTrades.length ? (wins / closedTrades.length) * 100 : 0),
    sharpe: sharpeRatio(returns, stepMs),
    candles: candles.length,
    equityCurve: curve,
    trades,
    assumptions: [
      `Fees use the pool's current fee/TVL rate (${baseDailyPct.toFixed(3)}% per day) scaled by range concentration and a ${(input.feeCaptureRatio * 100).toFixed(0)}% capture ratio. Historical fee-rate changes are not observable from OHLCV.`,
      `Strategy ${strategy} is approximated by a ${strategyCapture.toFixed(2)}× fee capture factor on a symmetric range; exact bin shaping is not simulated.`,
      "Stops, take profits and rebalances execute at candle close. Intrabar fills, MEV and queue position are not modelled.",
      `Each entry and exit pays ${input.costBpsPerRebalance} bps in costs (swap, slippage, priority fee estimate). Capital is redeployed in full.`,
      "Impermanent loss comes from the concentrated-liquidity value function with the pool quote priced in USD at its current rate.",
      "Past performance of this pool does not guarantee future yield or price behaviour.",
    ],
  };
  return { config, result };
}
