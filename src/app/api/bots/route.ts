import { z } from "zod";
import { api, assertSameOrigin, enforceRateLimit, json, readJson, requireUser, ApiError } from "@/lib/api";
import { createDefaultBotConfig } from "@/lib/defaults";
import { rateLimitKey } from "@/lib/rate-limit";
import { botConfigSchema } from "@/lib/schemas";
import { createBot, getBotStats, getBots } from "@/lib/store";

const createSchema = z.object({
  name: z.string().trim().min(1).max(48),
  mode: z.enum(["paper", "live"]),
  config: botConfigSchema.partial().optional(),
});

export async function GET() {
  return api(async () => {
    const user = await requireUser();
    return json({ bots: getBots(user.id), stats: getBotStats(user.id) });
  });
}

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(rateLimitKey(request, "bot-create", user.id), 10, 60_000);
    const body = await readJson(request, createSchema);
    const base = createDefaultBotConfig(body.config?.riskProfile ?? "balanced");
    const merged = botConfigSchema.parse({ ...base, ...body.config });
    try {
      const bot = createBot(user.id, {
        name: body.name,
        status: "paused",
        mode: body.mode,
        config: merged,
      });
      return json({ bot }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/UNIQUE|constraint/i.test(message)) {
        throw new ApiError(409, "A bot with that name already exists.", "duplicate_name");
      }
      throw error;
    }
  });
}
