import { api, assertSameOrigin, enforceRateLimit, json, readJson, requireUser } from "@/lib/api";
import { runBacktest } from "@/lib/backtest/engine";
import { rateLimitKey } from "@/lib/rate-limit";
import { backtestSchema } from "@/lib/schemas";
import { getBacktests, logActivity, saveBacktest } from "@/lib/store";

export async function GET() {
  return api(async () => {
    const user = await requireUser();
    return json({ backtests: getBacktests(user.id, 30) });
  });
}

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "backtest", user.id), 6, 60_000);
    const body = await readJson(request, backtestSchema);
    const { config, result } = await runBacktest(body);
    const record = saveBacktest(user.id, {
      poolName: config.poolName,
      protocol: config.protocol,
      config,
      result,
    });
    logActivity({
      userId: user.id,
      level: "info",
      category: "backtest",
      message: `Backtest ${config.poolName} · ${config.days}d ${config.timeframe} · return ${result.totalReturnPct.toFixed(2)}% · fees $${result.feesUsd.toFixed(2)}`,
      metadata: { backtestId: record.id, rebalances: result.rebalances },
    });
    return json({ backtest: record }, { status: 201 });
  });
}
