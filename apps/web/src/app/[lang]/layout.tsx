import type { Metadata, Viewport } from "next";
import { Caveat, Inter, JetBrains_Mono, Roboto_Condensed, Rubik_Distressed } from "next/font/google";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Footer, Header } from "@/components/chrome";
import { alternates, getDict, hasLocale, LOCALE_META, LOCALES } from "@/i18n";
import { api } from "@/lib/api";
import "../globals.css";

// Roboto Condensed is the face of the Rust game UI
const display = Roboto_Condensed({
  variable: "--font-roboto-condensed",
  subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"],
  weight: ["400", "700"],
});
// worn spray-paint headline face (hero only) and a marker hand for the notes scribbled on the "map table"
const worn = Rubik_Distressed({ variable: "--font-worn", subsets: ["latin", "cyrillic"], weight: "400", preload: false });
const hand = Caveat({ variable: "--font-hand", subsets: ["latin", "cyrillic"], weight: ["600"], preload: false });
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin", "latin-ext", "cyrillic"] });

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const d = getDict(lang);
  return {
    title: { default: d.meta.title, template: "%s · WipeRadar" },
    description: d.meta.description,
    alternates: alternates(),
    openGraph: { siteName: "WipeRadar", locale: LOCALE_META[lang].og, type: "website" },
    twitter: { card: "summary_large_image" },
    metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  };
}

export const viewport: Viewport = { themeColor: "#0e0c0a" };

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const d = getDict(lang);
  const demo = await api
    .stats()
    .then((s) => s.demo)
    .catch(() => false);

  return (
    // Browser extensions (e.g. ones adding data-easx-* attributes) mutate <html>/<body> before
    // React hydrates; this silences only those two elements' attribute diffs, not their children.
    <html
      lang={lang}
      className={`${display.variable} ${inter.variable} ${mono.variable} ${worn.variable} ${hand.variable} antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col" suppressHydrationWarning>
        {/* shared SVG filters: hand-cut edges for tape/notes (referenced from CSS as url(#rough)) */}
        <svg width="0" height="0" aria-hidden="true" focusable="false" className="pointer-events-none absolute">
          <defs>
            <filter id="rough" x="-4%" y="-8%" width="108%" height="116%">
              <feTurbulence type="fractalNoise" baseFrequency="0.035 0.09" numOctaves="2" seed="4" result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
        <a
          href="#main"
          className="fixed top-2 left-2 z-[100] -translate-y-16 bg-rust px-3 py-2 text-sm text-white focus:translate-y-0"
        >
          Skip to content
        </a>
        <Suspense>
          <Header d={d} locale={lang} />
        </Suspense>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6">{children}</main>
        <Footer d={d} locale={lang} demo={demo} />
      </body>
    </html>
  );
}
