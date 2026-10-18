import { ShieldCheck } from "lucide-react";
import type { Dict } from "@/i18n";
import type { Region, ServerSummary } from "@wiperadar/shared";

export function regionCode(region: Region | null, d: Dict) {
  return region ? d.regionShort[region] : "??";
}

export function Badges({ s, d }: { s: ServerSummary; d: Dict }) {
  const items: { label: string; tone: string }[] = [];
  if (s.rate) items.push({ label: d.rate[s.rate], tone: s.rate === "x1" ? "text-bone" : "text-hazard" });
  if (s.groupLimit) items.push({ label: d.group[s.groupLimit], tone: "text-cold" });
  if (s.type !== "community") items.push({ label: d.type[s.type], tone: s.type === "official" ? "text-rust-2" : "text-ash" });
  if (s.cadence) items.push({ label: d.cadence[s.cadence], tone: "text-ash" });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="border-seam bg-ink-2 stamp text-bone">{regionCode(s.region, d)}</span>
      {s.verified && (
        <span className="flex items-center gap-1 border-toxic-dark stamp text-toxic" title={d.claim.badge}>
          <ShieldCheck className="size-3" aria-hidden />
          <span className="sr-only">{d.claim.badge}</span>
        </span>
      )}
      {items.map((b) => (
        <span key={b.label} className={`border-seam stamp ${b.tone}`}>
          {b.label}
        </span>
      ))}
    </div>
  );
}

/** Rust-HUD style population bar: green fill, hazard hatch for queue overflow. */
export function PopBar({ players, max, queue }: { players: number; max: number; queue: number }) {
  const pct = max ? Math.min(100, (players / max) * 100) : 0;
  const tone = pct >= 90 ? "bg-rust-2" : pct >= 50 ? "bg-toxic" : "bg-toxic-dark";
  return (
    <div className="relative h-2 w-full overflow-hidden bg-ink-2 ring-1 ring-seam" aria-hidden>
      <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      {queue > 0 && (
        <div className="absolute inset-y-0 right-0 hazard-thin" style={{ width: `${Math.min(30, (queue / max) * 100)}%` }} />
      )}
      {/* segment ticks like the in-game health bar */}
      <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0_9%,rgb(14_12_10/0.7)_9%_10%)]" />
    </div>
  );
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

/**
 * Monogram plate per server: initials of the first meaningful word on a
 * stamped-metal tile; hue is stable per network so sibling servers match.
 */
export function Emblem({ name, size = 44 }: { name: string; size?: number }) {
  const words = name
    .replace(/\[[^\]]*\]|\|.*$/g, " ")
    .split(/[\s#\-|]+/)
    .filter((w) => /^[\p{L}]/u.test(w) && !/^(eu|na|us|ru|the)$/i.test(w));
  const network = words[0] ?? name;
  const initials = (
    words.length > 1 && words[1].length > 2 && /^\p{Lu}/u.test(words[1]) ? network[0] + words[1][0] : network.slice(0, 2)
  ).toUpperCase();
  const palette = ["#ce422b", "#b8642a", "#8a7a3a", "#5d8a2a", "#3f7f86", "#6a5a8e", "#9c3f5c", "#a68a52"];
  const color = palette[Math.abs(hash(network.toLowerCase())) % palette.length];
  return (
    <svg viewBox="0 0 44 44" width={size} height={size} className="shrink-0" aria-hidden>
      <path d="M6 0H44V38L38 44H0V6Z" fill="#14110e" stroke="#3a312a" />
      <path d="M8 3H41V36L36 41H3V8Z" fill={color} fillOpacity="0.16" stroke={color} strokeOpacity="0.55" />
      <circle cx="7" cy="37" r="1.3" fill="#4a3f36" />
      <circle cx="37" cy="7" r="1.3" fill="#4a3f36" />
      <text
        x="22"
        y="27.5"
        textAnchor="middle"
        fill={color}
        style={{ font: "700 15px var(--font-roboto-condensed), sans-serif", letterSpacing: "0.04em" }}
      >
        {initials}
      </text>
    </svg>
  );
}

/** 24h players sparkline (server-rendered SVG, no JS). */
export function Sparkline({ data, label }: { data: number[]; label: string }) {
  if (data.length < 2 || data.every((v) => v === 0)) return null; // need two points for a line
  const W = 120;
  const H = 26;
  // scale to the server's own range so the daily wave is visible; the PopBar above shows absolute fill
  const top = Math.max(...data, 1) * 1.1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * W, H - 1 - (v / top) * (H - 3)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[26px] w-full" role="img" aria-label={label}>
      <path d={`${line}L${W},${H}L0,${H}Z`} fill="#8fbf4a" fillOpacity="0.14" />
      <path d={line} fill="none" stroke="#8fbf4a" strokeOpacity="0.85" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx={last[0] - 1.5} cy={last[1]} r="2" fill="#8fbf4a" />
    </svg>
  );
}

/** Where we are in the current wipe cycle: last wipe → next wipe. */
export function CycleBar({ last, next, d }: { last: string | null; next: string | null; d: Dict }) {
  if (!last || !next) return null;
  const a = Date.parse(last);
  const b = Date.parse(next);
  const now = Date.now();
  if (b <= a) return null;
  const pct = Math.max(0, Math.min(100, ((now - a) / (b - a)) * 100));
  const day = Math.floor((now - a) / 86_400_000) + 1;
  const total = Math.max(1, Math.round((b - a) / 86_400_000));
  return (
    <div className="space-y-1" title={`${d.card.cycle}: ${Math.round(pct)}%`}>
      <div className="flex justify-between font-mono text-[10px] text-smoke">
        <span className="font-display">{d.card.cycle}</span>
        <span>
          {d.card.day} {Math.min(day, total)} {d.card.of} {total}
        </span>
      </div>
      <div className="h-1 bg-ink-2 ring-1 ring-seam">
        <div className="h-full bg-gradient-to-r from-hazard via-rust-2 to-rust-dark" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
