import { api, json, requireUser } from "@/lib/api";
import { getActivity, getTransactions } from "@/lib/store";

export async function GET(request: Request) {
  return api(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const limit = Math.min(300, Math.max(1, Number(url.searchParams.get("limit") ?? 120) || 120));
    return json({
      activity: getActivity(user.id, limit),
      transactions: getTransactions(user.id, Math.min(limit, 100)),
    });
  });
}
