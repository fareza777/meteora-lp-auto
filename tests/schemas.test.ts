import { describe, expect, it } from "vitest";
import {
  backtestSchema,
  botConfigSchema,
  botPatchSchema,
  exitAllSchema,
  manualOpenSchema,
  notificationsSchema,
  riskSchema,
  telegramTokenSchema,
} from "@/lib/schemas";
import { createDefaultBotConfig, createDefaultSettings } from "@/lib/defaults";

describe("riskSchema", () => {
  it("accepts every shipped risk profile", () => {
    const defaults = createDefaultSettings();
    expect(riskSchema.safeParse(defaults.risk).success).toBe(true);
    expect(riskSchema.parse(defaults.risk)).toEqual(defaults.risk);
  });

  it("rejects unsafe or impossible limits", () => {
    const risk = createDefaultSettings().risk;
    expect(riskSchema.safeParse({ ...risk, maxCapitalPerPoolPct: 0 }).success).toBe(false);
    expect(riskSchema.safeParse({ ...risk, maxCapitalPerPoolPct: 150 }).success).toBe(false);
    expect(riskSchema.safeParse({ ...risk, maxOpenPositions: 0 }).success).toBe(false);
    expect(riskSchema.safeParse({ ...risk, maxOpenPositions: 21 }).success).toBe(false);
    expect(riskSchema.safeParse({ ...risk, maxSlippageBps: 5 }).success).toBe(false);
    expect(riskSchema.safeParse({ ...risk, maxDrawdownPct: 0.1 }).success).toBe(false);
    expect(riskSchema.safeParse({ ...risk, minPoolTvlUsd: 1_000 }).success).toBe(false);
    expect(riskSchema.safeParse({ ...risk, maxOpenPositions: 3.5 }).success).toBe(false);
  });
});

describe("bot schemas", () => {
  it("accepts a default bot config and rejects empty protocols", () => {
    const config = createDefaultBotConfig("balanced");
    expect(botConfigSchema.safeParse(config).success).toBe(true);
    expect(botConfigSchema.safeParse({ ...config, protocols: [] }).success).toBe(false);
    expect(botConfigSchema.safeParse({ ...config, intervalSeconds: 5 }).success).toBe(false);
    expect(botConfigSchema.safeParse({ ...config, rangeWidthPct: 100 }).success).toBe(false);
  });

  it("allows partial patches", () => {
    expect(botPatchSchema.safeParse({ status: "running" }).success).toBe(true);
    expect(
      botPatchSchema.safeParse({ config: { capitalPerPositionUsd: 1_000, compound: false } }).success,
    ).toBe(true);
    expect(botPatchSchema.safeParse({ mode: "real" }).success).toBe(false);
    expect(botPatchSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("backtestSchema", () => {
  const valid = {
    protocol: "dlmm",
    poolAddress: "HZwqbW8bW4g3m9hA7kS3g5Ef9tNwJ2pQxP1jXe4m3RtA",
    strategy: "auto",
    days: 14,
    timeframe: "1h",
    capitalUsd: 2_500,
    rangeWidthPct: 12,
    feeCaptureRatio: 0.75,
    rebalanceOutOfRange: true,
    rebalanceCooldownHours: 6,
    stopLossPct: 15,
    takeProfitPct: 50,
    costBpsPerRebalance: 30,
  };

  it("accepts a valid backtest request", () => {
    expect(backtestSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unsupported windows and values", () => {
    expect(backtestSchema.safeParse({ ...valid, days: 2 }).success).toBe(false);
    expect(backtestSchema.safeParse({ ...valid, days: 61 }).success).toBe(false);
    expect(backtestSchema.safeParse({ ...valid, timeframe: "5m" }).success).toBe(false);
    expect(backtestSchema.safeParse({ ...valid, capitalUsd: 50 }).success).toBe(false);
    expect(backtestSchema.safeParse({ ...valid, feeCaptureRatio: 0 }).success).toBe(false);
    expect(backtestSchema.safeParse({ ...valid, poolAddress: "short" }).success).toBe(false);
  });
});

describe("request schemas", () => {
  it("validates manual opens and exits", () => {
    expect(manualOpenSchema.safeParse({ protocol: "damm-v2", address: "x".repeat(44), mode: "paper" }).success).toBe(
      true,
    );
    expect(manualOpenSchema.safeParse({ protocol: "dlmm", address: "x".repeat(44), mode: "live" }).success).toBe(true);
    expect(manualOpenSchema.safeParse({ protocol: "dlmm", address: "x".repeat(44), mode: "sandbox" }).success).toBe(
      false,
    );
    expect(exitAllSchema.safeParse({ mode: "paper" }).success).toBe(true);
    expect(exitAllSchema.safeParse({ mode: "everything" }).success).toBe(false);
  });

  it("validates notification and telegram payloads", () => {
    const settings = createDefaultSettings().notifications;
    expect(notificationsSchema.safeParse(settings).success).toBe(true);
    expect(notificationsSchema.safeParse({ ...settings, chatId: "x".repeat(65) }).success).toBe(false);
    expect(telegramTokenSchema.safeParse({ token: null }).success).toBe(true);
    expect(telegramTokenSchema.safeParse({ token: "short" }).success).toBe(false);
    expect(telegramTokenSchema.safeParse({ token: "123456789:AAH-valid-token-value" }).success).toBe(true);
  });
});
