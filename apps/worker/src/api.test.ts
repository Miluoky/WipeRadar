import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApi, STALE_AFTER_MS } from "./api";
import { config } from "./config";
import type { Db } from "./db";
import type { PollStatus } from "./poller";

/** Records the LIMIT of each servers query; returns empty results. */
function fakeDb() {
  const limits: number[] = [];
  const db = {
    kind: "pglite",
    query: async (sql: string) => {
      const m = /LIMIT (\d+)/.exec(sql);
      if (m) limits.push(Number(m[1]));
      return { rows: sql.includes("count(*)") ? [{ n: 0 }] : [] };
    },
  } as unknown as Db;
  return { db, limits };
}

const visitor = { "x-forwarded-for": "203.0.113.7, 10.0.0.2" };

test("public page size is capped at 200, the site's own calls at 1000", async () => {
  const { db, limits } = fakeDb();
  const app = await buildApi(db);
  await app.inject({ url: "/api/servers?limit=1000", headers: visitor });
  await app.inject({ url: "/api/servers?limit=1000&sort=name" });
  assert.deepEqual(limits, [200, 1000]);
  await app.close();
});

test("public traffic is rate limited per visitor, internal traffic is not", async () => {
  const prev = config.rateLimitPerMin;
  config.rateLimitPerMin = 2;
  const app = await buildApi(fakeDb().db);
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await app.inject({ url: "/api/health", headers: visitor })).statusCode);
  assert.deepEqual(codes, [200, 200, 429]);
  assert.equal((await app.inject({ url: "/api/health", headers: { "x-real-ip": "198.51.100.1" } })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/health" })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/health" })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/health" })).statusCode, 200);
  config.rateLimitPerMin = prev;
  await app.close();
});

test("live feed refuses visitors over the SSE connection cap", async () => {
  const prev = config.sseMaxPerIp;
  config.sseMaxPerIp = 0;
  const app = await buildApi(fakeDb().db);
  const res = await app.inject({ url: "/api/live", headers: visitor });
  assert.equal(res.statusCode, 429);
  config.sseMaxPerIp = prev;
  await app.close();
});

test("CORS is not open to arbitrary origins", async () => {
  const app = await buildApi(fakeDb().db);
  const res = await app.inject({ url: "/api/health", headers: { origin: "https://evil.example" } });
  assert.notEqual(res.headers["access-control-allow-origin"], "https://evil.example");
  assert.notEqual(res.headers["access-control-allow-origin"], "*");
  await app.close();
});

test("health is ok while cycles are fresh and 503 when polling stalls", async () => {
  const status: PollStatus = { startedAt: new Date(), lastCycleAt: null, lastCycleMs: null, lastError: null, servers: 0 };
  const app = await buildApi(fakeDb().db, status);

  let res = await app.inject("/api/health");
  assert.equal(res.statusCode, 200); // just started, no cycle yet

  status.startedAt = new Date(Date.now() - STALE_AFTER_MS - 1000);
  res = await app.inject("/api/health");
  assert.equal(res.statusCode, 503);

  Object.assign(status, { lastCycleAt: new Date(), lastCycleMs: 900, servers: 11_000 });
  res = await app.inject("/api/health");
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().poll.servers, 11_000);
  await app.close();
});
