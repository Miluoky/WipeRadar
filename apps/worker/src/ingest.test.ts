import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveRow, detectWipe, wipeKind } from "./ingest";

test("derives a CIS server row from a list entry", () => {
  const born = Math.floor(Date.now() / 1000) - 3600;
  const r = deriveRow(
    {
      ip: "1.2.3.4",
      queryPort: 28017,
      gamePort: 28015,
      name: "ГРОМ RUST #1 [X2] МАКС 3 | ВАЙП 16.10",
      map: "Procedural Map",
      players: 255,
      maxPlayers: 255,
      keywords: `mp300,cp290,qp12,born${born},oxide,weekly,eu`,
    },
    new Date("2026-10-14T00:00:00Z"),
  );
  assert.equal(r.players, 290); // from keywords, not the saturated byte
  assert.equal(r.queue, 12);
  assert.equal(r.region, "cis"); // cyrillic name beats the "eu" tag
  assert.equal(r.rate, "x2");
  assert.equal(r.groupLimit, "trio");
  assert.equal(r.type, "modded");
  assert.equal(r.cadence, "weekly");
  assert.equal(r.hostnameWipeDate, "2026-10-16");
  assert.equal(r.bornAt?.getTime(), born * 1000);
});

test("wipe detection on born transitions", () => {
  const a = new Date("2026-10-08T15:00:00Z");
  assert.equal(detectWipe(null, a), "initial");
  assert.equal(detectWipe(a, a), null);
  assert.equal(detectWipe(a, new Date(a.getTime() + 60_000)), null); // jitter
  assert.equal(detectWipe(a, new Date("2026-10-15T15:00:00Z")), "wipe");
  assert.equal(detectWipe(new Date("2026-10-15T15:00:00Z"), a), null); // restored backup
  assert.equal(detectWipe(a, null), null);
});

test("force wipe classification", () => {
  assert.equal(wipeKind(new Date("2026-10-01T18:05:00Z")), "force");
  assert.equal(wipeKind(new Date("2026-10-08T15:00:00Z")), "map");
});
