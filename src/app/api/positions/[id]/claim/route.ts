import { api, assertSameOrigin, enforceRateLimit, json, requireUser, ApiError } from "@/lib/api";
import { rateLimitKey } from "@/lib/rate-limit";
import { getPosition } from "@/lib/store";
import { claimLiveFees } from "@/lib/trading/live";
import { claimPaperFees } from "@/lib/trading/paper";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "position-claim", user.id), 30, 60_000);
    const { id } = await context.params;
    const position = getPosition(user.id, id);
    if (!position) throw new ApiError(404, "Position not found.", "not_found");
    if (position.status !== "open") throw new ApiError(409, "Position is already closed.", "already_closed");
    if (position.mode === "paper") {
      const claimed = await claimPaperFees({ userId: user.id, positionId: position.id, actor: "manual" });
      return json({ position: claimed });
    }
    const claimed = await claimLiveFees({ userId: user.id, positionId: position.id, actor: "manual" });
    return json({ position: claimed });
  });
}
