import { buildApi } from "./api";
import { config } from "./config";
import { openDb } from "./db";
import { initGeo } from "./geo";
import { Poller } from "./poller";
import { DemoSource } from "./sources/demo";
import { SteamSource } from "./sources/steam";

const db = await openDb();
await initGeo();

const demo = config.demo ? new DemoSource() : null;
const source = demo ?? new SteamSource(config.steamKey!, config.listShards, config.listLimit, config.proberUrl);
console.log(`[worker] source=${source.name} db=${db.kind}`);

const poller = new Poller(db, source);
await poller.init();

const app = await buildApi(db);
await app.listen({ port: config.port, host: "0.0.0.0" });
console.log(`[api] http://localhost:${config.port}/api/stats`);

await poller.cycle();
if (demo) {
  await demo.seedHistory(db, poller.idByAddr);
  poller.forceFullPredict();
  await poller.cycle();
}

// demo ticks faster so the live feed moves while you watch
const interval = (config.demo ? 20 : config.listIntervalSec) * 1000;
setInterval(() => void poller.cycle(), interval);
setInterval(() => void poller.pruneMetrics(), 3_600_000);

const shutdown = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
