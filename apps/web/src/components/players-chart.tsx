"use client";

import { useMemo, useRef, useState } from "react";
import type { MetricPoint, MetricRange } from "@wiperadar/shared";
import { intlLocale, type Locale } from "@/i18n/meta";

const W = 800;
const H = 220;
const PAD = { l: 36, r: 8, t: 12, b: 24 };
const RANGES: MetricRange[] = ["24h", "7d", "30d"];

/**
 * Population chart: players area (green) + queue area (amber hatched),
 * dashed red markers at wipes, crosshair tooltip. Pure SVG, no chart lib.
 */
export function PlayersChart({
  serverId,
  initial,
  maxPlayers,
  wipes,
  locale,
}: {
  serverId: number;
  initial: MetricPoint[];
  maxPlayers: number;
  wipes: string[];
  locale: Locale;
}) {
  const [range, setRange] = useState<MetricRange>("24h");
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const load = async (r: MetricRange) => {
    setRange(r);
    setLoading(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/metrics?range=${r}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const geo = useMemo(() => {
    if (data.length < 2) return null;
    const t0 = Date.parse(data[0].t);
    const t1 = Date.parse(data[data.length - 1].t);
    const top = Math.max(maxPlayers, ...data.map((p) => p.players + p.queue), 10);
    const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b);
    const pts = data.map((p) => ({ x: x(Date.parse(p.t)), yp: y(p.players), yq: y(p.players + p.queue), p }));
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.yp.toFixed(1)}`).join("");
    const area = `${line}L${pts[pts.length - 1].x},${H - PAD.b}L${pts[0].x},${H - PAD.b}Z`;
    const qTop = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.yq.toFixed(1)}`).join("");
    const qArea = `${qTop}${[...pts]
      .reverse()
      .map((p) => `L${p.x.toFixed(1)},${p.yp.toFixed(1)}`)
      .join("")}Z`;
    const ticks = [0, 0.5, 1].map((f) => ({ v: Math.round(top * f), y: y(top * f) }));
    const wipeX = wipes
      .map((w) => Date.parse(w))
      .filter((t) => t >= t0 && t <= t1)
      .map(x);
    const hasQueue = data.some((p) => p.queue > 0);
    return { pts, line, area, qArea, ticks, wipeX, hasQueue, t0, t1, maxY: y(maxPlayers) };
  }, [data, maxPlayers, wipes]);

  const fmt = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!geo || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < geo.pts.length; i++) if (Math.abs(geo.pts[i].x - px) < Math.abs(geo.pts[best].x - px)) best = i;
    setHover(best);
  };

  const h = hover !== null && geo ? geo.pts[hover] : null;

  return (
    <div>
      <div className="mb-3 flex gap-1" role="tablist">
        {RANGES.map((r) => (
          <button
            key={r}
            role="tab"
            aria-selected={range === r}
            onClick={() => load(r)}
            className={`px-3 py-1 font-display text-xs plate-sm ${
              range === r ? "bg-rust text-white" : "bg-steel-3 text-ash hover:text-bone"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <div className={`relative transition-opacity ${loading ? "opacity-50" : ""}`}>
        {!geo ? (
          <div className="grid h-[220px] place-items-center text-sm text-smoke">—</div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-none select-none"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label="players over time"
          >
            <defs>
              <linearGradient id="pl" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#8fbf4a" stopOpacity="0.45" />
                <stop offset="1" stopColor="#8fbf4a" stopOpacity="0.02" />
              </linearGradient>
              <pattern id="hz" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="4" height="8" fill="#f0b03a" fillOpacity="0.55" />
              </pattern>
            </defs>
            {geo.ticks.map((t) => (
              <g key={t.v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y} stroke="#3a312a" strokeDasharray="2 4" />
                <text x={PAD.l - 6} y={t.y + 4} textAnchor="end" className="fill-smoke font-mono text-[10px]">
                  {t.v}
                </text>
              </g>
            ))}
            <line x1={PAD.l} x2={W - PAD.r} y1={geo.maxY} y2={geo.maxY} stroke="#ce422b" strokeOpacity="0.5" />
            {geo.wipeX.map((x, i) => (
              <g key={i}>
                <line x1={x} x2={x} y1={PAD.t} y2={H - PAD.b} stroke="#e2573c" strokeDasharray="4 3" />
                <text x={x + 4} y={PAD.t + 10} className="fill-rust-2 font-mono text-[10px]">
                  WIPE
                </text>
              </g>
            ))}
            {geo.hasQueue && <path d={geo.qArea} fill="url(#hz)" />}
            <path d={geo.area} fill="url(#pl)" />
            <path d={geo.line} fill="none" stroke="#8fbf4a" strokeWidth="1.8" strokeLinejoin="round" />
            <text x={PAD.l} y={H - 6} className="fill-smoke font-mono text-[10px]">
              {fmt.format(geo.t0)}
            </text>
            <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-smoke font-mono text-[10px]">
              {fmt.format(geo.t1)}
            </text>
            {h && (
              <g>
                <line x1={h.x} x2={h.x} y1={PAD.t} y2={H - PAD.b} stroke="#ece3d8" strokeOpacity="0.35" />
                <circle cx={h.x} cy={h.yp} r="4" fill="#0e0c0a" stroke="#8fbf4a" strokeWidth="2" />
              </g>
            )}
          </svg>
        )}
        {h && (
          <div
            className="pointer-events-none absolute top-2 border border-seam bg-ink/95 px-2.5 py-1.5 font-mono text-xs plate-sm"
            style={{ left: `clamp(0px, calc(${(h.x / W) * 100}% - 70px), calc(100% - 150px))` }}
          >
            <div className="text-smoke">{fmt.format(Date.parse(h.p.t))}</div>
            <div className="text-toxic">{h.p.players} online</div>
            {h.p.queue > 0 && <div className="text-hazard">+{h.p.queue} queue</div>}
          </div>
        )}
      </div>
    </div>
  );
}
