"use client";

import Link from "next/link";
import type { ServerSummary } from "@wiperadar/shared";
import type { Dict } from "@/i18n";
import { intlLocale, type Locale } from "@/i18n/meta";
import { regionCode } from "./badges";
import { useNow } from "./clock";

/**
 * Seven day columns in the viewer's timezone (grouping must happen in the browser:
 * "Friday 01:00" for Moscow is "Thursday" for New York).
 */
export function CalendarView({ servers, d, locale }: { servers: ServerSummary[]; d: Dict; locale: Locale }) {
  const now = useNow();
  if (!now) return <div className="h-96 animate-pulse bg-steel/40" />;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const loc = intlLocale(locale);
  const dayKey = (t: number) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  const time = new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit" });
  const dayName = new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "short" });

  const days = Array.from({ length: 7 }, (_, i) => now + i * 86_400_000);
  // input is sorted by players: keep the busiest per day, then order by time
  const PER_DAY = 30;
  const byDay = new Map<string, ServerSummary[]>();
  for (const s of servers) {
    if (!s.nextWipeAt) continue;
    const k = dayKey(Date.parse(s.nextWipeAt));
    const day = byDay.get(k) ?? [];
    if (day.length < PER_DAY) byDay.set(k, [...day, s]);
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-xs text-smoke">
        {d.calendar.tz}: <span className="text-ash">{tz}</span>
      </p>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-7">
        {days.map((t, i) => {
          const items = (byDay.get(dayKey(t)) ?? []).sort((a, b) => Date.parse(a.nextWipeAt!) - Date.parse(b.nextWipeAt!));
          const title = i === 0 ? d.calendar.today : i === 1 ? d.calendar.tomorrow : dayName.format(t);
          return (
            <section key={i} className={`flex min-h-40 flex-col plate ${i === 0 ? "ring-1 ring-rust/60" : ""}`}>
              <header className="flex items-baseline justify-between border-b border-seam px-3 py-2">
                <h2 className={`font-display text-sm ${i === 0 ? "text-rust-2" : "text-bone"}`}>{title}</h2>
                <span className="font-mono text-xs text-smoke">{items.length}</span>
              </header>
              <ol className="flex-1 divide-y divide-seam/60">
                {items.length === 0 && <li className="px-3 py-4 text-xs text-smoke">{d.calendar.empty}</li>}
                {items.map((s) => {
                  const past = Date.parse(s.nextWipeAt!) < now;
                  return (
                    <li key={s.id}>
                      <Link
                        href={`/${locale}/server/${s.id}`}
                        className={`block px-3 py-2 hover:bg-steel-3 ${past ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-hazard">
                            {time.format(Date.parse(s.nextWipeAt!))}
                          </span>
                          <span className="border-seam stamp px-1 py-0.5 text-[9px] text-ash">{regionCode(s.region, d)}</span>
                          {s.nextWipeSource === "force" && (
                            <span className="border-rust stamp px-1 py-0.5 text-[9px] text-rust-2">FORCE</span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-bone/90">{s.name}</p>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
