import { api, assertSameOrigin, json } from "@/lib/api";
import { destroySession } from "@/lib/auth";

export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    await destroySession();
    return json({ ok: true });
  });
}
