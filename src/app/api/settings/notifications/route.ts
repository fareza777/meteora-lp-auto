import { api, assertSameOrigin, enforceRateLimit, json, readJson, requireUser } from "@/lib/api";
import { rateLimitKey } from "@/lib/rate-limit";
import { notificationsSchema } from "@/lib/schemas";
import { getUserSettings, saveSettings } from "@/lib/store";

export async function PUT(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "settings-notify", user.id), 20, 60_000);
    const body = await readJson(request, notificationsSchema);
    const current = getUserSettings(user.id);
    saveSettings(user.id, {
      ...current,
      notifications: { ...body, hasToken: current.notifications.hasToken },
    });
    return json({ settings: getUserSettings(user.id) });
  });
}
