import Fastify from "fastify";
import cors from "@fastify/cors";
import { CADENCES, GROUP_LIMITS, RATES, REGIONS, SERVER_TYPES, type MetricRange } from "@wiperadar/shared";
import { config } from "./config";
import type { Db } from "./db";
import { TtlCache } from "./cache";
import { subscribe } from "./events";
import { getMetrics, getServer, getStats, listServers, type ListParams } from "./repo";

/** "eu,cis" → ["eu","cis"], dropping anything not in the allow-list. */
function list<T extends string>(v: unknown, allowed: readonly T[]): T[] | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const out = v.split(",").filter((x): x is T => (allowed as readonly string[]).includes(x));
  return out.length ? out : undefined;
}
const num = (v: unknown) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

export async function buildApi(db: Db) {
  const app = Fastify({ logger: { level: "warn" } });
  await app.register(cors, { origin: true });
  const cache = new TtlCache();

  // browsers/CDNs may reuse a response briefly; the SSE feed pushes anything urgent
  const SHORT = "public, max-age=5, stale-while-revalidate=25";
  const LONG = "public, max-age=60, stale-while-revalidate=300";

  app.get("/api/health", async () => ({
    ok: true,
    demo: config.demo,
    db: db.kind,
    cache: { hits: cache.hits, misses: cache.misses },
  }));

  app.get("/api/stats", async (_req, reply) => {
    reply.header("Cache-Control", SHORT);
    return cache.get("stats", 5_000, () => getStats(db, config.demo));
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
      limit: num(q.limit),
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

  app.get("/api/servers/:id/metrics", async (req, reply) => {
    const id = num((req.params as { id: string }).id);
    const range = ((req.query as { range?: string }).range ?? "24h") as MetricRange;
    if (!id || !["24h", "7d", "30d"].includes(range)) return reply.code(400).send({ error: "bad request" });
    reply.header("Cache-Control", LONG);
    return cache.get(`metrics:${id}:${range}`, range === "24h" ? 30_000 : 300_000, () => getMetrics(db, id, range));
  });

  /** Server-Sent Events: live wipes + stats ticks. */
  app.get("/api/live", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    const off = subscribe((e) => reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
    req.raw.on("close", () => {
      off();
      clearInterval(ping);
    });
  });

  return app;
}
