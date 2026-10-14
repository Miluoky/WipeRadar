import { test } from "node:test";
import assert from "node:assert/strict";
import { queryInfo, queryRules, queryPlayers, joinDescription, startFakeServer, A2SError } from "./index";

const rules: Record<string, string> = {
  "world.seed": "1337420",
  "world.size": "4250",
  ent_cnt: "184233",
  url: "https://example.gg",
};
// long description → forces split packets
for (let i = 0; i < 6; i++) rules[`description_${i}`] = `Part ${i}: ` + "x".repeat(200);

test("A2S INFO/RULES/PLAYER against fake Rust server (challenge + split)", async () => {
  const srv = await startFakeServer({
    name: "[EU] Test Rust x2 Duo",
    map: "Procedural Map",
    players: 312, // > 255: byte field saturates, keywords carry the truth
    maxPlayers: 400,
    keywords: "mp400,cp312,qp17,born1728547200,oxide,biweekly,eu",
    gamePort: 28015,
    rules,
    playerList: [{ name: "rocket_enjoyer", score: 3, durationSec: 912.5 }],
  });
  try {
    const info = await queryInfo("127.0.0.1", srv.port);
    assert.equal(info.name, "[EU] Test Rust x2 Duo");
    assert.equal(info.players, 255);
    assert.equal(info.gamePort, 28015);
    assert.equal(info.keywords, "mp400,cp312,qp17,born1728547200,oxide,biweekly,eu");

    const r = await queryRules("127.0.0.1", srv.port);
    assert.equal(r["world.seed"], "1337420");
    assert.equal(r["world.size"], "4250");
    assert.ok(joinDescription(r)!.startsWith("Part 0: xxx"));
    assert.ok(joinDescription(r)!.includes("Part 5: "));

    const p = await queryPlayers("127.0.0.1", srv.port);
    assert.deepEqual(p, [{ name: "rocket_enjoyer", score: 3, durationSec: 912.5 }]);
  } finally {
    await srv.close();
  }
});

test("times out on a dead port", async () => {
  await assert.rejects(queryInfo("127.0.0.1", 9, { timeoutMs: 300, retries: 0 }), (e) => e instanceof A2SError);
});
