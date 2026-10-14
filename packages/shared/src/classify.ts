import type { GroupLimit, Rate, Region, ServerType } from "./types";
import type { RustKeywords } from "./rust-keywords";

/** Cyrillic "х/Х" look identical to latin x on CIS server names. */
const X = "[xх×]";

export function parseRate(name: string): Rate | null {
  const n = name.toLowerCase();
  // An explicit multiplier wins: "Vanilla 2x" on real servers means vanilla gameplay at 2x gather.
  const m =
    n.match(new RegExp(String.raw`(?:^|[^\w])${X}\s?(\d{1,12}(?:[.,]\d+)?)(?![\d])`, "u")) ??
    n.match(new RegExp(String.raw`(?:^|[^\w])(\d{1,12}(?:[.,]\d+)?)\s?${X}(?![\wа-я])`, "u"));
  if (!m) return word(String.raw`vanilla|ванилла|ваниль|классика|classic`).test(n) ? "x1" : null;
  const v = Number(m[1].replace(",", "."));
  // buckets for fractional rates: 1.5x → vanilla-ish, 2.5x → 2x, …
  if (v < 1.75) return "x1";
  if (v < 2.75) return "x2";
  if (v < 4) return "x3";
  if (v < 10) return "x5";
  return "x10";
}

/** Word boundaries that also work for Cyrillic (JS \b is ASCII-only). */
const word = (alts: string) => new RegExp(String.raw`(?<![\p{L}\d])(?:${alts})(?![\p{L}\d])`, "iu");

// Largest first: "Solo/Duo/Trio" means groups of up to 3, so the biggest size mentioned wins.
const GROUP_PATTERNS: [RegExp, GroupLimit][] = [
  [word(String.raw`no\s?limit|nolimit|без\s?лимита?|clans?|кланы?`), "nolimit"],
  [word(String.raw`quad|квадро?|max\s?4|4\s?max|макс\s?4`), "quad"],
  [word(String.raw`trio|трио|max\s?3|3\s?max|макс\s?3`), "trio"],
  [word(String.raw`duo|дуо|max\s?2|2\s?max|макс\s?2`), "duo"],
  [word(String.raw`solo|соло|max\s?1|1\s?max|макс\s?1`), "solo"],
];

export function parseGroupLimit(name: string): GroupLimit | null {
  for (const [re, g] of GROUP_PATTERNS) if (re.test(name)) return g;
  return null;
}

/**
 * From the "ts<n>" keyword. 8 is Rust's default max team size, so 8+ means
 * the owner didn't restrict groups. 5–7 has no filter bucket → null (name decides).
 */
export function groupFromTeamSize(ts: number | null): GroupLimit | null {
  if (ts == null || ts < 1) return null;
  if (ts <= 4) return (["solo", "duo", "trio", "quad"] as const)[ts - 1];
  return ts >= 8 ? "nolimit" : null;
}

/**
 * Short codes ("EU", "US", "NA") only count in UPPER case — "join us" must not become North America.
 * Bracketed codes and full words are case-insensitive.
 */
const NAME_REGION: [RegExp, Region][] = [
  [/\[(?:ru|rus|cis|снг|kz|ua|by)\]|\b(?:moscow|russia)\b|\.ru\b|(?<![\p{L}])(?:москва|россия|мск)(?![\p{L}])/iu, "cis"],
  [/\b(?:RU|CIS|MSK)\b/, "cis"],
  [/\[(?:eu|eu west|eu east|de|uk|fr|pl|nl)\]|\b(?:europe|germany|london|amsterdam|frankfurt)\b/i, "eu"],
  [/\b(?:EU|UK)\b/, "eu"],
  [/\[(?:na|us|usa|ca)\]|\b(?:us east|us west|us central|north america|canada|chicago|dallas|new york)\b/i, "na"],
  [/\b(?:NA|US|USA)\b/, "na"],
  [/\[(?:sa|br)\]|\b(?:brazil|brasil|chile|latam)\b/i, "sa"],
  [/\b(?:BR|LATAM)\b/, "sa"],
  [/\[(?:asia|sg|jp|kr|cn|th|vn|ph)\]|\b(?:asia|singapore|japan|korea|hong kong)\b/i, "asia"],
  [/\b(?:SEA|ASIA|SG|JP|KR)\b/, "asia"],
  [/\[(?:au|oce|nz)\]|\b(?:oceania|australia|sydney)\b/i, "oce"],
  [/\b(?:AU|OCE|NZ)\b/, "oce"],
];

export function regionFromCountry(country: string): Region {
  const c = country.toUpperCase();
  if (["RU", "BY", "KZ", "UA", "AM", "AZ", "GE", "KG", "MD", "TJ", "UZ", "TM"].includes(c)) return "cis";
  if (["US", "CA", "MX"].includes(c)) return "na";
  if (["BR", "AR", "CL", "CO", "PE", "UY", "PY", "EC", "VE", "BO"].includes(c)) return "sa";
  if (["AU", "NZ"].includes(c)) return "oce";
  if (["ZA", "EG", "NG", "KE", "MA", "TN", "DZ", "GH"].includes(c)) return "af";
  if (
    [
      "JP",
      "KR",
      "SG",
      "HK",
      "CN",
      "TW",
      "TH",
      "VN",
      "PH",
      "IN",
      "ID",
      "MY",
      "AE",
      "SA",
      "IL",
      "QA",
      "BH",
      "KW",
      "PK",
      "BD",
    ].includes(c)
  )
    return "asia";
  return "eu"; // incl. TR — Turkish players sit on EU routes
}

/**
 * Who the server is FOR, not where the box is:
 *   1. explicit region in the name ("[EU]", "US East")
 *   2. Cyrillic name → CIS (CIS projects often rent boxes in DE/NL/FI)
 *   3. GeoIP country of the IP
 *   4. Rust region tag
 */
export function detectRegion(name: string, kw: RustKeywords | null, country?: string | null): Region | null {
  for (const [re, r] of NAME_REGION) if (re.test(name)) return r;
  if (/[а-яё]/i.test(name)) return "cis";
  if (country) return regionFromCountry(country);
  return kw?.region ?? null;
}

export function detectType(name: string, kw: RustKeywords | null, rate: Rate | null): ServerType {
  const n = name.toLowerCase();
  const style = new Set(kw?.styleTags ?? []);
  if (style.has("pve") || word(String.raw`pve|пве|build\s?server|creative`).test(n)) return "pve";
  if (/\bofficial\b|facepunch/.test(n) || kw?.flags.includes("official")) return "official";
  if (/barren/.test(n)) return "barren";
  if (style.has("softcore") || /softcore/.test(n)) return "softcore";
  if (kw?.modded || (rate && rate !== "x1")) return "modded";
  return "community";
}

/**
 * Many CIS servers put the wipe date into the hostname: "WIPE 14.10", "ВАЙП 14.10", "Wiped 10/14".
 * Returns a UTC date at 00:00 (time unknown) or null.
 */
/**
 * Latin look-alikes → Cyrillic, so "Baйп" (Latin B, a — used to dodge filters) reads as "вайп".
 * Only applied to words that already contain Cyrillic, so English "wipe" stays intact.
 */
const HOMOGLYPHS: Record<string, string> = {
  a: "а",
  b: "в",
  c: "с",
  e: "е",
  h: "н",
  k: "к",
  m: "м",
  o: "о",
  p: "р",
  t: "т",
  x: "х",
  y: "у",
};
export function deHomoglyph(s: string): string {
  return s.replace(/\S+/g, (w) => (/[а-яё]/i.test(w) ? w.replace(/[a-z]/gi, (c) => HOMOGLYPHS[c.toLowerCase()] ?? c) : w));
}

/**
 * Search skeleton: lowercase, Cyrillic look-alikes folded to Latin, punctuation collapsed.
 * "BOCTOK | x2" (Latin letters faking Cyrillic) and a user typing "восток" both become "boctok x2".
 */
const TO_LATIN: Record<string, string> = {
  а: "a",
  в: "b",
  е: "e",
  ё: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
};
export function searchKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[авеёкмнорстух]/g, (c) => TO_LATIN[c] ?? c)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Strip Unity rich-text markup Rust owners use in descriptions: <color=#f00>, <size=20>, <b>… */
export function stripRichText(s: string): string {
  return s.replace(
    /<\/?(?:color|size|b|i|u|s|align|font|mark|sprite|material|quad|line-height|voffset|cspace|indent)(?:=[^>]*)?>/gi,
    "",
  );
}

export function parseHostnameWipeDate(name: string, now = new Date()): Date | null {
  const m = deHomoglyph(name).match(/(?:wipe[d]?|вайп|вайпнулся)\s*[:\-|]?\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  // "." → DD.MM (EU/CIS). "/" → assume US MM/DD unless the first number can't be a month.
  const usOrder = m[0].includes("/") && a <= 12;
  const day = usOrder ? b : a;
  const month = usOrder ? a : b;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getUTCFullYear();
  const d = new Date(Date.UTC(year, month - 1, day));
  // "WIPE 02.01" seen in late December means next year
  if (!m[3] && d.getTime() < now.getTime() - 180 * 86_400_000) d.setUTCFullYear(year + 1);
  return d;
}
