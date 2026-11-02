import { z } from "zod";
import { api, assertSameOrigin, enforceRateLimit, json, readJson, ApiError } from "@/lib/api";
import { canonicalWallet, issueNonce, requestOrigin } from "@/lib/auth";
import { rateLimitKey } from "@/lib/rate-limit";
import { isValidSolanaAddress } from "@/lib/security";

const schema = z.object({ wallet: z.string().min(32).max(44) });

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    enforceRateLimit(rateLimitKey(request, "auth-nonce"), 20, 60_000);
    const { wallet } = await readJson(request, schema);
    if (!isValidSolanaAddress(wallet)) {
      throw new ApiError(400, "Enter a valid Solana wallet address.", "invalid_wallet");
    }
    const origin = await requestOrigin();
    const issued = issueNonce({ wallet: canonicalWallet(wallet), purpose: "login", origin });
    return json(issued);
  });
}
