import "server-only";
import { getConfig } from "../config";
import { cached } from "./cache";
import { isQuoteMint } from "./mints";
import type {
  OhlcvCandle,
  PoolSnapshot,
  Protocol,
  ProtocolStats,
  Protocol as ProtocolType,
  TokenInfo,
} from "../types";

type UnknownRecord = Record<string, unknown>;

type RawPool = {
  address?: unknown;
  name?: unknown;
  token_x?: UnknownRecord;
  token_y?: UnknownRecord;
  token_x_amount?: unknown;
  token_y_amount?: unknown;
  created_at?: unknown;
  pool_config?: UnknownRecord;
  dynamic_fee_pct?: unknown;
  tvl?: unknown;
  current_price?: unknown;
  apr?: unknown;
  apy?: unknown;
  farm_apr?: unknown;
  volume?: UnknownRecord;
  fees?: UnknownRecord;
  fee_tvl_ratio?: UnknownRecord;
  cumulative_metrics?: UnknownRecord;
  is_blacklisted?: unknown;
  tags?: unknown;
  has_farm?: unknown;
};

function number(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function token(raw: UnknownRecord | undefined): TokenInfo | null {
  if (!raw) return null;
  const address = text(raw.address);
  if (!address) return null;
  return {
    address,
    symbol: text(raw.symbol, "???"),
    name: text(raw.name, text(raw.symbol, "Unknown")),
    decimals: number(raw.decimals, 0),
    priceUsd: number(raw.price),
    verified: raw.is_verified === true,
    freezeAuthorityDisabled: raw.freeze_authority_disabled === true,
    holders: number(raw.holders),
    marketCapUsd: number(raw.market_cap),
  };
}

function windowed(raw: UnknownRecord | undefined, window: string): number {
  if (!raw) return 0;
  return number(raw[window]);
}

export function normalisePool(rawRaw: unknown, protocol: ProtocolType): PoolSnapshot | null {
  if (!rawRaw || typeof rawRaw !== "object") return null;
  const raw = rawRaw as RawPool;
  const address = text(raw.address);
  const name = text(raw.name);
  const tokenX = token(raw.token_x);
  const tokenY = token(raw.token_y);
  const currentPrice = number(raw.current_price);
  const tvl = number(raw.tvl);
  if (!address || !name || !tokenX || !tokenY || currentPrice <= 0 || tvl <= 0) return null;
  if (raw.is_blacklisted === true) return null;

  const config = (raw.pool_config ?? {}) as UnknownRecord;
  const feeTvl24hPct = windowed(raw.fee_tvl_ratio, "24h");
  const fees24h = windowed(raw.fees, "24h");
  const volume24h = windowed(raw.volume, "24h");
  const annualisedApr = feeTvl24hPct > 0 ? feeTvl24hPct * 365 : 0;
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [];

  return {
    id: `${protocol}:${address}`,
    protocol,
    address,
    name,
    tokenX,
    tokenY,
    currentPrice,
    tvlUsd: tvl,
    volume24hUsd: volume24h,
    volume4hUsd: windowed(raw.volume, "4h"),
    volume1hUsd: windowed(raw.volume, "1h"),
    fees24hUsd: fees24h,
    fees4hUsd: windowed(raw.fees, "4h"),
    fees1hUsd: windowed(raw.fees, "1h"),
    feeAprPct: annualisedApr,
    feeTvl24hPct,
    farmAprPct: number(raw.farm_apr),
    baseFeePct: number(config.base_fee_pct),
    dynamicFeePct: number(raw.dynamic_fee_pct),
    binStep: number(config.bin_step),
    createdAt: number(raw.created_at),
    tags,
    hasFarm: raw.has_farm === true,
  };
}

function baseUrl(protocol: ProtocolType): string {
  const config = getConfig();
  return protocol === "dlmm" ? config.dlmmApi : config.dammApi;
}

async function fetchJson<T>(url: string, timeoutMs = 12_000, retry = true): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "TideLP/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (retry) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return fetchJson<T>(url, timeoutMs, false);
    }
    throw new Error(`Meteora API request failed: ${error instanceof Error ? error.message : "network error"}`);
  }
  if (response.status === 429 || response.status >= 500) {
    if (retry) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return fetchJson<T>(url, timeoutMs, false);
    }
  }
  if (!response.ok) {
    throw new Error(`Meteora API returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

const UNIVERSE_TVL_FLOOR = 10_000;
const UNIVERSE_PAGE_SIZE = 1_000;
const UNIVERSE_MAX_PAGES = 8;

async function listPools(
  protocol: ProtocolType,
  sortBy: string,
  minimumTvl = UNIVERSE_TVL_FLOOR,
): Promise<PoolSnapshot[]> {
  const pools: PoolSnapshot[] = [];
  for (let page = 1; page <= UNIVERSE_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(UNIVERSE_PAGE_SIZE),
      sort_by: sortBy,
      filter_by: `is_blacklisted=false && tvl>=${minimumTvl}`,
    });
    const body = await fetchJson<{ data?: unknown[]; message?: string }>(
      `${baseUrl(protocol)}/pools?${params.toString()}`,
    );
    if (!Array.isArray(body.data)) {
      throw new Error(body.message || "Unexpected Meteora pools response.");
    }
    const batch = body.data
      .map((raw) => normalisePool(raw, protocol))
      .filter((p): p is PoolSnapshot => p !== null);
    pools.push(...batch);
    if (body.data.length < UNIVERSE_PAGE_SIZE || batch.length === 0) break;
  }
  return pools;
}

export interface ScanUniverse {
  pools: PoolSnapshot[];
  fetchedAt: number;
  stale: boolean;
}

export async function getScanUniverse(): Promise<ScanUniverse> {
  const result = await cached<Omit<ScanUniverse, "stale">>(
    "scan-universe-v3",
    120_000,
    15 * 60_000,
    async () => {
      const settled = await Promise.allSettled(
        (["dlmm", "damm-v2"] as const).map((protocol) => listPools(protocol, "tvl:desc")),
      );
      const fulfilled = settled.filter(
        (item): item is PromiseFulfilledResult<PoolSnapshot[]> => item.status === "fulfilled",
      );
      if (!fulfilled.length) {
        const reason = settled.find((item) => item.status === "rejected") as PromiseRejectedResult | undefined;
        throw reason?.reason ?? new Error("Meteora market data is unavailable.");
      }
      const merged = new Map<string, PoolSnapshot>();
      for (const result of fulfilled) {
        for (const pool of result.value) {
          const existing = merged.get(pool.id);
          if (!existing || pool.tvlUsd > existing.tvlUsd) merged.set(pool.id, pool);
        }
      }
      return { pools: Array.from(merged.values()), fetchedAt: Date.now() };
    },
  );
  return { ...result.value, stale: result.stale };
}

export async function getPoolDetail(protocol: ProtocolType, address: string): Promise<PoolSnapshot> {
  const result = await cached<PoolSnapshot>(
    `pool:${protocol}:${address}`,
    45_000,
    15 * 60_000,
    async () => {
      const raw = await fetchJson<unknown>(`${baseUrl(protocol)}/pools/${encodeURIComponent(address)}`);
      const pool = normalisePool(raw, protocol);
      if (!pool) throw new Error("Pool not found.");
      return pool;
    },
  );
  return result.value;
}

export async function getPoolStats(): Promise<ProtocolStats> {
  const result = await cached<ProtocolStats>(
    "protocol-stats-v2",
    60_000,
    30 * 60_000,
    async () => {
      const [dlmm, damm] = await Promise.allSettled([
        fetchJson<Record<string, unknown>>(`${getConfig().dlmmApi}/stats/protocol_metrics`),
        fetchJson<Record<string, unknown>>(`${getConfig().dammApi}/stats/protocol_metrics`),
      ]);
      let totalTvlUsd = 0;
      let volume24hUsd = 0;
      let fee24hUsd = 0;
      let totalPools = 0;
      let refreshedAt = 0;
      for (const item of [dlmm, damm]) {
        if (item.status !== "fulfilled") continue;
        totalTvlUsd += number(item.value.total_tvl);
        volume24hUsd += number(item.value.volume_24h);
        fee24hUsd += number(item.value.fee_24h);
        totalPools += number(item.value.total_pools);
        refreshedAt = Math.max(refreshedAt, number(item.value.refreshed_at) * 1000);
      }
      if (!refreshedAt) throw new Error("Protocol metrics are unavailable.");
      return { totalTvlUsd, volume24hUsd, fee24hUsd, totalPools, refreshedAt };
    },
  );
  return result.value;
}

const TIMEFRAME_MS: Record<string, number> = {
  "5m": 300_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "12h": 43_200_000,
  "24h": 86_400_000,
};

// The indexed OHLCV endpoint rejects windows beyond 100 candles per request.
const OHLCV_CHUNK_CANDLES = 96;
const OHLCV_MAX_CHUNKS = 64;

async function fetchOhlcvWindow(
  protocol: ProtocolType,
  address: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
): Promise<OhlcvCandle[]> {
  const params = new URLSearchParams({ timeframe });
  if (startTime) params.set("start_time", String(Math.floor(startTime / 1000)));
  if (endTime) params.set("end_time", String(Math.floor(endTime / 1000)));
  const raw = await fetchJson<{ data?: Array<Record<string, unknown>> }>(
    `${baseUrl(protocol)}/pools/${encodeURIComponent(address)}/ohlcv?${params.toString()}`,
  );
  return (raw.data ?? [])
    .map((c) => ({
      timestamp: number(c.timestamp) * 1000,
      open: number(c.open),
      high: number(c.high),
      low: number(c.low),
      close: number(c.close),
      volume: number(c.volume),
    }))
    .filter((c) => c.timestamp > 0 && c.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function getOhlcv(
  protocol: ProtocolType,
  address: string,
  timeframe: "5m" | "30m" | "1h" | "2h" | "4h" | "12h" | "24h",
  startTime?: number,
  endTime?: number,
): Promise<OhlcvCandle[]> {
  const stepMs = TIMEFRAME_MS[timeframe] ?? 3_600_000;
  // Align to candle boundaries so repeated chart/backtest requests share cache entries.
  const alignedStart = startTime ? Math.floor(startTime / stepMs) * stepMs : undefined;
  const alignedEnd = endTime ? Math.floor(endTime / stepMs) * stepMs : undefined;
  const key = `ohlcv:${protocol}:${address}:${timeframe}:${alignedStart ?? "default"}:${alignedEnd ?? "now"}`;
  const result = await cached<OhlcvCandle[]>(key, 180_000, 30 * 60_000, async () => {
    if (!alignedStart || !alignedEnd || alignedEnd <= alignedStart) {
      return fetchOhlcvWindow(protocol, address, timeframe, alignedStart, alignedEnd);
    }
    const spanMs = stepMs * OHLCV_CHUNK_CANDLES;
    const windows: Array<[number, number]> = [];
    for (let cursor = alignedStart; cursor < alignedEnd; cursor += spanMs) {
      windows.push([cursor, Math.min(alignedEnd, cursor + spanMs)]);
    }
    if (windows.length > OHLCV_MAX_CHUNKS) {
      throw new Error("Requested price history window is too large.");
    }
    const merged = new Map<number, OhlcvCandle>();
    const concurrency = 4;
    for (let index = 0; index < windows.length; index += concurrency) {
      const batch = windows.slice(index, index + concurrency);
      const results = await Promise.all(
        batch.map(([from, to]) => fetchOhlcvWindow(protocol, address, timeframe, from, to)),
      );
      for (const candles of results) {
        for (const candle of candles) merged.set(candle.timestamp, candle);
      }
    }
    return [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);
  });
  return result.value;
}

export interface RugSummary {
  score: number;
  risks: Array<{ name?: string; description?: string; level?: string; score?: number }>;
  rugged?: boolean;
}

export async function getTokenRisk(mint: string): Promise<RugSummary | null> {
  try {
    const result = await cached<RugSummary | null>(
      `rug:${mint}`,
      6 * 60 * 60_000,
      24 * 60 * 60_000,
      async () => {
        const raw = await fetchJson<Record<string, unknown>>(
          `${getConfig().rugcheckApi}/v1/tokens/${encodeURIComponent(mint)}/report/summary`,
          8_000,
          false,
        );
        return {
          score: number(raw.score_normalised, number(raw.score)),
          risks: Array.isArray(raw.risks) ? (raw.risks as RugSummary["risks"]) : [],
          rugged: raw.rugged === true,
        };
      },
    );
    return result.value;
  } catch {
    return null;
  }
}

export async function getLivePoolFromSdk(protocol: ProtocolType, address: string) {
  if (protocol !== "dlmm") return null;
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const { default: DLMM } = await import("@meteora-ag/dlmm");
  const config = getConfig();
  const connection = new Connection(config.rpcUrl, "confirmed");
  return DLMM.create(connection, new PublicKey(address), { cluster: config.cluster });
}
