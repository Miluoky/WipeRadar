import data from "./official-schedules.json";
import { forceWipeFor, nextForceWipe, zonedTime } from "./schedule";

const DAY = 86_400_000;

/**
 * Wipe schedules that big networks publish themselves (server description / website), checked against
 * the wipes we actually observed. Source of truth: official-schedules.json; research notes and the full
 * list (including networks we could not confirm) live in the project's wipe-schedules folder.
 */
export type OfficialStatus = "confirmed" | "zone_inferred" | "time_unstated" | "mismatch";

export interface OfficialSlot {
  /** 0=Sun..6=Sat */
  day: number;
  /** wall-clock HH:MM in `tz` */
  time: string;
}

export interface OfficialSchedule {
  /** weekly: every listed slot; biweekly: every other week counted from the force wipe; force: monthly force wipe only */
  kind: "weekly" | "biweekly" | "force";
  slots: OfficialSlot[];
  tz: string;
}

export interface OfficialEntry {
  network: string;
  name: string;
  /** JS regex tested against the server's hostname */
  match: string;
  schedule: OfficialSchedule | null;
  status: OfficialStatus;
  /** the network's own words, verbatim */
  quote: string;
  sourceUrl: string;
  note?: string;
}

interface OfficialData {
  checkedAt: string;
  servers: OfficialEntry[];
}

const DATA = data as OfficialData;
export const OFFICIAL_CHECKED_AT = DATA.checkedAt;

/** Only these are trusted enough to drive the next-wipe prediction. */
const USABLE: OfficialStatus[] = ["confirmed", "zone_inferred"];
const COMPILED = DATA.servers.filter((e) => e.schedule && USABLE.includes(e.status)).map((e) => ({ re: new RegExp(e.match), e }));

export function matchOfficial(hostname: string): OfficialEntry | null {
  return COMPILED.find((c) => c.re.test(hostname))?.e ?? null;
}

const local = (timeZone: string, at: Date) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(at);
  const n = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: n("year"), m: n("month") - 1, d: n("day") };
};
/** calendar day number, comparable across zones */
const dayNo = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / DAY);

/** Force wipe day counted as a New York calendar date (the day Facepunch ships, wherever the server is). */
function forceDay(year: number, month: number) {
  const f = forceWipeFor(year, month);
  const l = local("America/New_York", f);
  return { at: f, day: dayNo(l.y, l.m, l.d) };
}

/**
 * Next wipe after `now` per an official schedule. A slot on a force-wipe day before the force wipe
 * is dropped ("unless force wipe" in almost every schedule): the server wipes with the update instead.
 */
export function nextOfficialWipe(s: OfficialSchedule, now = new Date()): Date {
  const force = nextForceWipe(now);
  if (s.kind === "force" || !s.slots.length) return force;
  const start = local(s.tz, now);
  for (let i = 0; i < 70; i++) {
    const day = dayNo(start.y, start.m, start.d) + i;
    const date = new Date(day * DAY);
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    const dow = date.getUTCDay();
    // force wipe of this period: this month's if it already happened by this day, else last month's
    let f = forceDay(y, m);
    if (f.day > day) f = forceDay(m === 0 ? y - 1 : y, (m + 11) % 12);
    for (const slot of s.slots) {
      if (slot.day !== dow) continue;
      const [hh, mm] = slot.time.split(":").map(Number);
      const at = zonedTime(s.tz, y, m, d, hh, mm);
      if (at <= now) continue;
      if (day === f.day && at < f.at) continue;
      if (s.kind === "biweekly") {
        const first = f.day + ((dow - new Date(f.day * DAY).getUTCDay() + 7) % 7);
        if ((day - first) % 14 !== 0) continue;
      }
      return at < force ? at : force;
    }
  }
  return force;
}
