import type { Cadence, ScheduleSource } from "./types";

const DAY = 86_400_000;

/** Offset (minutes) of an IANA zone from UTC at a given instant, e.g. -240 for EDT. */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Wall-clock time in a zone → UTC instant (good enough away from the DST switch hour). */
export function zonedTime(timeZone: string, y: number, m: number, d: number, hh: number, mm = 0): Date {
  const guess = new Date(Date.UTC(y, m, d, hh, mm));
  const off = tzOffsetMinutes(timeZone, guess);
  return new Date(guess.getTime() - off * 60_000);
}

/**
 * Facepunch forced wipe: first Thursday of the month, 14:00 America/New_York
 * (= 19:00 UTC in winter, 18:00 UTC in summer).
 */
export function forceWipeFor(year: number, month: number): Date {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const day = 1 + ((4 - firstDow + 7) % 7);
  return zonedTime("America/New_York", year, month, day, 14);
}

export function nextForceWipe(from = new Date()): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const thisMonth = forceWipeFor(y, m);
  if (thisMonth.getTime() > from.getTime()) return thisMonth;
  return forceWipeFor(m === 11 ? y + 1 : y, (m + 1) % 12);
}

export function lastForceWipe(from = new Date()): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const thisMonth = forceWipeFor(y, m);
  if (thisMonth.getTime() <= from.getTime()) return thisMonth;
  return forceWipeFor(m === 0 ? y - 1 : y, (m + 11) % 12);
}

export interface Prediction {
  at: Date;
  source: ScheduleSource;
}

/**
 * Infer the typical wipe weekday/hour and period from history.
 * Returns null if history is too short or too irregular.
 */
export function inferFromHistory(wipes: Date[]): { periodDays: number; dow: number; hourUtc: number } | null {
  if (wipes.length < 3) return null;
  const sorted = [...wipes].sort((a, b) => a.getTime() - b.getTime()).slice(-6);
  const gaps = sorted.slice(1).map((d, i) => (d.getTime() - sorted[i].getTime()) / DAY);
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  const periodDays = [7, 14, 28, 30].reduce((best, p) => (Math.abs(p - median) < Math.abs(best - median) ? p : best), 7);
  // irregular: more than a third of gaps far from the period
  const off = gaps.filter((g) => Math.abs(g - periodDays) > 1.5).length;
  if (off > gaps.length / 3) return null;
  const last = sorted[sorted.length - 1];
  return { periodDays, dow: last.getUTCDay(), hourUtc: last.getUTCHours() };
}

/**
 * Best guess for the next wipe. Priority:
 *   owner schedule > hostname date > history pattern > cadence tag > force wipe.
 * Every server wipes on force wipe at the latest, so it's the upper bound.
 */
export function predictNextWipe(input: {
  now?: Date;
  lastWipe: Date | null;
  cadence: Cadence | null;
  history: Date[];
  hostnameDate?: Date | null;
  ownerNext?: Date | null;
}): Prediction {
  const now = input.now ?? new Date();
  const force = { at: nextForceWipe(now), source: "force" as const };
  const capped = (p: Prediction): Prediction => (p.at.getTime() < force.at.getTime() ? p : force);

  if (input.ownerNext && input.ownerNext > now) return capped({ at: input.ownerNext, source: "owner" });
  if (input.hostnameDate && input.hostnameDate.getTime() + DAY > now.getTime()) {
    // hostname gives a date without time; reuse the hour of the last wipe if known
    const d = new Date(input.hostnameDate);
    d.setUTCHours(input.lastWipe ? input.lastWipe.getUTCHours() : 15);
    if (d > now) return capped({ at: d, source: "hostname" });
  }

  const pattern = inferFromHistory(input.history);
  if (pattern && input.lastWipe) {
    let at = input.lastWipe.getTime() + pattern.periodDays * DAY;
    while (at <= now.getTime()) at += pattern.periodDays * DAY;
    return capped({ at: new Date(at), source: "history" });
  }

  if (input.cadence && input.cadence !== "monthly" && input.lastWipe) {
    const period = input.cadence === "weekly" ? 7 : 14;
    let at = input.lastWipe.getTime() + period * DAY;
    while (at <= now.getTime()) at += period * DAY;
    return capped({ at: new Date(at), source: "tags" });
  }
  return force;
}
