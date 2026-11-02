import { api, assertSameOrigin, json, requireUser } from "@/lib/api";
import { disarmLiveTrading } from "@/lib/auth";
import { getLiveReadiness } from "@/lib/trading/live";

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    disarmLiveTrading(user.id);
    return json({ readiness: getLiveReadiness(user.id) });
  });
}
