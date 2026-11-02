import type { PoolSnapshot, TokenInfo } from "../types";

export interface PoolOrientation {
  baseIsX: boolean;
  base: TokenInfo;
  quote: TokenInfo;
  /** Quote tokens per base token. */
  quotePerBase: number;
  basePriceUsd: number;
  quotePriceUsd: number;
}

const QUOTE_SYMBOLS = new Set(["USDC", "USDT", "USD1", "USDS", "SOL", "JITOSOL", "MSOL", "BSOL"]);

export function isQuoteToken(token: TokenInfo): boolean {
  return QUOTE_SYMBOLS.has(token.symbol.toUpperCase());
}

/**
 * Meteora prices are always tokenY per tokenX. Normalise each pool into a
 * base/quote view so USD maths stays correct when the quote asset is tokenX.
 */
export function getPoolOrientation(pool: PoolSnapshot): PoolOrientation | null {
  const xQuote = isQuoteToken(pool.tokenX);
  const yQuote = isQuoteToken(pool.tokenY);
  if (!xQuote && !yQuote) return null;
  if (!yQuote) {
    const quotePerBase = pool.currentPrice > 0 ? 1 / pool.currentPrice : 0;
    return {
      baseIsX: false,
      base: pool.tokenY,
      quote: pool.tokenX,
      quotePerBase,
      basePriceUsd: pool.tokenY.priceUsd || quotePerBase * pool.tokenX.priceUsd,
      quotePriceUsd: pool.tokenX.priceUsd || 1,
    };
  }
  return {
    baseIsX: true,
    base: pool.tokenX,
    quote: pool.tokenY,
    quotePerBase: pool.currentPrice,
    basePriceUsd: pool.tokenX.priceUsd || pool.currentPrice * pool.tokenY.priceUsd,
    quotePriceUsd: pool.tokenY.priceUsd || 1,
  };
}

export function economicPrice(rawPrice: number, orientation: PoolOrientation): number {
  if (rawPrice <= 0) return 0;
  return orientation.baseIsX ? rawPrice : 1 / rawPrice;
}

export function economicRange(
  lowerRaw: number,
  upperRaw: number,
  orientation: PoolOrientation,
): { lowerPrice: number; upperPrice: number } {
  if (orientation.baseIsX) return { lowerPrice: lowerRaw, upperPrice: upperRaw };
  return {
    lowerPrice: upperRaw > 0 ? 1 / upperRaw : 0,
    upperPrice: lowerRaw > 0 ? 1 / lowerRaw : 0,
  };
}

export function isQuotePool(pool: PoolSnapshot): boolean {
  return isQuoteToken(pool.tokenX) || isQuoteToken(pool.tokenY);
}
