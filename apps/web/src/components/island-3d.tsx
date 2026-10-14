"use client";

import { useEffect, useRef, useState } from "react";
import type { IslandHandle } from "@/lib/island-scene";

/**
 * 3D procedural island on a "map table". The Three.js scene is dynamically imported once the
 * element is near the viewport and the browser is idle, so it never competes with first paint.
 * Falls back to nothing (the CSS radar rings behind it stay) if WebGL isn't available.
 * Real wipes (SSE → "wr:wipe" window events) make a ring expand; clicking "wipes" the map.
 */
export function Island3D({ label, hint }: { label: string; hint: string }) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<IslandHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) {
      setUnsupported(true);
      return;
    }

    const start = async () => {
      try {
        const { mountIsland } = await import("@/lib/island-scene");
        if (disposed) return;
        handle.current = mountIsland(el, { seed: 1337, reduceMotion: reduce });
        setReady(true);
      } catch {
        setUnsupported(true); // no WebGL / context lost at creation
      }
    };

    // Safari has no requestIdleCallback
    const idle = (fn: () => void) => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1500 });
      else setTimeout(fn, 200);
    };

    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        idle(start);
      },
      { rootMargin: "150px" },
    );
    io.observe(el);

    const onWipe = () => handle.current?.ping();
    window.addEventListener("wr:wipe", onWipe);

    return () => {
      disposed = true;
      io.disconnect();
      window.removeEventListener("wr:wipe", onWipe);
      handle.current?.dispose();
      handle.current = null;
    };
  }, []);

  if (unsupported) return null;

  return (
    <div className="relative">
      {/* radar rings behind the canvas: visible instantly, keeps the box from looking empty while three.js loads */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-full opacity-60"
        style={{
          background:
            "repeating-radial-gradient(circle at 50% 55%, transparent 0 46px, rgb(232 169 58 / 0.1) 46px 47px), radial-gradient(circle at 50% 55%, rgb(157 193 83 / 0.08), transparent 62%)",
        }}
      />
      <div
        ref={host}
        role="img"
        aria-label={label}
        onClick={() => handle.current?.regenerate(Math.floor(Math.random() * 2 ** 31))}
        className={`relative aspect-[5/4] w-full cursor-pointer transition-opacity duration-700 select-none ${ready ? "opacity-100" : "opacity-0"}`}
      />
      <p className="pointer-events-none absolute right-2 bottom-1 max-w-[60%] rotate-[-3deg] font-hand text-[19px] leading-tight text-hazard">
        <span aria-hidden className="mr-1">
          ↖
        </span>
        {hint}
      </p>
    </div>
  );
}
