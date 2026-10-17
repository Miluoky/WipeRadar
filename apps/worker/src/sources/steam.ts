import { queryRules } from "@wiperadar/a2s";
import { ShrinkGuard } from "../guard";
import { log } from "../log";
import { probeRules } from "./prober";

/** Steam's edge occasionally drops connects; retry with backoff before failing the cycle. 4xx is final. */
async function fetchWithRetry(url: URL, attempts = 4): Promise<{ response?: { servers?: SteamServer[] } }> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw Object.assign(new Error(`Steam GetServerList ${res.status}: ${(await res.text()).slice(0, 200)}`), { final: true });
      }
      if (!res.ok) throw new Error(`Steam GetServerList ${res.status}`);
      return (await res.json()) as { response?: { servers?: SteamServer[] } };
    } catch (e) {
      if ((e as { final?: boolean }).final || i >= attempts) throw e;
      const wait = 2000 * 2 ** (i - 1);
      log.warn(`[steam] attempt ${i} failed (${(e as Error).message}), retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
import type { ListEntry, ServerSource } from "./types";

interface SteamServer {
  addr: string; // ip:queryPort
  gameport: number;
  name: string;
  map: string;
  players: number;
  max_players: number;
  gametype?: string; // = A2S keywords
  region?: number;
}

/**
 * Discovery + bulk snapshot through ONE HTTP call per shard:
 * Steam returns name, players and the keywords (incl. born=wipe time) for every server,
 * so wipe detection does not need per-server UDP at all. A2S is used only for RULES
 * (seed, size, description) on new/just-wiped servers.
 *
 * Steam Web API quota: 100k calls/day per key — one call every 2 min uses ~720.
 */
export class SteamSource implements ServerSource {
  readonly name = "steam";
  lastListPartial = false;
  /** per shard: losing the small "has players" shard alone barely dents the total but hides every live server */
  private shardGuards = new Map<string, ShrinkGuard>();

  constructor(
    private key: string,
    private shards: string[],
    private limit: number,
    proberUrl?: string,
  ) {
    if (proberUrl) this.fetchRulesBatch = (targets) => probeRules(proberUrl, targets);
  }

  async fetchList(): Promise<ListEntry[]> {
    const seen = new Map<string, ListEntry>();
    let partial = false;
    for (const filter of this.shards) {
      const url = new URL("https://api.steampowered.com/IGameServersService/GetServerList/v1/");
      url.searchParams.set("key", this.key);
      url.searchParams.set("filter", filter);
      url.searchParams.set("limit", String(this.limit));
      const json = await fetchWithRetry(url);
      const servers = json.response?.servers ?? [];
      if (servers.length >= Math.min(this.limit, 10_000)) {
        log.warn(`[steam] shard "${filter}" hit limit ${this.limit} — split it via LIST_SHARDS`);
      }
      let guard = this.shardGuards.get(filter);
      if (!guard) this.shardGuards.set(filter, (guard = new ShrinkGuard()));
      if (!guard.accept(servers.length)) {
        log.warn(`[steam] shard "${filter}" returned only ${servers.length} servers`);
        partial = true;
      }
      for (const s of servers) {
        const [ip, port] = s.addr.split(":");
        const e: ListEntry = {
          ip,
          queryPort: Number(port),
          gamePort: s.gameport,
          name: s.name,
          map: s.map,
          players: s.players,
          maxPlayers: s.max_players,
          keywords: s.gametype ?? "",
          steamRegion: s.region,
        };
        seen.set(`${ip}:${port}`, e);
      }
    }
    this.lastListPartial = partial;
    return [...seen.values()];
  }

  fetchRules(ip: string, queryPort: number) {
    return queryRules(ip, queryPort, { timeoutMs: 2500, retries: 1 });
  }

  /** Present only when the Rust prober is configured; otherwise the poller uses fetchRules. */
  readonly fetchRulesBatch?: (targets: { ip: string; queryPort: number }[]) => Promise<(Record<string, string> | Error)[]>;
}
