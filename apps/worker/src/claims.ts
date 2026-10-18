import { createHash, randomBytes, randomInt } from "node:crypto";
import { predictNextWipe, type ClaimStatus, type OwnerSchedule } from "@wiperadar/shared";
import { nextOfficialWipe } from "@wiperadar/shared/official";
import type { Db } from "./db";

/** A claim stays open this long; the owner puts its code into the server description or name meanwhile. */
export const CLAIM_TTL_DAYS = 7;
/** Open claims per server — enough for an owner who retries, not a spam vector. */
const MAX_OPEN = 5;
// no 0/O/1/I: owners type this into a server config by hand
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

const newCode = () => `WR-${Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a db row
const status = (r: Record<string, any>): ClaimStatus => ({
  code: r.token,
  serverId: r.server_id,
  verified: r.verified_at != null,
  expiresAt: new Date(new Date(r.created_at).getTime() + CLAIM_TTL_DAYS * 86_400_000).toISOString(),
});

export type CreateClaim = { ok: true; claim: ClaimStatus } | { ok: false; error: "not found" | "too many" };

export async function createClaim(db: Db, serverId: number, contact: string): Promise<CreateClaim> {
  const { rows: srv } = await db.query(`SELECT 1 FROM servers WHERE id = $1`, [serverId]);
  if (!srv.length) return { ok: false, error: "not found" };
  const { rows: open } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM server_claims
     WHERE server_id = $1 AND verified_at IS NULL AND created_at > now() - make_interval(days => $2)`,
    [serverId, CLAIM_TTL_DAYS],
  );
  if (open[0].n >= MAX_OPEN) return { ok: false, error: "too many" };
  const key = randomBytes(24).toString("base64url");
  const { rows } = await db.query(
    `INSERT INTO server_claims (server_id, contact, token, key_hash) VALUES ($1, $2, $3, $4)
     RETURNING token, server_id, verified_at, created_at`,
    [serverId, contact, newCode(), hashKey(key)],
  );
  // re-read RULES on the next pass instead of waiting out the TTL, so the check takes minutes, not hours
  await db.query(`UPDATE servers SET rules_checked_at = NULL WHERE id = $1`, [serverId]);
  return { ok: true, claim: { ...status(rows[0]), key } };
}

export async function getClaim(db: Db, code: string): Promise<ClaimStatus | null> {
  const { rows } = await db.query(`SELECT token, server_id, verified_at, created_at FROM server_claims WHERE token = $1`, [code]);
  return rows[0] ? status(rows[0]) : null;
}

/** After a RULES pass: open claims whose code now appears in the server's description or name become verified. */
export async function verifyClaims(db: Db, serverIds: number[]): Promise<number[]> {
  if (!serverIds.length) return [];
  const { rows } = await db.query<{ server_id: number }>(
    `UPDATE server_claims c SET verified_at = now()
     FROM servers s
     WHERE s.id = c.server_id AND s.id = ANY($1::int[]) AND c.verified_at IS NULL
       AND c.created_at > now() - make_interval(days => $2)
       AND strpos(upper(coalesce(s.description, '') || ' ' || s.name), c.token) > 0
     RETURNING c.server_id`,
    [serverIds, CLAIM_TTL_DAYS],
  );
  const ids = [...new Set(rows.map((r) => r.server_id))];
  if (ids.length) {
    await db.query(`UPDATE servers SET owner_verified_at = COALESCE(owner_verified_at, now()) WHERE id = ANY($1::int[])`, [ids]);
  }
  return ids;
}

/** Next wipe from an owner schedule (same rules as network schedules: force-wipe day handling, biweekly from the force wipe). */
export const ownerNext = (s: OwnerSchedule, now = new Date()) => nextOfficialWipe(s, now);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validates untrusted input; returns a clean schedule or null. */
export function parseSchedule(v: unknown): OwnerSchedule | null {
  if (!v || typeof v !== "object") return null;
  const { kind, slots, tz } = v as Record<string, unknown>;
  if (kind !== "weekly" && kind !== "biweekly") return null;
  if (!Array.isArray(slots) || !slots.length || slots.length > 14) return null;
  if (typeof tz !== "string" || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return null;
  }
  const clean: OwnerSchedule["slots"] = [];
  for (const s of slots) {
    const { day, time } = (s ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(day) || (day as number) < 0 || (day as number) > 6) return null;
    if (typeof time !== "string" || !TIME.test(time)) return null;
    clean.push({ day: day as number, time });
  }
  return { kind, slots: clean, tz };
}

/** True when `key` belongs to a verified claim on this server. */
export async function isOwner(db: Db, serverId: number, key: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM server_claims WHERE server_id = $1 AND key_hash = $2 AND verified_at IS NOT NULL LIMIT 1`,
    [serverId, hashKey(key)],
  );
  return rows.length > 0;
}

/** Saves (or with null, removes) the owner schedule and re-predicts the server's next wipe right away. */
export async function setSchedule(db: Db, serverId: number, schedule: OwnerSchedule | null) {
  if (!schedule) {
    await db.query(`DELETE FROM wipe_schedules WHERE server_id = $1 AND source = 'owner'`, [serverId]);
    // the poller re-predicts servers with no next wipe on its next cycle
    await db.query(`UPDATE servers SET next_wipe_at = NULL WHERE id = $1`, [serverId]);
    return;
  }
  const next = ownerNext(schedule);
  await db.query(
    `INSERT INTO wipe_schedules (server_id, source, schedule, next_at, updated_at) VALUES ($1, 'owner', $2, $3, now())
     ON CONFLICT (server_id) DO UPDATE SET source = 'owner', schedule = EXCLUDED.schedule, next_at = EXCLUDED.next_at,
       updated_at = now()`,
    [serverId, JSON.stringify(schedule), next.toISOString()],
  );
  const p = predictNextWipe({ lastWipe: null, cadence: null, history: [], ownerNext: next });
  await db.query(`UPDATE servers SET next_wipe_at = $2, next_wipe_source = $3 WHERE id = $1`, [
    serverId,
    p.at.toISOString(),
    p.source,
  ]);
}
