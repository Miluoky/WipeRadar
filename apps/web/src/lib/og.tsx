import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";

export const OG_SIZE = { width: 1200, height: 630 };

let fonts: Promise<{ name: string; data: Buffer; weight: 600 | 700; style: "normal" }[]> | null = null;

/** TTFs with Cyrillic/Latin-ext (Satori can't use woff2 or system fonts). Loaded once per process. */
export function ogFonts() {
  fonts ??= Promise.all([
    readFile(join(process.cwd(), "assets/fonts/Oswald-Bold.ttf")),
    readFile(join(process.cwd(), "assets/fonts/Inter-SemiBold.ttf")),
  ]).then(([oswald, inter]) => [
    { name: "Oswald", data: oswald, weight: 700 as const, style: "normal" as const },
    { name: "Inter", data: inter, weight: 600 as const, style: "normal" as const },
  ]);
  return fonts;
}

/** Shared frame: hazard band, grain-less dark steel, logo. */
export function OgFrame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(180deg, #1c1814 0%, #0e0c0a 100%)",
        color: "#ece3d8",
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          height: 18,
          display: "flex",
          backgroundImage: "repeating-linear-gradient(-45deg, #f0b03a 0 18px, #17130f 18px 36px)",
        }}
      />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", padding: "48px 64px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: "Oswald", fontSize: 34, letterSpacing: 2 }}>
          <div
            style={{
              width: 44,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "3px solid #ce422b",
              borderRadius: 999,
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: 999, background: "#f0b03a", display: "flex" }} />
          </div>
          <span>WIPE</span>
          <span style={{ color: "#e2573c", marginLeft: -14 }}>RADAR</span>
        </div>
        {children}
      </div>
    </div>
  );
}
