"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import { CalendarDays, Clock3, Flame, Radar, Star } from "lucide-react";
import type { Locale } from "@/i18n/meta";

type Item = { key: string; href: string; label: string; icon: ComponentType<{ className?: string }> };

/**
 * Main-menu style navigation (like the big uppercase items of the Rust main menu).
 * Active item gets the lighter slot background and the red underline.
 */
export function NavLinks({
  locale,
  labels,
  variant,
}: {
  locale: Locale;
  labels: { fresh: string; upcoming: string; all: string; favorites: string; calendar: string };
  variant: "desktop" | "mobile";
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab") ?? "wiped";
  const onHome = pathname === `/${locale}`;

  const items: Item[] = [
    { key: "wiped", href: `/${locale}`, label: labels.fresh, icon: Flame },
    { key: "upcoming", href: `/${locale}?tab=upcoming`, label: labels.upcoming, icon: Clock3 },
    { key: "all", href: `/${locale}?tab=all`, label: labels.all, icon: Radar },
    { key: "favorites", href: `/${locale}?tab=favorites`, label: labels.favorites, icon: Star },
    { key: "calendar", href: `/${locale}/calendar`, label: labels.calendar, icon: CalendarDays },
  ];
  const isActive = (k: string) => (k === "calendar" ? pathname.endsWith("/calendar") : onHome && tab === k);

  if (variant === "mobile") {
    return (
      <nav className="flex overflow-x-auto border-t border-seam font-display text-[13px] sm:hidden" aria-label="main">
        {items.map(({ key, href, label, icon: Icon }) => (
          <Link
            key={key}
            href={href}
            aria-current={isActive(key) ? "page" : undefined}
            className={`flex shrink-0 grow items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 ${
              isActive(key) ? "border-rust bg-steel-3 text-bone" : "border-transparent text-ash"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="hidden h-full items-stretch font-display md:flex" aria-label="main">
      {items.map(({ key, href, label, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={isActive(key) ? "page" : undefined}
          className={`flex items-center gap-2 border-b-2 px-4 text-[15px] transition-colors ${
            isActive(key) ? "border-rust bg-steel-3/70 text-bone" : "border-transparent text-ash hover:bg-steel-2 hover:text-bone"
          }`}
        >
          <Icon className={`size-4 ${isActive(key) ? "text-rust-2" : ""}`} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
