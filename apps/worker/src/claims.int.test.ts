import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClaimStatus } from "@wiperadar/shared";
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
