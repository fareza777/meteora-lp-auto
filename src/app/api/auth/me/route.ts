import { api, json } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { isLiveGloballyEnabled } from "@/lib/config";

export async function GET() {
  return api(async () => {
    const user = await getSessionUser();
    return json({ user, liveEnabled: isLiveGloballyEnabled() });
  });
}
