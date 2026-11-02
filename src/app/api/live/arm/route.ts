import { z } from "zod";
import { api, assertSameOrigin, enforceRateLimit, json, readJson, requireUser, ApiError } from "@/lib/api";
import { armLiveTrading, verifyActionSignature } from "@/lib/auth";
import { rateLimitKey } from "@/lib/rate-limit";
import { getLiveReadiness } from "@/lib/trading/live";

const schema = z.object({
  nonce: z.string().min(8).max(200),
  signature: z.string().min(32).max(200),
});

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "live-arm", user.id), 8, 60_000);
    const readiness = getLiveReadiness(user.id);
    if (readiness.killSwitch) {
      throw new ApiError(409, "Disengage the kill switch before arming live trading.", "kill_switch");
    }
    if (!readiness.globallyEnabled) {
      throw new ApiError(409, readiness.reason ?? "Live trading is disabled.", "live_disabled");
    }
    if (!readiness.rpcReady) {
      throw new ApiError(409, readiness.rpcReason ?? "Live RPC is not ready.", "rpc_not_ready");
    }
    if (!readiness.wallet) {
      throw new ApiError(409, "Create an execution wallet first.", "wallet_missing");
    }
    const body = await readJson(request, schema);
    const valid = verifyActionSignature({
      user,
      purpose: "enable-live",
      nonce: body.nonce,
      signature: body.signature,
    });
    if (!valid) throw new ApiError(403, "The arming signature could not be verified.", "invalid_signature");
    const armedUntil = armLiveTrading(user.id);
    return json({ armedUntil, readiness: getLiveReadiness(user.id) });
  });
}
