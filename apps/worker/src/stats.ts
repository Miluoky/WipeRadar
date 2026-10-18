import type { DayStats } from "@wiperadar/shared";
import type { Db } from "./db";

export type HitKind = "view" | "connect";

/**
 * Page views and Play/IP clicks per server per day. Hits are counted in memory and written in one
 * batched upsert per flush, so a popular page costs no write per visitor. One hit per visitor,
 * server and kind per day: reloads and double clicks don't inflate the owner's numbers.
 */
export class StatsCounter {
  private pending = new Map<string, { id: number; day: string; views: number; connects: number }>();
  private seen = new Set<string>();
  private seenDay = "";

  constructor(
    private db: Db,
    private maxSeen = 200_000,
  ) {}

  hit(serverId: number, kind: HitKind, visitor: string, now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    if (day !== this.seenDay) {
      this.seen.clear();
      this.seenDay = day;
    }
    const once = `${visitor}|${serverId}|${kind}`;
    if (this.seen.has(once)) return;
    if (this.seen.size < this.maxSeen) this.seen.add(once);
    const key = `${serverId}|${day}`;
    const row = this.pending.get(key) ?? { id: serverId, day, views: 0, connects: 0 };
    if (kind === "view") row.views++;
    else row.connects++;
    this.pending.set(key, row);
  }

  async flush() {
    if (!this.pending.size) return;
    const rows = [...this.pending.values()];
    this.pending.clear();
    await this.db.query(
      `INSERT INTO server_stats (server_id, day, views, connects)
       SELECT u.id, u.day, u.v, u.c FROM unnest($1::int[], $2::date[], $3::int[], $4::int[]) AS u(id, day, v, c)
       WHERE EXISTS (SELECT 1 FROM servers s WHERE s.id = u.id)
       ON CONFLICT (server_id, day) DO UPDATE
         SET views = server_stats.views + EXCLUDED.views, connects = server_stats.connects + EXCLUDED.connects`,
      [rows.map((r) => r.id), rows.map((r) => r.day), rows.map((r) => r.views), rows.map((r) => r.connects)],
    );
  }
}

export async function getDayStats(db: Db, serverId: number, days = 30): Promise<DayStats[]> {
  const { rows } = await db.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, views, connects FROM server_stats
     WHERE server_id = $1 AND day > current_date - $2::int ORDER BY day`,
    [serverId, days],
  );
  return rows.map((r) => ({ day: r.day, views: r.views, connects: r.connects }));
}
