import { api, assertSameOrigin, enforceRateLimit, json, requireUser, ApiError } from "@/lib/api";
import { rateLimitKey } from "@/lib/rate-limit";
import { LiveError, withdrawExecutionFunds } from "@/lib/trading/live";

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "live-withdraw", user.id), 2, 60_000);
    try {
      const result = await withdrawExecutionFunds({
        userId: user.id,
        destination: user.authWallet,
      });
      return json(result);
    } catch (error) {
      if (error instanceof LiveError) throw new ApiError(409, error.message, "withdraw_failed");
      throw error;
    }
  });
}
