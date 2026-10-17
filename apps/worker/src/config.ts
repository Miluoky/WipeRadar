try {
  process.loadEnvFile();
} catch {
  // no .env — fine
}

const env = (k: string) => process.env[k]?.trim() || undefined;

// Node's fetch ignores HTTP(S)_PROXY. Where Steam is only reachable through a local
// proxy/VPN (common in CIS), route outgoing HTTP through it. NO_PROXY keeps localhost direct.
// UDP (A2S) is never proxied.
if (env("HTTPS_PROXY") || env("HTTP_PROXY") || env("https_proxy") || env("http_proxy")) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

export const config = {
  port: Number(env("PORT") ?? 4000),
  databaseUrl: env("DATABASE_URL"),
  pgliteDir: env("PGLITE_DIR") ?? "./data/pglite",
  steamKey: env("STEAM_API_KEY"),
  demo: env("DEMO") === "1" || !env("STEAM_API_KEY"),
  geoipDb: env("GEOIP_DB"),
  /** Rust prober (services/prober). Unset → Node A2S client is used. */
  proberUrl: env("PROBER_URL"),
  listIntervalSec: Number(env("LIST_INTERVAL_SEC") ?? 120),
  /** Steam GetServerList filters; split into shards if one request hits the row limit. */
  // Steam caps one response at 10k rows; Rust has ~11.4k servers (Oct 2026), so split
  // into "has players" (~3k) and "empty" (~8.5k) — disjoint and both under the cap.
  listShards: (env("LIST_SHARDS") ?? "\\appid\\252490\\empty\\1;\\appid\\252490\\noplayers\\1").split(";"),
  listLimit: Number(env("LIST_LIMIT") ?? 10000), // Steam's hard cap per response
  rulesConcurrency: Number(env("RULES_CONCURRENCY") ?? 64),
  /** parallel UDP queries to a single host IP — hosting anti-DDoS hates bursts */
  perHostConcurrency: Number(env("PER_HOST_CONCURRENCY") ?? 3),
  rulesTtlHours: Number(env("RULES_TTL_HOURS") ?? 6),
  offlineAfterMisses: 3,
  metricsRetentionDays: Number(env("METRICS_RETENTION_DAYS") ?? 35),
  /** Public site origin; the only origin CORS allows. Unset → no cross-origin access (the site proxies /api). */
  siteUrl: env("SITE_URL"),
  /** Requests per minute per client IP on proxied (public) traffic. */
  rateLimitPerMin: Number(env("RATE_LIMIT_PER_MIN") ?? 300),
  sseMaxPerIp: Number(env("SSE_MAX_PER_IP") ?? 5),
  sseMaxTotal: Number(env("SSE_MAX_TOTAL") ?? 5000),
};
