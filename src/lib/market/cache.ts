type CacheEntry<T> = {
  value: T;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
};

type CacheStore = Map<string, CacheEntry<unknown>>;
type InFlightStore = Map<string, Promise<CacheResult<unknown>>>;

const globalForCache = globalThis as unknown as {
  tideMarketCache?: CacheStore;
  tideMarketInflight?: InFlightStore;
};

const store = (globalForCache.tideMarketCache ??= new Map());
const inflight = (globalForCache.tideMarketInflight ??= new Map());

export interface CacheResult<T> {
  value: T;
  fetchedAt: number;
  stale: boolean;
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  staleMs: number,
  loader: () => Promise<T>,
): Promise<CacheResult<T>> {
  const now = Date.now();
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expiresAt > now) {
    return { value: entry.value, fetchedAt: entry.fetchedAt, stale: false };
  }
  const active = inflight.get(key) as Promise<CacheResult<T>> | undefined;
  if (active) return active;

  const promise = (async () => {
    try {
      const value = await loader();
      const fetchedAt = Date.now();
      store.set(key, {
        value,
        fetchedAt,
        expiresAt: fetchedAt + ttlMs,
        staleUntil: fetchedAt + Math.max(ttlMs, staleMs),
      });
      return { value, fetchedAt, stale: false };
    } catch (error) {
      if (entry && entry.staleUntil > Date.now()) {
        console.warn(`[market-cache] serving stale ${key}`);
        return { value: entry.value, fetchedAt: entry.fetchedAt, stale: true };
      }
      throw error;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise as Promise<CacheResult<unknown>>);
  return promise;
}

export function peekCache<T>(key: string): CacheEntry<T> | undefined {
  return store.get(key) as CacheEntry<T> | undefined;
}

export function clearMarketCacheForTests(): void {
  store.clear();
  inflight.clear();
}
