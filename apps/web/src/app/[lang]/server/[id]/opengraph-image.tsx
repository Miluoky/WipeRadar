import { ImageResponse } from "next/og";
import { getDict, hasLocale, DEFAULT_LOCALE } from "@/i18n";
import { api } from "@/lib/api";
import { OG_SIZE, OgFrame, ogFonts } from "@/lib/og";
import { formatDuration } from "@/lib/time";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Rust server on WipeRadar";

/** Discord/Telegram preview: name, population, time since wipe, next wipe — rendered live. */
export default async function Image({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang, id } = await params;
  const d = getDict(hasLocale(lang) ? lang : DEFAULT_LOCALE);
  const s = await api.server(Number(id)).catch(() => null);
  const fonts = await ogFonts();
  if (!s) return new ImageResponse(<OgFrame>{null}</OgFrame>, { ...OG_SIZE, fonts });

  const now = Date.now();
  const fresh = s.lastWipeAt && now - Date.parse(s.lastWipeAt) < 3 * 3600_000;
  const pct = s.maxPlayers ? Math.min(100, (s.players / s.maxPlayers) * 100) : 0;
  const chips = [
    s.region ? d.regionShort[s.region] : null,
    s.rate ? d.rate[s.rate] : null,
    s.groupLimit ? d.group[s.groupLimit] : null,
    s.cadence ? d.cadence[s.cadence] : null,
  ].filter(Boolean) as string[];

  const stat = (label: string, value: string, color = "#ece3d8") => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: "18px 22px",
        background: "#241f1a",
        border: "2px solid #3a312a",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", fontFamily: "Oswald", fontSize: 22, color: "#a39686", letterSpacing: 2 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ display: "flex", fontSize: 46, color }}>{value}</div>
    </div>
  );

  return new ImageResponse(
    <OgFrame>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 36, gap: 18, flex: 1 }}>
        {fresh && (
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              background: "#ce422b",
              color: "white",
              fontFamily: "Oswald",
              fontSize: 26,
              padding: "4px 14px",
              letterSpacing: 2,
            }}
          >
            JUST WIPED
          </div>
        )}
        <div style={{ display: "flex", fontSize: 54, lineHeight: 1.15, maxHeight: 130, overflow: "hidden" }}>{s.name}</div>
        <div style={{ display: "flex", gap: 10 }}>
          {chips.map((c) => (
            <div
              key={c}
              style={{
                display: "flex",
                border: "2px solid #3a312a",
                padding: "4px 12px",
                fontFamily: "Oswald",
                fontSize: 22,
                color: "#f0b03a",
              }}
            >
              {c.toUpperCase()}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: "auto" }}>
          {stat(d.server.online, `${s.players}/${s.maxPlayers}${s.queue ? ` +${s.queue}` : ""}`, "#8fbf4a")}
          {stat(
            d.card.wiped,
            s.lastWipeAt ? `${formatDuration(now - Date.parse(s.lastWipeAt), d.units)} ${d.card.ago}`.trim() : "—",
            fresh ? "#f0b03a" : "#ece3d8",
          )}
          {stat(d.card.next, s.nextWipeAt ? formatDuration(Date.parse(s.nextWipeAt) - now, d.units) : "—")}
        </div>
        <div style={{ display: "flex", height: 12, background: "#15120f", border: "2px solid #3a312a" }}>
          <div style={{ display: "flex", width: `${pct}%`, background: "#8fbf4a" }} />
        </div>
      </div>
    </OgFrame>,
    { ...OG_SIZE, fonts },
  );
}
