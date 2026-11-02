import { api, json, requireUser, ApiError } from "@/lib/api";
import { getOhlcv } from "@/lib/market/meteora";
import { getPoolAnalysis } from "@/lib/market/scanner";
import { getUserSettings } from "@/lib/store";
import type { OhlcvCandle, Protocol } from "@/lib/types";

export async function GET(
  request: Request,
  context: { params: Promise<{ protocol: string; address: string }> },
) {
  return api(async () => {
    const user = await requireUser();
    const { protocol, address } = await context.params;
    if (protocol !== "dlmm" && protocol !== "damm-v2") {
      throw new ApiError(400, "Unsupported protocol.", "invalid_protocol");
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      throw new ApiError(400, "Invalid pool address.", "invalid_address");
    }
    const settings = getUserSettings(user.id);
    const url = new URL(request.url);
    const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days") ?? 7) || 7));
    const timeframeParam = url.searchParams.get("timeframe") ?? "1h";
    const timeframe = timeframeParam === "30m" || timeframeParam === "4h" ? timeframeParam : "1h";
    const now = Date.now();
    const [analysis, candles] = await Promise.all([
      getPoolAnalysis(protocol as Protocol, address, settings.risk),
      getOhlcv(protocol as Protocol, address, timeframe, now - days * 86_400_000, now).catch(
        () => [] as OhlcvCandle[],
      ),
    ]);
    return json({ analysis, candles, days, timeframe });
  });
}
