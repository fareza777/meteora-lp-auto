import { describe, expect, it } from "vitest";
import {
  economicPrice,
  economicRange,
  getPoolOrientation,
  isQuotePool,
  isQuoteToken,
} from "@/lib/market/orientation";
import { makePool } from "./helpers/fixtures";

describe("quote detection", () => {
  it("recognises major quote symbols", () => {
    expect(isQuoteToken(makePool().tokenY)).toBe(true);
    expect(isQuoteToken(makePool().tokenX)).toBe(true);
    expect(isQuoteToken({ ...makePool().tokenX, symbol: "BONK" })).toBe(false);
  });

  it("detects pools with at least one quote asset", () => {
    expect(isQuotePool(makePool())).toBe(true);
    const noQuote = makePool({
      tokenX: { ...makePool().tokenX, symbol: "BONK" },
      tokenY: { ...makePool().tokenY, symbol: "WIF" },
    });
    expect(isQuotePool(noQuote)).toBe(false);
    expect(getPoolOrientation(noQuote)).toBeNull();
  });
});

describe("getPoolOrientation", () => {
  it("treats tokenY as the quote when it is USDC", () => {
    const orientation = getPoolOrientation(makePool())!;
    expect(orientation.baseIsX).toBe(true);
    expect(orientation.base.symbol).toBe("SOL");
    expect(orientation.quote.symbol).toBe("USDC");
    expect(orientation.quotePerBase).toBe(200);
    expect(orientation.quotePriceUsd).toBe(1);
    expect(orientation.basePriceUsd).toBe(200);
  });

  it("inverts the price when the quote sits in tokenX", () => {
    const pool = makePool({
      tokenX: { ...makePool().tokenY },
      tokenY: {
        ...makePool().tokenX,
        address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
        symbol: "JUP",
        name: "Jupiter",
        priceUsd: 0.8,
      },
      currentPrice: 1.25,
    });
    const orientation = getPoolOrientation(pool)!;
    expect(orientation.baseIsX).toBe(false);
    expect(orientation.base.symbol).toBe("JUP");
    expect(orientation.quote.symbol).toBe("USDC");
    expect(orientation.quotePerBase).toBeCloseTo(0.8, 8);
    expect(economicPrice(1.25, orientation)).toBeCloseTo(0.8, 8);
    expect(economicPrice(0, orientation)).toBe(0);
  });

  it("keeps raw ranges when base is tokenX and inverts otherwise", () => {
    const standard = getPoolOrientation(makePool())!;
    expect(economicRange(188, 212, standard)).toEqual({ lowerPrice: 188, upperPrice: 212 });

    const inverted = getPoolOrientation(
      makePool({
        tokenX: { ...makePool().tokenY },
        tokenY: {
          ...makePool().tokenX,
          address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
          symbol: "JUP",
          name: "Jupiter",
          priceUsd: 0.8,
        },
        currentPrice: 1.25,
      }),
    )!;
    const range = economicRange(1.2, 1.3, inverted);
    expect(range.lowerPrice).toBeCloseTo(1 / 1.3, 8);
    expect(range.upperPrice).toBeCloseTo(1 / 1.2, 8);
    expect(range.lowerPrice).toBeLessThan(range.upperPrice);
    expect(economicRange(0, 0, inverted)).toEqual({ lowerPrice: 0, upperPrice: 0 });
  });
});
