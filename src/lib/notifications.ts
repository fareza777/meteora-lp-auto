import "server-only";
import { getConfig } from "./config";
import { getDb } from "./db";
import { readTelegramToken, getUserSettings } from "./store";

export type NotifyEvent = "open" | "close" | "risk" | "error" | "summary";

export async function notifyUser(
  userId: string,
  event: NotifyEvent,
  message: string,
): Promise<void> {
  try {
    const settings = getUserSettings(userId);
    if (!settings.notifications.telegramEnabled) return;
    if (event === "open" && !settings.notifications.onOpen) return;
    if (event === "close" && !settings.notifications.onClose) return;
    if (event === "risk" && !settings.notifications.onRisk) return;
    if (event === "error" && !settings.notifications.onError) return;
    const token = readTelegramToken(userId) || getConfig().telegramToken;
    const chatId = settings.notifications.chatId || getConfig().telegramChatId;
    if (!token || !chatId) return;
    await sendTelegram(token, chatId, message);
  } catch (error) {
    console.warn("[telegram] notification failed", error instanceof Error ? error.message : "unknown");
  }
}

export async function sendTelegram(token: string, chatId: string, message: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message.slice(0, 3_800),
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { description?: string } | null;
    throw new Error(`Telegram rejected the message${body?.description ? `: ${body.description}` : "."}`);
  }
}

export function markDailySummarySent(userId: string): void {
  getDb().prepare("UPDATE settings SET updated_at = ? WHERE user_id = ?").run(Date.now(), userId);
}
