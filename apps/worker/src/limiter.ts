/**
 * Runs `fn` over items with a global concurrency cap and a per-key cap
 * (key = host IP: one box often runs dozens of Rust servers, and its anti-DDoS
 * will drop us if we burst it).
 */
export async function mapLimited<T, R>(
  items: T[],
  opts: { concurrency: number; perKey: number; key: (t: T) => string },
  fn: (t: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const active = new Map<string, number>();
  const queue = items.map((item, i) => ({ item, i }));
  let running = 0;

  return new Promise((resolve) => {
    if (queue.length === 0) return resolve(results);
    let finished = 0;

    const pump = () => {
      for (let qi = 0; qi < queue.length && running < opts.concurrency;) {
        const { item, i } = queue[qi];
        const k = opts.key(item);
        if ((active.get(k) ?? 0) >= opts.perKey) {
          qi++;
          continue;
        }
        queue.splice(qi, 1);
        running++;
        active.set(k, (active.get(k) ?? 0) + 1);
        fn(item)
          .then(
            (value) => (results[i] = { status: "fulfilled", value }),
            (reason) => (results[i] = { status: "rejected", reason }),
          )
          .finally(() => {
            running--;
            active.set(k, active.get(k)! - 1);
            if (++finished === items.length) resolve(results);
            else pump();
          });
      }
    };
    pump();
  });
}
