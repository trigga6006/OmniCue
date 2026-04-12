/** Short-TTL cache for expensive bridge reads. */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<unknown>>()

const DEFAULT_TTL_MS = 1500

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key) as CacheEntry<T> | undefined
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return undefined
  }
  return entry.value
}

export function setCached<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/** Run fn with a hard timeout. Returns fallback on timeout. */
export function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs)
    fn().then(
      (v) => { clearTimeout(timer); resolve(v) },
      () => { clearTimeout(timer); resolve(fallback) },
    )
  })
}

/** Run fn, returning cached result if available, otherwise compute and cache. */
export async function cachedCall<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
  timeoutMs = 3000
): Promise<T | undefined> {
  const cached = getCached<T>(key)
  if (cached !== undefined) return cached
  const result = await withTimeout(fn, timeoutMs, undefined as T | undefined)
  if (result !== undefined) setCached(key, result, ttlMs)
  return result
}
