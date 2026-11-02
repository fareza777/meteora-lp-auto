import { api, assertSameOrigin, enforceRateLimit, json, requireUser, ApiError } from "@/lib/api";
import { rateLimitKey } from "@/lib/rate-limit";
import { getExecutionWallet } from "@/lib/store";
import { createExecutionWallet, getLiveReadiness, LiveError, removeExecutionWalletSafely } from "@/lib/trading/live";

export async function GET() {
  return api(async () => {
    const user = await requireUser();
    return json({ wallet: getExecutionWallet(user.id), readiness: getLiveReadiness(user.id) });
  });
}

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "live-wallet", user.id), 4, 60_000);
    try {
      const wallet = createExecutionWallet(user.id);
      return json({ wallet, readiness: getLiveReadiness(user.id) }, { status: 201 });
    } catch (error) {
      if (error instanceof LiveError) throw new ApiError(409, error.message, "wallet_exists");
      throw error;
    }
  });
}

export async function DELETE(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "live-wallet", user.id), 4, 60_000);
    try {
      removeExecutionWalletSafely(user.id);
      return json({ wallet: null, readiness: getLiveReadiness(user.id) });
    } catch (error) {
      if (error instanceof LiveError) throw new ApiError(409, error.message, "wallet_in_use");
      throw error;
    }
  });
}
