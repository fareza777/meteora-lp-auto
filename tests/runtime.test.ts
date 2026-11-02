import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLocksForTests, withLock } from "@/lib/concurrency";
import { rateLimit, rateLimitKey, resetRateLimitsForTests } from "@/lib/rate-limit";

afterEach(() => {
  resetLocksForTests();
  resetRateLimitsForTests();
  vi.useRealTimers();
});

describe("withLock", () => {
  it("serialises work that shares a key", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const task = (id: number) =>
      withLock("portfolio:user-1", async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(`start-${id}`);
        await new Promise((resolve) => setTimeout(resolve, 4));
        order.push(`end-${id}`);
        active -= 1;
      });
    await Promise.all([task(1), task(2), task(3)]);
    expect(maxActive).toBe(1);
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]);
  });

  it("releases the lock after a failure", async () => {
    await expect(
      withLock("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    let ran = false;
    await withLock("k", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("keeps different keys independent", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    const blocked = withLock("a", async () => {
      started.push("a");
      await gate;
    });
    const quick = await withLock("b", async () => {
      started.push("b");
      return 42;
    });
    expect(quick).toBe(42);
    expect(started).toContain("a");
    expect(started).toContain("b");
    release();
    await blocked;
  });
});

describe("rateLimit", () => {
  it("allows the limit, blocks the overflow and resets after the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(rateLimit("auth:1.2.3.4", 2, 60_000).ok).toBe(true);
    expect(rateLimit("auth:1.2.3.4", 2, 60_000).ok).toBe(true);
    expect(rateLimit("auth:1.2.3.4", 2, 60_000).ok).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(rateLimit("auth:1.2.3.4", 2, 60_000).ok).toBe(true);
  });

  it("keeps buckets separate per key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    expect(rateLimit("a", 1, 1_000).ok).toBe(true);
    expect(rateLimit("a", 1, 1_000).ok).toBe(false);
    expect(rateLimit("b", 1, 1_000).ok).toBe(true);
  });

  it("derives keys from proxy headers", () => {
    const proxied = new Request("http://localhost/api/test", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(rateLimitKey(proxied, "login", "wallet")).toBe("login:203.0.113.9:wallet");
    const direct = new Request("http://localhost/api/test", { headers: { "x-real-ip": "198.51.100.7" } });
    expect(rateLimitKey(direct, "arm")).toBe("arm:198.51.100.7:");
    expect(rateLimitKey(new Request("http://localhost/api/test"), "anon")).toBe("anon:local:");
  });
});
