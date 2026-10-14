/**
 * Stylized island silhouette derived from the seed — NOT the real map.
 * Real renders come from RustMaps (needs an API key); this keeps the card
 * visual without an external request and is labelled as schematic.
 */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function MapPreview({ seed, size, label }: { seed: number; size: number; label: string }) {
  const r = rng(seed);
  const N = 72;
  const harmonics = Array.from({ length: 5 }, (_, i) => ({ a: (r() * 0.16) / (i + 1), p: r() * Math.PI * 2, k: i + 2 }));
  const scale = 0.62 + Math.min(1, (size - 2500) / 3500) * 0.22;
  const pts = Array.from({ length: N }, (_, i) => {
    const t = (i / N) * Math.PI * 2;
    const rad = scale * (1 + harmonics.reduce((acc, h) => acc + h.a * Math.sin(h.k * t + h.p), 0));
    return [100 + Math.cos(t) * rad * 80, 100 + Math.sin(t) * rad * 80];
  });
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("") + "Z";
  const monuments = Array.from({ length: 7 }, () => {
    const a = r() * Math.PI * 2;
    const m = r() * 0.55 * scale * 80;
    return [100 + Math.cos(a) * m, 100 + Math.sin(a) * m];
  });
  const roads = monuments.slice(0, 4).map(([x, y], i) => {
    const [x2, y2] = monuments[(i + 2) % monuments.length];
    return `M${x.toFixed(1)},${y.toFixed(1)} Q100,100 ${x2.toFixed(1)},${y2.toFixed(1)}`;
  });

  return (
    <figure className="relative">
      <svg viewBox="0 0 200 200" className="aspect-square w-full bg-[#1d3340]" role="img" aria-label={label}>
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="#ffffff" strokeOpacity="0.06" />
          </pattern>
          <radialGradient id="land" cx="0.5" cy="0.5" r="0.6">
            <stop offset="0" stopColor="#6d7a43" />
            <stop offset="0.75" stopColor="#5a6a3a" />
            <stop offset="1" stopColor="#c8b27a" />
          </radialGradient>
        </defs>
        <path d={d} fill="#c8b27a" transform="translate(100 100) scale(1.04) translate(-100 -100)" />
        <path d={d} fill="url(#land)" />
        {roads.map((p, i) => (
          <path key={i} d={p} fill="none" stroke="#3b3326" strokeWidth="1.2" strokeDasharray="3 2" />
        ))}
        {monuments.map(([x, y], i) => (
          <rect key={i} x={x - 2.5} y={y - 2.5} width="5" height="5" fill="#ce422b" stroke="#0e0c0a" strokeWidth="0.8" />
        ))}
        <rect width="200" height="200" fill="url(#grid)" />
      </svg>
      <figcaption className="absolute bottom-1.5 left-2 font-display text-[10px] text-bone/60">{label}</figcaption>
    </figure>
  );
}
