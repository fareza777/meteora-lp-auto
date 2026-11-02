import { api, assertSameOrigin, enforceRateLimit, json, readJson, requireUser } from "@/lib/api";
import { rateLimitKey } from "@/lib/rate-limit";
import { riskSchema } from "@/lib/schemas";
import { getUserSettings, updateRiskSettings } from "@/lib/store";

export async function PUT(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "settings-risk", user.id), 20, 60_000);
    const risk = await readJson(request, riskSchema);
    updateRiskSettings(user.id, risk);
    return json({ settings: getUserSettings(user.id) });
  });
}
