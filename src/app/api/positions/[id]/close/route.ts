import { api, assertSameOrigin, enforceRateLimit, json, readJson, requireUser, ApiError } from "@/lib/api";
import { getPoolDetail } from "@/lib/market/meteora";
import { rateLimitKey } from "@/lib/rate-limit";
import { closeSchema } from "@/lib/schemas";
import { getPosition } from "@/lib/store";
import { closeLivePosition } from "@/lib/trading/live";
import { closePaperPosition } from "@/lib/trading/paper";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "position-close", user.id), 30, 60_000);
    const { id } = await context.params;
    const body = await readJson(request, closeSchema.partial());
    const position = getPosition(user.id, id);
    if (!position) throw new ApiError(404, "Position not found.", "not_found");
    if (position.status !== "open") throw new ApiError(409, "Position is already closed.", "already_closed");
    const reason = body.reason ?? "Manual exit";
    if (position.mode === "paper") {
      const pool = await getPoolDetail(position.protocol, position.poolAddress).catch(() => undefined);
      const closed = await closePaperPosition({
        userId: user.id,
        positionId: position.id,
        reason,
        pool,
        actor: "manual",
      });
      return json({ position: closed });
    }
    const closed = await closeLivePosition({
      userId: user.id,
      positionId: position.id,
      reason,
      actor: "manual",
      requireArming: false,
    });
    return json({ position: closed });
  });
}
