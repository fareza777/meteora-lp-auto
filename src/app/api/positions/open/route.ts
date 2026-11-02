import { api, assertSameOrigin, enforceRateLimit, json, readJson, requireUser, ApiError } from "@/lib/api";
import { createDefaultBotConfig } from "@/lib/defaults";
import { getPoolAnalysis } from "@/lib/market/scanner";
import { rateLimitKey } from "@/lib/rate-limit";
import { createBot, getBots, getUserSettings } from "@/lib/store";
import { openLiveDlmmPosition } from "@/lib/trading/live";
import { openPaperPosition } from "@/lib/trading/paper";
import { manualOpenSchema } from "@/lib/schemas";
import type { BotRecord } from "@/lib/types";

function manualBotName(mode: "paper" | "live"): string {
  return mode === "live" ? "Manual desk · live" : "Manual desk · paper";
}

function ensureManualBot(userId: string, mode: "paper" | "live"): BotRecord {
  const existing = getBots(userId).find((bot) => bot.name === manualBotName(mode) && bot.mode === mode);
  if (existing) return existing;
  const settings = getUserSettings(userId);
  const config = {
    ...createDefaultBotConfig("balanced"),
    protocols: mode === "live" ? (["dlmm"] as const).slice() : (["dlmm", "damm-v2"] as const).slice(),
    maxOpenPositions: settings.risk.maxOpenPositions,
  };
  try {
    return createBot(userId, {
      name: manualBotName(mode),
      status: "paused",
      mode,
      config,
    });
  } catch {
    const raced = getBots(userId).find((bot) => bot.name === manualBotName(mode) && bot.mode === mode);
    if (!raced) throw new ApiError(500, "Could not prepare the manual desk.", "manual_bot_failed");
    return raced;
  }
}

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "position-open", user.id), 20, 60_000);
    const body = await readJson(request, manualOpenSchema);
    if (body.mode === "live" && body.protocol !== "dlmm") {
      throw new ApiError(
        400,
        "Live execution currently supports Meteora DLMM. DAMM v2 is available in paper trading.",
        "live_protocol_unsupported",
      );
    }
    const settings = getUserSettings(user.id);
    const analysis = await getPoolAnalysis(body.protocol, body.address, settings.risk);
    const manual = ensureManualBot(user.id, body.mode);
    const entryBot: BotRecord = {
      ...manual,
      config: {
        ...manual.config,
        capitalPerPositionUsd: body.capitalUsd ?? manual.config.capitalPerPositionUsd,
        strategy: body.strategy ?? manual.config.strategy,
        rangeMode: body.widthPct ? "manual" : manual.config.rangeMode,
        rangeWidthPct: body.widthPct ?? manual.config.rangeWidthPct,
        maxOpenPositions: Math.max(manual.config.maxOpenPositions, settings.risk.maxOpenPositions),
      },
    };
    if (body.mode === "paper") {
      const position = await openPaperPosition({
        userId: user.id,
        bot: entryBot,
        analysis,
        reason: "Manual entry",
      });
      return json({ position }, { status: 201 });
    }
    const position = await openLiveDlmmPosition({
      userId: user.id,
      bot: entryBot,
      analysis,
      actor: "manual",
    });
    return json({ position }, { status: 201 });
  });
}
