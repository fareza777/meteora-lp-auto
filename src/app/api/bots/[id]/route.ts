import { api, assertSameOrigin, enforceRateLimit, json, readJson, requireUser, ApiError } from "@/lib/api";
import { rateLimitKey } from "@/lib/rate-limit";
import { botPatchSchema } from "@/lib/schemas";
import { deleteBotForUser, getBot, getPositions, saveBot } from "@/lib/store";
import { getLiveReadiness } from "@/lib/trading/live";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "bot-update", user.id), 30, 60_000);
    const { id } = await context.params;
    const bot = getBot(user.id, id);
    if (!bot) throw new ApiError(404, "Bot not found.", "not_found");
    const body = await readJson(request, botPatchSchema);
    const mode = body.mode ?? bot.mode;
    const status = body.status ?? bot.status;
    if (mode === "live" && (body.mode === "live" || status === "running")) {
      const readiness = getLiveReadiness(user.id);
      if (!readiness.canTrade) {
        throw new ApiError(409, readiness.reason ?? "Live trading is not ready.", "live_not_ready");
      }
    }
    const next = {
      ...bot,
      name: body.name ?? bot.name,
      status,
      mode,
      config: { ...bot.config, ...(body.config ?? {}) },
    };
    saveBot(next);
    return json({ bot: getBot(user.id, id) });
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "bot-delete", user.id), 10, 60_000);
    const { id } = await context.params;
    const bot = getBot(user.id, id);
    if (!bot) throw new ApiError(404, "Bot not found.", "not_found");
    if (bot.status === "running") throw new ApiError(409, "Pause the bot before deleting it.", "bot_running");
    const open = getPositions(user.id, { status: "open" }).filter((position) => position.botId === bot.id);
    if (open.length) throw new ApiError(409, "Close this bot's open positions first.", "positions_open");
    if (!deleteBotForUser(user.id, id)) {
      throw new ApiError(409, "Live bots keep their audit history and cannot be deleted.", "live_bot_protected");
    }
    return json({ ok: true });
  });
}
