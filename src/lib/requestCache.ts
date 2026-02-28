/**
 * Lightweight in-memory request cache for repeated AI calls.
 * Uses TTL + simple LRU eviction to keep behavior predictable.
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  lastAccessAt: number;
};

class RequestCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = 200) {
    this.maxEntries = maxEntries;
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    entry.lastAccessAt = Date.now();
    this.store.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    const now = Date.now();
    this.store.set(key, {
      value,
      expiresAt: now + Math.max(1, ttlMs),
      lastAccessAt: now,
    });
    this.evictIfNeeded();
  }

  clear(): void {
    this.store.clear();
  }

  private evictIfNeeded(): void {
    if (this.store.size <= this.maxEntries) return;
    const entries = Array.from(this.store.entries());
    entries.sort((a, b) => a[1].lastAccessAt - b[1].lastAccessAt);
    const excess = this.store.size - this.maxEntries;
    for (let i = 0; i < excess; i++) {
      this.store.delete(entries[i][0]);
    }
  }
}

const cache = new RequestCache(250);

export function getCached<T>(key: string): T | null {
  return cache.get<T>(key);
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  cache.set<T>(key, value, ttlMs);
}

export function clearRequestCache(): void {
  cache.clear();
}

export function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv32-${(hash >>> 0).toString(16)}`;
}

export function normalizeMessage(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function buildCacheKey(parts: Array<string | number | boolean | undefined>): string {
  return hashString(
    parts
      .filter((p) => p !== undefined)
      .map((p) => String(p))
      .join("::"),
  );
}
