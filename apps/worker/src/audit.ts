import type { A2SPlayer } from "@wiperadar/a2s";
import type { ServerAudit } from "@wiperadar/shared";
import { config } from "./config";
import type { Db } from "./db";
import { mapLimited } from "./limiter";
import { counters, log } from "./log";
import type { ServerSource } from "./sources/types";

export type AuditVerdict = "ok" | "hidden" | ServerAudit["reason"];

/** Audits needed in a row before the badge shows: one odd answer (a map change, a restart) isn't enough. */
export const STRIKES_TO_FLAG = 2;
/** Servers below this many reported players aren't worth inflating, or auditing. */
const MIN_PLAYERS = 20;

/**
 * Reads an A2S_PLAYER answer against the player count the server advertises.
 * Fake-online plugins raise the advertised number but can't put real connections in the list,
 * and bot fillers tend to join in one burst or share a name.
 */
export function judgePlayers(reported: number, list: A2SPlayer[]): AuditVerdict {
  // an empty list is a server that hides it (common, and allowed): no evidence either way
  if (!list.length) return "hidden";
  if (reported >= MIN_PLAYERS && list.length < reported * 0.5) return "short";
  if (list.length >= 15) {
    const top = (keys: string[]) => Math.max(...[...count(keys).values()]);
    // same join second for most of the list: a scripted burst, not people
    if (top(list.map((p) => String(Math.floor(p.durationSec / 2)))) >= list.length * 0.6) return "clones";
    const named = list.map((p) => p.name.trim().toLowerCase()).filter(Boolean);
    if (named.length >= 15 && top(named) >= named.length * 0.3) return "clones";
  }
  return "ok";
}

function count(keys: string[]) {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

/**
 * One audit pass over the busiest servers not checked lately: compare the player list with the
 * advertised count and look for a flat 24h curve (real servers always move). Strikes accumulate per
 * audit; a clean audit clears them, a hidden list leaves them as they are.
 */
export async function auditPlayers(db: Db, source: ServerSource, { limit = config.auditBatch, minAgeHours = 6 } = {}) {
  if (!source.fetchPlayers) return;
  const { rows } = await db.query<{ id: number; ip: string; query_port: number; players: number }>(
    `SELECT id, ip, query_port, players FROM servers
     WHERE online AND players >= $1 AND (audit_at IS NULL OR audit_at <= now() - make_interval(hours => $3))
     ORDER BY audit_at NULLS FIRST, players DESC LIMIT $2`,
    [MIN_PLAYERS, limit, minAgeHours],
  );
  if (!rows.length) return;
  const flat = await flatOnline(
    db,
    rows.map((r) => r.id),
  );
  const results = await mapLimited(
    rows,
    { concurrency: config.rulesConcurrency, perKey: config.perHostConcurrency, key: (r) => r.ip },
    (r) => source.fetchPlayers!(r.ip, r.query_port),
  );
  const u = { id: [] as number[], listed: [] as (number | null)[], reason: [] as (string | null)[], strike: [] as number[] };
  rows.forEach((r, i) => {
    const res = results[i];
    const list = res.status === "fulfilled" ? res.value : null;
    let verdict: AuditVerdict = list ? judgePlayers(r.players, list) : "hidden";
    if ((verdict === "ok" || verdict === "hidden") && flat.has(r.id)) verdict = "flat";
    u.id.push(r.id);
    u.listed.push(list ? list.length : null);
    u.reason.push(verdict === "ok" || verdict === "hidden" ? null : verdict);
    // 1 = strike, 0 = clean (reset), -1 = no evidence (keep)
    u.strike.push(verdict === "ok" ? 0 : verdict === "hidden" ? -1 : 1);
  });
  await db.query(
    `UPDATE servers s SET audit_at = now(), audit_listed = u.listed, audit_reported = s.players,
            audit_strikes = CASE u.strike WHEN 1 THEN LEAST(s.audit_strikes + 1, 10) WHEN 0 THEN 0 ELSE s.audit_strikes END,
            audit_reason = CASE u.strike WHEN 1 THEN u.reason WHEN 0 THEN NULL ELSE s.audit_reason END
     FROM unnest($1::int[], $2::int[], $3::text[], $4::int[]) AS u(id, listed, reason, strike)
     WHERE s.id = u.id`,
    [u.id, u.listed, u.reason, u.strike],
  );
  const strikes = u.strike.filter((s) => s === 1).length;
  counters.auditStrikes += strikes;
  log.info(`[audit] ${rows.length} servers, ${strikes} strikes`, { event: "audit", servers: rows.length, strikes });
}

/** Servers whose online count stayed within ±1 across a full day of samples while claiming a crowd. */
async function flatOnline(db: Db, ids: number[]): Promise<Set<number>> {
  const { rows } = await db.query<{ server_id: number }>(
    `SELECT server_id FROM metrics
     WHERE server_id = ANY($1::int[]) AND ts > now() - interval '24 hours'
     GROUP BY server_id
     HAVING count(*) >= 100 AND max(players) - min(players) <= 1 AND min(players) >= $2
        AND max(ts) - min(ts) > interval '20 hours'`,
    [ids, MIN_PLAYERS],
  );
  return new Set(rows.map((r) => r.server_id));
}
