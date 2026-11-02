import { z } from "zod";
import { api, assertSameOrigin, enforceRateLimit, json, readJson, ApiError } from "@/lib/api";
import { verifyLoginAndCreateSession } from "@/lib/auth";
import { rateLimitKey } from "@/lib/rate-limit";

const schema = z.object({
  wallet: z.string().min(32).max(44),
  nonce: z.string().min(8).max(200),
  signature: z.string().min(32).max(200),
});

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    enforceRateLimit(rateLimitKey(request, "auth-login"), 15, 60_000);
    const body = await readJson(request, schema);
    const user = await verifyLoginAndCreateSession({
      wallet: body.wallet,
      nonce: body.nonce,
      signature: body.signature,
      userAgent: request.headers.get("user-agent"),
    });
    if (!user) {
      throw new ApiError(401, "The wallet signature could not be verified.", "invalid_signature");
    }
    return json({ user });
  });
}
