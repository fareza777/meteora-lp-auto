import { describe, expect, it } from "vitest";
import {
  analyzeCandles,
  atrPercent,
  emaSeries,
  linearTrendPct,
  rsi,
  rsiLabel,
  smaSeries,
  swingLevels,
  trendLabel,
  volumeTrendPct,
} from "@/lib/analytics/technical";
import type { OhlcvCandle } from "@/lib/types";

function candle(
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000,
): OhlcvCandle {
  return { timestamp: 1_700_000_000_000 + index * 3_600_000, open, high, low, close, volume };
}

function series(closes: number[], spread = 1): OhlcvCandle[] {
  return closes.map((close, index) =>
    candle(index, close, close + spread, close - spread, close),
  );
}

describe("smaSeries", () => {
  it("aligns the first value with the period end", () => {
    const values = smaSeries([1, 2, 3, 4, 5], 3);
    expect(values).toEqual([null, null, 2, 3, 4]);
  });

  it("returns all nulls when there is not enough data", () => {
    expect(smaSeries([1, 2], 3)).toEqual([null, null]);
  });
});

describe("emaSeries", () => {
  it("seeds with the simple average and then follows the weight", () => {
    const values = emaSeries([1, 2, 3, 4, 5], 3);
    expect(values[0]).toBeNull();
    expect(values[1]).toBeNull();
    expect(values[2]).toBe(2);
    expect(values[3]).toBeCloseTo(3, 6);
    expect(values[4]).toBeCloseTo(4, 6);
  });
});

describe("rsi", () => {
  it("reads 100 for a monotonic rise and 0 for a monotonic fall", () => {
    const rising = Array.from({ length: 30 }, (_, index) => 100 + index);
    const falling = Array.from({ length: 30 }, (_, index) => 130 - index);
    expect(rsi(rising)).toBe(100);
    expect(rsi(falling)).toBe(0);
  });

  it("reads 50 for a flat market and null without enough data", () => {
    expect(rsi(new Array(20).fill(42))).toBe(50);
    expect(rsi([1, 2, 3])).toBeNull();
  });
});

describe("atrPercent", () => {
  it("scales the average true range to the last close", () => {
    const candles = series(Array.from({ length: 20 }, () => 100));
    expect(atrPercent(candles)).toBeCloseTo(2, 6);
  });

  it("returns null for short windows", () => {
    expect(atrPercent(series([100, 101]))).toBeNull();
  });
});

describe("linearTrendPct", () => {
  it("is positive for a rise and negative for a fall", () => {
    const up = linearTrendPct(Array.from({ length: 40 }, (_, index) => 100 + index * 2));
    const down = linearTrendPct(Array.from({ length: 40 }, (_, index) => 200 - index * 2));
    expect(up).toBeGreaterThan(20);
    expect(down).toBeLessThan(-20);
  });

  it("is near zero for a flat series", () => {
    expect(linearTrendPct(new Array(30).fill(100))).toBeCloseTo(0, 6);
  });
});

describe("swingLevels", () => {
  it("picks the nearest swing levels around the current price", () => {
    const closes = [100, 102, 104, 106, 108, 106, 104, 102, 100, 98, 100, 102, 104, 106];
    const levels = swingLevels(series(closes, 0.5));
    expect(levels.support).not.toBeNull();
    expect(levels.resistance).not.toBeNull();
    expect(levels.support!).toBeLessThan(106);
    expect(levels.resistance!).toBeGreaterThan(106);
  });

  it("returns no resistance when price sits at the window high", () => {
    const closes = [100, 101, 102, 103, 104, 105, 106];
    const candles = closes.map((close, index) =>
      candle(index, close, close, close - 0.2, close),
    );
    const levels = swingLevels(candles);
    expect(levels.resistance).toBeNull();
    expect(levels.support).not.toBeNull();
  });

  it("handles an empty input", () => {
    expect(swingLevels([])).toEqual({ support: null, resistance: null });
  });
});

describe("volumeTrendPct", () => {
  it("reports expansion when the recent window trades heavier", () => {
    const candles = [
      ...Array.from({ length: 20 }, (_, index) => candle(index, 100, 101, 99, 100, 1000)),
      ...Array.from({ length: 20 }, (_, index) => candle(index + 20, 100, 101, 99, 100, 2000)),
    ];
    expect(volumeTrendPct(candles)).toBeCloseTo(100, 6);
  });

  it("returns null when the prior window is empty", () => {
    const candles = Array.from({ length: 6 }, (_, index) =>
      candle(index, 100, 101, 99, 100, index < 3 ? 0 : 500),
    );
    expect(volumeTrendPct(candles)).toBeNull();
  });
});

describe("analyzeCandles", () => {
  it("classifies a strong advance as an uptrend with levels around price", () => {
    const closes = Array.from({ length: 60 }, (_, index) => 100 + index);
    const read = analyzeCandles(series(closes, 0.8));
    expect(read.trend).toBe("up");
    expect(read.trendPct).toBeGreaterThan(0);
    expect(read.changePct).toBeGreaterThan(0);
    expect(read.lastClose).toBe(159);
    expect(read.atrPct).not.toBeNull();
    expect(read.support).not.toBeNull();
    expect(read.rsi14).toBe(100);
  });

  it("classifies a slow decline as a downtrend", () => {
    const closes = Array.from({ length: 60 }, (_, index) => 200 - index);
    const read = analyzeCandles(series(closes, 0.8));
    expect(read.trend).toBe("down");
    expect(read.changePct).toBeLessThan(0);
  });

  it("returns a neutral read with no data", () => {
    const read = analyzeCandles([]);
    expect(read.trend).toBe("sideways");
    expect(read.lastClose).toBeNull();
    expect(read.rsi14).toBeNull();
  });
});

describe("labels", () => {
  it("maps RSI thresholds", () => {
    expect(rsiLabel(75)).toBe("Overbought");
    expect(rsiLabel(25)).toBe("Oversold");
    expect(rsiLabel(55)).toBe("Neutral");
    expect(rsiLabel(null)).toBe("No data");
  });

  it("maps trend directions", () => {
    expect(trendLabel("up")).toBe("Uptrend");
    expect(trendLabel("down")).toBe("Downtrend");
    expect(trendLabel("sideways")).toBe("Sideways");
  });
});
