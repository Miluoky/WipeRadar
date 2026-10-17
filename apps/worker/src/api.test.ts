import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApi, STALE_AFTER_MS } from "./api";
import type { Db } from "./db";
import type { PollStatus } from "./poller";

const db = { kind: "pglite" } as Db; // /api/health never touches the database

test("health is ok while cycles are fresh and 503 when polling stalls", async () => {
  const status: PollStatus = { startedAt: new Date(), lastCycleAt: null, lastCycleMs: null, lastError: null, servers: 0 };
  const app = await buildApi(db, status);

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
