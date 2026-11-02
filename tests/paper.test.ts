import { describe, expect, it } from "vitest";
import { PAPER_NETWORK_FEE_USD, MIN_POSITION_USD, recommendedPaperAction } from "@/lib/trading/paper";
import { makePosition } from "./helpers/fixtures";

const base = {
  stopLossPct: 10,
  takeProfitPct: 50,
  outOfRangeMinutes: 45,
  claimIntervalMinutes: 720,
  now: 1_800_000_000_000,
};

describe("recommendedPaperAction", () => {
  it("cuts losses before anything else", () => {
    const position = makePosition({ pnlPct: -12, inRange: false, outOfRangeSince: base.now - 3_600_000 });
    expect(recommendedPaperAction(position, base)).toBe("stop_loss");
  });

  it("takes profit at the configured threshold", () => {
    expect(recommendedPaperAction(makePosition({ pnlPct: 51 }), base)).toBe("take_profit");
    expect(recommendedPaperAction(makePosition({ pnlPct: 49 }), base)).toBe("hold");
  });

  it("rebalances only after the out-of-range grace period", () => {
    const early = makePosition({
      inRange: false,
      outOfRangeSince: base.now - 20 * 60_000,
    });
    const late = makePosition({
      inRange: false,
      outOfRangeSince: base.now - 46 * 60_000,
    });
    expect(recommendedPaperAction(early, base)).toBe("hold");
    expect(recommendedPaperAction(late, base)).toBe("out_of_range");
  });

  it("claims fees after the interval when enough has accrued", () => {
    const ready = makePosition({
      unclaimedFeesUsd: 2,
      lastClaimedAt: base.now - 721 * 60_000,
    });
    const tiny = makePosition({
      unclaimedFeesUsd: 0.4,
      lastClaimedAt: base.now - 7_200 * 60_000,
    });
    expect(recommendedPaperAction(ready, base)).toBe("claim");
    expect(recommendedPaperAction(tiny, base)).toBe("hold");
  });

  it("falls back to the open time when fees were never claimed", () => {
    const stale = makePosition({
      unclaimedFeesUsd: 5,
      lastClaimedAt: null,
      openedAt: base.now - 800 * 60_000,
    });
    const fresh = makePosition({
      unclaimedFeesUsd: 5,
      lastClaimedAt: null,
      openedAt: base.now - 30 * 60_000,
    });
    expect(recommendedPaperAction(stale, base)).toBe("claim");
    expect(recommendedPaperAction(fresh, base)).toBe("hold");
  });

  it("holds a healthy position", () => {
    expect(recommendedPaperAction(makePosition(), base)).toBe("hold");
  });

  it("exposes the paper cost constants", () => {
    expect(PAPER_NETWORK_FEE_USD).toBeGreaterThan(0);
    expect(MIN_POSITION_USD).toBeGreaterThanOrEqual(10);
  });
});
