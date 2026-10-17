"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Dict } from "@/i18n";
import { intlLocale, type Locale } from "@/i18n/meta";
import { formatDuration } from "@/lib/time";

/** One shared 1s ticker for every timer on the page. Server snapshot = 0 → placeholder, no hydration mismatch. */
let now = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now || Date.now(),
    () => 0,
  );
}

const Placeholder = () => <span className="text-smoke">—</span>;

export function Since({ iso, units, suffix }: { iso: string; units: Dict["units"]; suffix?: string }) {
  const t = useNow();
  if (!t) return <Placeholder />;
  return (
    <span className="tabular-nums">
      {formatDuration(t - Date.parse(iso), units)}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

export function Until({
  iso,
  units,
  prefix,
  nowLabel,
}: {
  iso: string;
  units: Dict["units"];
  prefix?: string;
  nowLabel: string;
}) {
  const t = useNow();
  if (!t) return <Placeholder />;
  const ms = Date.parse(iso) - t;
  if (ms <= 0) return <span className="text-hazard">{nowLabel}</span>;
  return (
    <span className="tabular-nums">
      {prefix ? `${prefix} ` : ""}
      {formatDuration(ms, units)}
    </span>
  );
}

/** Absolute time in the viewer's timezone. */
export function LocalTime({
  iso,
  locale,
  withDate = true,
  withWeekday = false,
}: {
  iso: string;
  locale: Locale;
  withDate?: boolean;
  withWeekday?: boolean;
}) {
  const t = useNow();
  if (!t) return <Placeholder />;
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: withWeekday ? "short" : undefined,
    day: withDate ? "2-digit" : undefined,
    month: withDate ? "short" : undefined,
    hour: "2-digit",
    minute: "2-digit",
  });
  return <time dateTime={iso}>{fmt.format(new Date(iso))}</time>;
}

/** A digit that flips like a mechanical counter: old value folds away, new one drops in (CSS 3D). */
function Flip({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  const [prev, setPrev] = useState<string | null>(null);
  useEffect(() => {
    if (text === shown) return;
    setPrev(shown);
    setShown(text);
    const id = setTimeout(() => setPrev(null), 420);
    return () => clearTimeout(id);
  }, [text, shown]);
  return (
    <span className="flip">
      <span key={shown} className="flip-new">
        {shown}
      </span>
      {prev !== null && (
        <span className="flip-old" aria-hidden>
          {prev}
        </span>
      )}
    </span>
  );
}

/** Big segmented countdown used for the force wipe. */
export function Countdown({ iso, units }: { iso: string; units: Dict["units"] }) {
  const t = useNow();
  const ms = t ? Math.max(0, Date.parse(iso) - t) : 0;
  const s = Math.floor(ms / 1000);
  const parts: [number, string][] = [
    [Math.floor(s / 86400), units.d],
    [Math.floor((s % 86400) / 3600), units.h],
    [Math.floor((s % 3600) / 60), units.m],
    [s % 60, units.s],
  ];
  return (
    <div className="flex gap-1.5" aria-live="off">
      {parts.map(([v, u]) => (
        <div key={u} className="min-w-14 px-2 py-2 text-center slot">
          <div className="font-display text-[26px] leading-none text-bone tabular-nums">
            {t ? <Flip text={String(v).padStart(2, "0")} /> : "--"}
          </div>
          <div className="mt-1 font-display text-[10px] text-ash">{u}</div>
        </div>
      ))}
    </div>
  );
}
