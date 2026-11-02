import { api, assertSameOrigin, enforceRateLimit, json, readJson, requireUser, ApiError } from "@/lib/api";
import { setKillSwitch, verifyActionSignature } from "@/lib/auth";
import { rateLimitKey } from "@/lib/rate-limit";
import { exitAllSchema } from "@/lib/schemas";
import { getPositions, logActivity, pauseAllBots } from "@/lib/store";
import { closeAllLivePositions } from "@/lib/trading/live";
import { closePaperPosition, refreshPaperPositionsForUser } from "@/lib/trading/paper";

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "exit-all", user.id), 4, 60_000);
    const body = await readJson(request, exitAllSchema);

    if (body.mode === "live") {
      if (!body.nonce || !body.signature) {
        throw new ApiError(403, "Sign the emergency exit message to close live positions.", "signature_required");
      }
      const valid = verifyActionSignature({
        user,
        purpose: "emergency-exit",
        nonce: body.nonce,
        signature: body.signature,
      });
      if (!valid) throw new ApiError(403, "The emergency exit signature could not be verified.", "invalid_signature");
      const outcome = await closeAllLivePositions({
        userId: user.id,
        reason: "Emergency exit",
        actor: "manual",
      });
      setKillSwitch(user.id, true);
      pauseAllBots(user.id);
      logActivity({
        userId: user.id,
        level: outcome.errors.length ? "warning" : "success",
        category: "risk",
        message: `Emergency exit closed ${outcome.closed} live position(s); kill switch engaged.`,
        metadata: { errors: outcome.errors },
      });
      return json({ ...outcome, killSwitch: true });
    }

    await refreshPaperPositionsForUser(user.id).catch(() => 0);
    const open = getPositions(user.id, { mode: "paper", status: "open" });
    let closed = 0;
    const errors: string[] = [];
    for (const position of open) {
      try {
        await closePaperPosition({
          userId: user.id,
          positionId: position.id,
          reason: "Emergency exit",
          actor: "manual",
        });
        closed += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Close failed");
      }
    }
    pauseAllBots(user.id);
    logActivity({
      userId: user.id,
      level: errors.length ? "warning" : "success",
      category: "risk",
      message: `Emergency exit closed ${closed} paper position(s); all bots paused.`,
      metadata: { errors },
    });
    return json({ closed, errors, killSwitch: false });
  });
}
