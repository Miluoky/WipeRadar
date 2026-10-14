import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WipeRadar — Rust wipe tracker",
    short_name: "WipeRadar",
    description: "Just-wiped Rust servers, wipe calendar, live population and queues.",
    start_url: "/",
    display: "standalone",
    background_color: "#0e0c0a",
    theme_color: "#0e0c0a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
