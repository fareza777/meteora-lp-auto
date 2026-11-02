import { describe, expect, it } from "vitest";
import {
  accrueFeeUsd,
  entrySides,
  estimatePaperFeeDailyPct,
  markLpPosition,
} from "@/lib/analytics/lpMath";

const base = {
  capitalUsd: 10_000,
  entryPrice: 200,
  lowerPrice: 188,
  upperPrice: 212,
  quotePriceUsd: 1,
};

describe("entrySides", () => {
  it("splits capital across both tokens and preserves the budget", () => {
    const sides = entrySides(base);
    expect(sides.x).toBeGreaterThan(0);
    expect(sides.y).toBeGreaterThan(0);
    expect(sides.xUsd).toBeGreaterThan(0);
    expect(sides.yUsd).toBeGreaterThan(0);
    expect(sides.xUsd + sides.yUsd).toBeCloseTo(base.capitalUsd, 6);
    expect(sides.totalUsd).toBe(base.capitalUsd);
  });

  it("rejects invalid ranges and budgets", () => {
    expect(entrySides({ ...base, lowerPrice: 0 })).toEqual({
      x: 0,
      y: 0,
      xUsd: 0,
      yUsd: 0,
      totalUsd: 0,
    });
    expect(entrySides({ ...base, upperPrice: base.lowerPrice }).totalUsd).toBe(0);
    expect(entrySides({ ...base, capitalUsd: 0 }).totalUsd).toBe(0);
    expect(entrySides({ ...base, quotePriceUsd: 0 }).totalUsd).toBe(0);
  });
});

describe("markLpPosition", () => {
  it("marks value at entry equal to capital with no impermanent loss", () => {
    const mark = markLpPosition(base, base.entryPrice);
    expect(mark.inRange).toBe(true);
    expect(mark.liquidityValueUsd).toBeCloseTo(base.capitalUsd, 4);
    expect(mark.ilUsd).toBeCloseTo(0, 4);
    expect(mark.pricePositionPct).toBeCloseTo(50, 4);
  });

  it("converts fully to the base token below the range", () => {
    const mark = markLpPosition(base, 150);
    expect(mark.inRange).toBe(false);
    expect(mark.x).toBeGreaterThan(0);
    expect(mark.y).toBeCloseTo(0, 8);
    expect(mark.xUsd).toBeGreaterThan(0);
    expect(mark.pricePositionPct).toBe(0);
    expect(mark.liquidityValueUsd).toBeLessThan(base.capitalUsd);
    expect(mark.ilUsd).toBeLessThan(0);
  });

  it("converts fully to the quote token above the range", () => {
    const mark = markLpPosition(base, 260);
    expect(mark.inRange).toBe(false);
    expect(mark.x).toBeCloseTo(0, 8);
    expect(mark.y).toBeGreaterThan(0);
    expect(mark.yUsd).toBeGreaterThan(0);
    expect(mark.pricePositionPct).toBe(100);
    expect(mark.ilUsd).toBeLessThan(0);
  });

  it("reports impermanent loss on both sides of the entry", () => {
    const down = markLpPosition(base, 190);
    const up = markLpPosition(base, 210);
    expect(down.ilUsd).toBeLessThanOrEqual(0);
    expect(up.ilUsd).toBeLessThanOrEqual(0);
    expect(down.pricePositionPct).toBeGreaterThan(0);
    expect(down.pricePositionPct).toBeLessThan(100);
  });

  it("returns an empty mark for broken input", () => {
    const mark = markLpPosition({ ...base, capitalUsd: 0 }, 200);
    expect(mark.liquidityValueUsd).toBe(0);
    expect(mark.inRange).toBe(false);
    expect(markLpPosition(base, 0).liquidityValueUsd).toBe(0);
  });
});

describe("estimatePaperFeeDailyPct", () => {
  const pool = {
    feeTvl24hPct: 0.8,
    fees4hUsd: 6_000,
    fees1hUsd: 1_600,
    tvlUsd: 4_000_000,
  };

  it("pays more for a concentrated range than a wide one", () => {
    const tight = estimatePaperFeeDailyPct(pool, 4, 6);
    const wide = estimatePaperFeeDailyPct(pool, 60, 6);
    expect(tight).toBeGreaterThan(wide);
    expect(wide).toBeGreaterThanOrEqual(0);
  });

  it("never exceeds the safety cap or drops below zero", () => {
    const absurd = estimatePaperFeeDailyPct(
      { feeTvl24hPct: 90, fees4hUsd: 9_000_000, fees1hUsd: 4_000_000, tvlUsd: 100_000 },
      0.1,
      60,
    );
    expect(absurd).toBeLessThanOrEqual(2.5);
    expect(absurd).toBeGreaterThan(0);
    expect(
      estimatePaperFeeDailyPct({ feeTvl24hPct: 0, fees4hUsd: 0, fees1hUsd: 0, tvlUsd: 0 }, 10, 5),
    ).toBe(0);
  });

  it("is stable for identical inputs", () => {
    expect(estimatePaperFeeDailyPct(pool, 12, 4)).toBe(estimatePaperFeeDailyPct(pool, 12, 4));
  });
});

describe("accrueFeeUsd", () => {
  it("accrues linearly for short marks", () => {
    const fiveMinutes = accrueFeeUsd({
      capitalUsd: 1_000,
      feeDailyPct: 1,
      elapsedMs: 5 * 60_000,
      inRange: true,
    });
    expect(fiveMinutes).toBeCloseTo((1_000 * 0.01 * 5) / 1_440, 8);
  });

  it("caps a single accrual at fifteen minutes", () => {
    const capped = accrueFeeUsd({
      capitalUsd: 1_000,
      feeDailyPct: 1,
      elapsedMs: 60 * 60_000,
      inRange: true,
    });
    const fifteen = accrueFeeUsd({
      capitalUsd: 1_000,
      feeDailyPct: 1,
      elapsedMs: 15 * 60_000,
      inRange: true,
    });
    expect(capped).toBe(fifteen);
  });

  it("pays nothing out of range or for non-positive elapsed time", () => {
    expect(
      accrueFeeUsd({ capitalUsd: 1_000, feeDailyPct: 1, elapsedMs: 60_000, inRange: false }),
    ).toBe(0);
    expect(
      accrueFeeUsd({ capitalUsd: 1_000, feeDailyPct: 1, elapsedMs: 0, inRange: true }),
    ).toBe(0);
    expect(
      accrueFeeUsd({ capitalUsd: 1_000, feeDailyPct: 1, elapsedMs: -500, inRange: true }),
    ).toBe(0);
  });
});
