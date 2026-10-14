/**
 * End-to-end check of the Rust prober: N fake Rust servers on localhost,
 * one /probe call through the worker's client, verify every result.
 * Usage: PROBER_URL=http://127.0.0.1:4100 npx tsx src/tools/prober-bench.ts 500
 */
import { startFakeServer } from "@wiperadar/a2s";
import { probeRules } from "../sources/prober";

const n = Number(process.argv[2] ?? 300);
const url = process.env.PROBER_URL ?? "http://127.0.0.1:4100";
const servers = await Promise.all(
  Array.from({ length: n }, (_, i) =>
    startFakeServer({
      name: `bench ${i}`,
      map: "Procedural Map",
      players: i % 200,
      maxPlayers: 200,
      keywords: `mp200,cp${i % 200},born1728547200`,
      gamePort: 28015,
      rules: { "world.seed": String(1000 + i), "world.size": "4000", description_0: "y".repeat(1500) },
      playerList: [],
    }),
  ),
);
const t0 = performance.now();
const res = await probeRules(
  url,
  servers.map((s) => ({ ip: "127.0.0.1", queryPort: s.port })),
);
const ms = Math.round(performance.now() - t0);
const ok = res.filter((r, i) => !(r instanceof Error) && r["world.seed"] === String(1000 + i)).length;
console.log(`${ok}/${n} correct (challenge + split RULES) in ${ms} ms`);
await Promise.all(servers.map((s) => s.close()));
process.exit(ok === n ? 0 : 1);
