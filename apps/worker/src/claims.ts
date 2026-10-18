import { randomInt } from "node:crypto";
import type { ClaimStatus } from "@wiperadar/shared";
import type { Db } from "./db";

/** A claim stays open this long; the owner puts its code into the server description or name meanwhile. */
export const CLAIM_TTL_DAYS = 7;
/** Open claims per server — enough for an owner who retries, not a spam vector. */
const MAX_OPEN = 5;
// no 0/O/1/I: owners type this into a server config by hand
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

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
  const { rows } = await db.query(
    `INSERT INTO server_claims (server_id, contact, token) VALUES ($1, $2, $3) RETURNING token, server_id, verified_at, created_at`,
    [serverId, contact, newCode()],
  );
  // re-read RULES on the next pass instead of waiting out the TTL, so the check takes minutes, not hours
  await db.query(`UPDATE servers SET rules_checked_at = NULL WHERE id = $1`, [serverId]);
  return { ok: true, claim: status(rows[0]) };
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
