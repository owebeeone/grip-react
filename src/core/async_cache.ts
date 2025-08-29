export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface AsyncCache<K, V> {
  get(key: K): CacheEntry<V> | undefined;
  set(key: K, value: V, ttlMs: number): void;
  delete(key: K): void;
  size(): number;
}

/**
 * Simple LRU + TTL cache suitable for async tap memoization.
 */
export class LruTtlCache<K, V> implements AsyncCache<K, V> {
  private readonly maxEntries: number;
  private readonly map = new Map<K, CacheEntry<V>>();

  constructor(maxEntries = 200) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get(key: K): CacheEntry<V> | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > 0 && entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh LRU
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: K, value: V, ttlMs: number): void {
    const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : 0;
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt });
    this.evictIfNeeded();
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  size(): number { return this.map.size; }

  private evictIfNeeded(): void {
    if (this.map.size <= this.maxEntries) return;
    // Evict oldest until under capacity
    const overflow = this.map.size - this.maxEntries;
    for (let i = 0; i < overflow; i++) {
      const firstKey = this.map.keys().next().value as K | undefined;
      if (firstKey === undefined) break;
      this.map.delete(firstKey);
    }
  }
}


