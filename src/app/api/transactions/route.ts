import { api, json, requireUser } from "@/lib/api";
import { getTransactions } from "@/lib/store";

export async function GET(request: Request) {
  return api(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 60) || 60));
    return json({ transactions: getTransactions(user.id, limit) });
  });
}
