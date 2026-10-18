import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarClock, CalendarPlus, Clock3, Flame, Radar, ServerCrash, Star, Users, Zap } from "lucide-react";
import type { Stats } from "@wiperadar/shared";
import { Countdown } from "@/components/clock";
import { FilterBar } from "@/components/filter-bar";
import { ServerCard } from "@/components/server-card";
import { WipeTicker } from "@/components/wipe-ticker";
import { getDict, hasLocale, intlLocale, type Dict, type Locale } from "@/i18n";
import { api } from "@/lib/api";
import { FAV_COOKIE, parseFavorites } from "@/lib/favorites";

const PAGE = 30;
const TABS = ["wiped", "upcoming", "all", "favorites"] as const;
type Tab = (typeof TABS)[number];
const FILTER_KEYS = ["q", "region", "rate", "group", "type", "cadence", "sort", "minPlayers"];

/** Time windows (hours). "Fresh 0–2h" = wiped between 1 second and 2 hours ago. */
interface Win {
  k: string;
  from: number;
  to: number;
}
const WINDOWS: Record<"wiped" | "upcoming", { list: Win[]; def: string }> = {
  wiped: {
    def: "2h",
    list: [
      { k: "2h", from: 0, to: 2 },
      { k: "6h", from: 2, to: 6 },
      { k: "24h", from: 6, to: 24 },
      { k: "3d", from: 24, to: 72 },
      { k: "all", from: 0, to: 72 },
    ],
  },
  upcoming: {
    def: "all",
    list: [
      { k: "1h", from: 0, to: 1 },
      { k: "6h", from: 1, to: 6 },
      { k: "24h", from: 6, to: 24 },
      { k: "3d", from: 24, to: 72 },
      { k: "all", from: 0, to: 72 },
    ],
  },
};

function windowLabel(w: Win, d: Dict) {
  if (w.k === "all") return d.windows.all;
  return w.to <= 24 ? `${w.from}–${w.to} ${d.units.h}` : `${w.from / 24}–${w.to / 24} ${d.units.d}`;
}

/** Applies a window to API params for the given tab. */
function applyWindow(p: URLSearchParams, tab: "wiped" | "upcoming", w: Win) {
  const [from, to] = tab === "wiped" ? ["wipedFromHours", "wipedWithinHours"] : ["nextFromHours", "nextWithinHours"];
  p.set(to, String(w.to));
  if (w.from > 0) p.set(from, String(w.from));
  p.set("quality", "1");
}

export default async function Home({ params, searchParams }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const d = getDict(lang);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const tab: Tab = TABS.includes(one("tab") as Tab) ? (one("tab") as Tab) : "wiped";
  const page = Math.max(1, Number(one("page")) || 1);
  const favorites = parseFavorites((await cookies()).get(FAV_COOKIE)?.value);
  const favSet = new Set(favorites);
  const hdr = await headers();
  const host = hdr.get("x-forwarded-host") ?? hdr.get("host");

  const filters = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = one(k);
    if (v) filters.set(k, v);
  }

  const windowed = tab === "wiped" || tab === "upcoming" ? WINDOWS[tab] : null;
  const win = windowed ? (windowed.list.find((w) => w.k === one("w")) ?? windowed.list.find((w) => w.k === windowed.def)!) : null;

  const qs = new URLSearchParams(filters);
  if (tab === "wiped" && win) {
    applyWindow(qs, "wiped", win);
    if (!qs.has("sort")) qs.set("sort", "wiped"); // newest first: "1 second ago" on top
  } else if (tab === "upcoming" && win) {
    applyWindow(qs, "upcoming", win);
    if (!qs.has("sort")) qs.set("sort", "next");
  } else if (tab === "favorites") {
    qs.set("ids", favorites.join(",") || "0");
  }
  qs.set("limit", String(PAGE));
  qs.set("offset", String((page - 1) * PAGE));

  const feedQs = new URLSearchParams({ wipedWithinHours: "24", sort: "wiped", limit: "14", quality: "1" });
  // per-window counts for the chips (cheap count queries, limit=1)
  const countReqs = windowed
    ? windowed.list.map((w) => {
        const p = new URLSearchParams(filters);
        applyWindow(p, tab as "wiped" | "upcoming", w);
        p.set("limit", "1");
        return api.servers(p).then((r) => r.total);
      })
    : [];

  let stats: Stats | null = null;
  let list: Awaited<ReturnType<typeof api.servers>> | null = null;
  let feed: Awaited<ReturnType<typeof api.servers>> | null = null;
  let counts: number[] = [];
  try {
    [stats, list, feed, counts] = await Promise.all([api.stats(), api.servers(qs), api.servers(feedQs), Promise.all(countReqs)]);
  } catch {
    // worker down — render the shell with an error panel
  }

  const hrefWith = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(filters);
    if (tab !== "wiped") p.set("tab", tab);
    if (win && win.k !== windowed?.def) p.set("w", win.k);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    return `/${lang}${s ? `?${s}` : ""}`;
  };

  const title = { wiped: d.tabs.justWiped, upcoming: d.tabs.upcoming, all: d.tabs.all, favorites: d.tabs.favorites }[tab];
  const TitleIcon = { wiped: Flame, upcoming: CalendarClock, all: Radar, favorites: Star }[tab];

  return (
    <div className="space-y-5">
      <Hero d={d} stats={stats} locale={lang} />

      {feed && <WipeTicker items={feed.items} d={d} locale={lang} />}

      <div className="grid gap-4 lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start">
        <aside>
          <Suspense>
            <FilterBar d={d} />
          </Suspense>
        </aside>

        <div className="min-w-0 space-y-4">
          <section className="plate">
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 panel-head">
              <h2 className="flex items-center gap-2 text-[15px] text-bone">
                <TitleIcon className="size-4 text-rust-2" aria-hidden />
                {title}
              </h2>
              {list && <span className="font-mono text-xs text-smoke">{list.total.toLocaleString(intlLocale(lang))}</span>}
              {tab === "favorites" && favorites.length > 0 && (
                <a
                  href={`webcal://${host}/${lang}/wipes.ics?ids=${favorites.join(",")}`}
                  className="flex items-center gap-1.5 px-2.5 py-1 btn-dim text-[13px] sm:ml-auto"
                >
                  <CalendarPlus className="size-3.5" aria-hidden />
                  {d.ics.subscribe}
                </a>
              )}
              {windowed && (
                <nav className="flex flex-wrap gap-1 sm:ml-auto" aria-label={d.windows.label}>
                  {windowed.list.map((w, i) => {
                    const on = w.k === win?.k;
                    return (
                      <Link
                        key={w.k}
                        href={hrefWith({ w: w.k === windowed.def ? null : w.k, page: null })}
                        aria-current={on ? "true" : undefined}
                        className={`${on ? "btn-go" : "btn-dim"} flex items-center gap-1.5 px-2.5 py-1 text-[13px]`}
                      >
                        {windowLabel(w, d)}
                        {counts[i] !== undefined && (
                          <span className={`font-mono text-[11px] ${on ? "text-go-text/80" : "text-ash"}`}>{counts[i]}</span>
                        )}
                      </Link>
                    );
                  })}
                </nav>
              )}
            </header>

            <div className="p-2 sm:p-3">
              {!list ? (
                <ApiDown />
              ) : list.items.length === 0 ? (
                <div className="grid place-items-center gap-1 px-4 py-16 text-center">
                  {tab === "favorites" ? (
                    <>
                      <Star className="size-8 text-hazard" aria-hidden />
                      <p className="max-w-md text-sm text-ash">{d.favorites.empty}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-display text-lg">{d.empty.title}</p>
                      <p className="text-sm text-ash">{d.empty.hint}</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {list.items.map((s) => (
                    <ServerCard key={s.id} s={s} d={d} locale={lang} fav={favSet.has(s.id)} />
                  ))}
                </div>
              )}
            </div>
          </section>

          {list && (
            <Pager
              d={d}
              page={page}
              pages={Math.ceil(list.total / PAGE)}
              href={(n) => hrefWith({ page: n > 1 ? String(n) : null })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Stats as inventory slots: icon, stack count, label — like items in the Rust inventory. */
function Hero({ d, stats, locale }: { d: Dict; stats: Stats | null; locale: Locale }) {
  const fmt = (n: number) => n.toLocaleString(intlLocale(locale));
  const cells = stats
    ? [
        { v: fmt(stats.online), l: d.stats.servers, icon: Radar, tone: "text-bone" },
        { v: fmt(stats.players), l: d.stats.players, icon: Users, tone: "text-toxic" },
        { v: fmt(stats.wipedLast24h), l: d.stats.wiped, icon: Flame, tone: "text-hazard" },
        { v: fmt(stats.upcoming24h), l: d.stats.upcoming, icon: Clock3, tone: "text-cold" },
      ]
    : [];
  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="space-y-3">
        <p className="flex items-center gap-2 font-display text-[13px] text-rust-2">
          <Zap className="size-3.5" aria-hidden />
          {d.hero.kicker}
        </p>
        <h1 className="font-worn text-[38px] leading-[1.02] text-bone drop-shadow-[0_2px_0_rgb(0_0_0/0.5)] sm:text-[60px]">
          {d.hero.title}
        </h1>
        {/* hand-drawn underline, a bit crooked on purpose */}
        <svg viewBox="0 0 320 14" className="-mt-1 h-3 w-64 text-rust sm:w-80" aria-hidden>
          <path
            d="M2 9 C 40 3, 70 12, 110 7 S 190 3, 230 8 S 295 11, 318 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
        </svg>
        <p className="max-w-2xl text-sm text-ash sm:text-base">{d.hero.subtitle}</p>
        <p className="-rotate-1 font-hand text-[21px] text-hazard">
          <span aria-hidden>✎ </span>
          {d.hero.note}
        </p>
        {stats && (
          <dl className="wobble grid grid-cols-2 gap-1.5 pt-1 sm:grid-cols-4">
            {cells.map(({ v, l, icon: Icon, tone }) => (
              <div key={l} className="scratched relative flex min-h-[86px] flex-col justify-between p-2.5 slot">
                <Icon className={`size-5 opacity-80 ${tone}`} aria-hidden />
                <dd className={`font-display text-[28px] leading-none tabular-nums ${tone}`}>{v}</dd>
                <dt className="font-display text-[11px] font-normal tracking-wide text-ash">{l}</dt>
              </div>
            ))}
          </dl>
        )}
      </div>

      {stats && (
        <div className="stained taped bolted w-fit max-w-full -rotate-1 plate lg:justify-self-end">
          <p className="px-3 py-2 panel-head text-[12px]">{d.hero.forceWipe}</p>
          <div className="p-3">
            <Countdown iso={stats.nextForceWipe} units={d.units} />
          </div>
        </div>
      )}
    </section>
  );
}

function Pager({ d, page, pages, href }: { d: Dict; page: number; pages: number; href: (n: number) => string }) {
  if (pages <= 1) return null;
  const btn = "px-4 py-2 text-sm";
  return (
    <nav className="flex items-center justify-center gap-3 pt-1" aria-label="pagination">
      {page > 1 ? (
        <Link href={href(page - 1)} className={`btn-dim ${btn}`}>
          {d.pagination.prev}
        </Link>
      ) : (
        <span className={`pointer-events-none btn-dim opacity-40 ${btn}`}>{d.pagination.prev}</span>
      )}
      <span className="font-mono text-sm text-ash">
        {page} {d.pagination.of} {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className={`btn-dim ${btn}`}>
          {d.pagination.next}
        </Link>
      ) : (
        <span className={`pointer-events-none btn-dim opacity-40 ${btn}`}>{d.pagination.next}</span>
      )}
    </nav>
  );
}

function ApiDown() {
  return (
    <div className="flex items-center gap-3 p-6 text-sm text-ash">
      <ServerCrash className="size-6 text-rust-2" aria-hidden />
      <span>
        API is unreachable. Start the worker: <code className="font-mono text-bone">npm run dev -w @wiperadar/worker</code>
      </span>
    </div>
  );
}
