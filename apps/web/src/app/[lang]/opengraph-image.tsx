import { ImageResponse } from "next/og";
import { getDict, hasLocale, DEFAULT_LOCALE } from "@/i18n";
import { OG_SIZE, OgFrame, ogFonts } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "WipeRadar";

export default async function Image({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const d = getDict(hasLocale(lang) ? lang : DEFAULT_LOCALE);
  return new ImageResponse(
    <OgFrame>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", gap: 20 }}>
        <div style={{ display: "flex", color: "#e2573c", fontFamily: "Oswald", fontSize: 30, letterSpacing: 3 }}>
          {d.hero.kicker.toUpperCase()}
        </div>
        <div style={{ display: "flex", fontFamily: "Oswald", fontSize: 84, lineHeight: 1.05 }}>{d.hero.title.toUpperCase()}</div>
        <div style={{ display: "flex", color: "#a39686", fontSize: 30, maxWidth: 1000 }}>{d.hero.subtitle}</div>
      </div>
    </OgFrame>,
    { ...OG_SIZE, fonts: await ogFonts() },
  );
}
