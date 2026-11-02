import type { OhlcvCandle } from "@/lib/types";

export type TrendDirection = "up" | "down" | "sideways";

export interface PriceLevels {
  support: number | null;
  resistance: number | null;
}

export interface TechnicalRead {
  candles: number;
  trend: TrendDirection;
  trendPct: number | null;
  changePct: number | null;
  rsi14: number | null;
  atrPct: number | null;
  support: number | null;
  resistance: number | null;
  supportDistancePct: number | null;
  resistanceDistancePct: number | null;
  volumeTrendPct: number | null;
  windowHigh: number | null;
  windowLow: number | null;
  lastClose: number | null;
  trendWindow: number;
}

export function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= period) sum -= values[index - period];
    if (index >= period - 1) out[index] = sum / period;
  }
  return out;
}

export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const weight = 2 / (period + 1);
  let sum = 0;
  for (let index = 0; index < period; index += 1) sum += values[index];
  let previous = sum / period;
  out[period - 1] = previous;
  for (let index = period; index < values.length; index += 1) {
    previous = values[index] * weight + previous * (1 - weight);
    out[index] = previous;
  }
  return out;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let averageGain = gain / period;
  let averageLoss = loss / period;
  for (let index = period + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (averageGain === 0 && averageLoss === 0) return 50;
  if (averageLoss === 0) return 100;
  if (averageGain === 0) return 0;
  const relative = averageGain / averageLoss;
  return 100 - 100 / (1 + relative);
}

export function atrPercent(candles: OhlcvCandle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const ranges: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousClose = candles[index - 1].close;
    ranges.push(
      Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose),
      ),
    );
  }
  const window = ranges.slice(-period);
  const atr = window.reduce((sum, value) => sum + value, 0) / window.length;
  const lastClose = candles[candles.length - 1].close;
  if (!(lastClose > 0)) return null;
  return (atr / lastClose) * 100;
}

export function linearTrendPct(values: number[], lookback = 72): number | null {
  const slice = values.slice(-lookback);
  if (slice.length < 8) return null;
  const count = slice.length;
  const meanX = (count - 1) / 2;
  const meanY = slice.reduce((sum, value) => sum + value, 0) / count;
  if (!(meanY > 0)) return null;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < count; index += 1) {
    const dx = index - meanX;
    numerator += dx * (slice[index] - meanY);
    denominator += dx * dx;
  }
  if (denominator === 0) return null;
  const slope = numerator / denominator;
  return ((slope * (count - 1)) / meanY) * 100;
}

export function swingLevels(candles: OhlcvCandle[], lookback = 120): PriceLevels {
  if (!candles.length) return { support: null, resistance: null };
  const slice = candles.slice(-lookback);
  const price = slice[slice.length - 1].close;
  const lows: number[] = [];
  const highs: number[] = [];
  for (let index = 2; index < slice.length - 2; index += 1) {
    const candle = slice[index];
    if (
      candle.low <= slice[index - 1].low &&
      candle.low <= slice[index - 2].low &&
      candle.low <= slice[index + 1].low &&
      candle.low <= slice[index + 2].low
    ) {
      lows.push(candle.low);
    }
    if (
      candle.high >= slice[index - 1].high &&
      candle.high >= slice[index - 2].high &&
      candle.high >= slice[index + 1].high &&
      candle.high >= slice[index + 2].high
    ) {
      highs.push(candle.high);
    }
  }
  const below = lows.filter((value) => value < price * 0.9995);
  const above = highs.filter((value) => value > price * 1.0005);
  const support = below.length
    ? Math.max(...below)
    : Math.min(...slice.map((candle) => candle.low));
  const resistance = above.length
    ? Math.min(...above)
    : Math.max(...slice.map((candle) => candle.high));
  return {
    support: support < price ? support : null,
    resistance: resistance > price ? resistance : null,
  };
}

export function volumeTrendPct(candles: OhlcvCandle[], window = 20): number | null {
  if (candles.length < 6) return null;
  const span = Math.min(window, Math.floor(candles.length / 2));
  if (span < 3) return null;
  const recent = candles.slice(-span);
  const previous = candles.slice(-span * 2, -span);
  const average = (list: OhlcvCandle[]) =>
    list.length ? list.reduce((sum, candle) => sum + candle.volume, 0) / list.length : 0;
  const previousAverage = average(previous);
  if (!(previousAverage > 0)) return null;
  return (average(recent) / previousAverage - 1) * 100;
}

export function analyzeCandles(candles: OhlcvCandle[]): TechnicalRead {
  const usable = candles.filter(
    (candle) => Number.isFinite(candle.close) && candle.close > 0 && Number.isFinite(candle.high),
  );
  if (usable.length < 2) {
    return {
      candles: usable.length,
      trend: "sideways",
      trendPct: null,
      changePct: null,
      rsi14: null,
      atrPct: null,
      support: null,
      resistance: null,
      supportDistancePct: null,
      resistanceDistancePct: null,
      volumeTrendPct: null,
      windowHigh: null,
      windowLow: null,
      lastClose: usable.length ? usable[usable.length - 1].close : null,
      trendWindow: 0,
    };
  }
  const closes = usable.map((candle) => candle.close);
  const lastClose = closes[closes.length - 1];
  const firstOpen = usable[0].open > 0 ? usable[0].open : closes[0];
  const trendWindow = Math.min(72, usable.length);
  const trendPct = linearTrendPct(closes, trendWindow);
  const atr = atrPercent(usable);
  const threshold = Math.max(0.35, (atr ?? 0) * 0.75);
  const trend: TrendDirection =
    trendPct === null ? "sideways" : trendPct > threshold ? "up" : trendPct < -threshold ? "down" : "sideways";
  const levels = swingLevels(usable);
  return {
    candles: usable.length,
    trend,
    trendPct,
    changePct: firstOpen > 0 ? (lastClose / firstOpen - 1) * 100 : null,
    rsi14: rsi(closes),
    atrPct: atr,
    support: levels.support,
    resistance: levels.resistance,
    supportDistancePct:
      levels.support === null ? null : ((lastClose - levels.support) / lastClose) * 100,
    resistanceDistancePct:
      levels.resistance === null ? null : ((levels.resistance - lastClose) / lastClose) * 100,
    volumeTrendPct: volumeTrendPct(usable),
    windowHigh: Math.max(...usable.map((candle) => candle.high)),
    windowLow: Math.min(...usable.map((candle) => candle.low)),
    lastClose,
    trendWindow,
  };
}

export function rsiLabel(value: number | null): "Overbought" | "Oversold" | "Neutral" | "No data" {
  if (value === null) return "No data";
  if (value >= 70) return "Overbought";
  if (value <= 30) return "Oversold";
  return "Neutral";
}

export function trendLabel(value: TrendDirection): "Uptrend" | "Downtrend" | "Sideways" {
  if (value === "up") return "Uptrend";
  if (value === "down") return "Downtrend";
  return "Sideways";
}
