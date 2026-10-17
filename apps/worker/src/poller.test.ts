import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleUrl } from "./poller";

test("rule images must be https, links may be http", () => {
  assert.equal(ruleUrl("https://cdn.example.com/a.png", { image: true }), "https://cdn.example.com/a.png");
  assert.equal(ruleUrl("http://cdn.example.com/a.png", { image: true }), null);
  assert.equal(ruleUrl(" http://example.com "), "http://example.com/");
  assert.equal(ruleUrl("javascript:alert(1)"), null);
  assert.equal(ruleUrl("not a url"), null);
  assert.equal(ruleUrl(undefined), null);
});
