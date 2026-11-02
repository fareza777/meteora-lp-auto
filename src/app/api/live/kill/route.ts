import { api, assertSameOrigin, json, requireUser } from "@/lib/api";
import { setKillSwitch } from "@/lib/auth";
import { logActivity, pauseAllBots } from "@/lib/store";
import { getLiveReadiness } from "@/lib/trading/live";

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    setKillSwitch(user.id, true);
    const paused = pauseAllBots(user.id);
    logActivity({
      userId: user.id,
      level: "warning",
      category: "risk",
      message: `Kill switch engaged. ${paused} bot(s) paused; live trading disarmed.`,
    });
    return json({ readiness: getLiveReadiness(user.id), paused });
  });
}
