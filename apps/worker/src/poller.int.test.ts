import { test } from "node:test";
import assert from "node:assert/strict";
import { Poller } from "./poller";
import type { ListEntry, ServerSource } from "./sources/types";
import { memoryDb } from "./test-db";

const HOUR = 3_600_000;

function entry(n: number, bornAt: Date, players = 10): ListEntry {
  return {
    ip: `10.0.0.${n}`,
    queryPort: 28017,
    gamePort: 28015,
    name: `Test server ${n}`,
    map: "Procedural Map",
    players,
    maxPlayers: 100,
    keywords: `mp100,cp${players},born${Math.floor(bornAt.getTime() / 1000)},weekly`,
  };
}

/** Scripted source: the test swaps `list` and `rules` between cycles. */
class FakeSource implements ServerSource {
  readonly name = "fake";
  list: ListEntry[] = [];
  rules = new Map<string, Record<string, string> | Error>();
  async fetchList() {
    return this.list;
  }
  async fetchRules(ip: string) {
    const r = this.rules.get(ip);
    if (!r || r instanceof Error) throw r ?? new Error("timeout");
    return r;
  }
}

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
  await db.close();
});
