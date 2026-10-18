import { joinDescription } from "@wiperadar/a2s";
import { predictNextWipe, stripRichText, type Cadence } from "@wiperadar/shared";
import { matchOfficial, nextOfficialWipe } from "@wiperadar/shared/official";
import { config } from "./config";
import type { Db } from "./db";
import { publish } from "./events";
import { ShrinkGuard } from "./guard";
import { deriveRow, detectWipe, wipeKind, type DerivedRow } from "./ingest";
import { mapLimited } from "./limiter";
import { counters, log } from "./log";
import { getServerSummaries, getStats } from "./repo";
import type { ServerSource } from "./sources/types";

interface Known {
  id: number;
  bornAt: Date | null;
}

const CHUNK = 2000;

/**
 * Only absolute URLs from server RULES reach the page; anything else is dropped.
 * Images must be https: plain http would be mixed content on the https site (blocked or flagged).
 * Plain links may stay http.
 */
export function ruleUrl(v: string | undefined, { image = false } = {}): string | null {
  if (!v) return null;
  try {
    const u = new URL(v.trim());
    const ok = u.protocol === "https:" || (!image && u.protocol === "http:");
    return ok ? u.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

/** What /api/health reports about the discovery loop. */
export interface PollStatus {
  startedAt: Date;
  lastCycleAt: Date | null;
  lastCycleMs: number | null;
  lastError: { at: Date; message: string } | null;
  servers: number;
}

export class Poller {
  readonly status: PollStatus = { startedAt: new Date(), lastCycleAt: null, lastCycleMs: null, lastError: null, servers: 0 };
  private known = new Map<string, Known>();
  private lastFullPredict = 0;
  private running = false;
  private listGuard = new ShrinkGuard();
  private rulesPass: Promise<void> | null = null;

  constructor(
    private db: Db,
    private source: ServerSource,
  ) {}

  get idByAddr() {
    return new Map([...this.known].map(([k, v]) => [k, v.id]));
  }

  async init() {
    const { rows } = await this.db.query<{ id: number; ip: string; query_port: number; born_at: Date | null }>(
      `SELECT id, ip, query_port, born_at FROM servers`,
    );
    for (const r of rows) this.known.set(`${r.ip}:${r.query_port}`, { id: r.id, bornAt: r.born_at && new Date(r.born_at) });
    // after a restart the first snapshot is compared against what was online before it
    const { rows: online } = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM servers WHERE online`);
    this.listGuard = new ShrinkGuard(online[0]?.n ?? 0);
  }

  /**
   * One discovery cycle: snapshot → upsert → wipes → metrics → offline → predictions.
   * RULES run afterwards in their own pass, so slow UDP queries never delay the next snapshot (wipe detection).
   */
  async cycle() {
    if (this.running) return;
    this.running = true;
    const t0 = performance.now();
    try {
      const now = new Date();
      const list = await this.source.fetchList();
      const rows = list.map((e) => deriveRow(e, now));

      const ids = await this.upsert(rows, now);
      const wiped = await this.recordWipes(rows, ids, now);
      await this.recordMetrics(rows, ids, now);
      // an empty/truncated answer from Steam must not push the rest of the world offline
      const trusted = this.listGuard.accept(rows.length) && !this.source.lastListPartial;
      if (trusted) await this.markMissing(new Set(ids));
      else {
        counters.truncatedLists++;
        log.warn(`[poll] list looks truncated (${rows.length} servers), not marking missing servers offline`, {
          servers: rows.length,
        });
      }
      await this.refreshPredictions(wiped);

      for (const server of await getServerSummaries(this.db, wiped.fresh)) publish({ type: "wipe", server });
      publish({ type: "tick", stats: await getStats(this.db, config.demo) });
      Object.assign(this.status, {
        lastCycleAt: new Date(),
        lastCycleMs: Math.round(performance.now() - t0),
        servers: rows.length,
      });
      const ms = Math.round(performance.now() - t0);
      counters.pollCycles++;
      counters.wipesDetected += wiped.all.length;
      counters.liveWipes += wiped.fresh.length;
      log.info(
        `[poll] ${this.source.name}: ${rows.length} servers, ${wiped.all.length} wipes (${wiped.fresh.length} live) in ${ms}ms`,
        { event: "poll", source: this.source.name, servers: rows.length, wipes: wiped.all.length, live: wiped.fresh.length, ms },
      );
      void this.rulesCycle();
    } catch (e) {
      counters.pollFailures++;
      log.error("[poll] cycle failed", { event: "poll_failed", error: e });
      this.status.lastError = { at: new Date(), message: (e as Error).message ?? String(e) };
    } finally {
      this.running = false;
    }
  }

  /** One RULES pass; while one is running, returns that pass instead of starting another. */
  rulesCycle(): Promise<void> {
    this.rulesPass ??= this.refreshRules()
      .catch((e) => log.error("[rules] pass failed", { event: "rules_failed", error: e }))
      .finally(() => (this.rulesPass = null));
    return this.rulesPass;
  }

  private async upsert(rows: DerivedRow[], now: Date): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const c = rows.slice(i, i + CHUNK);
      const col = <K extends keyof DerivedRow>(k: K) => c.map((r) => r[k]);
      const { rows: out } = await this.db.query<{ id: number; ip: string; query_port: number }>(
        `INSERT INTO servers (ip, query_port, game_port, name, map, players, max_players, queue, region, country,
                              rate, group_limit, type, cadence, tags, build, born_at, hostname_wipe_date, suspicious,
                              search_key, peak_players, online, misses, last_seen_at)
         SELECT u.ip, u.qp, u.gp, u.name, u.map, u.pl, u.mx, u.qu, u.region, u.country, u.rate, u.grp, u.type, u.cadence,
                string_to_array(u.tags, ','), u.build, u.born, u.hdate, u.sus, u.skey, u.pl, true, 0, $20
         FROM unnest($1::text[], $2::int[], $3::int[], $4::text[], $5::text[], $6::int[], $7::int[], $8::int[],
                     $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[], $15::text[],
                     $16::text[], $17::timestamptz[], $18::date[], $19::bool[], $21::text[])
              AS u(ip, qp, gp, name, map, pl, mx, qu, region, country, rate, grp, type, cadence, tags, build, born, hdate, sus, skey)
         ON CONFLICT (ip, query_port) DO UPDATE SET
           game_port = EXCLUDED.game_port, name = EXCLUDED.name, map = EXCLUDED.map,
           players = EXCLUDED.players, max_players = EXCLUDED.max_players, queue = EXCLUDED.queue,
           region = COALESCE(EXCLUDED.region, servers.region), country = COALESCE(EXCLUDED.country, servers.country),
           rate = EXCLUDED.rate, group_limit = EXCLUDED.group_limit, type = EXCLUDED.type,
           cadence = COALESCE(EXCLUDED.cadence, servers.cadence), tags = EXCLUDED.tags, build = EXCLUDED.build,
           born_at = COALESCE(EXCLUDED.born_at, servers.born_at), hostname_wipe_date = EXCLUDED.hostname_wipe_date,
           suspicious = EXCLUDED.suspicious, search_key = EXCLUDED.search_key,
           peak_players = GREATEST(servers.peak_players, EXCLUDED.players), online = true, misses = 0, last_seen_at = EXCLUDED.last_seen_at
         RETURNING id, ip, query_port`,
        [
          col("ip"),
          col("queryPort"),
          col("gamePort"),
          col("name"),
          col("map"),
          col("players"),
          col("maxPlayers"),
          col("queue"),
          col("region"),
          col("country"),
          col("rate"),
          col("groupLimit"),
          col("type"),
          col("cadence"),
          c.map((r) => r.tags.join(",")),
          col("build"),
          c.map((r) => r.bornAt?.toISOString() ?? null),
          col("hostnameWipeDate"),
          col("suspicious"),
          now.toISOString(),
          col("searchKey"),
        ],
      );
      const byAddr = new Map(out.map((o) => [`${o.ip}:${o.query_port}`, o.id]));
      for (const r of c) ids.push(byAddr.get(`${r.ip}:${r.queryPort}`)!);
    }
    return ids;
  }

  private async recordWipes(rows: DerivedRow[], ids: number[], now: Date) {
    const all: number[] = [];
    const fresh: number[] = [];
    const sid: number[] = [];
    const at: string[] = [];
    const kind: string[] = [];
    const by: string[] = [];
    rows.forEach((r, i) => {
      const addr = `${r.ip}:${r.queryPort}`;
      const prev = this.known.get(addr);
      const verdict = detectWipe(prev?.bornAt ?? null, r.bornAt);
      this.known.set(addr, { id: ids[i], bornAt: verdict ? r.bornAt : (prev?.bornAt ?? r.bornAt) });
      if (!verdict || !r.bornAt) return;
      all.push(ids[i]);
      sid.push(ids[i]);
      at.push(r.bornAt.toISOString());
      kind.push(wipeKind(r.bornAt));
      by.push(verdict === "initial" ? "born-initial" : "born");
      // only real transitions within the last 2h go to the live feed
      if (verdict === "wipe" && now.getTime() - r.bornAt.getTime() < 2 * 3_600_000) fresh.push(ids[i]);
    });
    if (sid.length) {
      await this.db.query(
        `INSERT INTO wipes (server_id, wiped_at, kind, map, detected_by)
         SELECT u.sid, u.at, u.kind, s.map, u.by
         FROM unnest($1::int[], $2::timestamptz[], $3::text[], $4::text[]) AS u(sid, at, kind, by)
         JOIN servers s ON s.id = u.sid
         ON CONFLICT DO NOTHING`,
        [sid, at, kind, by],
      );
      // new map → seed/size must be re-read
      await this.db.query(
        `UPDATE servers s SET last_wipe_at = u.at, rules_checked_at = NULL, next_wipe_at = NULL, peak_players = s.players
         FROM unnest($1::int[], $2::timestamptz[]) AS u(sid, at) WHERE s.id = u.sid`,
        [sid, at],
      );
    }
    return { all, fresh };
  }

  private async recordMetrics(rows: DerivedRow[], ids: number[], now: Date) {
    // 5-minute buckets: repeated polls inside a bucket overwrite (keeps the table small)
    const bucket = new Date(Math.floor(now.getTime() / 300_000) * 300_000).toISOString();
    for (let i = 0; i < rows.length; i += CHUNK) {
      const c = rows.slice(i, i + CHUNK);
      await this.db.query(
        `INSERT INTO metrics (server_id, ts, players, queue)
         SELECT u.sid, $4::timestamptz, LEAST(u.pl, 32767), LEAST(u.qu, 32767)
         FROM unnest($1::int[], $2::int[], $3::int[]) AS u(sid, pl, qu)
         -- ~75% of Rust servers sit empty: store only non-zero samples, charts fill gaps with 0
         WHERE u.pl > 0 OR u.qu > 0
         ON CONFLICT (server_id, ts) DO UPDATE SET players = EXCLUDED.players, queue = EXCLUDED.queue`,
        [ids.slice(i, i + CHUNK), c.map((r) => r.players), c.map((r) => r.queue), bucket],
      );
    }
  }

  private async markMissing(seen: Set<number>) {
    const missing = [...this.known.values()].map((k) => k.id).filter((id) => !seen.has(id));
    if (!missing.length) return;
    await this.db.query(
      `UPDATE servers SET misses = misses + 1, online = (misses + 1) < $2, players = 0, queue = 0
       WHERE id = ANY($1::int[])`,
      [missing, config.offlineAfterMisses],
    );
  }

  /** A2S_RULES for new / just-wiped / stale servers: seed, size, description, url. */
  private async refreshRules() {
    const { rows } = await this.db.query<{ id: number; ip: string; query_port: number; last_wipe_at: Date | null }>(
      `SELECT id, ip, query_port, last_wipe_at FROM servers
       WHERE online AND (rules_checked_at IS NULL OR rules_checked_at < now() - make_interval(hours => $1))
       ORDER BY rules_checked_at NULLS FIRST, players DESC LIMIT 3000`,
      [config.rulesTtlHours],
    );
    if (!rows.length) return;
    let results: PromiseSettledResult<Record<string, string>>[] | null = null;
    if (this.source.fetchRulesBatch) {
      try {
        results = (await this.source.fetchRulesBatch(rows.map((r) => ({ ip: r.ip, queryPort: r.query_port })))).map((v) =>
          v instanceof Error ? { status: "rejected", reason: v } : { status: "fulfilled", value: v },
        );
      } catch (e) {
        // prober down or not started — degrade to the in-process client instead of losing the cycle
        log.warn(`[rules] prober unavailable (${(e as Error).message}), using Node A2S`);
      }
    }
    results ??= await mapLimited(
      rows,
      { concurrency: config.rulesConcurrency, perKey: config.perHostConcurrency, key: (r) => r.ip },
      (r) => this.source.fetchRules(r.ip, r.query_port),
    );
    // one batched UPDATE per table instead of a query per server (up to 3000 per cycle)
    const failed: number[] = [];
    const ok = {
      id: [] as number[],
      seed: [] as (number | null)[],
      size: [] as (number | null)[],
      desc: [] as (string | null)[],
      url: [] as (string | null)[],
      header: [] as (string | null)[],
      fps: [] as (number | null)[],
      ents: [] as (number | null)[],
      logo: [] as (string | null)[],
      mapImg: [] as (string | null)[],
    };
    const wipe = { id: [] as number[], at: [] as string[], seed: [] as (number | null)[], size: [] as (number | null)[] };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const res = results[i];
      if (res.status === "rejected") {
        // don't hammer servers that block RULES — retry after TTL
        failed.push(r.id);
        continue;
      }
      const rules = res.value;
      const num = (k: string) => (rules[k] && Number.isFinite(Number(rules[k])) ? Math.round(Number(rules[k])) : null);
      const seed = num("world.seed");
      const size = num("world.size");
      const desc = joinDescription(rules);
      ok.id.push(r.id);
      ok.seed.push(seed);
      ok.size.push(size);
      ok.desc.push(desc ? stripRichText(desc).trim().slice(0, 4000) || null : null);
      ok.url.push(ruleUrl(rules.url));
      ok.header.push(ruleUrl(rules.headerimage, { image: true }));
      ok.fps.push(num("fps_avg"));
      ok.ents.push(num("ent_cnt"));
      ok.logo.push(ruleUrl(rules.logoimage, { image: true }));
      ok.mapImg.push(ruleUrl(rules.map_image_url, { image: true }));
      if (r.last_wipe_at) {
        wipe.id.push(r.id);
        wipe.at.push(new Date(r.last_wipe_at).toISOString());
        wipe.seed.push(seed);
        wipe.size.push(size);
      }
    }
    if (failed.length) {
      await this.db.query(`UPDATE servers SET rules_checked_at = now() WHERE id = ANY($1::int[])`, [failed]);
    }
    if (ok.id.length) {
      await this.db.query(
        `UPDATE servers s SET seed = u.seed, world_size = u.size, description = u.descr, url = u.url, header_image = u.header,
                fps = u.fps, entities = u.ents, logo_image = u.logo, map_image = u.map_img, rules_checked_at = now()
         FROM unnest($1::int[], $2::bigint[], $3::int[], $4::text[], $5::text[], $6::text[], $7::int[], $8::int[],
                     $9::text[], $10::text[]) AS u(id, seed, size, descr, url, header, fps, ents, logo, map_img)
         WHERE s.id = u.id`,
        [ok.id, ok.seed, ok.size, ok.desc, ok.url, ok.header, ok.fps, ok.ents, ok.logo, ok.mapImg],
      );
    }
    if (wipe.id.length) {
      await this.db.query(
        `UPDATE wipes w SET seed = COALESCE(w.seed, u.seed), world_size = COALESCE(w.world_size, u.size)
         FROM unnest($1::int[], $2::timestamptz[], $3::bigint[], $4::int[]) AS u(id, at, seed, size)
         WHERE w.server_id = u.id AND w.wiped_at = u.at`,
        [wipe.id, wipe.at, wipe.seed, wipe.size],
      );
    }
    counters.rulesOk += ok.id.length;
    counters.rulesFailed += failed.length;
    log.info(`[rules] ${ok.id.length}/${rows.length} ok`, { event: "rules", ok: ok.id.length, failed: failed.length });
  }

  /** Next-wipe predictions: all servers every 10 min, plus wiped/unknown ones every cycle. */
  private async refreshPredictions(wiped: { all: number[] }) {
    const full = Date.now() - this.lastFullPredict > 10 * 60_000;
    if (full) this.lastFullPredict = Date.now();
    const { rows } = await this.db.query<{
      id: number;
      name: string;
      cadence: Cadence | null;
      last_wipe_at: Date | null;
      hostname_wipe_date: string | Date | null;
      owner_next: Date | null;
      history: (string | Date)[] | null;
    }>(
      `SELECT s.id, s.name, s.cadence, s.last_wipe_at, s.hostname_wipe_date, ws.next_at AS owner_next,
              (SELECT array_agg(w.wiped_at ORDER BY w.wiped_at) FROM wipes w
                WHERE w.server_id = s.id AND w.wiped_at > now() - interval '120 days') AS history
       FROM servers s LEFT JOIN wipe_schedules ws ON ws.server_id = s.id
       WHERE s.online AND ($1 OR s.next_wipe_at IS NULL OR s.next_wipe_at < now() OR s.id = ANY($2::int[]))`,
      [full, wiped.all],
    );
    if (!rows.length) return;
    const now = new Date();
    const ids: number[] = [];
    const at: string[] = [];
    const src: string[] = [];
    for (const r of rows) {
      const official = matchOfficial(r.name);
      const p = predictNextWipe({
        now,
        lastWipe: r.last_wipe_at && new Date(r.last_wipe_at),
        cadence: r.cadence,
        history: (r.history ?? []).map((d) => new Date(d)),
        hostnameDate: r.hostname_wipe_date ? new Date(r.hostname_wipe_date) : null,
        ownerNext: r.owner_next && new Date(r.owner_next),
        officialNext: official?.schedule ? nextOfficialWipe(official.schedule, now) : null,
      });
      ids.push(r.id);
      at.push(p.at.toISOString());
      src.push(p.source);
    }
    await this.db.query(
      `UPDATE servers s SET next_wipe_at = u.at, next_wipe_source = u.src
       FROM unnest($1::int[], $2::timestamptz[], $3::text[]) AS u(id, at, src) WHERE s.id = u.id`,
      [ids, at, src],
    );
  }

  /** Recompute every prediction on the next cycle (e.g. after a history backfill). */
  forceFullPredict() {
    this.lastFullPredict = 0;
  }

  private timescale?: boolean;

  async pruneMetrics() {
    await this.db.query(`DELETE FROM metrics_hourly WHERE hour < now() - make_interval(days => $1)`, [
      config.metricsHourlyRetentionDays,
    ]);
    if (this.db.kind === "postgres") {
      // timescale's retention policy handles raw metrics; plain Postgres (e.g. Railway) needs the DELETE
      this.timescale ??= (await this.db.query(`SELECT 1 FROM schema_migrations WHERE id = 'timescale'`)).rows.length > 0;
      if (this.timescale) return;
    }
    await this.db.query(`DELETE FROM metrics WHERE ts < now() - make_interval(days => $1)`, [config.metricsRetentionDays]);
  }

  /**
   * Re-aggregates raw samples from `since` (default: the last 3 whole hours) into metrics_hourly.
   * Charts read the rollup only for hours older than 2h, so running this every few minutes keeps them exact.
   */
  async rollupMetrics(since = new Date(Date.now() - 3 * 3_600_000)) {
    await this.db.query(
      `INSERT INTO metrics_hourly (server_id, hour, players_sum, queue_sum, samples)
       SELECT server_id, date_bin('1 hour', ts, TIMESTAMPTZ '2000-01-01'), sum(players), sum(queue), count(*)
       FROM metrics WHERE ts >= date_bin('1 hour', $1::timestamptz, TIMESTAMPTZ '2000-01-01')
       GROUP BY 1, 2
       ON CONFLICT (server_id, hour) DO UPDATE
         SET players_sum = EXCLUDED.players_sum, queue_sum = EXCLUDED.queue_sum, samples = EXCLUDED.samples`,
      [since.toISOString()],
    );
  }
}
