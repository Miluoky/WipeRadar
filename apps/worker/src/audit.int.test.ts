import { test } from "node:test";
import assert from "node:assert/strict";
import type { A2SPlayer } from "@wiperadar/a2s";
import { auditPlayers } from "./audit";
import { Poller } from "./poller";
import { getServer } from "./repo";
import { entry, FakeSource, HOUR, memoryDb } from "./testing";

const list = (n: number): A2SPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ name: `p${i}`, score: 0, durationSec: 100 + i * 61 }));

test("two short player lists in a row flag the server; a clean audit clears it", async () => {
  const db = await memoryDb();
  const src = new FakeSource();
  src.list = [entry(1, new Date(Date.now() - 5 * HOUR), { players: 150, maxPlayers: 200 })];
  const poller = new Poller(db, src);
  await poller.init();
  await poller.cycle();

  src.players.set("10.0.0.1", list(30));
  await auditPlayers(db, src, { minAgeHours: 0 });
  assert.equal((await getServer(db, 1))?.suspicious, false, "one strike is not enough");
  await auditPlayers(db, src, { minAgeHours: 0 });
  const flagged = await getServer(db, 1);
  assert.equal(flagged?.suspicious, true);
  assert.deepEqual({ ...flagged?.audit, at: undefined }, { reason: "short", listed: 30, reported: 150, at: undefined });

  // a hidden list (timeout here) keeps the verdict; an honest one clears it
  src.players.delete("10.0.0.1");
  await auditPlayers(db, src, { minAgeHours: 0 });
  assert.equal((await getServer(db, 1))?.suspicious, true);
  src.players.set("10.0.0.1", list(148));
  await auditPlayers(db, src, { minAgeHours: 0 });
  const clean = await getServer(db, 1);
  assert.equal(clean?.suspicious, false);
  assert.equal(clean?.audit, null);

  // recently audited servers wait their turn
  src.players.set("10.0.0.1", list(10));
  await auditPlayers(db, src);
  assert.equal((await getServer(db, 1))?.audit, null);
  await db.close();
});

test("a crowd that never moves for a day is flagged as flat, even with a hidden list", async () => {
  const db = await memoryDb();
  const src = new FakeSource();
  src.list = [entry(1, new Date(Date.now() - 48 * HOUR), { players: 80, maxPlayers: 100 })];
  const poller = new Poller(db, src);
  await poller.init();
  await poller.cycle();
  await db.query(
    `INSERT INTO metrics (server_id, ts, players, queue)
     SELECT 1, now() - make_interval(mins => g * 10), 80 + (g % 2), 0 FROM generate_series(1, 140) g
     ON CONFLICT DO NOTHING`,
  );
  await auditPlayers(db, src, { minAgeHours: 0 });
  await auditPlayers(db, src, { minAgeHours: 0 });
  assert.equal((await getServer(db, 1))?.audit?.reason, "flat");
  await db.close();
});
