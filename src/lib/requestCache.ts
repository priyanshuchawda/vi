/**
 * Request cache for repeated AI calls.
 * Uses in-memory LRU + localStorage persistence for cross-reload reuse.
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  lastAccessAt: number;
};

class RequestCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;
  private readonly storageKey: string;

  constructor(maxEntries: number = 200, storageKey: string = 'qc_request_cache_v2') {
    this.maxEntries = maxEntries;
    this.storageKey = storageKey;
    this.hydrate();
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.persist();
      return null;
    }
    entry.lastAccessAt = Date.now();
    this.store.set(key, entry);
    this.persist();
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
    this.persist();
  }

  clear(): void {
    this.store.clear();
    this.persist();
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

  private hydrate(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<[string, CacheEntry<unknown>]>;
      const now = Date.now();
      for (const [key, entry] of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        if (now > entry.expiresAt) continue;
        this.store.set(key, entry);
      }
      this.evictIfNeeded();
    } catch {
      // ignore corrupted cache payloads
    }
  }

  private persist(): void {
    if (typeof window === 'undefined') return;
    try {
      const entries = Array.from(this.store.entries());
      localStorage.setItem(this.storageKey, JSON.stringify(entries));
    } catch {
      // ignore storage failures
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
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildCacheKey(parts: Array<string | number | boolean | undefined>): string {
  return hashString(
    parts
      .filter((p) => p !== undefined)
      .map((p) => String(p))
      .join('::'),
  );
}

export function buildSemanticCacheKey(input: {
  intent: string;
  modelId: string;
  message: string;
  historyHash?: string;
  snapshotHash?: string;
  toolSignature?: string;
  mode?: string;
  extra?: string;
}): string {
  return buildCacheKey([
    'semantic',
    input.intent,
    input.modelId,
    normalizeMessage(input.message),
    input.historyHash,
    input.snapshotHash,
    input.toolSignature,
    input.mode,
    input.extra,
  ]);
}
