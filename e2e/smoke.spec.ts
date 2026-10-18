import { expect, test } from "@playwright/test";

test("root redirects to a locale and the home page lists servers", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(en|ru|uk|de|pl|fr|es|pt|tr|zh)$/);
  // the default tab shows only the last 2h of wipes, which demo data may not have at every hour
  await page.goto(`${new URL(page.url()).pathname}?tab=all`);
  const cards = page.locator('a[href*="/server/"]');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(3);
});

test("server page renders and the chart switches range", async ({ page }) => {
  await page.goto("/en?tab=all");
  const href = await page.locator('a[href*="/server/"]').first().getAttribute("href");
  await page.goto(href!);
  await expect(page.locator("h1")).toBeVisible();
  const tab = page.getByRole("tab", { name: /7/ });
  const metrics = page.waitForResponse((r) => r.url().includes("/metrics?range=7d") && r.ok());
  await tab.click();
  await metrics;
  await expect(tab).toHaveAttribute("aria-selected", "true");
});

test("calendar page renders", async ({ page }) => {
  const res = await page.goto("/en/calendar");
  expect(res?.status()).toBe(200);
  await expect(page.locator("h1")).toBeVisible();
});

test("language switch keeps the path and changes the text", async ({ page }) => {
  await page.goto("/en/calendar");
  const enTitle = await page.locator("h1").innerText();
  await page.locator("summary[aria-label]").first().click();
  await page.locator('a[role="menuitem"][hreflang^="ru"]').click();
  await expect(page).toHaveURL(/\/ru\/calendar$/);
  await expect(page.locator("html")).toHaveAttribute("lang", /ru/);
  await expect(page.locator("h1")).not.toHaveText(enTitle);
});

test("live feed connects over SSE", async ({ page }) => {
  const live = page.waitForResponse((r) => r.url().endsWith("/api/live") && r.status() === 200);
  await page.goto("/en");
  await live;
});
