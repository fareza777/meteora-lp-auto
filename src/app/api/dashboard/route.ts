import { api, json, requireUser } from "@/lib/api";
import { loadImprovementState } from "@/lib/bot/improve-server";
import { getLiveReadiness, syncLivePositionsIfStale } from "@/lib/trading/live";
import { getWalletSnapshot } from "@/lib/trading/solana";
import { refreshPaperPositionsForUser } from "@/lib/trading/paper";
import { getLiveSummary, getPaperSummary, toPositionView } from "@/lib/portfolio";
import { scanPools } from "@/lib/market/scanner";
import {
  getActivity,
  getBotStats,
  getBots,
  getExecutionWallet,
  getPaperAccount,
  getPositions,
  getTransactions,
  getUserSettings,
} from "@/lib/store";
import type { DashboardData, PoolAnalysis, PositionView, ProtocolStats } from "@/lib/types";

const EMPTY_STATS: ProtocolStats = {
  totalTvlUsd: 0,
  volume24hUsd: 0,
  fee24hUsd: 0,
  totalPools: 0,
  refreshedAt: 0,
};

export async function GET() {
  return api(async () => {
    const user = await requireUser();
    const settings = getUserSettings(user.id);

    await refreshPaperPositionsForUser(user.id).catch(() => 0);

    const readiness = getLiveReadiness(user.id);
    let wallet = null;
    if (readiness.wallet) {
      const [, snapshot] = await Promise.all([
        syncLivePositionsIfStale(user.id, 60_000).catch(() => 0),
        getWalletSnapshot(user.id).catch(() => null),
      ]);
      wallet = snapshot;
    }

    const paperState = getPaperSummary(user.id);
    const liveState = getLiveSummary(user.id, wallet);

    let topPools: PoolAnalysis[] = [];
    let stats = EMPTY_STATS;
    let stale = true;
    try {
      const scan = await scanPools({ limit: 6, deep: true, sort: "score" }, settings.risk);
      topPools = scan.pools;
      stats = scan.stats;
      stale = scan.stale;
    } catch {
      // Market data outages must not take the portfolio offline.
    }

    const paperPositions = getPositions(user.id, { mode: "paper", limit: 200 });
    const livePositions = getPositions(user.id, { mode: "live", limit: 200 });
    const allPositions: PositionView[] = [...paperPositions, ...livePositions]
      .map(toPositionView)
      .sort((a, b) => b.openedAt - a.openedAt);

    const response: DashboardData = {
      user,
      executionWallet: getExecutionWallet(user.id),
      paper: getPaperAccount(user.id),
      summary: paperState.summary,
      liveSummary: liveState.summary,
      livePositions: livePositions.filter((position) => position.status === "open").map(toPositionView),
      liveReadiness: readiness,
      wallet,
      positions: allPositions,
      bots: getBots(user.id),
      botStats: getBotStats(user.id),
      activity: getActivity(user.id, 40),
      transactions: getTransactions(user.id, 40),
      equityCurve: paperState.equityCurve,
      improvement: loadImprovementState(user.id, "paper"),
      liveImprovement: loadImprovementState(user.id, "live"),
      settings,
      market: {
        stats,
        topPools,
        lastUpdated: stats.refreshedAt,
        stale,
      },
    };
    return json(response);
  });
}
