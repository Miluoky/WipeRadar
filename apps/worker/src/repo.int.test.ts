import { test } from "node:test";
import assert from "node:assert/strict";
import { Poller } from "./poller";
import { getMetrics, listServers } from "./repo";
import { entry, FakeSource, HOUR, memoryDb } from "./testing";

/** Five servers wiped 1h, 3h, 5h, 30h and 10 days ago; one is a test box, one is empty. */
async function world() {
  const db = await memoryDb();
  const src = new FakeSource();
  const ago = (h: number) => new Date(Date.now() - h * HOUR);
  src.list = [
    entry(1, ago(1), { name: "Rustoria EU Main", players: 200, maxPlayers: 200 }),
    entry(2, ago(3), { name: "Восток RU x2", players: 40 }),
    entry(3, ago(5), { name: "testserver", players: 30 }),
    entry(4, ago(30), { name: "Empty Vanilla", players: 0 }),
    entry(5, ago(240), { name: "Old Monthly", players: 60 }),
  ];
  const poller = new Poller(db, src);
  await poller.init();
  await poller.cycle();
  await poller.rulesCycle();
  return db;
}

const names = (p: { items: { name: string }[] }) => p.items.map((s) => s.name).sort();

test("listServers filters by wipe time windows", async () => {
  const db = await world();
  assert.deepEqual(names(await listServers(db, { wipedWithinHours: 4 })), ["Rustoria EU Main", "Восток RU x2"]);
  // "wiped 2–6h ago"
  assert.deepEqual(names(await listServers(db, { wipedFromHours: 2, wipedWithinHours: 6 })), ["testserver", "Восток RU x2"]);
  await db.close();
});

test("quality hides test boxes and empty servers", async () => {
  const db = await world();
  assert.deepEqual(names(await listServers(db, { quality: true })), ["Old Monthly", "Rustoria EU Main", "Восток RU x2"]);
  assert.equal((await listServers(db, {})).total, 5);
  await db.close();
});

test("search folds look-alike letters and ignores case", async () => {
  const db = await world();
  assert.deepEqual(names(await listServers(db, { q: "BOCTOK" })), ["Восток RU x2"]);
  assert.deepEqual(names(await listServers(db, { q: "rustoria" })), ["Rustoria EU Main"]);
  assert.deepEqual(names(await listServers(db, { q: "100%_" })), []); // LIKE wildcards are literal
  await db.close();
});

test("sort and paging", async () => {
  const db = await world();
  const page = await listServers(db, { sort: "wiped", limit: 2, offset: 1 });
  assert.deepEqual(
    page.items.map((s) => s.name),
    ["Восток RU x2", "testserver"],
  );
  assert.equal(page.total, 5);
  await db.close();
});

test("7d chart reads the hourly rollup once raw samples are pruned", async () => {
  const db = await world();
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM servers WHERE name = 'Old Monthly'`);
  const id = rows[0].id;
  await db.query(`UPDATE servers SET first_seen_at = now() - interval '7 days'`);
  // two days ago: 12 samples of 30 players, 12 of 50 in the same hour → hourly average 40
  const hour = new Date(Math.floor((Date.now() - 48 * HOUR) / HOUR) * HOUR);
  for (let i = 0; i < 24; i++) {
    await db.query(`INSERT INTO metrics (server_id, ts, players, queue) VALUES ($1, $2, $3, 0) ON CONFLICT DO NOTHING`, [
      id,
      new Date(hour.getTime() + i * 150_000).toISOString(),
      i < 12 ? 30 : 50,
    ]);
  }
  const poller = new Poller(db, new FakeSource());
  await poller.rollupMetrics(new Date(0));
  await db.query(`DELETE FROM metrics WHERE ts < now() - interval '1 day'`);

  const points = await getMetrics(db, id, "7d");
  const at = points.find((p) => p.t === hour.toISOString());
  assert.equal(at?.players, 40);
  assert.equal(points.filter((p) => p.players > 0 && p.t !== hour.toISOString()).length <= 1, true);
  await db.close();
});
