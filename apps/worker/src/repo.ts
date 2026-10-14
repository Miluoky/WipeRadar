import {
  nextForceWipe,
  searchKey,
  type MetricPoint,
  type MetricRange,
  type Paged,
  type ServerDetail,
  type ServerQuery,
  type ServerSummary,
  type Stats,
  type WipeRecord,
} from "@wiperadar/shared";
import type { Db } from "./db";

type Row = Record<string, any>;

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

const SUMMARY_COLS = `id, ip, game_port, name, region, country, players, max_players, queue, map, seed, world_size,
  rate, group_limit, type, cadence, last_wipe_at, next_wipe_at, next_wipe_source, online, header_image, logo_image, promoted, suspicious, peak_players`;

function toSummary(r: Row): ServerSummary {
  return {
    id: r.id,
    addr: `${r.ip}:${r.game_port}`,
    name: r.name,
    region: r.region,
    country: r.country,
    players: r.players,
    maxPlayers: r.max_players,
    queue: r.queue,
    map: r.map,
    seed: r.seed,
    worldSize: r.world_size,
    rate: r.rate,
    groupLimit: r.group_limit,
    type: r.type,
    cadence: r.cadence,
    lastWipeAt: iso(r.last_wipe_at),
    nextWipeAt: iso(r.next_wipe_at),
    nextWipeSource: r.next_wipe_source,
    online: r.online,
    headerImage: r.header_image,
    logoImage: r.logo_image,
    peakPlayers: r.peak_players ?? 0,
    promoted: r.promoted,
    suspicious: r.suspicious,
  };
}

export interface ListParams extends ServerQuery {
  wipedWithinHours?: number;
  wipedFromHours?: number;
  nextWithinHours?: number;
  nextFromHours?: number;
  quality?: boolean;
}

export async function listServers(db: Db, p: ListParams): Promise<Paged<ServerSummary>> {
  const where: string[] = ["online"];
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  if (p.ids) where.push(`id = ANY(${arg(p.ids)}::int[])`);
  if (p.q) {
    // look-alike-folded skeleton on both sides: "восток" finds "BOCTOK"
    const key = searchKey(p.q).replace(/[%_\\]/g, (c) => `\\${c}`);
    if (key) where.push(`search_key LIKE ${arg(`%${key}%`)}`);
  }
  if (p.region?.length) where.push(`region = ANY(${arg(p.region)}::text[])`);
  if (p.rate?.length) where.push(`rate = ANY(${arg(p.rate)}::text[])`);
  if (p.group?.length) where.push(`group_limit = ANY(${arg(p.group)}::text[])`);
  if (p.type?.length) where.push(`type = ANY(${arg(p.type)}::text[])`);
  if (p.cadence?.length) where.push(`cadence = ANY(${arg(p.cadence)}::text[])`);
  if (p.minPlayers) where.push(`players >= ${arg(p.minPlayers)}`);
  // time windows: "wiped 2–6h ago" = wipedFromHours=2 & wipedWithinHours=6 (fractions allowed)
  if (p.wipedWithinHours) where.push(`last_wipe_at > now() - ${arg(p.wipedWithinHours)}::float8 * interval '1 hour'`);
  if (p.wipedFromHours) where.push(`last_wipe_at <= now() - ${arg(p.wipedFromHours)}::float8 * interval '1 hour'`);
  if (p.nextWithinHours)
    where.push(`next_wipe_at BETWEEN now() AND now() + ${arg(p.nextWithinHours)}::float8 * interval '1 hour'`);
  if (p.nextFromHours) where.push(`next_wipe_at >= now() + ${arg(p.nextFromHours)}::float8 * interval '1 hour'`);
  // Live data is ~75% empty or dev boxes ("testserver", 0/2 slots). Feeds and the
  // calendar ask for quality so real communities aren't buried; "All servers" doesn't.
  if (p.quality) {
    where.push(
      `(promoted OR (max_players >= 50 AND GREATEST(players, peak_players) >= 5 AND name !~* '(^|[^a-z])(test|testing|dev|staging|debug)([^a-z]|$)'))`,
    );
  }

  const order =
    p.sort === "hot"
      ? // fresh wipes people are actually joining: population decayed by hours since wipe
        "promoted DESC, (players + queue + 1) / power(extract(epoch FROM now() - last_wipe_at) / 3600 + 2, 1.5) DESC NULLS LAST"
      : p.sort === "wiped"
        ? "last_wipe_at DESC NULLS LAST"
        : p.sort === "next"
          ? "next_wipe_at ASC NULLS LAST"
          : p.sort === "name"
            ? "name ASC"
            : "promoted DESC, players + queue DESC";
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 1000);
  const offset = Math.max(p.offset ?? 0, 0);
  const w = where.join(" AND ");

  const [items, total] = await Promise.all([
    db.query(`SELECT ${SUMMARY_COLS} FROM servers WHERE ${w} ORDER BY ${order}, id LIMIT ${limit} OFFSET ${offset}`, args),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM servers WHERE ${w}`, args),
  ]);
  const out = items.rows.map(toSummary);
  if (limit <= 200) await attachSparklines(db, out); // big pulls (calendar, sitemap) don't render charts
  return { items: out, total: total.rows[0].n };
}

const SPARK_SLOTS = 48; // 30-minute slots over 24h

/**
 * Half-hourly averages for the last 24h in two queries — feeds the mini chart on list cards.
 * Slots before we started tracking a server are cut off instead of drawn as zeros.
 */
async function attachSparklines(db: Db, servers: ServerSummary[]) {
  if (!servers.length) return;
  const ids = servers.map((s) => s.id);
  const [samples, tracked] = await Promise.all([
    db.query<{ server_id: number; h: number; players: number }>(
      `SELECT server_id,
              floor(extract(epoch FROM now() - ts) / 1800)::int AS h,
              round(avg(players))::int AS players
       FROM metrics
       WHERE server_id = ANY($1::int[]) AND ts > now() - interval '24 hours'
       GROUP BY 1, 2`,
      [ids],
    ),
    db.query<{ id: number; slots: number }>(
      `SELECT id, ceil(extract(epoch FROM now() - first_seen_at) / 1800)::int AS slots FROM servers WHERE id = ANY($1::int[])`,
      [ids],
    ),
  ]);
  const slots = new Map(tracked.rows.map((r) => [r.id, Math.min(SPARK_SLOTS, Math.max(1, r.slots))]));
  const full = new Map(servers.map((s) => [s.id, new Array<number>(SPARK_SLOTS).fill(0)]));
  for (const r of samples.rows) {
    const arr = full.get(r.server_id);
    if (arr && r.h >= 0 && r.h < SPARK_SLOTS) arr[SPARK_SLOTS - 1 - r.h] = r.players; // oldest → newest
  }
  for (const s of servers) s.spark = full.get(s.id)!.slice(SPARK_SLOTS - (slots.get(s.id) ?? SPARK_SLOTS));
}

export async function getServerSummary(db: Db, id: number): Promise<ServerSummary | null> {
  const { rows } = await db.query(`SELECT ${SUMMARY_COLS} FROM servers WHERE id = $1`, [id]);
  return rows[0] ? toSummary(rows[0]) : null;
}

export async function getServer(db: Db, id: number): Promise<ServerDetail | null> {
  const { rows } = await db.query(
    `SELECT ${SUMMARY_COLS}, description, url, tags, build, fps, entities, map_image, first_seen_at, last_seen_at FROM servers WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  const wipes = await db.query(
    `SELECT wiped_at, kind, seed, world_size, map FROM wipes WHERE server_id = $1 ORDER BY wiped_at DESC LIMIT 20`,
    [id],
  );
  return {
    ...toSummary(r),
    description: r.description,
    mapImage: r.map_image,
    url: r.url,
    tags: r.tags ?? [],
    build: r.build,
    fps: r.fps,
    entities: r.entities,
    firstSeenAt: iso(r.first_seen_at)!,
    lastSeenAt: iso(r.last_seen_at)!,
    wipes: wipes.rows.map((w): WipeRecord => ({
      wipedAt: iso(w.wiped_at)!,
      kind: w.kind,
      seed: w.seed,
      worldSize: w.world_size,
      map: w.map,
    })),
  };
}

const RANGE: Record<MetricRange, { span: string; bucket: string }> = {
  "24h": { span: "24 hours", bucket: "10 minutes" },
  "7d": { span: "7 days", bucket: "1 hour" },
  "30d": { span: "30 days", bucket: "4 hours" },
};

export async function getMetrics(db: Db, id: number, range: MetricRange): Promise<MetricPoint[]> {
  const { span, bucket } = RANGE[range];
  // Zero samples aren't stored, so empty buckets are filled with 0 — but only from when we
  // started tracking the server, otherwise a new server would show a fake month of zeros.
  // With TimescaleDB, swap date_bin for time_bucket over a continuous aggregate.
  const { rows } = await db.query(
    `WITH b AS (
       SELECT generate_series(
         date_bin('${bucket}', GREATEST(now() - interval '${span}', s.first_seen_at), TIMESTAMPTZ '2000-01-01'),
         now(), interval '${bucket}') AS t
       FROM servers s WHERE s.id = $1
     ), m AS (
       SELECT date_bin('${bucket}', ts, TIMESTAMPTZ '2000-01-01') AS t,
              round(avg(players))::int AS players, round(avg(queue))::int AS queue
       FROM metrics WHERE server_id = $1 AND ts > now() - interval '${span}'
       GROUP BY 1
     )
     SELECT b.t, coalesce(m.players, 0) AS players, coalesce(m.queue, 0) AS queue
     FROM b LEFT JOIN m USING (t) ORDER BY b.t`,
    [id],
  );
  return rows.map((r) => ({ t: iso(r.t)!, players: r.players, queue: r.queue }));
}

export async function getStats(db: Db, demo: boolean): Promise<Stats> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS servers,
            count(*) FILTER (WHERE online)::int AS online,
            coalesce(sum(players) FILTER (WHERE online), 0)::int AS players,
            count(*) FILTER (WHERE online AND last_wipe_at > now() - interval '24 hours')::int AS wiped,
            count(*) FILTER (WHERE online AND next_wipe_at BETWEEN now() AND now() + interval '24 hours')::int AS upcoming
     FROM servers`,
  );
  const r = rows[0];
  return {
    servers: r.servers,
    online: r.online,
    players: r.players,
    wipedLast24h: r.wiped,
    upcoming24h: r.upcoming,
    nextForceWipe: nextForceWipe().toISOString(),
    demo,
  };
}
