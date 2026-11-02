import type {
  BotConfig,
  NotificationSettings,
  RiskProfile,
  RiskProfileDefaults,
  UserSettings,
} from "./types";

const commonBot: BotConfig = {
  protocols: ["dlmm", "damm-v2"],
  strategy: "auto",
  riskProfile: "balanced",
  capitalPerPositionUsd: 2_500,
  maxOpenPositions: 4,
  minFeeAprPct: 18,
  minTvlUsd: 150_000,
  minScore: 62,
  rangeMode: "auto",
  rangeWidthPct: 12,
  rebalanceOutOfRangeMinutes: 45,
  claimIntervalMinutes: 720,
  compound: true,
  autoImprove: true,
  rotationEnabled: true,
  rotationMinDelta: 12,
  stopLossPct: 12,
  takeProfitPct: 45,
  slippageBps: 100,
  serviceFeeBps: 0,
  intervalSeconds: 180,
  cooldownMinutes: 30,
  maxPriceImpactPct: 0.8,
};

const profiles: Record<RiskProfile, RiskProfileDefaults> = {
  conservative: {
    risk: {
      maxCapitalPerPoolPct: 10,
      maxTotalExposurePct: 50,
      maxOpenPositions: 3,
      maxDrawdownPct: 8,
      dailyLossLimitPct: 3,
      stopLossPct: 10,
      takeProfitPct: 30,
      minPoolTvlUsd: 500_000,
      minPoolAgeHours: 72,
      minTokenHolders: 2_000,
      minScore: 70,
      maxRiskScore: 38,
      maxSlippageBps: 75,
      rejectUnverifiedTokens: true,
      rebalanceCooldownMinutes: 45,
      liveMaxPerTradeUsd: 500,
      liveDailyNotionalLimitUsd: 2_000,
    },
    bot: {
      capitalPerPositionUsd: 1_000,
      maxOpenPositions: 3,
      minFeeAprPct: 25,
      minTvlUsd: 500_000,
      minScore: 70,
      rangeMode: "auto",
      rangeWidthPct: 16,
      stopLossPct: 10,
      takeProfitPct: 30,
      slippageBps: 75,
      rotationMinDelta: 18,
    },
  },
  balanced: {
    risk: {
      maxCapitalPerPoolPct: 20,
      maxTotalExposurePct: 70,
      maxOpenPositions: 4,
      maxDrawdownPct: 15,
      dailyLossLimitPct: 6,
      stopLossPct: 15,
      takeProfitPct: 50,
      minPoolTvlUsd: 150_000,
      minPoolAgeHours: 24,
      minTokenHolders: 500,
      minScore: 62,
      maxRiskScore: 55,
      maxSlippageBps: 100,
      rejectUnverifiedTokens: false,
      rebalanceCooldownMinutes: 30,
      liveMaxPerTradeUsd: 1_000,
      liveDailyNotionalLimitUsd: 5_000,
    },
    bot: {
      capitalPerPositionUsd: 2_500,
      maxOpenPositions: 4,
      minFeeAprPct: 18,
      minTvlUsd: 150_000,
      minScore: 62,
      rangeMode: "auto",
      rangeWidthPct: 12,
      stopLossPct: 15,
      takeProfitPct: 50,
      slippageBps: 100,
      rotationMinDelta: 12,
    },
  },
  aggressive: {
    risk: {
      maxCapitalPerPoolPct: 35,
      maxTotalExposurePct: 90,
      maxOpenPositions: 6,
      maxDrawdownPct: 25,
      dailyLossLimitPct: 10,
      stopLossPct: 20,
      takeProfitPct: 80,
      minPoolTvlUsd: 75_000,
      minPoolAgeHours: 12,
      minTokenHolders: 250,
      minScore: 55,
      maxRiskScore: 72,
      maxSlippageBps: 150,
      rejectUnverifiedTokens: false,
      rebalanceCooldownMinutes: 15,
      liveMaxPerTradeUsd: 2_500,
      liveDailyNotionalLimitUsd: 10_000,
    },
    bot: {
      capitalPerPositionUsd: 4_000,
      maxOpenPositions: 6,
      minFeeAprPct: 12,
      minTvlUsd: 75_000,
      minScore: 55,
      rangeMode: "auto",
      rangeWidthPct: 8,
      stopLossPct: 20,
      takeProfitPct: 80,
      slippageBps: 150,
      rotationMinDelta: 8,
    },
  },
};

export const DEFAULT_PROFILE: RiskProfile = "balanced";

export function getProfileDefaults(profile: RiskProfile = DEFAULT_PROFILE): RiskProfileDefaults {
  return structuredClone(profiles[profile]);
}

export function createDefaultBotConfig(profile: RiskProfile = "balanced"): BotConfig {
  const defaults = getProfileDefaults(profile);
  return {
    ...structuredClone(commonBot),
    ...defaults.bot,
    riskProfile: profile,
  };
}

export function createDefaultSettings(): UserSettings {
  const risk = getProfileDefaults("balanced").risk;
  const notifications: NotificationSettings = {
    telegramEnabled: false,
    onOpen: true,
    onClose: true,
    onRisk: true,
    onError: true,
    dailySummary: true,
    chatId: "",
    hasToken: false,
  };
  return { risk, notifications };
}

export const RISK_PROFILE_COPY: Record<
  RiskProfile,
  { label: string; tldr: string; accent: string }
> = {
  conservative: {
    label: "Conservative",
    tldr: "Blue-chip pools, tighter drawdown, smaller clips.",
    accent: "var(--cyan)",
  },
  balanced: {
    label: "Balanced",
    tldr: "Sustainable yield with adaptive range and rotation.",
    accent: "var(--accent)",
  },
  aggressive: {
    label: "Aggressive",
    tldr: "High-velocity pools and wider risk budget.",
    accent: "var(--amber)",
  },
};
