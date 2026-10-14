import type { Dict } from "@/i18n";

/**
 * SEO landing pages: one clean URL per high-intent search ("rust servers EU", "rust 2x solo", "wiped today").
 * They are ordinary filtered lists, but with their own indexable URL, title, H1 and intro text, and they
 * are cross-linked from the footer and from each other so crawlers reach them from every page.
 */
export type LandingKind = "fresh" | "region" | "rate" | "group" | "cadence" | "type";

interface Landing {
  kind: LandingKind;
  /** API filter value */
  value?: string;
}

export const LANDINGS: Record<string, Landing> = {
  "wiped-today": { kind: "fresh" },
  eu: { kind: "region", value: "eu" },
  cis: { kind: "region", value: "cis" },
  na: { kind: "region", value: "na" },
  sa: { kind: "region", value: "sa" },
  asia: { kind: "region", value: "asia" },
  oceania: { kind: "region", value: "oce" },
  vanilla: { kind: "rate", value: "x1" },
  "2x": { kind: "rate", value: "x2" },
  "3x": { kind: "rate", value: "x3" },
  "5x": { kind: "rate", value: "x5" },
  "10x": { kind: "rate", value: "x10" },
  solo: { kind: "group", value: "solo" },
  duo: { kind: "group", value: "duo" },
  trio: { kind: "group", value: "trio" },
  quad: { kind: "group", value: "quad" },
  "no-limit": { kind: "group", value: "nolimit" },
  weekly: { kind: "cadence", value: "weekly" },
  biweekly: { kind: "cadence", value: "biweekly" },
  monthly: { kind: "cadence", value: "monthly" },
  pve: { kind: "type", value: "pve" },
  softcore: { kind: "type", value: "softcore" },
  barren: { kind: "type", value: "barren" },
  modded: { kind: "type", value: "modded" },
};

export const LANDING_SLUGS = Object.keys(LANDINGS);

/** Slugs linked from the footer on every page. */
export const FOOTER_LANDINGS = ["wiped-today", "eu", "cis", "na", "asia", "vanilla", "2x", "solo", "weekly", "monthly"];

export function landingFilter(slug: string): URLSearchParams | null {
  const l = LANDINGS[slug];
  if (!l) return null;
  const p = new URLSearchParams({ quality: "1", sort: "players", limit: "40" });
  if (l.kind === "fresh") {
    p.set("wipedWithinHours", "24");
    p.set("sort", "wiped");
  } else if (l.value) {
    p.set(l.kind === "cadence" ? "cadence" : l.kind === "region" ? "region" : l.kind === "rate" ? "rate" : l.kind === "group" ? "group" : "type", l.value);
  }
  return p;
}

export function landingLabel(slug: string, d: Dict): string {
  const l = LANDINGS[slug];
  if (!l) return slug;
  switch (l.kind) {
    case "fresh":
      return d.seo.wipedToday;
    case "region":
      return d.region[l.value as keyof Dict["region"]];
    case "rate":
      return d.rate[l.value as keyof Dict["rate"]];
    case "group":
      return d.group[l.value as keyof Dict["group"]];
    case "cadence":
      return d.cadence[l.value as keyof Dict["cadence"]];
    case "type":
      return d.type[l.value as keyof Dict["type"]];
  }
}

/** "{label}" placeholder substitution for dictionary templates. */
export const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
