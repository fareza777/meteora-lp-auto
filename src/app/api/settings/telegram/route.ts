import { z } from "zod";
import { api, assertSameOrigin, enforceRateLimit, json, readJson, requireUser, ApiError } from "@/lib/api";
import { rateLimitKey } from "@/lib/rate-limit";
import { getUserSettings, saveSettings, saveTelegramToken } from "@/lib/store";

const schema = z.object({
  token: z.string().trim().min(20).max(200).nullable(),
  chatId: z.string().trim().max(64).optional(),
});

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "settings-telegram-token", user.id), 8, 60_000);
    const body = await readJson(request, schema);
    if (body.token && !/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(body.token)) {
      throw new ApiError(400, "That does not look like a Telegram bot token.", "invalid_token");
    }
    saveTelegramToken(user.id, body.token);
    if (body.chatId !== undefined) {
      const current = getUserSettings(user.id);
      saveSettings(user.id, {
        ...current,
        notifications: { ...current.notifications, chatId: body.chatId },
      });
    }
    const settings = getUserSettings(user.id);
    return json({ hasToken: settings.notifications.hasToken, chatId: settings.notifications.chatId });
  });
}
