export type CacheStats = {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  entries: number;
  hitRate: number;
};

type CacheEntry<V> = { value: V; expiresAt: number };

export class TtlLruCache<K, V> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<K, CacheEntry<V>>();
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;
  private expirationCount = 0;

  constructor(options: { ttlMs: number; maxEntries: number }) {
    if (options.ttlMs <= 0 || options.maxEntries < 1) throw new Error('缓存配置必须为正数');
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) { this.missCount += 1; return undefined; }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this.expirationCount += 1;
      this.missCount += 1;
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hitCount += 1;
    return entry.value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictionCount += 1;
    }
  }

  delete(key: K): void { this.entries.delete(key); }

  peek(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return undefined;
    return entry.value;
  }

  clear(): void { this.entries.clear(); }

  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) { this.entries.delete(key); this.expirationCount += 1; }
    }
  }

  keys(): Iterable<K> { return Array.from(this.entries.keys()); }

  stats(): CacheStats {
    this.prune();
    const requests = this.hitCount + this.missCount;
    return { hits: this.hitCount, misses: this.missCount, evictions: this.evictionCount, expirations: this.expirationCount, entries: this.entries.size, hitRate: requests ? this.hitCount / requests : 0 };
  }
}
