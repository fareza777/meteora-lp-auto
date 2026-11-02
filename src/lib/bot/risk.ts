import "server-only";
import { getPaperSummary } from "../portfolio";
import { getPaperAccount, getPositions, getUserSettings } from "../store";
import type { RiskSettings, TradingMode } from "../types";

export interface RiskState {
  mode: TradingMode;
  killSwitch: boolean;
  dailyLossPct: number;
  drawdownPct: number;
  dailyLossBreached: boolean;
  drawdownBreached: boolean;
  halt: boolean;
  reasons: string[];
}

function liveBook(userId: string): { openPnl: number; openCapital: number } {
  const positions = getPositions(userId, { mode: "live", limit: 500 });
  const open = positions.filter((position) => position.status === "open");
  const openCapital = open.reduce((sum, position) => sum + position.capitalUsd, 0);
  const openPnl = open.reduce(
    (sum, position) =>
      sum +
      position.currentValueUsd +
      position.unclaimedFeesUsd +
      position.claimedFeesUsd -
      position.capitalUsd,
    0,
  );
  return { openPnl, openCapital };
}

/**
 * Paper risk is measured against the rolling peak and the day-start equity.
 * Live risk cannot observe wallet cash cheaply, so it uses the open book's
 * mark-to-market PnL relative to deployed capital as the loss guard.
 */
export function evaluateRisk(userId: string, mode: TradingMode, killSwitch: boolean): RiskState {
  const settings = getUserSettings(userId);
  const reasons: string[] = [];

  let dailyLossPct = 0;
  let drawdownPct = 0;

  if (mode === "paper") {
    const state = getPaperSummary(userId);
    const account = getPaperAccount(userId);
    const peak = Math.max(account.peakEquity, state.summary.equity);
    dailyLossPct = state.summary.dayPnlPct;
    drawdownPct = peak > 0 ? ((peak - state.summary.equity) / peak) * 100 : 0;
  } else {
    const book = liveBook(userId);
    const ratio = book.openCapital > 0 ? (book.openPnl / book.openCapital) * 100 : 0;
    dailyLossPct = ratio;
    drawdownPct = Math.max(0, -ratio);
  }

  const dailyLossBreached = dailyLossPct <= -Math.abs(settings.risk.dailyLossLimitPct);
  const drawdownBreached = drawdownPct >= Math.abs(settings.risk.maxDrawdownPct);
  if (killSwitch) reasons.push("Kill switch is active");
  if (dailyLossBreached) {
    reasons.push(
      mode === "paper"
        ? `Daily loss ${dailyLossPct.toFixed(2)}% hit the ${settings.risk.dailyLossLimitPct}% limit`
        : `Open-book loss ${dailyLossPct.toFixed(2)}% hit the ${settings.risk.dailyLossLimitPct}% limit`,
    );
  }
  if (drawdownBreached) {
    reasons.push(
      mode === "paper"
        ? `Drawdown ${drawdownPct.toFixed(2)}% hit the ${settings.risk.maxDrawdownPct}% limit`
        : `Open-book drawdown ${drawdownPct.toFixed(2)}% hit the ${settings.risk.maxDrawdownPct}% limit`,
    );
  }

  return {
    mode,
    killSwitch,
    dailyLossPct,
    drawdownPct,
    dailyLossBreached,
    drawdownBreached,
    halt: killSwitch || dailyLossBreached || drawdownBreached,
    reasons,
  };
}

export function tightStops(risk: RiskSettings, bot: { stopLossPct: number; takeProfitPct: number }) {
  return {
    stopLossPct: Math.min(Math.abs(risk.stopLossPct), Math.abs(bot.stopLossPct)),
    takeProfitPct: Math.min(Math.abs(risk.takeProfitPct), Math.abs(bot.takeProfitPct)),
  };
}
