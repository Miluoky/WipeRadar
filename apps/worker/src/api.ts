import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { FastifyRequest } from "fastify";
import { CADENCES, GROUP_LIMITS, RATES, REGIONS, SERVER_TYPES, type MetricRange } from "@wiperadar/shared";
import { createClaim, getClaim } from "./claims";
import { config } from "./config";
import type { Db } from "./db";
import { TtlCache } from "./cache";
import { subscribe } from "./events";
import { counters } from "./log";
import type { PollStatus } from "./poller";
import { getAccuracy, getMetrics, getServer, getSimilar, getStats, listServers, type ListParams } from "./repo";

/** "eu,cis" → ["eu","cis"], dropping anything not in the allow-list. */
function list<T extends string>(v: unknown, allowed: readonly T[]): T[] | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const out = v.split(",").filter((x): x is T => (allowed as readonly string[]).includes(x));
  return out.length ? out : undefined;
}
/** Health turns 503 when no poll cycle has finished for this long (alerting hook). */
export const STALE_AFTER_MS = 10 * 60_000;

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const num = (v: unknown) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Page size caps: the site's own server-side calls (calendar) need more than the public API gets. */
const PUBLIC_LIMIT = 200;
const INTERNAL_LIMIT = 1000;

/**
 * The worker is private: browsers reach it only through the site's /api rewrite, which forwards
 * the visitor's address (X-Real-IP from Railway's edge, X-Forwarded-For from the Next proxy).
 * No forwarded address → the site's own server-side render, which is trusted.
 */
export function clientIp(req: FastifyRequest): string | null {
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || null;
}

export async function buildApi(db: Db, status?: PollStatus) {
  const app = Fastify({ logger: { level: "warn" } });
  await app.register(cors, { origin: config.siteUrl ? new URL(config.siteUrl).origin : false });
  await app.register(rateLimit, {
    max: config.rateLimitPerMin,
    timeWindow: 60_000,
    keyGenerator: (req) => clientIp(req) ?? "internal",
    allowList: (req) => clientIp(req) === null,
  });
  const cache = new TtlCache();
  const sse = { total: 0, perIp: new Map<string, number>() };

  // browsers/CDNs may reuse a response briefly; the SSE feed pushes anything urgent
  const SHORT = "public, max-age=5, stale-while-revalidate=25";
  const LONG = "public, max-age=60, stale-while-revalidate=300";

  app.get("/api/health", async (_req, reply) => {
    // before the first cycle finishes, count from process start so deploy healthchecks pass
    const last = status ? (status.lastCycleAt ?? status.startedAt) : null;
    const ok = !last || Date.now() - last.getTime() < STALE_AFTER_MS;
    reply.header("Cache-Control", "no-store");
    return reply.code(ok ? 200 : 503).send({
      ok,
      demo: config.demo,
      db: db.kind,
      poll: status && {
        lastCycleAt: status.lastCycleAt,
        lastCycleMs: status.lastCycleMs,
        servers: status.servers,
        lastError: status.lastError,
      },
      cache: { hits: cache.hits, misses: cache.misses },
    });
  });

  // Prometheus text format. Outside /api on purpose: the site only proxies /api/*, so this stays private.
  app.get("/metrics", { config: { rateLimit: false } }, async (_req, reply) => {
    const lines = [
      ...Object.entries(counters).map(([k, v]) => `wiperadar_${snake(k)}_total ${v}`),
      `wiperadar_sse_clients ${sse.total}`,
      `wiperadar_last_cycle_ms ${status?.lastCycleMs ?? 0}`,
      `wiperadar_last_cycle_age_seconds ${status?.lastCycleAt ? Math.round((Date.now() - status.lastCycleAt.getTime()) / 1000) : -1}`,
      `wiperadar_servers ${status?.servers ?? 0}`,
    ];
    reply.header("Content-Type", "text/plain; version=0.0.4");
    return lines.join("\n") + "\n";
  });

  app.get("/api/stats", async (_req, reply) => {
    reply.header("Cache-Control", SHORT);
    return cache.get("stats", 5_000, () => getStats(db, config.demo));
  });

  app.get("/api/accuracy", async (_req, reply) => {
    reply.header("Cache-Control", LONG);
    return cache.get("accuracy", 600_000, () => getAccuracy(db));
  });

  app.get("/api/servers", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const sort = q.sort as ListParams["sort"];
    const params: ListParams = {
      q: q.q?.slice(0, 80) || undefined,
      region: list(q.region, REGIONS),
      rate: list(q.rate, RATES),
      group: list(q.group, GROUP_LIMITS),
      type: list(q.type, SERVER_TYPES),
      cadence: list(q.cadence, CADENCES),
      minPlayers: num(q.minPlayers),
      sort: sort && ["players", "wiped", "next", "name", "hot"].includes(sort) ? sort : undefined,
      limit: Math.min(num(q.limit) ?? 50, clientIp(req) ? PUBLIC_LIMIT : INTERNAL_LIMIT),
      offset: num(q.offset),
      wipedWithinHours: num(q.wipedWithinHours),
      nextWithinHours: num(q.nextWithinHours),
      wipedFromHours: num(q.wipedFromHours),
      nextFromHours: num(q.nextFromHours),
      quality: q.quality === "1",
      ids: q.ids
        ? q.ids
            .split(",")
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0)
            .slice(0, 200)
        : undefined,
    };
    reply.header("Cache-Control", SHORT);
    // key = the validated params, so junk query strings can't bloat the cache
    return cache.get(`list:${JSON.stringify(params)}`, 10_000, () => listServers(db, params));
  });

  app.get("/api/servers/:id", async (req, reply) => {
    const id = num((req.params as { id: string }).id);
    const s = id ? await cache.get(`server:${id}`, 10_000, () => getServer(db, id)) : null;
    if (!s) return reply.code(404).send({ error: "not found" });
    reply.header("Cache-Control", SHORT);
    return s;
  });

  app.get("/api/servers/:id/similar", async (req, reply) => {
    const id = num((req.params as { id: string }).id);
    if (!id) return reply.code(400).send({ error: "bad request" });
    reply.header("Cache-Control", LONG);
    return cache.get(`similar:${id}`, 60_000, () => getSimilar(db, id));
  });

  app.get("/api/servers/:id/metrics", async (req, reply) => {
    const id = num((req.params as { id: string }).id);
    const range = ((req.query as { range?: string }).range ?? "24h") as MetricRange;
    if (!id || !["24h", "7d", "30d"].includes(range)) return reply.code(400).send({ error: "bad request" });
    reply.header("Cache-Control", LONG);
    return cache.get(`metrics:${id}:${range}`, range === "24h" ? 30_000 : 300_000, () => getMetrics(db, id, range));
  });

  // Ownership claims. Tight per-IP limit: each claim is a stored row and forces a RULES re-read.
  app.post("/api/servers/:id/claims", { config: { rateLimit: { max: 5, timeWindow: 3_600_000 } } }, async (req, reply) => {
    const id = num((req.params as { id: string }).id);
    const contact = (req.body as { contact?: unknown } | null)?.contact;
    if (!id || typeof contact !== "string" || !contact.trim() || contact.length > 120) {
      return reply.code(400).send({ error: "bad request" });
    }
    const res = await createClaim(db, id, contact.trim());
    if (!res.ok) return reply.code(res.error === "not found" ? 404 : 429).send({ error: res.error });
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send(res.claim);
  });

  app.get("/api/claims/:code", async (req, reply) => {
    const code = (req.params as { code: string }).code.toUpperCase();
    const claim = /^WR-[A-Z0-9]{8}$/.test(code) ? await getClaim(db, code) : null;
    if (!claim) return reply.code(404).send({ error: "not found" });
    reply.header("Cache-Control", "no-store");
    return claim;
  });

  /** Server-Sent Events: live wipes + stats ticks. */
  app.get("/api/live", { config: { rateLimit: false } }, (req, reply) => {
    const ip = clientIp(req) ?? "internal";
    const mine = sse.perIp.get(ip) ?? 0;
    if (sse.total >= config.sseMaxTotal || (ip !== "internal" && mine >= config.sseMaxPerIp)) {
      return reply.code(429).send({ error: "too many live connections" });
    }
    sse.total++;
    sse.perIp.set(ip, mine + 1);
    reply.hijack(); // the raw stream is ours; fastify must not send its own response
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    const off = subscribe((e) => reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
    req.raw.on("close", () => {
      off();
      clearInterval(ping);
      sse.total--;
      const n = (sse.perIp.get(ip) ?? 1) - 1;
      if (n > 0) sse.perIp.set(ip, n);
      else sse.perIp.delete(ip);
    });
  });

  return app;
}
