import { defineConfig, devices } from "@playwright/test";

// Smoke tests against the demo worker (no Steam key) and a production build of the site.
const WEB = 3100;
const API = 4100;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB}`,
    trace: "retain-on-failure",
    // cloud sandboxes ship their own Chromium; CI installs Playwright's
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm start -w @wiperadar/worker",
      url: `http://localhost:${API}/api/health`,
      env: { PORT: String(API), STEAM_API_KEY: "", DATABASE_URL: "", PGLITE_DIR: "memory://" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // API_URL is baked into the rewrites at build time
      command: `npm run build -w @wiperadar/web && npm start -w @wiperadar/web -- -p ${WEB}`,
      url: `http://localhost:${WEB}/robots.txt`,
      env: { API_URL: `http://localhost:${API}`, SITE_URL: `http://localhost:${WEB}` },
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
