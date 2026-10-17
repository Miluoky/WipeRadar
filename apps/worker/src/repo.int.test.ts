import { test } from "node:test";
import assert from "node:assert/strict";
import { Poller } from "./poller";
import { listServers } from "./repo";
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
