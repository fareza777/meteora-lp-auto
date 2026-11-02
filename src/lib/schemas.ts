import { z } from "zod";

const percent = (min = 0, max = 100) => z.number().min(min).max(max);
const usd = (min = 0, max = 50_000_000) => z.number().min(min).max(max);

export const riskSchema = z.object({
  maxCapitalPerPoolPct: percent(1, 100),
  maxTotalExposurePct: percent(1, 100),
  maxOpenPositions: z.number().int().min(1).max(20),
  maxDrawdownPct: percent(0.5, 80),
  dailyLossLimitPct: percent(0.5, 50),
  stopLossPct: percent(0.5, 80),
  takeProfitPct: percent(1, 500),
  minPoolTvlUsd: usd(10_000, 100_000_000),
  minPoolAgeHours: z.number().min(0).max(720),
  minTokenHolders: z.number().int().min(0).max(1_000_000),
  minScore: percent(0, 100),
  maxRiskScore: percent(1, 100),
  maxSlippageBps: z.number().int().min(10).max(1_000),
  rejectUnverifiedTokens: z.boolean(),
  rebalanceCooldownMinutes: z.number().int().min(5).max(1_440),
  liveMaxPerTradeUsd: usd(10, 1_000_000),
  liveDailyNotionalLimitUsd: usd(10, 5_000_000),
});

export const botConfigSchema = z.object({
  protocols: z.array(z.enum(["dlmm", "damm-v2"])).min(1).max(2),
  strategy: z.enum(["auto", "spot", "curve", "bidask"]),
  riskProfile: z.enum(["conservative", "balanced", "aggressive"]),
  capitalPerPositionUsd: usd(10, 1_000_000),
  maxOpenPositions: z.number().int().min(1).max(20),
  minFeeAprPct: percent(0, 5_000),
  minTvlUsd: usd(0, 100_000_000),
  minScore: percent(0, 100),
  rangeMode: z.enum(["auto", "manual"]),
  rangeWidthPct: percent(0.4, 90),
  rebalanceOutOfRangeMinutes: z.number().int().min(1).max(1_440),
  claimIntervalMinutes: z.number().int().min(5).max(10_080),
  compound: z.boolean(),
  autoImprove: z.boolean(),
  rotationEnabled: z.boolean(),
  rotationMinDelta: z.number().min(1).max(500),
  stopLossPct: percent(0.5, 80),
  takeProfitPct: percent(1, 500),
  slippageBps: z.number().int().min(10).max(1_000),
  serviceFeeBps: z.number().int().min(0).max(500),
  intervalSeconds: z.number().int().min(20).max(86_400),
  cooldownMinutes: z.number().int().min(1).max(10_080),
  maxPriceImpactPct: percent(0.05, 20),
});

export const botPatchSchema = z.object({
  name: z.string().trim().min(1).max(48).optional(),
  status: z.enum(["running", "paused"]).optional(),
  mode: z.enum(["paper", "live"]).optional(),
  config: botConfigSchema.partial().optional(),
});

export const notificationsSchema = z.object({
  telegramEnabled: z.boolean(),
  onOpen: z.boolean(),
  onClose: z.boolean(),
  onRisk: z.boolean(),
  onError: z.boolean(),
  dailySummary: z.boolean(),
  chatId: z.string().trim().max(64),
});

export const manualOpenSchema = z.object({
  protocol: z.enum(["dlmm", "damm-v2"]),
  address: z.string().min(32).max(44),
  mode: z.enum(["paper", "live"]),
  capitalUsd: usd(10, 1_000_000).optional(),
  strategy: z.enum(["auto", "spot", "curve", "bidask"]).optional(),
  widthPct: percent(0.4, 90).optional(),
});

export const closeSchema = z.object({
  reason: z.string().trim().min(1).max(120).optional(),
});

export const exitAllSchema = z.object({
  mode: z.enum(["paper", "live"]),
  nonce: z.string().max(200).optional(),
  signature: z.string().max(200).optional(),
});

export const telegramTokenSchema = z.object({
  token: z.string().trim().min(20).max(200).nullable(),
  chatId: z.string().trim().max(64).optional(),
});

export const backtestSchema = z.object({
  protocol: z.enum(["dlmm", "damm-v2"]),
  poolAddress: z.string().min(32).max(44),
  strategy: z.enum(["auto", "spot", "curve", "bidask"]),
  days: z.number().int().min(3).max(60),
  timeframe: z.enum(["30m", "1h", "4h"]),
  capitalUsd: usd(100, 10_000_000),
  rangeWidthPct: percent(0.4, 90),
  feeCaptureRatio: z.number().min(0.05).max(1),
  rebalanceOutOfRange: z.boolean(),
  rebalanceCooldownHours: z.number().min(0.5).max(168),
  stopLossPct: percent(0.5, 80),
  takeProfitPct: percent(1, 500),
  costBpsPerRebalance: z.number().min(0).max(500),
});
