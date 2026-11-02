import { describe, expect, it } from "vitest";
import {
  analyzePool,
  baseSafety,
  calculateVolatility,
  clamp,
  computeRisk,
  eligibilityFailures,
  mergeSafety,
  poolSignals,
  priceRangeFromWidth,
  recommendStrategy,
  recommendedRange,
  round,
} from "@/lib/analytics/strategy";
import { balancedRisk, hourlyCandles, makePool, steadyCandles } from "./helpers/fixtures";

describe("math helpers", () => {
  it("clamps values and rejects NaN", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(Number.NaN, 2, 8)).toBe(2);
    expect(round(1.23456, 3)).toBe(1.235);
    expect(round(-1.005, 2)).toBe(-1);
  });
});

describe("calculateVolatility", () => {
  it("returns zero for flat price history", () => {
    const flat = hourlyCandles(Array.from({ length: 60 }, () => 100), { halfSpread: 0 });
    const stats = calculateVolatility(flat);
    expect(stats.dailyVolPct).toBe(0);
    expect(stats.trendPct).toBe(0);
    expect(stats.maxDrawdownPct).toBe(0);
    expect(stats.candles).toBe(48);
  });

  it("measures oscillation and drawdown from unsorted candles", () => {
    const closes = Array.from({ length: 48 }, (_, index) => (index % 2 === 0 ? 100 : 101));
    const stats = calculateVolatility(hourlyCandles(closes).reverse());
    expect(stats.dailyVolPct).toBeGreaterThan(0.5);
    expect(stats.maxDrawdownPct).toBeGreaterThan(0.5);
    expect(stats.maxDrawdownPct).toBeLessThan(2);
    expect(stats.candles).toBe(48);
  });

  it("tracks trends on a monotonic series", () => {
    const closes = Array.from({ length: 48 }, (_, index) => 100 + index * 0.25);
    const stats = calculateVolatility(hourlyCandles(closes, { halfSpread: 0 }));
    expect(stats.trendPct).toBeGreaterThan(4);
    expect(stats.trendPct).toBeLessThan(8);
    expect(stats.maxDrawdownPct).toBe(0);
    expect(stats.dailyVolPct).toBeGreaterThan(0);
  });

  it("returns empty stats below three candles", () => {
    const stats = calculateVolatility(hourlyCandles([100, 101]));
    expect(stats).toEqual({ dailyVolPct: 0, trendPct: 0, maxDrawdownPct: 0, candles: 2 });
  });
});

describe("recommendStrategy", () => {
  it("maps volatility regimes to LP shapes", () => {
    expect(recommendStrategy(0.5, false)).toBe("Curve");
    expect(recommendStrategy(1.79, false)).toBe("Curve");
    expect(recommendStrategy(1.8, false)).toBe("Spot");
    expect(recommendStrategy(6.99, false)).toBe("Spot");
    expect(recommendStrategy(7, false)).toBe("BidAsk");
    expect(recommendStrategy(25, false)).toBe("BidAsk");
  });

  it("always uses Curve for quote-to-quote pairs", () => {
    expect(recommendStrategy(30, true)).toBe("Curve");
  });
});

describe("recommendedRange", () => {
  it("computes symmetric price bounds with width clamping", () => {
    const range = priceRangeFromWidth(100, 500);
    expect(range.lowerPrice).toBeCloseTo(52.5, 6);
    expect(range.upperPrice).toBeCloseTo(147.5, 6);
    expect(priceRangeFromWidth(100, 0).lowerPrice).toBeCloseTo(99.9, 6);
  });

  it("aligns DLMM ranges to bin steps", () => {
    const pool = makePool({ currentPrice: 200, binStep: 4 });
    const range = recommendedRange(pool, 10, "Spot");
    expect(Number.isInteger(range.lowerBin)).toBe(true);
    expect(Number.isInteger(range.upperBin)).toBe(true);
    expect(range.lowerBin).toBeLessThan(range.upperBin);
    expect(range.widthBins).toBeGreaterThanOrEqual(2);
    expect(range.lowerPrice).toBeLessThan(200);
    expect(range.upperPrice).toBeGreaterThan(200);
    expect(range.lowerPrice).toBeCloseTo(190, 0);
    expect(range.upperPrice).toBeCloseTo(210, 0);
    expect(range.widthPct).toBe(10);
  });

  it("tightens Curve ranges around the active price", () => {
    const pool = makePool({ currentPrice: 200, binStep: 0 });
    const spot = recommendedRange(pool, 20, "Spot");
    const curve = recommendedRange(pool, 20, "Curve");
    expect(curve.upperPrice - curve.lowerPrice).toBeLessThan(spot.upperPrice - spot.lowerPrice);
    expect(curve.lowerPrice).toBeLessThan(200);
    expect(curve.upperPrice).toBeGreaterThan(200);
    expect(curve.lowerBin).toBe(0);
    expect(curve.upperBin).toBe(0);
  });
});

describe("pool signals and safety", () => {
  it("reads healthy quote-to-quote signals", () => {
    const signals = poolSignals(makePool());
    expect(signals.verifiedTokens).toBe(2);
    expect(signals.quoteQuality).toBe(2);
    expect(signals.ageHours).toBeGreaterThan(700);
    expect(signals.volumeToTvl).toBeCloseTo(2, 3);
    expect(signals.consistency).toBeGreaterThan(60);
  });

  it("marks both verified mints with a large holder base as safe", () => {
    const safety = baseSafety(makePool());
    expect(safety.status).toBe("safe");
    expect(safety.score).toBeGreaterThanOrEqual(72);
    expect(safety.checked).toBe(false);
    expect(safety.reasons.length).toBeGreaterThan(1);
  });

  it("blocks unverified mints with a tiny holder base", () => {
    const pool = makePool({
      tokenX: { ...makePool().tokenX, verified: false, holders: 80 },
      tokenY: { ...makePool().tokenY, verified: false, holders: 90 },
    });
    const safety = baseSafety(pool);
    expect(safety.status).toBe("blocked");
    expect(safety.reasons).toContain("Neither mint is verified");
    expect(safety.reasons).toContain("Low holder base");
  });

  it("escalates external rug reports to blocked", () => {
    const merged = mergeSafety(baseSafety(makePool()), { rugged: true, reasons: ["RugCheck: rugged"] });
    expect(merged.status).toBe("blocked");
    expect(merged.score).toBe(0);
    expect(merged.checked).toBe(true);
    expect(merged.reasons).toContain("RugCheck: rugged");
  });

  it("normalises external scores on a 0-10 scale", () => {
    const good = mergeSafety(baseSafety(makePool()), { score: 9 });
    expect(good.status).toBe("safe");
    expect(good.score).toBeGreaterThanOrEqual(82);
    const bad = mergeSafety(baseSafety(makePool()), { score: 2 });
    expect(bad.score).toBeLessThanOrEqual(45);
    expect(bad.status).toBe("watch");
  });
});

describe("computeRisk", () => {
  it("adds critical flags for young, thin, low-holder pools", () => {
    const pool = makePool({
      tvlUsd: 10_000,
      createdAt: Date.now() - 2 * 3_600_000,
      volume24hUsd: 50,
      volume4hUsd: 20,
      volume1hUsd: 5,
      fees24hUsd: 10,
      feeTvl24hPct: 0.1,
      feeAprPct: 36.5,
      tokenX: { ...makePool().tokenX, verified: false, holders: 80 },
      tokenY: { ...makePool().tokenY, verified: false, holders: 90 },
    });
    const risk = computeRisk({
      pool,
      safety: baseSafety(pool),
      signals: poolSignals(pool),
      volatilityPct: 3,
    });
    const codes = risk.flags.map((flag) => flag.code);
    expect(codes).toContain("token_blocked");
    expect(codes).toContain("new_pool");
    expect(codes).toContain("thin_tvl");
    expect(codes).toContain("holder_risk");
    expect(risk.flags.some((flag) => flag.severity === "critical")).toBe(true);
    expect(risk.score).toBeGreaterThanOrEqual(90);
  });

  it("keeps a deep, mature pool low risk", () => {
    const pool = makePool();
    const risk = computeRisk({
      pool,
      safety: baseSafety(pool),
      signals: poolSignals(pool),
      volatilityPct: 4,
    });
    expect(risk.score).toBeLessThan(30);
    expect(risk.flags.some((flag) => flag.severity === "critical")).toBe(false);
  });
});

describe("analyzePool", () => {
  it("produces a complete, bounded analysis", () => {
    const now = 1_700_000_000_000;
    const analysis = analyzePool(makePool(), { now, candles: steadyCandles(72) });
    expect(analysis.updatedAt).toBe(now);
    expect(analysis.score).toBeGreaterThanOrEqual(0);
    expect(analysis.score).toBeLessThanOrEqual(100);
    expect(analysis.confidence).toBeGreaterThanOrEqual(20);
    expect(analysis.confidence).toBeLessThanOrEqual(98);
    expect(analysis.recommendedStrategy).toBe("Curve");
    expect(analysis.volatilityPct).toBeGreaterThan(0);
    expect(analysis.range.lowerPrice).toBeLessThan(analysis.pool.currentPrice);
    expect(analysis.range.upperPrice).toBeGreaterThan(analysis.pool.currentPrice);
    expect(analysis.feeAprPct).toBeCloseTo(182.5, 2);
    expect(analysis.netAprPct).toBeGreaterThan(analysis.pool.farmAprPct);
    expect(analysis.safety.checked).toBe(false);
    expect(analysis.warnings).not.toContain(
      "Range uses an estimated volatility regime until OHLCV is loaded",
    );
  });

  it("warns when no OHLCV history is available", () => {
    const analysis = analyzePool(makePool());
    expect(analysis.warnings).toContain(
      "Range uses an estimated volatility regime until OHLCV is loaded",
    );
    expect(analysis.confidence).toBeLessThan(98);
  });

  it("merges external safety into the recommendation", () => {
    const analysis = analyzePool(makePool(), { safety: { rugged: true } });
    expect(analysis.safety.status).toBe("blocked");
    expect(analysis.warnings).toContain(
      "Critical risk flag present — autopilot will not enter this pool",
    );
    expect(analysis.riskFlags.some((flag) => flag.code === "token_blocked")).toBe(true);
  });
});

describe("eligibilityFailures", () => {
  it("passes a healthy pool under its own risk profile thresholds", () => {
    const analysis = analyzePool(makePool(), { candles: steadyCandles(72) });
    const failures = eligibilityFailures(analysis, { risk: balancedRisk() });
    expect(failures).not.toContain("Pool TVL below minimum");
    expect(failures).not.toContain("Pool is too young");
    expect(failures).not.toContain("Token holder base is too small");
    expect(failures).not.toContain("Token safety check failed");
  });

  it("explains every failed gate", () => {
    const analysis = analyzePool(makePool());
    const failures = eligibilityFailures(analysis, {
      risk: balancedRisk(),
      botConfig: { minTvlUsd: 10_000_000, minScore: 99, minFeeAprPct: 500 },
    });
    expect(failures).toContain("Pool TVL below minimum");
    expect(failures).toContain("Opportunity score below minimum");
    expect(failures).toContain("Fee APR below bot threshold");
  });

  it("blocks pools without a USD quote asset", () => {
    const pool = makePool({
      tokenX: { ...makePool().tokenX, symbol: "BONK", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
      tokenY: { ...makePool().tokenY, symbol: "WIF", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
    });
    const analysis = analyzePool(pool);
    const failures = eligibilityFailures(analysis, { risk: balancedRisk() });
    expect(failures).toContain("Pool has no major USD quote asset");
  });
});
