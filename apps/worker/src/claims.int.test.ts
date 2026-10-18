import { test } from "node:test";
import assert from "node:assert/strict";
import { predictNextWipe, type ClaimStatus, type OwnerSchedule } from "@wiperadar/shared";
import { ownerNext } from "./claims";
import { buildApi } from "./api";
import { Poller } from "./poller";
import { getServer } from "./repo";
import { entry, FakeSource, HOUR, memoryDb } from "./testing";

const visitor = { "x-real-ip": "203.0.113.9" };

test("an ownership claim is verified once its code shows up in the server description", async () => {
  const db = await memoryDb();
  const src = new FakeSource();
  src.list = [entry(1, new Date(Date.now() - 5 * HOUR))];
  src.rules.set("10.0.0.1", { description: "Welcome!" });
  const poller = new Poller(db, src);
  await poller.init();
  await poller.cycle();
  await poller.rulesCycle();
  const app = await buildApi(db);

  const res = await app.inject({
    method: "POST",
    url: "/api/servers/1/claims",
    payload: { contact: "@owner" },
    headers: visitor,
  });
  assert.equal(res.statusCode, 201);
  const claim = res.json<ClaimStatus>();
  assert.match(claim.code, /^WR-[2-9A-HJ-NP-Z]{8}$/);
  assert.equal(claim.verified, false);

  // the owner pastes the code (lowercase is fine); the claim forced a RULES re-read on the next pass
  src.rules.set("10.0.0.1", { description: `Welcome! ${claim.code.toLowerCase()}` });
  await poller.rulesCycle();
  const after = await app.inject({ url: `/api/claims/${claim.code}`, headers: visitor });
  assert.equal(after.json<ClaimStatus>().verified, true);
  assert.equal((await getServer(db, 1))?.verified, true);

  // the claim's key now publishes a schedule: Thursdays 18:00 Moscow time
  assert.ok(claim.key && claim.key.length >= 16);
  const schedule = { kind: "weekly", slots: [{ day: 4, time: "18:00" }], tz: "Europe/Moscow" };
  const put = (key: string, payload: unknown) =>
    app.inject({
      method: "PUT",
      url: "/api/servers/1/schedule",
      payload: payload as object,
      headers: { ...visitor, authorization: `Bearer ${key}` },
    });
  assert.equal((await put("not-the-owner-key-000", schedule)).statusCode, 403);
  assert.equal((await put(claim.key, { ...schedule, tz: "Mars/Olympus" })).statusCode, 400);
  assert.equal((await put(claim.key, { ...schedule, slots: [{ day: 4, time: "25:00" }] })).statusCode, 400);
  assert.equal((await put(claim.key, schedule)).statusCode, 204);
  const s = await getServer(db, 1);
  assert.deepEqual(s?.ownerSchedule, schedule);
  // Thursday 18:00 MSK = 15:00 UTC, unless the monthly force wipe comes first
  const expected = predictNextWipe({
    lastWipe: null,
    cadence: null,
    history: [],
    ownerNext: ownerNext(schedule as OwnerSchedule),
  });
  assert.equal(s?.nextWipeAt, expected.at.toISOString());
  assert.equal(s?.nextWipeSource, expected.source);
  if (expected.source === "owner") assert.equal(`${expected.at.getUTCDay()} ${expected.at.getUTCHours()}`, "4 15");
  // still the owner's after the poller's own prediction pass
  poller.forceFullPredict();
  await poller.cycle();
  assert.equal((await getServer(db, 1))?.nextWipeAt, s?.nextWipeAt);

  const del = await app.inject({
    method: "DELETE",
    url: "/api/servers/1/schedule",
    headers: { ...visitor, authorization: `Bearer ${claim.key}` },
  });
  assert.equal(del.statusCode, 204);
  assert.equal((await getServer(db, 1))?.ownerSchedule, null);

  await app.close();
  await db.close();
});

test("claims are validated and capped per server", async () => {
  const db = await memoryDb();
  const src = new FakeSource();
  src.list = [entry(1, new Date(Date.now() - 5 * HOUR))];
  const poller = new Poller(db, src);
  await poller.init();
  await poller.cycle();
  await poller.rulesCycle();
  const app = await buildApi(db);
  const post = (url: string, payload: unknown, ip = "203.0.113.10") =>
    app.inject({ method: "POST", url, payload: payload as object, headers: { "x-real-ip": ip } });

  assert.equal((await post("/api/servers/1/claims", { contact: "" })).statusCode, 400);
  assert.equal((await post("/api/servers/1/claims", { contact: "x".repeat(121) })).statusCode, 400);
  assert.equal((await post("/api/servers/999/claims", { contact: "a" })).statusCode, 404);
  assert.equal((await app.inject({ url: "/api/claims/WR-NOTACODE" })).statusCode, 404);
  // five open claims per server, from different visitors so the per-IP limit isn't what stops it
  for (let i = 0; i < 5; i++)
    assert.equal((await post("/api/servers/1/claims", { contact: "a" }, `198.51.100.${i}`)).statusCode, 201);
  assert.equal((await post("/api/servers/1/claims", { contact: "a" }, "198.51.100.99")).statusCode, 429);

  await app.close();
  await poller.rulesCycle();
  await db.close();
});
