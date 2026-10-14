import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { pl } from "./pl";
import { pt } from "./pt";
import { ru, type Dict } from "./ru";
import { tr } from "./tr";
import { uk } from "./uk";
import { zh } from "./zh";
import { LOCALE_META, LOCALES, type Locale } from "./meta";

export { LOCALE_META, LOCALES, intlLocale, type Locale } from "./meta";

export const DEFAULT_LOCALE: Locale = "en";

const dictionaries: Record<Locale, Dict> = { en, ru, uk, de, pl, fr, es, pt, tr, zh };

export const hasLocale = (l: string): l is Locale => l in LOCALE_META;
export const getDict = (l: Locale): Dict => dictionaries[l];
export type { Dict };

/** Browser language → site locale. CIS languages without their own UI fall back to Russian. */
const LANG_TO_LOCALE: Record<string, Locale> = {
  en: "en",
  ru: "ru",
  be: "ru",
  kk: "ru",
  ky: "ru",
  uz: "ru",
  tg: "ru",
  hy: "ru",
  az: "ru",
  ka: "ru",
  mo: "ru",
  tt: "ru",
  uk: "uk",
  de: "de",
  pl: "pl",
  fr: "fr",
  es: "es",
  pt: "pt",
  tr: "tr",
  zh: "zh",
};

export function pickLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const langs = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { lang: tag.toLowerCase().split("-")[0], q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { lang } of langs) if (LANG_TO_LOCALE[lang]) return LANG_TO_LOCALE[lang];
  return DEFAULT_LOCALE;
}

/** hreflang map for a path without the locale prefix, e.g. "/server/12". */
export function alternates(path = "") {
  const languages: Record<string, string> = Object.fromEntries(LOCALES.map((l) => [LOCALE_META[l].intl, `/${l}${path}`]));
  languages["x-default"] = `/en${path}`;
  return { languages };
}
