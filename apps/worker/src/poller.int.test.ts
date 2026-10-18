import { test } from "node:test";
import assert from "node:assert/strict";
import { subscribe } from "./events";
import { Poller } from "./poller";
import { getAccuracy } from "./repo";
import { entry, FakeSource, HOUR, memoryDb } from "./testing";

test("RULES results are written in batches: ok rows, failures and the wipe's seed", async () => {
  const db = await memoryDb();
  const src = new FakeSource();
  const born = new Date(Date.now() - HOUR);
  src.list = [entry(1, born), entry(2, born)];
  src.rules.set("10.0.0.1", {
    "world.seed": "123456",
    "world.size": "4000",
    description_0: "Hello",
    headerimage: "https://cdn.example.com/h.png",
    logoimage: "http://cdn.example.com/l.png",
    url: "http://example.com",
    fps_avg: "59.6",
  });
  const poller = new Poller(db, src);
  await poller.init();
  await poller.cycle();
  await poller.rulesCycle(); // the pass the cycle started

  const { rows } = await db.query(
    `SELECT ip, seed, world_size, description, header_image, logo_image, url, fps, rules_checked_at FROM servers ORDER BY ip`,
  );
  assert.equal(rows[0].seed, 123456);
  assert.equal(rows[0].world_size, 4000);
  assert.equal(rows[0].description, "Hello");
  assert.equal(rows[0].header_image, "https://cdn.example.com/h.png");
  assert.equal(rows[0].logo_image, null); // http image dropped
  assert.equal(rows[0].url, "http://example.com/");
  assert.equal(rows[0].fps, 60);
  assert.equal(rows[1].seed, null); // RULES failed…
  assert.ok(rows[1].rules_checked_at); // …but it is not retried every cycle

  const { rows: wipes } = await db.query(`SELECT s.ip, w.seed FROM wipes w JOIN servers s ON s.id = w.server_id ORDER BY s.ip`);
  assert.deepEqual(
    wipes.map((w) => w.seed),
    [123456, null],
  );
  await poller.rulesCycle();
  await db.close();
});

test("a born change is recorded as a wipe and pushed to the live feed", async () => {
  const db = await memoryDb();
  const src = new FakeSource();
  const old = new Date(Date.now() - 7 * 24 * HOUR);
  src.list = [entry(1, old)];
  const poller = new Poller(db, src);
  await poller.init();
  await poller.cycle();

  const live: number[] = [];
  const off = subscribe((e) => e.type === "wipe" && live.push(e.server.id));
  const fresh = new Date(Date.now() - 10 * 60_000);
  src.list = [entry(1, fresh)];
  await poller.cycle();
  off();

  const { rows } = await db.query(`SELECT detected_by, wiped_at FROM wipes ORDER BY wiped_at`);
  assert.deepEqual(
    rows.map((r) => r.detected_by),
    ["born-initial", "born"],
  );
  assert.equal(new Date(rows[1].wiped_at).getTime(), Math.floor(fresh.getTime() / 1000) * 1000);
  assert.equal(live.length, 1);
  await poller.rulesCycle();
  await db.close();
});

test("a born that goes back in time (restored backup) is not a wipe", async () => {
  const db = await memoryDb();
  const src = new FakeSource();
  const poller = new Poller(db, src);
  await poller.init();
  src.list = [entry(1, new Date(Date.now() - HOUR))];
  await poller.cycle();
  src.list = [entry(1, new Date(Date.now() - 5 * 24 * HOUR))];
  await poller.cycle();
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM wipes`);
  assert.equal(rows[0].n, 1);
  await poller.rulesCycle();
  await db.close();
});

test("a server missing from three snapshots goes offline", async () => {
  const db = await memoryDb();
  const src = new FakeSource();
  const born = new Date(Date.now() - HOUR);
  const poller = new Poller(db, src);
  await poller.init();
  src.list = [entry(1, born), entry(2, born), entry(3, born)];
  await poller.cycle();
  src.list = [entry(1, born), entry(2, born)];
  const online = async () => (await db.query(`SELECT ip FROM servers WHERE online ORDER BY ip`)).rows.map((r) => r.ip as string);
  await poller.cycle();
  await poller.cycle();
  assert.deepEqual(await online(), ["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
  await poller.cycle();
  assert.deepEqual(await online(), ["10.0.0.1", "10.0.0.2"]);
  await poller.rulesCycle();
  await db.close();
});

test("an empty answer from Steam does not take servers offline", async () => {
  const db = await memoryDb();
  const src = new FakeSource();
  const born = new Date(Date.now() - HOUR);
  const poller = new Poller(db, src);
  await poller.init();
  src.list = [entry(1, born), entry(2, born)];
  await poller.cycle();
  src.list = [];
  for (let i = 0; i < 4; i++) await poller.cycle();
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM servers WHERE online`);
  assert.equal(rows[0].n, 2);
  await poller.rulesCycle();
  await db.close();
});

test("a wipe keeps the prediction that stood before it, for accuracy stats", async () => {
  const db = await memoryDb();
  const src = new FakeSource();
  src.list = [entry(1, new Date(Date.now() - 7 * 24 * HOUR))];
  const poller = new Poller(db, src);
  await poller.init();
  await poller.cycle();

  const fresh = new Date(Math.floor((Date.now() - 10 * 60_000) / 1000) * 1000);
  const promised = new Date(fresh.getTime() + 20 * 60_000);
  await db.query(`UPDATE servers SET next_wipe_at = $1, next_wipe_source = 'owner'`, [promised.toISOString()]);
  src.list = [entry(1, fresh)];
  await poller.cycle();
  await poller.rulesCycle();

  const { rows } = await db.query(`SELECT predicted_at, predicted_source FROM wipes WHERE detected_by = 'born'`);
  assert.equal(new Date(rows[0].predicted_at).getTime(), promised.getTime());
  assert.equal(rows[0].predicted_source, "owner");
  assert.deepEqual(await getAccuracy(db), [{ source: "owner", wipes: 1, withinHour: 1, medianErrorMinutes: 20 }]);
  await db.close();
});
