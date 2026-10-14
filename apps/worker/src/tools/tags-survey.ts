/**
 * Pulls the live Steam list and prints keyword tokens we don't understand yet,
 * so TAG tables in @wiperadar/shared/rust-keywords can be kept accurate.
 * Usage: STEAM_API_KEY=... npm run tags:survey -w @wiperadar/worker
 */
import { parseRustKeywords } from "@wiperadar/shared";
import { config } from "../config";
import { SteamSource } from "../sources/steam";

if (!config.steamKey) {
  console.error("STEAM_API_KEY is required");
  process.exit(1);
}
const list = await new SteamSource(config.steamKey, config.listShards, config.listLimit).fetchList();
const unknown = new Map<string, number>();
let withBorn = 0;
for (const e of list) {
  const kw = parseRustKeywords(e.keywords);
  if (kw.bornAt) withBorn++;
  for (const f of kw.flags) {
    const key = f.replace(/\d+/g, "#");
    unknown.set(key, (unknown.get(key) ?? 0) + 1);
  }
}
console.log(`${list.length} servers, ${withBorn} with born=`);
console.table(
  [...unknown]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([token, count]) => ({ token, count })),
);
