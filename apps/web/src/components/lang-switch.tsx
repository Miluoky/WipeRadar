"use client";

import { Check, ChevronDown, Globe } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { LOCALE_META, LOCALES, type Locale } from "@/i18n/meta";

/** Language menu: keeps the current path and filters, remembers the choice in a cookie. */
export function LangSwitch({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const ref = useRef<HTMLDetailsElement>(null);
  const rest = pathname.split("/").slice(2).join("/");
  const qs = params.toString();

  // close on outside click / Escape
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="group relative">
      <summary
        aria-label={label}
        className="flex cursor-pointer list-none items-center gap-1.5 border border-seam bg-ink-2 px-2.5 py-1.5 font-mono text-xs text-bone uppercase plate-sm select-none hover:border-smoke [&::-webkit-details-marker]:hidden"
      >
        <Globe className="size-3.5 text-ash" aria-hidden />
        {locale}
        <ChevronDown className="size-3 text-smoke transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="absolute right-0 z-50 mt-2 w-52 py-1 shadow-2xl plate shadow-black/70" role="menu">
        {LOCALES.map((l) => (
          <li key={l} role="none">
            <Link
              role="menuitem"
              href={`/${l}${rest ? `/${rest}` : ""}${qs ? `?${qs}` : ""}`}
              hrefLang={LOCALE_META[l].intl}
              onClick={() => {
                document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`;
                if (ref.current) ref.current.open = false;
              }}
              aria-current={l === locale ? "true" : undefined}
              className={`flex items-center justify-between px-3 py-2 text-sm ${
                l === locale ? "bg-rust/15 text-bone" : "text-ash hover:bg-steel-3 hover:text-bone"
              }`}
            >
              <span>{LOCALE_META[l].name}</span>
              <span className="flex items-center gap-2 font-mono text-[10px] text-smoke uppercase">
                {l}
                {l === locale && <Check className="size-3.5 text-rust-2" aria-hidden />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
