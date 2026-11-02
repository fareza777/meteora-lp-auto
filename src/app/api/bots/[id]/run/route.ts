import { api, assertSameOrigin, enforceRateLimit, json, requireUser, ApiError } from "@/lib/api";
import { rateLimitKey } from "@/lib/rate-limit";
import { getBot } from "@/lib/store";
import { runBotOnce } from "@/lib/bot/engine";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "bot-run", user.id), 6, 60_000);
    const { id } = await context.params;
    const bot = getBot(user.id, id);
    if (!bot) throw new ApiError(404, "Bot not found.", "not_found");
    const result = await runBotOnce(bot, { force: true });
    return json({ result });
  });
}
