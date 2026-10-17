import type { NextConfig } from "next";
import { join } from "node:path";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

// baseline hardening; no CSP yet — the 3D hero, inline JSON-LD and next/font would each need nonces/hashes
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // self-contained server (apps/web/server.js + traced node_modules) — the image ships without dev deps
  output: "standalone",
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  // pages show live data on every request; caching lives in the worker/Redis layer
  cacheComponents: false,
  transpilePackages: ["@wiperadar/shared"],
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async rewrites() {
    // browser talks to /api/* on the same origin (SSE included), Next proxies to the worker
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
