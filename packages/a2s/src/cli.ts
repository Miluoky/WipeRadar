/** Usage: npm run query -w @wiperadar/a2s -- 1.2.3.4:28017 */
import { queryInfo, queryRules, joinDescription } from "./client";

const [host, port] = (process.argv[2] ?? "").split(":");
if (!host || !port) {
  console.error("usage: query <ip>:<queryPort>");
  process.exit(1);
}
const info = await queryInfo(host, Number(port));
console.log({ ...info, steamId: info.steamId?.toString(), gameId: info.gameId?.toString() });
const rules = await queryRules(host, Number(port)).catch((e) => ({ error: String(e) }));
console.log(rules);
if (!("error" in rules)) console.log("description:", joinDescription(rules));
