import "server-only";
import { nowMs } from "./db";
import {
  getBotStats,
  getEquitySnapshots,
  getPaperAccount,
  getPositions,
  getTransactions,
  savePaperAccount,
} from "./store";
import type {
  EquityPoint,
  PortfolioSummary,
  PositionRecord,
  PositionView,
  TradingMode,
  WalletSnapshot,
} from "./types";

export function toPositionView(position: PositionRecord): PositionView {
  return {
    ...position,
    valueUsd: position.currentValueUsd,
    ageMinutes: Math.max(0, Math.floor((nowMs() - position.openedAt) / 60_000)),
  };
}

export function calculateMaxDrawdown(points: EquityPoint[]): number {
  let peak = points[0]?.equity ?? 0;
  let maxDd = 0;
  for (const point of points) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - point.equity) / peak) * 100);
  }
  return maxDd;
}

export function getPaperSummary(userId: string): {
  summary: PortfolioSummary;
  positions: PositionRecord[];
  equityCurve: EquityPoint[];
} {
  const account = getPaperAccount(userId);
  const positions = getPositions(userId, { mode: "paper", limit: 500 });
  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status === "closed");
  const positionsValue = open.reduce((sum, p) => sum + p.currentValueUsd, 0);
  const unclaimedFees = open.reduce((sum, p) => sum + p.unclaimedFeesUsd, 0);
  const equity = account.cash + positionsValue + unclaimedFees;
  const totalPnl = equity - account.initialCapital;
  const openCapital = open.reduce((sum, p) => sum + p.capitalUsd, 0);
  const openUnrealized = open.reduce((sum, p) => sum + p.pnlUsd, 0);
  const realizedPnl = totalPnl - openUnrealized;
  const feeIncome = positions.reduce(
    (sum, p) => sum + p.claimedFeesUsd + (p.status === "open" ? p.unclaimedFeesUsd : 0),
    0,
  );
  const claimedFees = positions.reduce((sum, p) => sum + p.claimedFeesUsd, 0);
  const impermanentLoss = open.reduce((sum, p) => sum + p.ilUsd, 0);
  const wins = closed.filter((p) => p.pnlUsd > 0).length;
  const snapshots = getEquitySnapshots(userId);
  const currentPoint: EquityPoint = {
    ts: nowMs(),
    equity,
    cash: account.cash,
    positionsValue,
    pnl: totalPnl,
    fees: feeIncome,
  };
  const equityCurve = [...snapshots, currentPoint];
  const maxDrawdownPct = calculateMaxDrawdown(equityCurve);
  const firstTs = snapshots[0]?.ts ?? nowMs();
  const days = Math.max(1 / 24, (nowMs() - firstTs) / 86_400_000);
  const estAprPct = (feeIncome / Math.max(1, account.initialCapital)) * (365 / days) * 100;
  const dayPnl = equity - account.dayStartEquity;
  return {
    summary: {
      mode: "paper",
      initialCapital: account.initialCapital,
      cash: account.cash,
      positionsValue,
      unclaimedFees,
      equity,
      totalPnl,
      totalPnlPct: (totalPnl / Math.max(1, account.initialCapital)) * 100,
      realizedPnl,
      unrealizedPnl: openUnrealized,
      feeIncome,
      claimedFees,
      impermanentLoss,
      estAprPct: Number.isFinite(estAprPct) ? estAprPct : 0,
      maxDrawdownPct,
      openPositions: open.length,
      exposurePct: equity > 0 ? (openCapital / equity) * 100 : 0,
      dayPnl,
      dayPnlPct: (dayPnl / Math.max(1, account.dayStartEquity)) * 100,
      winRate: closed.length ? (wins / closed.length) * 100 : 0,
    },
    positions,
    equityCurve,
  };
}

export function getLiveSummary(
  userId: string,
  wallet?: WalletSnapshot | null,
): {
  summary: PortfolioSummary;
  positions: PositionRecord[];
  equityCurve: EquityPoint[];
} {
  const positions = getPositions(userId, { mode: "live", limit: 500 });
  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status === "closed");
  const positionsValue = open.reduce((sum, p) => sum + p.currentValueUsd, 0);
  const unclaimedFees = open.reduce((sum, p) => sum + p.unclaimedFeesUsd, 0);
  const capital = positions.reduce((sum, p) => sum + p.capitalUsd, 0);
  const walletValue = wallet?.totalValueUsd ?? 0;
  const equity = walletValue + positionsValue + unclaimedFees;
  const realizedPnl = closed.reduce((sum, p) => sum + p.pnlUsd, 0);
  const openUnrealized = open.reduce((sum, p) => sum + p.pnlUsd, 0);
  const totalPnl = realizedPnl + openUnrealized;
  const feeIncome = positions.reduce(
    (sum, p) => sum + p.claimedFeesUsd + (p.status === "open" ? p.unclaimedFeesUsd : 0),
    0,
  );
  const claimedFees = positions.reduce((sum, p) => sum + p.claimedFeesUsd, 0);
  const openCapital = open.reduce((sum, p) => sum + p.capitalUsd, 0);
  const wins = closed.filter((p) => p.pnlUsd > 0).length;
  const firstOpenedAt = positions.length ? Math.min(...positions.map((p) => p.openedAt)) : nowMs();
  const days = Math.max(1 / 24, (nowMs() - firstOpenedAt) / 86_400_000);
  const estAprPct = capital > 0 ? (feeIncome / capital) * (365 / days) * 100 : 0;
  return {
    summary: {
      mode: "live",
      initialCapital: Math.max(capital, 1),
      cash: walletValue,
      positionsValue,
      unclaimedFees,
      equity,
      totalPnl,
      totalPnlPct: capital > 0 ? (totalPnl / capital) * 100 : 0,
      realizedPnl,
      unrealizedPnl: openUnrealized,
      feeIncome,
      claimedFees,
      impermanentLoss: open.reduce((sum, p) => sum + p.ilUsd, 0),
      estAprPct: Number.isFinite(estAprPct) ? estAprPct : 0,
      maxDrawdownPct: 0,
      openPositions: open.length,
      exposurePct: equity > 0 ? (openCapital / equity) * 100 : 0,
      dayPnl: 0,
      dayPnlPct: 0,
      winRate: closed.length ? (wins / closed.length) * 100 : 0,
    },
    positions,
    equityCurve: [],
  };
}

export function updatePaperAccountAfterMark(userId: string, summary: PortfolioSummary): void {
  const account = getPaperAccount(userId);
  const dayKey = new Date().toISOString().slice(0, 10);
  const dayStartEquity = account.dayKey === dayKey ? account.dayStartEquity : summary.equity;
  savePaperAccount({
    ...account,
    peakEquity: Math.max(account.peakEquity, summary.equity),
    dayStartEquity,
    dayKey,
  });
}

export function getRecentTransactions(userId: string, limit = 30) {
  return getTransactions(userId, limit);
}

export function getCombinedBotStats(userId: string) {
  return getBotStats(userId);
}

export function filterMode<T extends { mode: TradingMode }>(items: T[], mode: TradingMode): T[] {
  return items.filter((item) => item.mode === mode);
}
