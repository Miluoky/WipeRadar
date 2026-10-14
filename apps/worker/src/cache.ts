/**
 * Tiny in-process TTL cache with in-flight coalescing.
 * A page view fans out into ~8 list/count queries; with this, a burst of visitors inside the TTL window
 * costs one database round trip per distinct query. Data changes only once per poll cycle (2 min),
 * so a few seconds of staleness is invisible. With several API instances swap for Redis (same interface).
 */
interface Entry<T> {
  at: number;
  value?: T;
  pending?: Promise<T>;
}

const MAX_ENTRIES = 600;

export class TtlCache {
  private map = new Map<string, Entry<unknown>>();
  hits = 0;
  misses = 0;

  async get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const e = this.map.get(key) as Entry<T> | undefined;
    if (e) {
      if (e.pending) return e.pending; // coalesce concurrent identical requests
      if (now - e.at < ttlMs) {
        this.hits++;
        return e.value as T;
      }
    }
    this.misses++;
    const pending = load().then(
      (value) => {
        this.map.set(key, { at: Date.now(), value });
        return value;
      },
      (err) => {
        this.map.delete(key); // never cache failures
        throw err;
      },
    );
    this.map.set(key, { at: now, pending });
    this.prune(now);
    return pending;
  }

  private prune(now: number) {
    if (this.map.size <= MAX_ENTRIES) return;
    for (const [k, e] of this.map) if (!e.pending && now - e.at > 60_000) this.map.delete(k);
    // still over: drop the oldest quarter
    if (this.map.size > MAX_ENTRIES) {
      const oldest = [...this.map].sort((a, b) => a[1].at - b[1].at).slice(0, MAX_ENTRIES / 4);
      for (const [k] of oldest) this.map.delete(k);
    }
  }

  clear() {
    this.map.clear();
  }
}
