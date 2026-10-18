import type { Dict } from "@/i18n";

/** "2д 4ч", "3ч 12м", "45с" — two most significant units. */
export function formatDuration(ms: number, u: Dict["units"]): string {
  const s = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}${u.d} ${h}${u.h}`;
  if (h > 0) return `${h}${u.h} ${m}${u.m}`;
  if (m > 0) return `${m}${u.m} ${s % 60}${u.s}`;
  return `${s % 60}${u.s}`;
}

/** A forecast miss to the minute: "<1m", "35m", "2h 5m", "1d 3h". */
export function formatMiss(ms: number, u: Dict["units"]): string {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 1) return `<1${u.m}`;
  if (m < 60) return `${m}${u.m}`;
  if (m < 1440) return `${Math.floor(m / 60)}${u.h} ${m % 60}${u.m}`;
  return `${Math.floor(m / 1440)}${u.d} ${Math.floor((m % 1440) / 60)}${u.h}`;
}

export const rustmapsUrl = (size: number, seed: number) => `https://rustmaps.com/map/${size}_${seed}`;
