import { api, json, requireUser } from "@/lib/api";
import { getWalletSnapshot } from "@/lib/trading/solana";

export async function GET(request: Request) {
  return api(async () => {
    const user = await requireUser();
    const force = new URL(request.url).searchParams.get("force") === "1";
    const wallet = await getWalletSnapshot(user.id, force);
    return json({ wallet });
  });
}
