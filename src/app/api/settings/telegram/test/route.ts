import { api, assertSameOrigin, enforceRateLimit, json, requireUser, ApiError } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { rateLimitKey } from "@/lib/rate-limit";
import { sendTelegram } from "@/lib/notifications";
import { getUserSettings, readTelegramToken } from "@/lib/store";

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "settings-telegram-test", user.id), 4, 60_000);
    const settings = getUserSettings(user.id);
    const token = readTelegramToken(user.id) || getConfig().telegramToken;
    const chatId = settings.notifications.chatId || getConfig().telegramChatId;
    if (!token) throw new ApiError(400, "Add a Telegram bot token first.", "missing_token");
    if (!chatId) throw new ApiError(400, "Add a Telegram chat ID first.", "missing_chat");
    await sendTelegram(
      token,
      chatId,
      "Tide test notification\nYour Telegram alerts are connected. Entry, exit and risk events will arrive here.",
    );
    return json({ ok: true });
  });
}
