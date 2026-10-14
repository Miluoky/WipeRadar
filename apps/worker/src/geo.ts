import { config } from "./config";

type Lookup = (ip: string) => string | null;

let lookup: Lookup = () => null;

/** Optional MaxMind GeoLite2-Country lookup. Without GEOIP_DB we rely on tags and names. */
export async function initGeo() {
  if (!config.geoipDb) return;
  const maxmind = await import("maxmind");
  const reader = await maxmind.open<import("maxmind").CountryResponse>(config.geoipDb);
  lookup = (ip) => reader.get(ip)?.country?.iso_code ?? null;
  console.log("[geo] GeoIP database loaded");
}

export const countryOf = (ip: string) => lookup(ip);

/** Steam's own coarse region code — last resort. */
export function regionFromSteamCode(code: number | undefined) {
  switch (code) {
    case 0:
    case 1:
      return "na" as const;
    case 2:
      return "sa" as const;
    case 3:
      return "eu" as const;
    case 4:
      return "asia" as const;
    case 5:
      return "oce" as const;
    case 7:
      return "af" as const;
    default:
      return null;
  }
}
