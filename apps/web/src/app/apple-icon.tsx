import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Same radar mark as icon.svg, on an opaque square (iOS fills transparency with black and rounds the corners itself). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#1c1814" }}>
        <svg viewBox="0 0 32 32" width="180" height="180">
          <circle cx="16" cy="16" r="11" fill="none" stroke="#ce422b" strokeWidth="2" />
          <circle cx="16" cy="16" r="6" fill="none" stroke="#ce422b" strokeOpacity=".5" />
          <path d="M16 16 L16 5 A11 11 0 0 1 26.5 12.5 Z" fill="#ce422b" fillOpacity=".6" />
          <circle cx="22" cy="11" r="2" fill="#f0b03a" />
        </svg>
      </div>
    ),
    size,
  );
}
