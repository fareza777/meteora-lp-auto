type LockEntry = { tail: Promise<unknown> };

const globalForLocks = globalThis as unknown as { tideLocks?: Map<string, LockEntry> };
const locks = (globalForLocks.tideLocks ??= new Map());

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key)?.tail ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  locks.set(key, { tail });
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key)?.tail === tail) locks.delete(key);
  }
}

export function resetLocksForTests() {
  locks.clear();
}
