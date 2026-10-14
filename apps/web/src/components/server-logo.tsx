"use client";

import { useState } from "react";
import { Emblem } from "./badges";

/**
 * Owner-provided logo (A2S rule "logoimage") on a metal frame; falls back to the
 * generated emblem when missing or broken. No referrer leaks to the owner's host.
 */
/** Owner's header image (A2S "headerimage"), hidden entirely if it fails to load. */
export function ServerBanner({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return (
    // whole banner (owners put text in it, cropping cuts logos) over a blurred copy filling the plate
    <div className="relative h-44 overflow-hidden plate sm:h-60">
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative backdrop */}
      <img
        src={src}
        alt=""
        aria-hidden
        referrerPolicy="no-referrer"
        className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-2xl"
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party hosts, no optimizer */}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="relative size-full object-contain"
      />
    </div>
  );
}

/** Real Facepunch map render; shows `fallback` (the schematic) if missing or expired. */
export function MapImage({ src, alt, fallback }: { src: string | null; alt: string; fallback: React.ReactNode }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <>{fallback}</>;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block bg-[#1d3340]">
      {/* eslint-disable-next-line @next/next/no-img-element -- remote render, already sized by Facepunch */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="aspect-square w-full object-cover"
      />
    </a>
  );
}

export function ServerLogo({ name, src, size = 44 }: { name: string; src: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <Emblem name={name} size={size} />;
  return (
    <span className="relative block shrink-0 overflow-hidden bg-ink-2 ring-1 ring-seam" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party hosts, no optimizer */}
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="size-full object-cover"
      />
    </span>
  );
}
