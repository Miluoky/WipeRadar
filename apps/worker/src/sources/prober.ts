/**
 * Client for the Rust prober service (services/prober). One HTTP call carries up to
 * 5000 targets; the prober fans them out over a single UDP socket with per-host limits.
 */
interface ProbeResult {
  addr: string;
  ok: boolean;
  rules?: Record<string, string>;
  error?: string;
}

const CHUNK = 5000;

export async function probeRules(
  baseUrl: string,
  targets: { ip: string; queryPort: number }[],
): Promise<(Record<string, string> | Error)[]> {
  const out: (Record<string, string> | Error)[] = [];
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const res = await fetch(`${baseUrl}/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targets: chunk.map((t) => `${t.ip}:${t.queryPort}`), info: false, rules: true, timeoutMs: 2500 }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`prober ${res.status}`);
    const results = (await res.json()) as ProbeResult[];
    for (const r of results) out.push(r.rules ?? new Error(r.error ?? "no rules"));
  }
  return out;
}
