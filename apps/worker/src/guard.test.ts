import { test } from "node:test";
import assert from "node:assert/strict";
import { ShrinkGuard } from "./guard";

test("shrink guard rejects an empty or halved list", () => {
  const g = new ShrinkGuard(11_000);
  assert.equal(g.accept(0), false);
  assert.equal(g.accept(5_000), false);
  assert.equal(g.accept(10_500), true);
  assert.equal(g.accept(12_000), true); // growth is always fine
});

test("shrink guard accepts a real shrink after repeated rejections", () => {
  const g = new ShrinkGuard(1000, 0.5, 3);
  assert.equal(g.accept(100), false);
  assert.equal(g.accept(100), false);
  assert.equal(g.accept(100), true);
  assert.equal(g.accept(90), true); // 100 is the new baseline
});

test("first snapshot with no baseline is trusted", () => {
  assert.equal(new ShrinkGuard().accept(0), true);
});
