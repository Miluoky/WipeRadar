import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { breadcrumbs, JsonLd, SITE } from "@/components/json-ld";
import { ServerCard } from "@/components/server-card";
import { alternates, getDict, hasLocale } from "@/i18n";
import { api } from "@/lib/api";
import { FAV_COOKIE, parseFavorites } from "@/lib/favorites";
import { fill, landingFilter, landingLabel, LANDING_SLUGS } from "@/lib/landing";

export async function generateMetadata({ params }: PageProps<"/[lang]/rust/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!hasLocale(lang) || !landingFilter(slug)) return {};
  const d = getDict(lang);
  const label = landingLabel(slug, d);
  return {
    title: fill(d.seo.landingTitle, { label }),
    description: fill(d.seo.landingDesc, { label }),
    alternates: { canonical: `/${lang}/rust/${slug}`, ...alternates(`/rust/${slug}`) },
    openGraph: { title: fill(d.seo.landingTitle, { label }), description: fill(d.seo.landingDesc, { label }), type: "website" },
  };
}

export default async function LandingPage({ params }: PageProps<"/[lang]/rust/[slug]">) {
  const { lang, slug } = await params;
  const filter = landingFilter(slug);
  if (!hasLocale(lang) || !filter) notFound();
  const d = getDict(lang);
  const label = landingLabel(slug, d);
  const list = await api.servers(filter).catch(() => null);
  const favSet = new Set(parseFavorites((await cookies()).get(FAV_COOKIE)?.value));
  const title = fill(d.seo.landingTitle, { label });

  return (
    <div className="space-y-5">
      <JsonLd
        data={[
          breadcrumbs([
            { name: d.seo.breadcrumbHome, path: `/${lang}` },
            { name: title, path: `/${lang}/rust/${slug}` },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: title,
            numberOfItems: list?.items.length ?? 0,
            itemListElement: (list?.items ?? []).slice(0, 20).map((s, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `${SITE}/${lang}/server/${s.id}`,
              name: s.name,
            })),
          },
        ]}
      />

      <header className="stained bolted p-5 plate sm:p-7">
        <nav aria-label="breadcrumb" className="mb-2 font-display text-[12px] text-smoke">
          <Link href={`/${lang}`} className="hover:text-bone">
            {d.seo.breadcrumbHome}
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-ash">{label}</span>
        </nav>
        <h1 className="font-worn text-[32px] leading-tight sm:text-[46px]">{title}</h1>
        <p className="mt-3 max-w-3xl text-sm text-ash sm:text-base">{fill(d.seo.landingIntro, { label })}</p>
      </header>

      <section className="plate">
        <h2 className="px-4 py-2.5 panel-head text-[15px] text-bone">
          {label} <span className="ml-2 font-mono text-xs text-smoke">{list?.total ?? 0}</span>
        </h2>
        <div className="space-y-1.5 p-2 sm:p-3">
          {list?.items.length ? (
            list.items.map((s) => <ServerCard key={s.id} s={s} d={d} locale={lang} fav={favSet.has(s.id)} />)
          ) : (
            <p className="p-8 text-center text-sm text-ash">{d.empty.title}</p>
          )}
        </div>
      </section>

      <section aria-labelledby="more" className="p-4 plate">
        <h2 id="more" className="mb-3 font-display text-[13px] text-ash">
          {d.seo.explore}
        </h2>
        <ul className="flex flex-wrap gap-1.5">
          {LANDING_SLUGS.filter((s) => s !== slug).map((s) => (
            <li key={s}>
              <Link href={`/${lang}/rust/${s}`} className="inline-block px-2.5 py-1 btn-dim text-[13px]">
                {landingLabel(s, d)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
