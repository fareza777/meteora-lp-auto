import type { OhlcvCandle, PoolSnapshot, PositionRecord } from "@/lib/types";
import { getProfileDefaults } from "@/lib/defaults";

export function makePool(overrides: Partial<PoolSnapshot> = {}): PoolSnapshot {
  return {
    id: "dlmm:pool-sol-usdc",
    protocol: "dlmm",
    address: "HZwqbW8bW4g3m9hA7kS3g5Ef9tNwJ2pQxP1jXe4m3RtA",
    name: "SOL-USDC",
    tokenX: {
      address: "So11111111111111111111111111111111111111112",
      symbol: "SOL",
      name: "Solana",
      decimals: 9,
      priceUsd: 200,
      verified: true,
      freezeAuthorityDisabled: true,
      holders: 500_000,
      marketCapUsd: 90_000_000_000,
    },
    tokenY: {
      address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      priceUsd: 1,
      verified: true,
      freezeAuthorityDisabled: true,
      holders: 1_000_000,
      marketCapUsd: 30_000_000_000,
    },
    currentPrice: 200,
    tvlUsd: 5_000_000,
    volume24hUsd: 10_000_000,
    volume4hUsd: 1_800_000,
    volume1hUsd: 500_000,
    fees24hUsd: 25_000,
    fees4hUsd: 4_500,
    fees1hUsd: 1_200,
    feeAprPct: 182.5,
    feeTvl24hPct: 0.5,
    farmAprPct: 1.2,
    baseFeePct: 0.04,
    dynamicFeePct: 0.01,
    binStep: 4,
    createdAt: Date.now() - 30 * 86_400_000,
    tags: ["verified"],
    hasFarm: false,
    ...overrides,
  };
}

export function hourlyCandles(
  closes: number[],
  opts: { start?: number; halfSpread?: number; volume?: number } = {},
): OhlcvCandle[] {
  const start = opts.start ?? Date.UTC(2026, 0, 1);
  const spread = opts.halfSpread ?? 0.005;
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1];
    return {
      timestamp: start + index * 3_600_000,
      open,
      high: Math.max(open, close) * (1 + spread),
      low: Math.min(open, close) * (1 - spread),
      close,
      volume: opts.volume ?? 1_000,
    };
  });
}

export function steadyCandles(count: number, price = 200, wigglePct = 0.4): OhlcvCandle[] {
  const closes = Array.from({ length: count }, (_, index) =>
    price * (1 + (index % 2 === 0 ? wigglePct : -wigglePct) / 100),
  );
  return hourlyCandles(closes, { start: Date.now() - count * 3_600_000, halfSpread: 0.002 });
}

export function balancedRisk() {
  return getProfileDefaults("balanced").risk;
}

export function makePosition(overrides: Partial<PositionRecord> = {}): PositionRecord {
  const now = Date.now();
  return {
    id: "position-1",
    userId: "user-1",
    botId: "bot-1",
    mode: "paper",
    protocol: "dlmm",
    poolAddress: "pool-sol-usdc",
    poolName: "SOL-USDC",
    strategy: "Spot",
    status: "open",
    capitalUsd: 2_000,
    entryPrice: 200,
    currentPrice: 200,
    lowerBin: -100,
    upperBin: 100,
    lowerPrice: 188,
    upperPrice: 212,
    tokenXMint: "So11111111111111111111111111111111111111112",
    tokenYMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tokenXSymbol: "SOL",
    tokenYSymbol: "USDC",
    tokenXDecimals: 9,
    tokenYDecimals: 6,
    entryXAmount: 5,
    entryYAmount: 1_000,
    currentXAmount: 5,
    currentYAmount: 1_000,
    tokenXPriceUsd: 200,
    tokenYPriceUsd: 1,
    currentValueUsd: 2_000,
    feeDailyPct: 0.5,
    unclaimedFeesUsd: 0,
    claimedFeesUsd: 0,
    ilUsd: 0,
    pnlUsd: 0,
    pnlPct: 0,
    inRange: true,
    outOfRangeSince: null,
    lastClaimedAt: null,
    positionAddress: null,
    nftMint: null,
    openedAt: now - 3_600_000,
    lastAccruedAt: now,
    updatedAt: now,
    closedAt: null,
    closeReason: null,
    closeProceedsUsd: null,
    txOpen: null,
    txClose: null,
    ...overrides,
  };
}
