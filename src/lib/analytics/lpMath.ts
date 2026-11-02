import { clamp } from "./strategy";

/**
 * Concentrated-liquidity maths used by the paper venue.
 *
 * DLMM bins are approximated with a continuous concentrated range. This is a
 * deliberately conservative simulator: it models range exit, token conversion
 * and impermanent loss, while fees are accrued from live pool fee velocity.
 */

export interface LpEntry {
  capitalUsd: number;
  entryPrice: number;
  lowerPrice: number;
  upperPrice: number;
  quotePriceUsd: number;
}

export interface LpSides {
  x: number;
  y: number;
  xUsd: number;
  yUsd: number;
  totalUsd: number;
}

function sqrt(value: number): number {
  return Math.sqrt(Math.max(value, 0));
}

export function entrySides(entry: LpEntry): LpSides {
  const { capitalUsd, entryPrice, lowerPrice, upperPrice, quotePriceUsd } = entry;
  if (
    capitalUsd <= 0 ||
    entryPrice <= 0 ||
    lowerPrice <= 0 ||
    upperPrice <= lowerPrice ||
    quotePriceUsd <= 0
  ) {
    return { x: 0, y: 0, xUsd: 0, yUsd: 0, totalUsd: 0 };
  }
  const p = Math.min(Math.max(entryPrice, lowerPrice * 1.0000001), upperPrice * 0.9999999);
  const sp = sqrt(p);
  const sa = sqrt(lowerPrice);
  const sb = sqrt(upperPrice);
  const xUnit = 1 / sp - 1 / sb;
  const yUnit = sp - sa;
  if (xUnit < 0 || yUnit < 0 || (xUnit === 0 && yUnit === 0)) {
    return { x: 0, y: 0, xUsd: 0, yUsd: 0, totalUsd: 0 };
  }
  const valueYUnits = xUnit * p + yUnit;
  if (valueYUnits <= 0) return { x: 0, y: 0, xUsd: 0, yUsd: 0, totalUsd: 0 };
  const budgetY = capitalUsd / quotePriceUsd;
  const liquidity = budgetY / valueYUnits;
  const x = liquidity * xUnit;
  const y = liquidity * yUnit;
  return {
    x,
    y,
    xUsd: x * p * quotePriceUsd,
    yUsd: y * quotePriceUsd,
    totalUsd: capitalUsd,
  };
}

export interface LpMark {
  x: number;
  y: number;
  xUsd: number;
  yUsd: number;
  liquidityValueUsd: number;
  holdValueUsd: number;
  ilUsd: number;
  inRange: boolean;
  pricePositionPct: number;
}

export function markLpPosition(entry: LpEntry, currentPrice: number): LpMark {
  const initial = entrySides(entry);
  const { lowerPrice, upperPrice, quotePriceUsd } = entry;
  if (!initial.totalUsd || currentPrice <= 0) {
    return {
      x: 0,
      y: 0,
      xUsd: 0,
      yUsd: 0,
      liquidityValueUsd: 0,
      holdValueUsd: 0,
      ilUsd: 0,
      inRange: false,
      pricePositionPct: 0,
    };
  }
  const p0 = Math.min(Math.max(entry.entryPrice, lowerPrice * 1.0000001), upperPrice * 0.9999999);
  const sp0 = sqrt(p0);
  const sa = sqrt(lowerPrice);
  const sb = sqrt(upperPrice);
  const liquidity = initial.x / (1 / sp0 - 1 / sb);

  let x = 0;
  let y = 0;
  if (currentPrice <= lowerPrice) {
    x = liquidity * (1 / sa - 1 / sb);
  } else if (currentPrice >= upperPrice) {
    y = liquidity * (sb - sa);
  } else {
    const sp = sqrt(currentPrice);
    x = liquidity * (1 / sp - 1 / sb);
    y = liquidity * (sp - sa);
  }
  const xUsd = x * currentPrice * quotePriceUsd;
  const yUsd = y * quotePriceUsd;
  const liquidityValueUsd = xUsd + yUsd;
  const holdValueUsd = initial.x * currentPrice * quotePriceUsd + initial.y * quotePriceUsd;
  const inRange = currentPrice >= lowerPrice && currentPrice <= upperPrice;
  const pricePositionPct =
    currentPrice <= lowerPrice
      ? 0
      : currentPrice >= upperPrice
        ? 100
        : ((currentPrice - lowerPrice) / (upperPrice - lowerPrice)) * 100;
  return {
    x,
    y,
    xUsd,
    yUsd,
    liquidityValueUsd,
    holdValueUsd,
    ilUsd: liquidityValueUsd - holdValueUsd,
    inRange,
    pricePositionPct,
  };
}

export function estimatePaperFeeDailyPct(pool: {
  feeTvl24hPct: number;
  fees4hUsd: number;
  fees1hUsd: number;
  tvlUsd: number;
}, rangeWidthPct: number, volatilityPct: number): number {
  const daily = Math.max(0, pool.feeTvl24hPct);
  const recent =
    pool.tvlUsd > 0 ? Math.max((pool.fees4hUsd * 6 * 100) / pool.tvlUsd, (pool.fees1hUsd * 24 * 100) / pool.tvlUsd) : 0;
  const blended = Math.min(daily, (daily * 0.6 + recent * 0.4) * 1.05);
  const relative = clamp(rangeWidthPct, 0.5, 100);
  const vol = clamp(volatilityPct, 0.5, 60);
  const concentration = clamp((vol * 0.4) / relative, 0.12, 1.8);
  const dailyPct = clamp(blended * concentration, 0, 2.5);
  return Math.round(dailyPct * 10000) / 10000;
}

export function accrueFeeUsd(input: {
  capitalUsd: number;
  feeDailyPct: number;
  elapsedMs: number;
  inRange: boolean;
}): number {
  if (!input.inRange || input.elapsedMs <= 0) return 0;
  const days = Math.min(input.elapsedMs, 15 * 60_000) / 86_400_000;
  return input.capitalUsd * (input.feeDailyPct / 100) * days;
}
