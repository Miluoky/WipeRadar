"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";
import type { ClaimStatus, DayStats, OwnerSchedule } from "@wiperadar/shared";
import type { Dict } from "@/i18n";
import { intlLocale, type Locale } from "@/i18n/meta";

const key = (id: number) => `wr:claim:${id}`;

/**
 * Owner verification: contact → code → owner puts the code into the server description or name →
 * the worker sees it on its next RULES read. The code is kept in localStorage so a reload doesn't lose it.
 */
export function ClaimBox({
  serverId,
  verified,
  intro,
  schedule,
  locale,
  t,
  ts,
}: {
  serverId: number;
  verified: boolean;
  intro: string;
  schedule: OwnerSchedule | null;
  locale: Locale;
  t: Dict["claim"];
  ts: Dict["schedule"];
}) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState("");
  const [claim, setClaim] = useState<ClaimStatus | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error" | "pending">("idle");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key(serverId)) ?? "null") as ClaimStatus | null;
      // an open claim until it expires; a verified one for good (its key edits the schedule)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring client-only state after hydration
      if (saved && (saved.verified || Date.parse(saved.expiresAt) > Date.now())) setClaim(saved);
    } catch {
      // storage unavailable — start over
    }
  }, [serverId]);

  const remember = (c: ClaimStatus) => {
    // the status endpoint never returns the key: keep the one from creation
    const merged = { ...c, key: c.key ?? claim?.key };
    setClaim(merged);
    try {
      localStorage.setItem(key(serverId), JSON.stringify(merged));
    } catch {
      // not fatal
    }
  };

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    try {
      const res = await fetch(`/api/servers/${serverId}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact }),
      });
      if (!res.ok) throw new Error(String(res.status));
      remember(await res.json());
      setState("idle");
    } catch {
      setState("error");
    }
  };

  const check = async () => {
    if (!claim) return;
    setState("busy");
    try {
      const res = await fetch(`/api/claims/${claim.code}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const c = (await res.json()) as ClaimStatus;
      remember(c);
      setState(c.verified ? "idle" : "pending");
    } catch {
      setState("error");
    }
  };

  if (claim?.verified && claim.key) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-toxic">
          <ShieldCheck className="size-5" aria-hidden /> {t.verified}
        </p>
        <OwnerStats serverId={serverId} ownerKey={claim.key} locale={locale} t={ts} />
        <ScheduleForm serverId={serverId} ownerKey={claim.key} initial={schedule} locale={locale} t={ts} error={t.error} />
      </div>
    );
  }
  if (verified && !open && !claim) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-toxic">
          <ShieldCheck className="size-5" aria-hidden /> {t.verified}
        </p>
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-ash underline hover:text-bone">
          {ts.again}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ShieldCheck className="size-5 text-toxic" aria-hidden />
      <p>{intro}</p>
      {claim ? (
        <>
          <p>{t.step}</p>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(claim.code).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
            className="flex w-full items-center justify-between gap-2 bg-ink-2 px-3 py-2 font-mono text-base text-bone ring-1 ring-seam select-all"
          >
            {claim.code}
            {copied ? <Check className="size-4 text-toxic" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          </button>
          <button type="button" onClick={check} disabled={state === "busy"} className="w-full px-3 py-2 btn-dim text-sm">
            {t.check}
          </button>
          {state === "pending" && <p className="text-xs text-hazard">{t.pending}</p>}
        </>
      ) : open ? (
        <form onSubmit={request} className="space-y-2">
          <input
            required
            maxLength={120}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={t.contact}
            aria-label={t.contact}
            className="w-full bg-ink-2 px-3 py-2 text-sm text-bone ring-1 ring-seam placeholder:text-smoke"
          />
          <button type="submit" disabled={state === "busy"} className="w-full px-3 py-2 btn-dim text-sm">
            {t.submit}
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="w-full px-3 py-2 btn-dim text-sm">
          {t.start}
        </button>
      )}
      {state === "error" && <p className="text-xs text-rust-2">{t.error}</p>}
    </div>
  );
}

/** Last 30 days of page views and Play/copy clicks, one visitor counted once a day. */
function OwnerStats({
  serverId,
  ownerKey,
  locale,
  t,
}: {
  serverId: number;
  ownerKey: string;
  locale: Locale;
  t: Dict["schedule"];
}) {
  const [days, setDays] = useState<DayStats[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/servers/${serverId}/stats`, { headers: { Authorization: `Bearer ${ownerKey}` }, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<DayStats[]>) : null))
      .then((d) => live && d && setDays(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [serverId, ownerKey]);

  if (!days) return null;
  const fmt = new Intl.NumberFormat(intlLocale(locale));
  const views = days.reduce((a, d) => a + d.views, 0);
  const connects = days.reduce((a, d) => a + d.connects, 0);
  const peak = Math.max(1, ...days.map((d) => d.views));
  return (
    <div className="space-y-2 border-t border-seam pt-3" data-testid="owner-stats">
      <p className="font-display text-xs text-bone">{t.stats}</p>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt>{t.views}</dt>
          <dd className="font-mono text-lg text-bone">{fmt.format(views)}</dd>
        </div>
        <div>
          <dt>{t.connects}</dt>
          <dd className="font-mono text-lg text-bone">{fmt.format(connects)}</dd>
        </div>
      </dl>
      {days.length > 1 && (
        <div className="flex h-8 items-end gap-px" aria-hidden>
          {days.map((d) => (
            <span
              key={d.day}
              title={`${d.day}: ${d.views} / ${d.connects}`}
              className="flex-1 bg-toxic/60"
              style={{ height: `${Math.max(4, (d.views / peak) * 100)}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Weekdays + time + zone; the worker turns it into the next wipe (force wipe rules included). */
function ScheduleForm({
  serverId,
  ownerKey,
  initial,
  locale,
  t,
  error,
}: {
  serverId: number;
  ownerKey: string;
  initial: OwnerSchedule | null;
  locale: Locale;
  t: Dict["schedule"];
  error: string;
}) {
  const [kind, setKind] = useState<OwnerSchedule["kind"]>(initial?.kind ?? "weekly");
  const [days, setDays] = useState<number[]>(initial ? [...new Set(initial.slots.map((s) => s.day))] : [4]);
  const [time, setTime] = useState(initial?.slots[0]?.time ?? "18:00");
  const [tz, setTz] = useState(initial?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");
  const zones = Intl.supportedValuesOf("timeZone");
  // Sun..Sat names in the visitor's language; 2023-01-01 was a Sunday
  const dayName = (d: number) =>
    new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + d)));

  const send = async (method: "PUT" | "DELETE") => {
    setState("busy");
    try {
      const res = await fetch(`/api/servers/${serverId}/schedule`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerKey}` },
        body: method === "PUT" ? JSON.stringify({ kind, tz, slots: days.map((day) => ({ day, time })) }) : undefined,
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("saved");
    } catch {
      setState("error");
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send("PUT");
      }}
      className="space-y-3 border-t border-seam pt-3"
    >
      <p className="font-display text-xs text-bone">{t.title}</p>
      <div className="flex gap-3 text-xs">
        {(["weekly", "biweekly"] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="radio" name={`wr-kind-${serverId}`} checked={kind === k} onChange={() => setKind(k)} />
            {t[k]}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const on = days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => setDays((x) => (on ? x.filter((v) => v !== d) : [...x, d]))}
              className={`${on ? "btn-go" : "btn-dim"} px-2 py-1 text-xs`}
            >
              {dayName(d)}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-xs">
        <label htmlFor={`wr-time-${serverId}`}>{t.time}</label>
        <input
          id={`wr-time-${serverId}`}
          type="time"
          required
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="bg-ink-2 px-2 py-1 text-bone ring-1 ring-seam"
        />
        <label htmlFor={`wr-tz-${serverId}`}>{t.tz}</label>
        <select
          id={`wr-tz-${serverId}`}
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="min-w-0 bg-ink-2 px-2 py-1 text-bone ring-1 ring-seam"
        >
          {zones.map((z) => (
            <option key={z}>{z}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={state === "busy" || !days.length} className="flex-1 px-3 py-2 btn-go text-sm">
          {t.save}
        </button>
        {initial && (
          <button type="button" onClick={() => void send("DELETE")} className="px-3 py-2 btn-dim text-sm">
            {t.remove}
          </button>
        )}
      </div>
      {state === "saved" && <p className="text-xs text-toxic">{t.saved}</p>}
      {state === "error" && <p className="text-xs text-rust-2">{error}</p>}
    </form>
  );
}
