import { z } from "zod";
import { api, assertSameOrigin, enforceRateLimit, json, readJson, requireUser } from "@/lib/api";
import { createActionNonce, requestOrigin } from "@/lib/auth";
import { rateLimitKey } from "@/lib/rate-limit";

const schema = z.object({
  purpose: z.enum(["enable-live", "emergency-exit"]).default("enable-live"),
});

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "live-nonce", user.id), 12, 60_000);
    const body = await readJson(request, schema);
    const origin = await requestOrigin();
    const issued = createActionNonce(user, body.purpose, origin);
    return json({ ...issued, purpose: body.purpose });
  });
}
