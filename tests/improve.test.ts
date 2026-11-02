import { describe, expect, it } from "vitest";
import { analyzePool } from "@/lib/analytics/strategy";
import {
  applyGuardToBot,
  candidateCapitalUsd,
  computeImprovement,
  strategyForGuard,
} from "@/lib/bot/improve";
import { createDefaultBotConfig } from "@/lib/defaults";
import type { BotRecord, PositionRecord } from "@/lib/types";
import { balancedRisk, makePool, makePosition } from "./helpers/fixtures";

const NOW = Date.UTC(2026, 10, 2, 4, 0, 0);

function closed(overrides: Partial<PositionRecord> = {}): PositionRecord {
  return makePosition({
    status: "closed",
    closedAt: NOW - 60 * 60_000,
    updatedAt: NOW - 60 * 60_000,
    closeReason: "Manual exit",
    ...overrides,
  });
}

function bot(autoImprove = true): BotRecord {
  return {
    id: "bot-1",
    userId: "user-1",
    name: "Aurora",
    status: "running",
    mode: "paper",
    config: { ...createDefaultBotConfig("balanced"), autoImprove },
    lastRunAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function baseInput(closedPositions: PositionRecord[], overrides: Record<string, number> = {}) {
  const netPnl = closedPositions.reduce((sum, position) => sum + position.pnlUsd, 0);
  return {
    mode: "paper" as const,
    closed: closedPositions,
    risk: balancedRisk(),
    equity: 25_000 + netPnl,
    initialCapital: 25_000,
    peakEquity: 25_000,
    dayPnlPct: 0,
    now: NOW,
    autoImproveEnabled: true,
    ...overrides,
  };
}

describe("performance guard", () => {
  it("starts neutral before the first closed trade", () => {
    const state = computeImprovement(baseInput([]));
    expect(state.heat).toBe("steady");
    expect(state.sampleTrades).toBe(0);
    expect(state.capitalScale).toBe(1);
    expect(state.entryScoreFloorDelta).toBe(0);
    expect(state.blockedPools).toHaveLength(0);
    expect(state.actions[0]).toContain("learning");
  });

  it("blocks a pool after repeated stop-losses and cools the book", () => {
    const gta = closed({
      id: "loss-1",
      poolAddress: "pool-gta6",
      poolName: "GTA6-SOL",
      strategy: "BidAsk",
      pnlUsd: -431.02,
      closeReason: "Stop loss 15%",
    });
    const state = computeImprovement(baseInput([gta]));
    expect(state.heat).toBe("cooling");
    expect(state.capitalScale).toBeLessThan(1);
    expect(state.entryScoreFloorDelta).toBeGreaterThan(0);
    expect(state.blockedPools[0]?.poolName).toBe("GTA6-SOL");
    expect(state.blockedPools[0]?.blockedUntil).toBeGreaterThan(NOW);
    expect(state.blockedPools[0]?.blockReason).toContain("stop-loss");
  });

  it("blocks a repeat offender for longer than a first stop", () => {
    const first = closed({
      id: "loss-1",
      poolAddress: "pool-gta6",
      poolName: "GTA6-SOL",
      strategy: "BidAsk",
      pnlUsd: -431.02,
      closeReason: "Stop loss 15%",
      closedAt: NOW - 3 * 60 * 60_000,
      updatedAt: NOW - 3 * 60 * 60_000,
    });
    const second = closed({
      id: "loss-2",
      poolAddress: "pool-gta6",
      poolName: "GTA6-SOL",
      strategy: "BidAsk",
      pnlUsd: -399.61,
      closeReason: "Stop loss 15%",
      closedAt: NOW - 60 * 60_000,
      updatedAt: NOW - 60 * 60_000,
    });
    const state = computeImprovement(baseInput([first, second]));
    const pool = state.blockedPools[0];
    expect(pool?.stopLosses).toBe(2);
    expect(pool?.blockedUntil).toBeGreaterThanOrEqual(NOW + 46 * 60 * 60_000);
  });

  it("pauses entries after a loss streak", () => {
    const losses = [1, 2, 3, 4].map((index) =>
      closed({
        id: `loss-${index}`,
        poolAddress: "pool-xhype",
        poolName: "xHYPE-USDC",
        strategy: "BidAsk",
        pnlUsd: -400,
        closeReason: "Stop loss 15%",
        closedAt: NOW - index * 20 * 60_000,
        updatedAt: NOW - index * 20 * 60_000,
      }),
    );
    const state = computeImprovement(baseInput(losses));
    expect(state.heat).toBe("cold");
    expect(state.pauseEntries).toBe(true);
    expect(state.pauseReason).toContain("consecutive");
    expect(state.pauseUntil).toBeGreaterThan(NOW);
    expect(state.capitalScale).toBeLessThanOrEqual(0.5);
    expect(state.entryScoreFloorDelta).toBeGreaterThanOrEqual(10);
  });

  it("downgrades a losing strategy to the least-bad fallback", () => {
    const bidAskLosses = [1, 2, 3].map((index) =>
      closed({
        id: `bidask-${index}`,
        poolAddress: `pool-risk-${index}`,
        poolName: `RISK-${index}`,
        strategy: "BidAsk",
        pnlUsd: -200,
        closedAt: NOW - index * 60 * 60_000,
        updatedAt: NOW - index * 60 * 60_000,
      }),
    );
    const spotWins = [1, 2, 3].map((index) =>
      closed({
        id: `spot-${index}`,
        poolAddress: `pool-solid-${index}`,
        poolName: `SOLID-${index}`,
        strategy: "Spot",
        pnlUsd: 100,
        closedAt: NOW - (index + 4) * 60 * 60_000,
        updatedAt: NOW - (index + 4) * 60 * 60_000,
      }),
    );
    const curveWins = [1, 2, 3].map((index) =>
      closed({
        id: `curve-${index}`,
        poolAddress: `pool-stable-${index}`,
        poolName: `STABLE-${index}`,
        strategy: "Curve",
        pnlUsd: 20,
        closedAt: NOW - (index + 8) * 60 * 60_000,
        updatedAt: NOW - (index + 8) * 60 * 60_000,
      }),
    );
    const state = computeImprovement(baseInput([...bidAskLosses, ...spotWins, ...curveWins]));
    const bidask = state.strategies.find((strategy) => strategy.strategy === "BidAsk");
    expect(bidask?.status).toBe("penalized");
    expect(bidask?.adjustment).toBe(-9);
    expect(strategyForGuard("BidAsk", state)).toBe("Spot");
  });

  it("earns a small, capped amount of extra risk on a hot streak", () => {
    const wins = Array.from({ length: 6 }, (_, index) =>
      closed({
        id: `win-${index}`,
        poolAddress: "pool-sol-usdc",
        poolName: "SOL-USDC",
        strategy: "Spot",
        pnlUsd: 100,
        closedAt: NOW - (index + 1) * 60 * 60_000,
        updatedAt: NOW - (index + 1) * 60 * 60_000,
      }),
    );
    const state = computeImprovement(
      baseInput(wins, { equity: 25_600, peakEquity: 25_600 }),
    );
    expect(state.heat).toBe("hot");
    expect(state.capitalScale).toBeCloseTo(1.05, 2);
    expect(state.entryScoreFloorDelta).toBe(-2);
    expect(state.winRate).toBe(100);
  });

  it("applies thresholds and risk-scaled capital only when enabled", () => {
    const state = computeImprovement(
      baseInput([
        closed({
          poolAddress: "pool-gta6",
          poolName: "GTA6-SOL",
          strategy: "BidAsk",
          pnlUsd: -431,
          closeReason: "Stop loss 15%",
        }),
      ]),
    );
    const analysis = { ...analyzePool(makePool()), riskScore: 55 };
    const enabled = bot(true);
    const guarded = applyGuardToBot(enabled, state);
    expect(guarded.config.minScore).toBe(enabled.config.minScore + state.entryScoreFloorDelta);
    expect(guarded.config.rotationMinDelta).toBeGreaterThan(enabled.config.rotationMinDelta);
    expect(guarded.config.rebalanceOutOfRangeMinutes).toBeGreaterThan(
      enabled.config.rebalanceOutOfRangeMinutes,
    );
    expect(candidateCapitalUsd(enabled, analysis, state)).toBeLessThan(
      enabled.config.capitalPerPositionUsd,
    );

    const disabled = bot(false);
    expect(applyGuardToBot(disabled, state)).toBe(disabled);
    expect(candidateCapitalUsd(disabled, analysis, state)).toBe(
      disabled.config.capitalPerPositionUsd,
    );
  });
});
