import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRustKeywords,
  parseRate,
  parseGroupLimit,
  groupFromTeamSize,
  searchKey,
  stripRichText,
  detectRegion,
  detectType,
  parseHostnameWipeDate,
  forceWipeFor,
  nextForceWipe,
  predictNextWipe,
} from "./index";

test("parses Rust keywords", () => {
  const kw = parseRustKeywords("mp200,cp57,qp3,v2593,born1728547200,gmrust,cs57813,oxide,monthly,EU,vanilla,ptrak");
  assert.equal(kw.maxPlayers, 200);
  assert.equal(kw.players, 57);
  assert.equal(kw.queue, 3);
  assert.equal(kw.bornAt?.toISOString(), "2024-10-10T08:00:00.000Z");
  assert.equal(kw.modded, true);
  assert.equal(kw.cadence, "monthly");
  assert.equal(kw.region, "eu");
  assert.deepEqual(kw.styleTags, ["vanilla"]);
  assert.deepEqual(kw.flags, ["ptrak"]);
});

test("parses live 2026 keywords: compressed ^tags, ts team size, $r region", () => {
  // verbatim from Steam GetServerList, Oct 2026
  const kw = parseRustKeywords("mp200,cp53,ptrak,qp0,$r?,v2634,^m,^v,^p,born1791307180,gmvanilla,cs167781,ts8,^o^z");
  assert.equal(kw.cadence, "monthly");
  assert.deepEqual(kw.styleTags, ["vanilla", "pve"]);
  assert.equal(kw.teamSize, 8);
  assert.equal(kw.players, 53);
  assert.equal(kw.region, null);
  assert.deepEqual(kw.flags, ["ptrak", "^o", "^z"]);
  assert.equal(parseRustKeywords("ts3,^w,$ruk1").cadence, "weekly");
  assert.equal(parseRustKeywords("$ruk1").region, "eu");
  assert.equal(parseRustKeywords("$rus5").region, "na");
  assert.equal(parseRustKeywords("$rau1").region, "oce");
  assert.equal(groupFromTeamSize(3), "trio");
  assert.equal(groupFromTeamSize(8), "nolimit");
  assert.equal(groupFromTeamSize(6), null);
});

test("search key folds look-alikes; rich text stripped", () => {
  assert.ok(searchKey("BOCTOK | WEDNESDAY X2").includes(searchKey("восток")));
  assert.ok(searchKey("Magic Rust #20 — Vanilla").includes(searchKey("magic rust")));
  assert.equal(stripRichText("<color=#ff0000>WIPE</color> <size=20>Fri</size>"), "WIPE Fri");
});

test("rejects garbage born values", () => {
  assert.equal(parseRustKeywords("born0").bornAt, null);
  assert.equal(parseRustKeywords(`born${Math.floor(Date.now() / 1000) + 10 * 86400}`).bornAt, null);
});

test("rate parsing incl. cyrillic х", () => {
  assert.equal(parseRate("Magic Rust #3 [x2] MAX 3"), "x2");
  assert.equal(parseRate("[RU] ТВОЙ РАСТ Х3 ТРИО"), "x3");
  assert.equal(parseRate("Rusty Moose |EU Monthly| 2x"), "x2");
  assert.equal(parseRate("Lazy Rust x1000 Solo"), "x10");
  assert.equal(parseRate("EU Vanilla Main"), "x1");
  // live names: the multiplier beats the word "vanilla"
  assert.equal(parseRate("Magic Rust #20 — Vanilla 2x | Baйп 12.10"), "x2");
  assert.equal(parseRate("Atlas - EU 2X Monthly | Vanilla+ | No BP Wipes"), "x2");
  assert.equal(parseRate("GORGONA [X1000 | PIRATE/NON-STEAM"), "x10");
  assert.equal(parseRate("ВОСТОК | ДЛЯ НОВИЧКОВ X1.5"), "x1");
  assert.equal(parseRate("Rust EU Main 3"), null);
});

test("group limit", () => {
  assert.equal(parseGroupLimit("EU Solo/Duo/Trio"), "trio"); // up to 3
  assert.equal(parseGroupLimit("Magic Rust #6 — Modded 2x (Solo/Duo)"), "duo");
  assert.equal(parseGroupLimit("WARBANDITS.GG Solo Only - Weekly"), "solo");
  assert.equal(parseGroupLimit("Magic Rust MAX 3"), "trio");
  assert.equal(parseGroupLimit("ГРАНД РАСТ ДУО"), "duo");
  assert.equal(parseGroupLimit("EU Main No Limit"), "nolimit");
});

test("region + type", () => {
  assert.equal(detectRegion("Some server", null, "DE"), "eu");
  assert.equal(detectRegion("[RU] Сервер", null, null), "cis");
  assert.equal(detectRegion("Just a server", null, null), null);
  assert.equal(detectRegion("Подземка", null, null), "cis");
  // CIS project on a German box is still for the CIS audience
  assert.equal(detectRegion("ВОСТОК | x2", null, "DE"), "cis");
  // lowercase "us" is English, not a region
  assert.equal(detectRegion("Come play with us", null, null), null);
  assert.equal(detectRegion("Rusty Moose |US Mondays|", null, "DE"), "na");
  assert.equal(detectRegion("Turkish Rust", null, "TR"), "eu");
  assert.equal(detectType("PVE Paradise", null, null), "pve");
  assert.equal(detectType("EU x2 Duo", parseRustKeywords("oxide"), "x2"), "modded");
});

test("hostname wipe date", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  assert.equal(parseHostnameWipeDate("RUST | WIPE 16.10 | x2", now)?.toISOString(), "2026-10-16T00:00:00.000Z");
  assert.equal(parseHostnameWipeDate("ВАЙП 02.01", new Date("2026-12-28T00:00:00Z"))?.toISOString(), "2027-01-02T00:00:00.000Z");
  assert.equal(parseHostnameWipeDate("Wiped 10/14", now)?.toISOString(), "2026-10-14T00:00:00.000Z");
  assert.equal(parseHostnameWipeDate("No date here", now), null);
  // real Magic Rust hostname: Latin "B" and "a" inside "вайп"
  assert.equal(parseHostnameWipeDate("Magic Rust #20 — Vanilla 2x | Baйп 12.10", now)?.toISOString(), "2026-10-12T00:00:00.000Z");
});

test("force wipe respects DST", () => {
  // Oct 2026: first Thursday is Oct 1, EDT (UTC-4) → 18:00 UTC
  assert.equal(forceWipeFor(2026, 9).toISOString(), "2026-10-01T18:00:00.000Z");
  // Jan 2027: first Thursday is Jan 7, EST (UTC-5) → 19:00 UTC
  assert.equal(forceWipeFor(2027, 0).toISOString(), "2027-01-07T19:00:00.000Z");
  assert.equal(nextForceWipe(new Date("2026-10-14T00:00:00Z")).toISOString(), "2026-11-05T19:00:00.000Z");
});

test("predicts from weekly history and caps at force wipe", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const h = [new Date("2026-09-24T15:00:00Z"), new Date("2026-10-01T15:00:00Z"), new Date("2026-10-08T15:00:00Z")];
  const p = predictNextWipe({ now, lastWipe: h[2], cadence: null, history: h });
  assert.equal(p.source, "history");
  assert.equal(p.at.toISOString(), "2026-10-15T15:00:00.000Z");
  const far = predictNextWipe({ now, lastWipe: null, cadence: null, history: [] });
  assert.equal(far.source, "force");
});
