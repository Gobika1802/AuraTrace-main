type Bucket = { count: number; resetAt: number };

const stores = new Map<string, Map<string, Bucket>>();

/**
 * Simple fixed-window in-memory rate limiter.
 * Suitable for a single API instance; swap for a Redis-backed
 * implementation when running multiple replicas.
 */
export function rateLimit(key: string, limit: number, windowMs: number, id: string): { ok: boolean; remaining: number } {
  const now = Date.now();
  let store = stores.get(key);
  if (!store) {
    store = new Map();
    stores.set(key, store);
  }

  // Periodic cleanup to avoid unbounded growth.
  if (store.size > 5000) {
    for (const [k, bucket] of store) {
      if (bucket.resetAt <= now) store.delete(k);
    }
  }

  let bucket = store.get(id);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    store.set(id, bucket);
  }
  bucket.count += 1;
  return { ok: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count) };
}
