import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClaimStatus, DayStats } from "@wiperadar/shared";
import { buildApi } from "./api";
import { Poller } from "./poller";
import { StatsCounter } from "./stats";
import { entry, FakeSource, HOUR, memoryDb } from "./testing";

test("view/connect beacons are deduped per visitor and readable only with the owner key", async () => {
  const db = await memoryDb();
  const src = new FakeSource();
  src.list = [entry(1, new Date(Date.now() - 5 * HOUR))];
  src.rules.set("10.0.0.1", { description: "Welcome!" });
  const poller = new Poller(db, src);
  await poller.init();
  await poller.cycle();
  await poller.rulesCycle();
  const stats = new StatsCounter(db);
  const app = await buildApi(db, undefined, stats);
  const hit = (kind: string, ip: string, id = 1) =>
    app.inject({ method: "POST", url: `/api/servers/${id}/hit?kind=${kind}`, headers: { "x-real-ip": ip } });

  assert.equal((await hit("view", "203.0.113.1")).statusCode, 204);
  await hit("view", "203.0.113.1"); // reload: not counted again
  await hit("view", "203.0.113.2");
  await hit("connect", "203.0.113.2");
  await hit("view", "203.0.113.3", 999); // unknown server: dropped on flush
  assert.equal((await hit("like", "203.0.113.1")).statusCode, 400);
  await stats.flush();
  await hit("view", "203.0.113.4"); // a second flush adds to the same day
  await stats.flush();

  const visitor = { "x-real-ip": "203.0.113.9" };
  const claim = (
    await app.inject({ method: "POST", url: "/api/servers/1/claims", payload: { contact: "@o" }, headers: visitor })
  ).json<ClaimStatus>();
  const read = (key: string) =>
    app.inject({ url: "/api/servers/1/stats", headers: { ...visitor, authorization: `Bearer ${key}` } });
  // not verified yet → the key is worthless
  assert.equal((await read(claim.key!)).statusCode, 403);
  src.rules.set("10.0.0.1", { description: claim.code });
  await poller.rulesCycle();
  assert.equal((await read("not-the-owner-key-000")).statusCode, 403);
  const res = await read(claim.key!);
  assert.equal(res.statusCode, 200);
  const days = res.json<DayStats[]>();
  assert.equal(days.length, 1);
  assert.equal(days[0].day, new Date().toISOString().slice(0, 10));
  assert.equal(days[0].views, 3);
  assert.equal(days[0].connects, 1);
  await app.close();
  await db.close();
});
