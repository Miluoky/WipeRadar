import type { MetadataRoute } from "next";
import { LOCALE_META, LOCALES } from "@/i18n";
import { api } from "@/lib/api";
import { LANDING_SLUGS } from "@/lib/landing";

const SITE = process.env.SITE_URL ?? "http://localhost:3000";
// 10 locales per page and 50k URLs per sitemap → ~4.9k pages; the rest of the budget goes to populated servers.
const MAX_SERVERS = 4_700;

/** Every page × every language, with hreflang alternates so Google serves the right locale. */
function entry(path: string, priority: number, changeFrequency: "hourly" | "daily"): MetadataRoute.Sitemap {
  const languages: Record<string, string> = Object.fromEntries(
    LOCALES.map((l) => [LOCALE_META[l].intl, `${SITE}/${l}${path}`]),
  );
  languages["x-default"] = `${SITE}/en${path}`;
  return LOCALES.map((l) => ({
    url: `${SITE}/${l}${path}`,
    changeFrequency,
    priority,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const out: MetadataRoute.Sitemap = [
    ...entry("", 1, "hourly"),
    ...entry("/calendar", 0.8, "hourly"),
    ...LANDING_SLUGS.flatMap((s) => entry(`/rust/${s}`, 0.7, "hourly")),
  ];
  try {
    for (let offset = 0; offset < MAX_SERVERS; offset += 200) {
      const page = await api.servers(
        new URLSearchParams({ limit: "200", offset: String(offset), sort: "players", quality: "1" }),
      );
      for (const s of page.items) out.push(...entry(`/server/${s.id}`, 0.6, "daily"));
      if (offset + 200 >= page.total) break;
    }
  } catch {
    // API down at build/request time — still serve the static part
  }
  return out;
}
