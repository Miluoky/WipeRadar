/** Order = order in the language menu. Covers the largest Rust audiences. */
export const LOCALE_META = {
  en: { name: "English", intl: "en-GB", og: "en_US" },
  ru: { name: "Русский", intl: "ru-RU", og: "ru_RU" },
  uk: { name: "Українська", intl: "uk-UA", og: "uk_UA" },
  de: { name: "Deutsch", intl: "de-DE", og: "de_DE" },
  pl: { name: "Polski", intl: "pl-PL", og: "pl_PL" },
  fr: { name: "Français", intl: "fr-FR", og: "fr_FR" },
  es: { name: "Español", intl: "es-ES", og: "es_ES" },
  pt: { name: "Português (BR)", intl: "pt-BR", og: "pt_BR" },
  tr: { name: "Türkçe", intl: "tr-TR", og: "tr_TR" },
  zh: { name: "简体中文", intl: "zh-CN", og: "zh_CN" },
} as const;

export type Locale = keyof typeof LOCALE_META;
export const LOCALES = Object.keys(LOCALE_META) as Locale[];
export const intlLocale = (l: Locale) => LOCALE_META[l].intl;
