import { test } from "node:test";
import assert from "node:assert/strict";
import type { A2SPlayer } from "@wiperadar/a2s";
import { judgePlayers } from "./audit";

const people = (n: number): A2SPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ name: `player${i}`, score: i, durationSec: 60 + i * 97 }));

test("a list that matches the advertised count is fine", () => {
  assert.equal(judgePlayers(120, people(118)), "ok");
  // small servers aren't judged on the count
  assert.equal(judgePlayers(12, people(3)), "ok");
});

test("an empty list is a hidden list, not evidence", () => {
  assert.equal(judgePlayers(200, []), "hidden");
});

test("far fewer listed players than advertised", () => {
  assert.equal(judgePlayers(150, people(40)), "short");
  assert.equal(judgePlayers(150, people(80)), "ok");
});

test("bot-like lists: one join burst or one shared name", () => {
  const burst = people(40).map((p, i) => (i < 30 ? { ...p, durationSec: 3600.4 } : p));
  assert.equal(judgePlayers(40, burst), "clones");
  const named = people(40).map((p, i) => (i < 15 ? { ...p, name: "Bot" } : p));
  assert.equal(judgePlayers(40, named), "clones");
});
