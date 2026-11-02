import "server-only";
import {
  analyzePool,
  eligibilityFailures,
  mergeSafety,
  baseSafety,
  strategySlug,
  type ExternalSafety,
} from "../analytics/strategy";
import type {
  BotConfig,
  OhlcvCandle,
  PoolAnalysis,
  PoolSnapshot,
  Protocol,
  RiskSettings,
  ScannerResponse,
  StrategyName,
} from "../types";
import { isQuoteMint } from "../market/mints";
import { getOhlcv, getPoolDetail, getPoolStats, getScanUniverse, getTokenRisk } from "../market/meteora";

const MAX_DEEP_ANALYSES = 24;

export interface ScanFilters {
  protocols?: Protocol[];
  search?: string;
  minTvlUsd?: number;
  minScore?: number;
  maxRiskScore?: number;
  sort?: "score" | "feeApr" | "tvl" | "volume" | "risk" | "age";
  limit?: number;
  deep?: boolean;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function externalSafetyFromRug(
  entries: Array<{
    symbol: string;
    summary: Awaited<ReturnType<typeof getTokenRisk>>;
  }>,
): ExternalSafety | null {
  const available = entries.filter((entry) => entry.summary);
  if (!available.length) return null;
  const reasons: string[] = [];
  let blocked = false;
  let watch = false;
  for (const { symbol, summary } of available) {
    if (!summary) continue;
    if (summary.rugged) {
      blocked = true;
      reasons.push(`${symbol}: flagged as rugged by RugCheck`);
    }
    for (const risk of summary.risks.slice(0, 4)) {
      const level = String(risk.level ?? "").toLowerCase();
      const name = risk.name || risk.description || "Token risk";
      if (level.includes("danger") || level.includes("critical")) {
        blocked = true;
        reasons.push(`${symbol}: ${name}`);
      } else if (level.includes("warn") || level.includes("medium")) {
        watch = true;
        reasons.push(`${symbol}: ${name}`);
      }
    }
    if (summary.risks.length > 0) watch = true;
  }
  if (blocked) return { status: "blocked", score: 15, reasons, rugged: true };
  if (watch) return { status: "watch", score: 60, reasons };
  return { status: "safe", score: 92, reasons: reasons.length ? reasons : ["RugCheck passed"] };
}

async function deepSafety(pool: PoolSnapshot): Promise<ExternalSafety | null> {
  const tokens = [pool.tokenX, pool.tokenY].filter(
    (token) => !isQuoteMint(token.address) && !token.verified,
  );
  if (!tokens.length) {
    return { status: "safe", score: 88, reasons: ["Verified / major mints"] };
  }
  const entries = await Promise.all(
    tokens.slice(0, 2).map(async (token) => ({
      symbol: token.symbol,
      summary: await getTokenRisk(token.address),
    })),
  );
  return externalSafetyFromRug(entries);
}

async function analyseDeep(pool: PoolSnapshot, risk: RiskSettings): Promise<PoolAnalysis> {
  const now = Date.now();
  const [candles, external] = await Promise.all([
    getOhlcv(pool.protocol, pool.address, "1h", now - 3 * 86_400_000, now).catch(() => [] as OhlcvCandle[]),
    deepSafety(pool).catch(() => null),
  ]);
  return analyzePool(pool, { candles, safety: external, risk });
}

function applySort(analyses: PoolAnalysis[], sort: ScanFilters["sort"]): PoolAnalysis[] {
  const sorted = [...analyses];
  switch (sort) {
    case "feeApr":
      sorted.sort((a, b) => b.feeAprPct - a.feeAprPct);
      break;
    case "tvl":
      sorted.sort((a, b) => b.pool.tvlUsd - a.pool.tvlUsd);
      break;
    case "volume":
      sorted.sort((a, b) => b.pool.volume24hUsd - a.pool.volume24hUsd);
      break;
    case "risk":
      sorted.sort((a, b) => a.riskScore - b.riskScore);
      break;
    case "age":
      sorted.sort((a, b) => b.signals.ageHours - a.signals.ageHours);
      break;
    case "score":
    default:
      sorted.sort((a, b) => b.score - a.score);
  }
  return sorted;
}

export async function scanPools(filters: ScanFilters = {}, risk?: RiskSettings): Promise<ScannerResponse> {
  const universe = await getScanUniverse();
  const protocols = filters.protocols?.length ? new Set(filters.protocols) : null;
  const search = filters.search?.trim().toLowerCase();
  const baseRisk: RiskSettings | undefined = risk;

  let analyses = universe.pools
    .filter((pool) => !protocols || protocols.has(pool.protocol))
    .filter(
      (pool) =>
        !search ||
        pool.name.toLowerCase().includes(search) ||
        pool.address.toLowerCase().includes(search) ||
        pool.tokenX.symbol.toLowerCase().includes(search) ||
        pool.tokenY.symbol.toLowerCase().includes(search),
    )
    .filter((pool) => pool.tvlUsd >= (filters.minTvlUsd ?? 0))
    .map((pool) => analyzePool(pool, { risk: baseRisk }))
    .filter((analysis) => analysis.score >= (filters.minScore ?? 0))
    .filter((analysis) => analysis.riskScore <= (filters.maxRiskScore ?? 100));

  analyses = applySort(analyses, filters.sort ?? "score");
  const matched = analyses.length;
  const deepCount = filters.deep === false ? 0 : Math.min(filters.limit ?? 30, MAX_DEEP_ANALYSES);
  const deepTargets = analyses.slice(0, deepCount);
  const deepResults = await mapLimit(deepTargets, 4, async (analysis) => {
    try {
      return await analyseDeep(analysis.pool, risk ?? ({} as RiskSettings));
    } catch {
      return analysis;
    }
  });
  const deepMap = new Map(deepResults.map((analysis) => [analysis.pool.id, analysis]));
  analyses = analyses.map((analysis) => deepMap.get(analysis.pool.id) ?? analysis);
  analyses = applySort(analyses, filters.sort ?? "score");

  const limit = Math.min(filters.limit ?? 30, 250);
  const stats = await getPoolStats().catch(() => ({
    totalTvlUsd: 0,
    volume24hUsd: 0,
    fee24hUsd: 0,
    totalPools: 0,
    refreshedAt: 0,
  }));
  return {
    pools: analyses.slice(0, limit),
    stats,
    cachedAt: universe.fetchedAt,
    stale: universe.stale,
    universe: {
      total: universe.pools.length,
      dlmm: universe.pools.filter((pool) => pool.protocol === "dlmm").length,
      damm: universe.pools.filter((pool) => pool.protocol === "damm-v2").length,
      matched,
      deep: deepResults.length,
    },
  };
}

export async function getPoolAnalysis(
  protocol: Protocol,
  address: string,
  risk?: RiskSettings,
): Promise<PoolAnalysis> {
  const pool = await getPoolDetail(protocol, address);
  return analyseDeep(pool, risk ?? ({} as RiskSettings));
}

export interface Opportunity {
  analysis: PoolAnalysis;
  eligible: boolean;
  failures: string[];
  strategy: StrategyName;
}

export async function discoverOpportunities(opts: {
  risk: RiskSettings;
  config: BotConfig;
  excludePools?: string[];
}): Promise<Opportunity[]> {
  const protocols = opts.config.protocols.length ? opts.config.protocols : undefined;
  const response = await scanPools(
    {
      protocols,
      minTvlUsd: Math.max(opts.risk.minPoolTvlUsd, opts.config.minTvlUsd),
      minScore: Math.min(opts.risk.minScore, opts.config.minScore) - 15,
      maxRiskScore: Math.min(100, opts.risk.maxRiskScore + 10),
      sort: "score",
      limit: 30,
      deep: true,
    },
    opts.risk,
  );
  const excluded = new Set(opts.excludePools ?? []);
  return response.pools
    .filter((analysis) => !excluded.has(analysis.pool.id))
    .map((analysis) => {
      const strategy =
        opts.config.strategy === "auto"
          ? analysis.recommendedStrategy
          : opts.config.strategy === "curve"
            ? "Curve"
            : opts.config.strategy === "bidask"
              ? "BidAsk"
              : "Spot";
      const failures = eligibilityFailures(analysis, {
        risk: opts.risk,
        botConfig: opts.config,
      });
      return { analysis, eligible: failures.length === 0, failures, strategy };
    })
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.analysis.score - a.analysis.score;
    });
}

export { strategySlug };
