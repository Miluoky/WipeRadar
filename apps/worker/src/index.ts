import { buildApi } from "./api";
import { auditPlayers } from "./audit";
import { config } from "./config";
import { openDb } from "./db";
import { initGeo } from "./geo";
import { Poller } from "./poller";
import { StatsCounter } from "./stats";
import { DemoSource } from "./sources/demo";
import { SteamSource } from "./sources/steam";

const db = await openDb();
await initGeo();

const demo = config.demo ? new DemoSource() : null;
const source = demo ?? new SteamSource(config.steamKey!, config.listShards, config.listLimit, config.proberUrl);
console.log(`[worker] source=${source.name} db=${db.kind}`);

const poller = new Poller(db, source);
await poller.init();

const stats = new StatsCounter(db);
const app = await buildApi(db, poller.status, stats);
// "::" is dual-stack (IPv4 + IPv6) — Railway private networking resolves over IPv6;
// hosts with IPv6 disabled reject it, so fall back to IPv4 only
try {
  await app.listen({ port: config.port, host: "::" });
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "EAFNOSUPPORT") throw e;
  await app.listen({ port: config.port, host: "0.0.0.0" });
}
console.log(`[api] http://localhost:${config.port}/api/stats`);

await poller.cycle();
if (demo) {
  await demo.seedHistory(db, poller.idByAddr);
  await poller.rollupMetrics(new Date(0));
  poller.forceFullPredict();
  await poller.cycle();
  // two back-to-back audits so the demo shows flagged servers right away
  for (let i = 0; i < 2; i++) await auditPlayers(db, demo, { minAgeHours: 0 });
}

// demo ticks faster so the live feed moves while you watch
const interval = (config.demo ? 20 : config.listIntervalSec) * 1000;
setInterval(() => void poller.cycle(), interval);
// hourly rollup for the 7d/30d charts, then retention (TimescaleDB keeps its own policy for raw metrics)
const rollup = () => poller.rollupMetrics().catch((e) => console.error("[rollup] failed:", e));
const prune = () => poller.pruneMetrics().catch((e) => console.error("[prune] failed:", e));
void rollup().then(prune);
setInterval(() => void rollup(), 10 * 60_000);
setInterval(() => void prune(), 3_600_000);
// population audit: A2S_PLAYER against the advertised count, busiest servers first
const audit = () => auditPlayers(db, source).catch((e) => console.error("[audit] failed:", e));
setTimeout(() => void audit(), 60_000);
setInterval(() => void audit(), 15 * 60_000);
setInterval(() => void stats.flush().catch((e) => console.error("[stats] flush failed:", e)), 60_000);

const shutdown = async () => {
  await app.close();
  await stats.flush().catch(() => {});
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
