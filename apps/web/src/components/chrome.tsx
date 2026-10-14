import Link from "next/link";
import type { Dict, Locale } from "@/i18n";
import { FOOTER_LANDINGS, landingLabel } from "@/lib/landing";
import { LangSwitch } from "./lang-switch";
import { LiveFeed } from "./live-feed";
import { NavLinks } from "./nav-links";

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-9" aria-hidden>
        <rect x="0.5" y="0.5" width="31" height="31" fill="#cd412b" />
        <circle cx="16" cy="16" r="10.5" fill="none" stroke="#fff" strokeOpacity="0.9" strokeWidth="1.6" />
        <circle cx="16" cy="16" r="5.5" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.2" />
        <path d="M16 16 L16 5.5 A10.5 10.5 0 0 1 26 12.8 Z" fill="#fff" fillOpacity="0.35" />
        <circle cx="21.5" cy="10.5" r="1.9" fill="#fff" />
      </svg>
      <span className="font-display text-[21px] leading-none tracking-wide">
        Wipe<span className="text-rust-2">Radar</span>
      </span>
    </span>
  );
}

export function Header({ d, locale }: { d: Dict; locale: Locale }) {
  const labels = {
    fresh: d.tabs.justWiped,
    upcoming: d.tabs.upcoming,
    all: d.tabs.all,
    favorites: d.tabs.favorites,
    calendar: d.nav.calendar,
  };
  return (
    <header className="sticky top-0 z-40 border-b border-seam bg-[#141412]/95 shadow-[0_6px_20px_rgb(0_0_0/0.45)] backdrop-blur">
      <div className="h-[3px] bg-rust" aria-hidden />
      <div className="mx-auto flex h-14 max-w-7xl items-stretch gap-5 px-4">
        <Link href={`/${locale}`} aria-label="WipeRadar" className="flex items-center">
          <Logo />
        </Link>
        <NavLinks locale={locale} labels={labels} variant="desktop" />
        <div className="ml-auto flex items-center gap-3">
          <LiveFeed d={d} locale={locale} refreshOnWipe />
          <LangSwitch locale={locale} label={d.nav.language} />
        </div>
      </div>
      <NavLinks locale={locale} labels={labels} variant="mobile" />
    </header>
  );
}

export function Footer({ d, locale, demo }: { d: Dict; locale: Locale; demo: boolean }) {
  return (
    <footer className="mt-16 border-t border-seam">
      {demo && (
        <div className="hazard-thin">
          <p className="mx-auto max-w-7xl bg-ink/85 px-4 py-2 text-center text-xs font-semibold text-hazard">{d.footer.demo}</p>
        </div>
      )}
      {/* crawlable links to the SEO landing pages from every page */}
      <nav aria-label={d.seo.popular} className="mx-auto max-w-7xl px-4 pt-8">
        <h2 className="mb-2 font-display text-[12px] text-smoke">{d.seo.popular}</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-ash">
          {FOOTER_LANDINGS.map((s) => (
            <li key={s}>
              <Link href={`/${locale}/rust/${s}`} className="hover:text-bone">
                {landingLabel(s, d)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-xs text-smoke sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <div className="space-y-1 sm:text-right">
          <p>{d.footer.disclaimer}</p>
          <p>
            <a href="https://db-ip.com" target="_blank" rel="noreferrer" className="hover:text-ash">
              IP Geolocation by DB-IP
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
