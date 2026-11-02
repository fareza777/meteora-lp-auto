type Bucket = { count: number; resetAt: number };

const globalForLimits = globalThis as unknown as { tideRateBuckets?: Map<string, Bucket> };
const buckets = (globalForLimits.tideRateBuckets ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; resetAt: number } {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + windowMs };
    buckets.set(key, bucket);
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return { ok: true, resetAt: bucket.resetAt };
  }
  existing.count += 1;
  return { ok: existing.count <= limit, resetAt: existing.resetAt };
}

export function rateLimitKey(request: Request, scope: string, suffix = ""): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "local";
  return `${scope}:${ip}:${suffix}`;
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
