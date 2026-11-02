import type {
  OhlcvCandle,
  PoolAnalysis,
  PoolSnapshot,
  PoolSignals,
  RecommendedRange,
  RiskFlag,
  RiskSettings,
  StrategyName,
  TokenSafety,
} from "../types";
import { isQuoteMint } from "../market/mints";
import { isQuotePool } from "../market/orientation";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function round(value: number, places = 2): number {
  const p = 10 ** places;
  return Math.round(value * p) / p;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

export interface VolatilityStats {
  dailyVolPct: number;
  trendPct: number;
  maxDrawdownPct: number;
  candles: number;
}

export function calculateVolatility(candles: OhlcvCandle[]): VolatilityStats {
  if (candles.length < 3) {
    return { dailyVolPct: 0, trendPct: 0, maxDrawdownPct: 0, candles: candles.length };
  }
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const medianStep =
    sorted
      .slice(1)
      .map((c, i) => c.timestamp - sorted[i].timestamp)
      .sort((a, b) => a - b)[Math.floor((sorted.length - 1) / 2)] || 60 * 60_000;
  const periodsPerDay = Math.max(1, 86_400_000 / medianStep);
  const lookback = sorted.slice(-Math.min(sorted.length, Math.ceil(periodsPerDay * 2)));
  const returns: number[] = [];
  for (let i = 1; i < lookback.length; i += 1) {
    const prev = lookback[i - 1].close;
    if (prev > 0) returns.push(Math.log(lookback[i].close / prev));
  }
  const rawVol = stdDev(returns);
  const lastDay = lookback.slice(-Math.ceil(periodsPerDay));
  const high = Math.max(...lastDay.map((c) => c.high));
  const low = Math.min(...lastDay.map((c) => c.low));
  const rangeVol = low > 0 ? ((high - low) / low) * 100 : 0;
  const dailyVolPct = Math.max(rawVol * Math.sqrt(periodsPerDay) * 100, rangeVol * 0.55);
  const first = lastDay[0]?.open || lookback[0].close;
  const last = lookback[lookback.length - 1].close;
  const trendPct = first > 0 ? ((last - first) / first) * 100 : 0;

  let peak = lookback[0].close;
  let maxDrawdownPct = 0;
  for (const candle of lookback) {
    peak = Math.max(peak, candle.close);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - candle.close) / peak) * 100);
  }
  return {
    dailyVolPct: round(dailyVolPct, 3),
    trendPct: round(trendPct, 2),
    maxDrawdownPct: round(maxDrawdownPct, 2),
    candles: lookback.length,
  };
}

export function poolSignals(pool: PoolSnapshot): PoolSignals {
  const ageHours = pool.createdAt ? (Date.now() - pool.createdAt) / 3_600_000 : 0;
  const volumeToTvl = pool.tvlUsd > 0 ? pool.volume24hUsd / pool.tvlUsd : 0;
  const feeTrend = pool.fees24hUsd > 0 ? (pool.fees1hUsd * 24) / pool.fees24hUsd : 0;
  const dailyYields = [
    pool.tvlUsd > 0 ? (pool.fees1hUsd * 24 * 100) / pool.tvlUsd : 0,
    pool.tvlUsd > 0 ? (pool.fees4hUsd * 6 * 100) / pool.tvlUsd : 0,
    pool.feeTvl24hPct,
  ].filter((v) => v > 0);
  const consistency =
    dailyYields.length >= 2
      ? clamp(100 - (stdDev(dailyYields) / Math.max(0.0001, mean(dailyYields))) * 55, 0, 100)
      : dailyYields.length === 1
        ? 45
        : 0;
  const verifiedTokens = Number(pool.tokenX.verified) + Number(pool.tokenY.verified);
  const quoteQuality =
    Number(
      isQuoteMint(pool.tokenX.address) ||
        pool.tokenX.symbol === "USDC" ||
        pool.tokenX.symbol === "USDT" ||
        pool.tokenX.symbol === "SOL",
    ) +
    Number(
      isQuoteMint(pool.tokenY.address) ||
        pool.tokenY.symbol === "USDC" ||
        pool.tokenY.symbol === "USDT" ||
        pool.tokenY.symbol === "SOL",
    );
  return {
    ageHours: round(ageHours, 1),
    volumeToTvl: round(volumeToTvl, 3),
    feeTrend: round(feeTrend, 3),
    consistency: round(consistency, 1),
    verifiedTokens,
    minHolders: Math.min(pool.tokenX.holders, pool.tokenY.holders),
    quoteQuality,
  };
}

export function baseSafety(pool: PoolSnapshot): TokenSafety {
  const signals = poolSignals(pool);
  const reasons: string[] = [];
  let score = 55;
  if (signals.verifiedTokens === 2) {
    score += 20;
    reasons.push("Both mints verified");
  } else if (signals.verifiedTokens === 1) {
    score += 10;
    reasons.push("One mint verified");
  } else {
    score -= 15;
    reasons.push("Neither mint is verified");
  }
  if (signals.minHolders >= 5_000) score += 12;
  else if (signals.minHolders >= 1_000) score += 8;
  else if (signals.minHolders >= 250) score += 2;
  else {
    score -= 16;
    reasons.push("Low holder base");
  }
  const tokens = [pool.tokenX, pool.tokenY];
  const unknownWithFreeze = tokens.filter(
    (t) => !t.verified && !t.freezeAuthorityDisabled && !isQuoteMint(t.address),
  ).length;
  if (unknownWithFreeze > 0) {
    score -= unknownWithFreeze * 8;
    reasons.push("Freeze authority active on an unverified mint");
  }
  if (signals.quoteQuality === 2) {
    score += 8;
    reasons.push("Quote-to-quote pair");
  }
  score = clamp(score, 0, 100);
  const blocked =
    (signals.verifiedTokens === 0 && signals.minHolders < 300) ||
    (unknownWithFreeze === 2 && signals.minHolders < 1_000);
  const status: TokenSafety["status"] = blocked ? "blocked" : score >= 72 ? "safe" : score >= 52 ? "watch" : "watch";
  return { status, score: round(score, 0), reasons, checked: false };
}

export interface ExternalSafety {
  status?: TokenSafety["status"];
  score?: number;
  reasons?: string[];
  rugged?: boolean;
}

export function mergeSafety(base: TokenSafety, external?: ExternalSafety | null): TokenSafety {
  if (!external) return base;
  let status = base.status;
  let score = base.score;
  const reasons = [...base.reasons, ...(external.reasons ?? [])];
  if (external.rugged) {
    status = "blocked";
    score = 0;
  } else if (typeof external.score === "number") {
    const normalized = external.score <= 10 ? external.score * 10 : external.score;
    if (normalized >= 80) score = Math.max(score, 82);
    else if (normalized < 35) score = Math.min(score, 45);
  }
  if (external.status === "blocked") {
    status = "blocked";
    score = Math.min(score, 20);
  }
  if (status !== "blocked") {
    status = score >= 72 ? "safe" : "watch";
  }
  return { status, score: round(score, 0), reasons, checked: true };
}

export interface AnalyzeOptions {
  risk?: Partial<RiskSettings>;
  candles?: OhlcvCandle[];
  safety?: ExternalSafety | null;
  now?: number;
}

function deriveActiveBin(price: number, binStep: number): number {
  if (binStep <= 0 || price <= 0) return 0;
  return Math.round(Math.log(price) / Math.log(1 + binStep / 10_000));
}

export function priceRangeFromWidth(price: number, widthPct: number): { lowerPrice: number; upperPrice: number } {
  const half = clamp(widthPct, 0.2, 95) / 100 / 2;
  return {
    lowerPrice: price * (1 - half),
    upperPrice: price * (1 + half),
  };
}

export function recommendedRange(
  pool: PoolSnapshot,
  widthPct: number,
  strategy: StrategyName,
): RecommendedRange {
  const width = clamp(widthPct, 0.4, 90);
  let { lowerPrice, upperPrice } = priceRangeFromWidth(pool.currentPrice, width);
  if (strategy === "Curve") {
    const center = pool.currentPrice;
    const half = (upperPrice - lowerPrice) / 2;
    lowerPrice = Math.max(center - half * 0.9, center * 0.0001);
    upperPrice = center + half * 0.9;
  }
  if (pool.binStep > 0) {
    const lowerBins = Math.ceil(
      Math.log(lowerPrice / pool.currentPrice) / Math.log(1 + pool.binStep / 10_000),
    );
    const upperBins = Math.floor(
      Math.log(upperPrice / pool.currentPrice) / Math.log(1 + pool.binStep / 10_000),
    );
    const activeBin = deriveActiveBin(pool.currentPrice, pool.binStep);
    const lowerBin = activeBin + Math.min(-1, lowerBins);
    const upperBin = activeBin + Math.max(1, upperBins);
    return {
      lowerBin,
      upperBin,
      lowerPrice: pool.currentPrice * (1 + pool.binStep / 10_000) ** lowerBins,
      upperPrice: pool.currentPrice * (1 + pool.binStep / 10_000) ** upperBins,
      widthBins: Math.max(2, upperBin - lowerBin),
      widthPct: width,
    };
  }
  return {
    lowerBin: 0,
    upperBin: 0,
    lowerPrice,
    upperPrice,
    widthBins: 0,
    widthPct: width,
  };
}

export function recommendStrategy(volatilityPct: number, stablePair: boolean): StrategyName {
  if (stablePair || volatilityPct < 1.8) return "Curve";
  if (volatilityPct < 7) return "Spot";
  return "BidAsk";
}

export function rangeConcentrationMultiplier(widthPct: number, volatilityPct: number): number {
  const relative = clamp(widthPct, 0.5, 100);
  const vol = clamp(volatilityPct, 0.5, 60);
  return clamp((vol * 0.45) / relative, 0.15, 2.4);
}

function scoreYield(feeAprPct: number): number {
  const capped = clamp(feeAprPct, 0, 5_000);
  return clamp((Math.log10(1 + capped) / Math.log10(1 + 800)) * 100, 0, 100);
}

function scoreDepth(tvlUsd: number): number {
  return clamp(
    ((Math.log10(Math.max(1, tvlUsd)) - Math.log10(25_000)) /
      (Math.log10(20_000_000) - Math.log10(25_000))) *
      100,
    0,
    100,
  );
}

function scoreAge(ageHours: number): number {
  return clamp((Math.log10(1 + ageHours) / Math.log10(1 + 24 * 90)) * 100, 0, 100);
}

export function computeRisk(input: {
  pool: PoolSnapshot;
  safety: TokenSafety;
  signals: PoolSignals;
  volatilityPct: number;
}): { score: number; flags: RiskFlag[] } {
  const { pool, safety, signals, volatilityPct } = input;
  const flags: RiskFlag[] = [];
  let risk = 18;
  if (safety.status === "blocked") {
    risk += 55;
    flags.push({ code: "token_blocked", label: "Token safety check failed", severity: "critical" });
  } else if (safety.status === "watch") {
    risk += 14 + (72 - Math.min(72, safety.score)) * 0.4;
    flags.push({ code: "token_watch", label: "Token requires extra due diligence", severity: "warning" });
  }
  if (signals.ageHours < 6) {
    risk += 24;
    flags.push({ code: "new_pool", label: "Pool is less than 6 hours old", severity: "critical" });
  } else if (signals.ageHours < 24) {
    risk += 14;
    flags.push({ code: "young_pool", label: "Pool is less than 24 hours old", severity: "warning" });
  } else if (signals.ageHours < 72) {
    risk += 6;
  }
  if (pool.tvlUsd < 50_000) {
    risk += 18;
    flags.push({ code: "thin_tvl", label: "Thin pool liquidity", severity: "critical" });
  } else if (pool.tvlUsd < 150_000) {
    risk += 9;
    flags.push({ code: "low_tvl", label: "Below preferred TVL", severity: "warning" });
  }
  if (signals.verifiedTokens === 0) {
    risk += 9;
    flags.push({ code: "unverified_mints", label: "Unverified token mints", severity: "warning" });
  }
  if (signals.minHolders < 250) {
    risk += 12;
    flags.push({ code: "holder_risk", label: "Very small holder base", severity: "critical" });
  } else if (signals.minHolders < 1_000) {
    risk += 6;
  }
  if (pool.feeTvl24hPct > 35 && signals.ageHours < 48) {
    risk += 12;
    flags.push({ code: "yield_anomaly", label: "Unsustainably high fresh yield", severity: "warning" });
  }
  if (signals.volumeToTvl > 12) {
    risk += 8;
    flags.push({ code: "volume_anomaly", label: "Volume is extreme versus TVL", severity: "info" });
  }
  if (signals.volumeToTvl < 0.03) {
    risk += 10;
    flags.push({ code: "low_turnover", label: "Low trading turnover", severity: "warning" });
  }
  if (volatilityPct > 18) {
    risk += 12;
    flags.push({ code: "high_volatility", label: "High realised volatility", severity: "warning" });
  } else if (volatilityPct === 0) {
    risk += 4;
    flags.push({ code: "no_price_history", label: "Limited price history", severity: "info" });
  }
  risk -= clamp((pool.tvlUsd / 5_000_000) * 8, 0, 8);
  return { score: round(clamp(risk, 0, 100), 0), flags };
}

export function analyzePool(pool: PoolSnapshot, options: AnalyzeOptions = {}): PoolAnalysis {
  const signals = poolSignals(pool);
  const volStats =
    options.candles && options.candles.length >= 3
      ? calculateVolatility(options.candles)
      : {
          dailyVolPct: clamp(3 + Math.log10(1 + signals.volumeToTvl) * 5, 3, 18),
          trendPct: 0,
          maxDrawdownPct: 0,
          candles: 0,
        };
  const stablePair = signals.quoteQuality === 2;
  const strategy = recommendStrategy(volStats.dailyVolPct, stablePair);
  const autoWidth =
    signals.quoteQuality === 2
      ? clamp(volStats.dailyVolPct * 0.9, 1.5, 8)
      : clamp(volStats.dailyVolPct * 1.35, 5, 55);
  const safety = mergeSafety(baseSafety(pool), options.safety);
  const risk = computeRisk({
    pool,
    safety,
    signals,
    volatilityPct: volStats.dailyVolPct,
  });
  const range = recommendedRange(pool, autoWidth, strategy);
  const concentration = rangeConcentrationMultiplier(autoWidth, volStats.dailyVolPct);
  const projectedFeeApr = pool.feeAprPct * concentration;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (pool.feeAprPct >= 30) reasons.push(`Live 24h fees annualise to ${round(pool.feeAprPct, 0)}% of TVL`);
  else if (pool.feeAprPct > 0) reasons.push(`Fee/TVL supports a ${round(pool.feeAprPct, 0)}% annualised rate`);
  if (signals.consistency >= 65) reasons.push("Fee production is consistent across time windows");
  if (pool.tvlUsd >= 1_000_000) reasons.push("Deep liquidity reduces execution and exit risk");
  if (safety.status === "safe") reasons.push("Mint and holder checks look healthy");
  if (signals.quoteQuality >= 1) reasons.push("Includes a major quote asset");
  if (volStats.candles === 0) warnings.push("Range uses an estimated volatility regime until OHLCV is loaded");

  const yieldScore = scoreYield(pool.feeAprPct);
  const depthScore = scoreDepth(pool.tvlUsd);
  const ageScore = scoreAge(signals.ageHours);
  const volumeScore = clamp((Math.log10(1 + signals.volumeToTvl) / Math.log10(1 + 5)) * 100, 0, 100);
  const safetyScore = safety.status === "blocked" ? 0 : safety.score;
  const trendPenalty = signals.feeTrend > 4 && signals.ageHours < 48 ? 8 : 0;
  let score =
    yieldScore * 0.31 +
    safetyScore * 0.22 +
    depthScore * 0.16 +
    signals.consistency * 0.11 +
    ageScore * 0.1 +
    volumeScore * 0.1 -
    risk.score * 0.34 -
    trendPenalty;
  score = round(clamp(score, 0, 100), 1);

  const confidence = clamp(
    45 +
      (volStats.candles >= 24 ? 25 : volStats.candles > 0 ? 12 : 0) +
      (safety.checked ? 15 : 0) +
      (signals.ageHours >= 72 ? 10 : 0) +
      (pool.tvlUsd >= 250_000 ? 5 : 0),
    20,
    98,
  );

  if (risk.flags.some((flag) => flag.severity === "critical")) {
    warnings.push("Critical risk flag present — autopilot will not enter this pool");
  }

  return {
    pool,
    score,
    riskScore: risk.score,
    confidence,
    feeAprPct: round(pool.feeAprPct, 2),
    netAprPct: round(projectedFeeApr + pool.farmAprPct, 2),
    volatilityPct: volStats.dailyVolPct,
    recommendedStrategy: strategy,
    range,
    reasons,
    warnings,
    riskFlags: risk.flags,
    signals,
    safety,
    updatedAt: options.now ?? Date.now(),
  };
}

export interface EligibilityOptions {
  risk: RiskSettings;
  botConfig?: {
    minTvlUsd: number;
    minScore: number;
    minFeeAprPct: number;
  };
}

export function eligibilityFailures(analysis: PoolAnalysis, opts: EligibilityOptions): string[] {
  const failures: string[] = [];
  const { risk } = opts;
  const minTvl = Math.max(risk.minPoolTvlUsd, opts.botConfig?.minTvlUsd ?? 0);
  const minScore = Math.max(risk.minScore, opts.botConfig?.minScore ?? 0);
  const minFeeApr = opts.botConfig?.minFeeAprPct ?? 0;
  if (analysis.pool.tvlUsd < minTvl) failures.push("Pool TVL below minimum");
  if (analysis.signals.ageHours < risk.minPoolAgeHours) failures.push("Pool is too young");
  if (analysis.signals.minHolders < risk.minTokenHolders) failures.push("Token holder base is too small");
  if (analysis.riskScore > risk.maxRiskScore) failures.push("Risk score exceeds profile limit");
  if (analysis.score < minScore) failures.push("Opportunity score below minimum");
  if (analysis.feeAprPct < minFeeApr) failures.push("Fee APR below bot threshold");
  if (!isQuotePool(analysis.pool)) failures.push("Pool has no major USD quote asset");
  if (risk.rejectUnverifiedTokens && analysis.signals.verifiedTokens === 0) {
    failures.push("Unverified mints blocked by risk profile");
  }
  if (analysis.safety.status === "blocked") failures.push("Token safety check failed");
  const critical = analysis.riskFlags.some((flag) => flag.severity === "critical");
  if (critical) failures.push("Critical risk flag");
  return failures;
}

export function strategySlug(strategy: StrategyName): "spot" | "curve" | "bidask" {
  if (strategy === "BidAsk") return "bidask";
  if (strategy === "Curve") return "curve";
  return "spot";
}
