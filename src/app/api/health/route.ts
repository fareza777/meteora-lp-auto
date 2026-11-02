import { json } from "@/lib/api";
import { getConfig, isLiveGloballyEnabled, validateLiveRpc } from "@/lib/config";
import { isSqliteReady } from "@/lib/db";

export async function GET() {
  const config = getConfig();
  const rpc = validateLiveRpc();
  return json({
    ok: isSqliteReady(),
    service: "tide-lp",
    version: "1.0.0",
    time: Date.now(),
    liveEnabled: isLiveGloballyEnabled(),
    liveRpcReady: rpc.ok,
    botScheduler: config.botEnabled,
    cluster: config.cluster,
  });
}
