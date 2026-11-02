import { Keypair } from "@solana/web3.js";
import { api, assertSameOrigin, json, ApiError } from "@/lib/api";
import { createSession, ensureUserWorkspace } from "@/lib/auth";

function devWallet(): string {
  const seed = new Uint8Array(32).fill(9);
  return Keypair.fromSeed(seed).publicKey.toBase58();
}

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    if (process.env.NODE_ENV === "production" || process.env.DEV_LOGIN_ENABLED !== "true") {
      throw new ApiError(404, "Not found.", "not_found");
    }
    const user = ensureUserWorkspace(devWallet());
    await createSession(user.id, "dev-login");
    return json({ user });
  });
}
