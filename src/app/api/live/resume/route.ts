import { api, assertSameOrigin, json, requireUser } from "@/lib/api";
import { setKillSwitch } from "@/lib/auth";
import { logActivity } from "@/lib/store";
import { getLiveReadiness } from "@/lib/trading/live";

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    setKillSwitch(user.id, false);
    logActivity({
      userId: user.id,
      level: "info",
      category: "risk",
      message: "Kill switch disengaged. Live trading still requires a fresh 24-hour arming signature.",
    });
    return json({ readiness: getLiveReadiness(user.id) });
  });
}
