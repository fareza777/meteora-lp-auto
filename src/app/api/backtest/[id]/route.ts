import { api, json, requireUser, ApiError } from "@/lib/api";
import { getBacktest } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const record = getBacktest(user.id, id);
    if (!record) throw new ApiError(404, "Backtest not found.", "not_found");
    return json({ backtest: record });
  });
}
