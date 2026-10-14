"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CADENCES, GROUP_LIMITS, RATES, REGIONS, SERVER_TYPES } from "@wiperadar/shared";
import type { Dict } from "@/i18n";

type Key = "region" | "rate" | "group" | "type" | "cadence";

const GROUPS: { key: Key; values: readonly string[] }[] = [
  { key: "region", values: REGIONS.filter((r) => r !== "af") },
  { key: "rate", values: RATES },
  { key: "group", values: GROUP_LIMITS },
  { key: "type", values: SERVER_TYPES },
  { key: "cadence", values: CADENCES },
];

export function FilterBar({ d }: { d: Dict }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [open, setOpen] = useState(false);

  const push = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };

  // debounce search typing
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => push((p) => (q ? p.set("q", q) : p.delete("q"))), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const selected = (key: Key) => new Set((params.get(key) ?? "").split(",").filter(Boolean));
  const toggle = (key: Key, value: string) =>
    push((p) => {
      const s = selected(key);
      if (s.has(value)) s.delete(value);
      else s.add(value);
      if (s.size) p.set(key, [...s].join(","));
      else p.delete(key);
    });

  const active = GROUPS.reduce((n, g) => n + selected(g.key).size, 0) + (params.get("q") ? 1 : 0);
  const label = (key: Key, v: string) => (d[key] as Record<string, string>)[v];

  return (
    // sidebar panel, like the filter column of the in-game server browser
    <section className="plate lg:sticky lg:top-[76px]" aria-busy={pending}>
      <header className="flex items-center gap-2 px-3 py-2 panel-head text-[13px]">
        <SlidersHorizontal className="size-3.5" aria-hidden />
        {d.filters.title}
        {active > 0 && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              push((p) => {
                for (const g of GROUPS) p.delete(g.key);
                p.delete("q");
              });
            }}
            className="ml-auto flex items-center gap-1 text-[11px] text-ash hover:text-rust-2"
          >
            <X className="size-3.5" aria-hidden /> {d.filters.reset}
          </button>
        )}
      </header>
      <div className="space-y-3 p-3">
        <div className="flex flex-col gap-2">
          <label className="relative flex-1">
            <span className="sr-only">{d.filters.search}</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-smoke" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={d.filters.search}
              className="w-full border border-seam bg-ink-2 py-2.5 pr-3 pl-9 text-sm text-bone plate-sm placeholder:text-smoke focus:border-rust focus:outline-none"
            />
          </label>
          <div className="flex gap-2">
            <select
              aria-label={d.filters.sort}
              value={params.get("sort") ?? ""}
              onChange={(e) => push((p) => (e.target.value ? p.set("sort", e.target.value) : p.delete("sort")))}
              className="flex-1 border border-seam bg-ink-2 px-3 py-2.5 text-sm text-bone focus:border-rust focus:outline-none"
            >
              <option value="">{d.sort.players}</option>
              <option value="wiped">{d.sort.wiped}</option>
              <option value="next">{d.sort.next}</option>
              <option value="name">{d.sort.name}</option>
            </select>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="flex items-center gap-2 px-3 btn-dim text-sm lg:hidden"
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              {active > 0 && <span className="bg-rust px-1.5 text-xs text-white">{active}</span>}
            </button>
          </div>
        </div>

        <div className={`${open ? "flex" : "hidden"} flex-col gap-3 lg:flex`}>
          {GROUPS.map((g) => {
            const sel = selected(g.key);
            return (
              <div key={g.key} className="space-y-1.5">
                <div className="font-display text-[11px] text-smoke">{d.filters[g.key]}</div>
                <div className="flex flex-wrap gap-1" role="group" aria-label={d.filters[g.key]}>
                  {g.values.map((v) => {
                    const on = sel.has(v);
                    return (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(g.key, v)}
                        className={`border px-2 py-1 text-[12.5px] transition-colors ${
                          on
                            ? "border-toxic-dark bg-toxic-dark text-go-text"
                            : "border-seam bg-ink-2 text-ash hover:border-smoke hover:text-bone"
                        }`}
                      >
                        {label(g.key, v)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
