import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BacktestConfig } from "@/lib/types";
import { runBacktest } from "@/lib/backtest/engine";
import { hourlyCandles, makePool, steadyCandles } from "./helpers/fixtures";

const meteora = vi.hoisted(() => ({ getPoolDetail: vi.fn(), getOhlcv: vi.fn() }));
vi.mock("@/lib/market/meteora", () => meteora);

const baseConfig: Omit<BacktestConfig, "poolName"> = {
  protocol: "dlmm",
  poolAddress: makePool().address,
  strategy: "auto",
  days: 7,
  timeframe: "1h",
  capitalUsd: 10_000,
  rangeWidthPct: 12,
  feeCaptureRatio: 0.8,
  rebalanceOutOfRange: false,
  rebalanceCooldownHours: 8,
  stopLossPct: 5,
  takeProfitPct: 100,
  costBpsPerRebalance: 0,
};

beforeEach(() => {
  meteora.getPoolDetail.mockReset();
  meteora.getOhlcv.mockReset();
});

describe("runBacktest", () => {
  it("stops out of a drawdown and reports an honest curve", async () => {
    const pool = makePool();
    const closes = [...Array.from({ length: 12 }, () => 200), 170, 168, 166, 164];
    meteora.getPoolDetail.mockResolvedValue(pool);
    meteora.getOhlcv.mockResolvedValue(hourlyCandles(closes));

    const { config, result } = await runBacktest(baseConfig);

    expect(config.poolName).toBe("SOL-USDC");
    expect(result.candles).toBe(closes.length);
    expect(result.equityCurve).toHaveLength(closes.length);
    expect(result.trades[0]?.reason).toBe("Stop loss");
    expect(result.trades[0]?.closedAt).not.toBeNull();
    expect(result.finalEquity).toBeLessThan(baseConfig.capitalUsd);
    expect(result.totalReturnPct).toBeLessThan(0);
    expect(result.maxDrawdownPct).toBeGreaterThan(0);
    expect(result.winRate).toBe(0);
    expect(Number.isFinite(result.sharpe)).toBe(true);
    expect(result.assumptions.length).toBeGreaterThan(3);
    expect(Math.abs((result.equityCurve.at(-1)?.equity ?? 0) - result.finalEquity)).toBeLessThan(0.01);
  });

  it("accrues fees while price stays inside the range", async () => {
    meteora.getPoolDetail.mockResolvedValue(makePool());
    meteora.getOhlcv.mockResolvedValue(steadyCandles(96));

    const { result } = await runBacktest({
      ...baseConfig,
      rangeWidthPct: 30,
      feeCaptureRatio: 1,
      stopLossPct: 90,
      takeProfitPct: 500,
    });

    expect(result.feesUsd).toBeGreaterThan(0);
    expect(result.finalEquity).toBeGreaterThan(baseConfig.capitalUsd);
    expect(result.costsUsd).toBe(0);
    expect(result.timeInRangePct).toBeGreaterThan(90);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.closedAt).toBeNull();
    expect(result.trades[0]?.reason).toBe("Open at end of test");
  });

  it("rebalances after price exits the range", async () => {
    meteora.getPoolDetail.mockResolvedValue(makePool());
    meteora.getOhlcv.mockResolvedValue(
      hourlyCandles(Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? 200 : 175))),
    );

    const { result } = await runBacktest({
      ...baseConfig,
      rangeWidthPct: 10,
      rebalanceOutOfRange: true,
      rebalanceCooldownHours: 1,
      stopLossPct: 80,
      takeProfitPct: 500,
    });

    expect(result.rebalances).toBeGreaterThan(1);
    expect(result.trades.some((trade) => trade.reason === "Out of range rebalance")).toBe(true);
    expect(result.trades.length).toBeGreaterThan(2);
    expect(result.costsUsd).toBeGreaterThanOrEqual(0);
  });

  it("charges rebalance costs when configured", async () => {
    meteora.getPoolDetail.mockResolvedValue(makePool());
    meteora.getOhlcv.mockResolvedValue(
      hourlyCandles(Array.from({ length: 30 }, (_, index) => (index % 2 === 0 ? 200 : 175))),
    );
    const { result } = await runBacktest({
      ...baseConfig,
      rangeWidthPct: 10,
      rebalanceOutOfRange: true,
      rebalanceCooldownHours: 1,
      stopLossPct: 80,
      takeProfitPct: 500,
      costBpsPerRebalance: 30,
    });
    expect(result.costsUsd).toBeGreaterThan(0);
    expect(result.finalEquity).toBeLessThan(baseConfig.capitalUsd * 1.05);
  });

  it("refuses pools without a USD quote", async () => {
    meteora.getPoolDetail.mockResolvedValue(
      makePool({
        tokenX: { ...makePool().tokenX, symbol: "BONK", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
        tokenY: { ...makePool().tokenY, symbol: "WIF", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
      }),
    );
    await expect(runBacktest(baseConfig)).rejects.toThrow(/no recognised USD quote asset/);
    expect(meteora.getOhlcv).not.toHaveBeenCalled();
  });

  it("requires enough price history", async () => {
    meteora.getPoolDetail.mockResolvedValue(makePool());
    meteora.getOhlcv.mockResolvedValue(hourlyCandles([200, 201, 200]));
    await expect(runBacktest(baseConfig)).rejects.toThrow(/Not enough price history/);
  });
});
