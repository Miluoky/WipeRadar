import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus, ExternalLink, Flame, Map as MapIcon, ShieldCheck, Timer, Users } from "lucide-react";
import type { OwnerSchedule, ServerDetail } from "@wiperadar/shared";
import { Badges, PopBar } from "@/components/badges";
import { MapImage, ServerBanner, ServerLogo } from "@/components/server-logo";
import { LocalTime, Since, Until } from "@/components/clock";
import { ClaimBox } from "@/components/claim-box";
import { ConnectButtons } from "@/components/connect";
import { FavoriteButton } from "@/components/favorite-button";
import { ShareButton } from "@/components/share-button";
import { MapPreview } from "@/components/map-preview";
import { PlayersChart } from "@/components/players-chart";
import { cookies } from "next/headers";
import { alternates, getDict, hasLocale, intlLocale, type Dict, type Locale } from "@/i18n";
import { breadcrumbs, JsonLd, SITE } from "@/components/json-ld";
import { fill } from "@/lib/landing";
import { api, NotFound } from "@/lib/api";
import { formatMiss, rustmapsUrl } from "@/lib/time";
import { FAV_COOKIE, parseFavorites } from "@/lib/favorites";

async function load(id: string): Promise<ServerDetail | null> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  try {
    return await api.server(n);
  } catch (e) {
    if (e instanceof NotFound) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: PageProps<"/[lang]/server/[id]">): Promise<Metadata> {
  const { lang, id } = await params;
  const s = await load(id).catch(() => null);
  if (!s || !hasLocale(lang)) return {};
  const d = getDict(lang);
  const vars = { name: s.name, players: s.players, max: s.maxPlayers, region: s.region ? d.region[s.region] : "—" };
  return {
    title: fill(d.seo.serverTitle, vars),
    description: fill(d.seo.serverDesc, vars),
    alternates: { canonical: `/${lang}/server/${s.id}`, ...alternates(`/server/${s.id}`) },
    // dead servers shouldn't compete in search; they come back on their own when the server does
    ...(s.online ? {} : { robots: { index: false, follow: true } }),
  };
}

/** "Mon, Thu 18:00 · every week (Europe/Moscow)" in the visitor's language. */
function describeSchedule(sch: OwnerSchedule, lang: Locale, d: Dict) {
  const day = new Intl.DateTimeFormat(intlLocale(lang), { weekday: "short", timeZone: "UTC" });
  const byTime = new Map<string, number[]>();
  for (const s of sch.slots) byTime.set(s.time, [...(byTime.get(s.time) ?? []), s.day]);
  const parts = [...byTime].map(
    ([time, days]) =>
      `${days
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map((n) => day.format(new Date(Date.UTC(2023, 0, 1 + n))))
        .join(", ")} ${time}`,
  );
  return `${parts.join("; ")} · ${d.schedule[sch.kind].toLowerCase()} (${sch.tz})`;
}

export default async function ServerPage({ params }: PageProps<"/[lang]/server/[id]">) {
  const { lang, id } = await params;
  if (!hasLocale(lang)) notFound();
  const d = getDict(lang);
  const s = await load(id);
  if (!s) notFound();
  const [metrics, similar, accuracy] = await Promise.all([
    api.metrics(s.id, "24h").catch(() => []),
    api.similar(s.id).catch(() => []),
    api.accuracy().catch(() => []),
  ]);
  // hit rate of the current prediction's source, once there's enough history to mean something
  const acc = accuracy.find((a) => a.source === s.nextWipeSource && a.wipes >= 20);
  const fresh = s.lastWipeAt && Date.now() - Date.parse(s.lastWipeAt) < 3 * 3600_000;
  const fav = parseFavorites((await cookies()).get(FAV_COOKIE)?.value).includes(s.id);
  const peak = metrics.reduce((m, p) => Math.max(m, p.players), 0);
  const avg = metrics.length ? Math.round(metrics.reduce((a, p) => a + p.players, 0) / metrics.length) : 0;
  const nf = new Intl.NumberFormat(intlLocale(lang));
  // seed+size only identify a map for procedural maps; custom maps reuse placeholder seeds
  const procedural = !s.map || /procedural/i.test(s.map);

  const url = `${SITE}/${lang}/server/${s.id}`;
  return (
    <div className="space-y-5">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "GameServer",
            name: s.name,
            url,
            inLanguage: lang,
            description: s.description?.slice(0, 300) || undefined,
            image: s.headerImage || s.logoImage || undefined,
            playersOnline: s.players,
            serverStatus: !s.online
              ? "https://schema.org/OfflineTemporarily"
              : s.queue > 0
                ? "https://schema.org/OnlineFull"
                : "https://schema.org/Online",
            game: { "@type": "VideoGame", name: "Rust", url: "https://store.steampowered.com/app/252490/Rust/" },
          },
          breadcrumbs([
            { name: d.seo.breadcrumbHome, path: `/${lang}` },
            { name: s.name, path: `/${lang}/server/${s.id}` },
          ]),
        ]}
      />
      <Link href={`/${lang}`} className="inline-flex items-center gap-1.5 font-display text-xs text-ash hover:text-rust-2">
        <ArrowLeft className="size-3.5" aria-hidden /> {d.server.back}
      </Link>

      <ServerBanner src={s.headerImage} />

      {/* title plate */}
      <section className="relative overflow-hidden rivets p-4 pt-6 plate sm:p-6">
        {fresh && <div className="absolute inset-x-0 top-0 h-1.5 hazard" aria-hidden />}
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {fresh && (
                <span className="flex items-center gap-1 border-rust bg-rust stamp text-white">
                  <Flame className="size-3" aria-hidden /> JUST WIPED
                </span>
              )}
              {!s.online && <span className="border-smoke stamp text-smoke">{d.server.offline}</span>}
              {s.promoted && <span className="border-hazard stamp text-hazard">{d.card.ad}</span>}
            </div>
            <div className="flex items-start gap-4">
              <ServerLogo name={s.name} src={s.logoImage} size={64} />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-start gap-2">
                  <h1 className="min-w-0 flex-1 text-2xl leading-tight font-bold break-words sm:text-3xl">{s.name}</h1>
                  <FavoriteButton id={s.id} initial={fav} labels={{ add: d.card.favorite, remove: d.card.unfavorite }} />
                </div>
                <Badges s={s} d={d} />
              </div>
            </div>
            <p className="font-mono text-sm text-ash">
              {d.server.connectHint} <span className="text-bone select-all">client.connect {s.addr}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ConnectButtons
              addr={s.addr}
              size="lg"
              labels={{ connect: d.card.connect, copy: d.card.copy, copied: d.card.copied }}
            />
            {s.nextWipeAt && (
              <a
                href={`/${lang}/wipes.ics?ids=${s.id}`}
                title={d.ics.add}
                className="flex items-center gap-1.5 px-4 py-3 btn-dim text-base"
              >
                <CalendarPlus className="size-4" aria-hidden />
                <span className="hidden sm:inline">{d.ics.add}</span>
              </a>
            )}
            <ShareButton labels={{ share: d.server.share, shared: d.server.shared }} />
          </div>
        </div>
      </section>

      {/* key numbers */}
      <section className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-2 p-4 plate">
          <p className="flex items-center gap-1.5 font-display text-xs text-ash">
            <Users className="size-3.5" aria-hidden /> {d.server.online}
          </p>
          <p className="font-mono text-3xl font-bold">
            {s.players}
            <span className="text-lg text-smoke"> / {s.maxPlayers}</span>
            {s.queue > 0 && <span className="ml-2 text-base text-hazard">+{s.queue}</span>}
          </p>
          <PopBar players={s.players} max={s.maxPlayers} queue={s.queue} />
          {metrics.length > 0 && (
            <p className="flex gap-4 pt-1 font-mono text-xs text-smoke">
              <span>
                {d.server.peak}: <b className="text-bone">{peak}</b>
              </span>
              <span>
                {d.server.avg}: <b className="text-bone">{avg}</b>
              </span>
            </p>
          )}
        </div>
        <div className="space-y-1 p-4 plate">
          <p className="flex items-center gap-1.5 font-display text-xs text-ash">
            <Flame className="size-3.5" aria-hidden /> {d.card.wiped}
          </p>
          <p className={`font-mono text-3xl font-bold ${fresh ? "text-hazard" : ""}`}>
            {s.lastWipeAt ? <Since iso={s.lastWipeAt} units={d.units} /> : "—"}
          </p>
          {s.lastWipeAt && (
            <p className="text-xs text-smoke">
              <LocalTime iso={s.lastWipeAt} locale={lang} withWeekday /> · {d.card.ago}
            </p>
          )}
        </div>
        <div className="space-y-1 p-4 plate">
          <p className="flex items-center gap-1.5 font-display text-xs text-ash">
            <Timer className="size-3.5" aria-hidden /> {d.card.next}
          </p>
          <p className="font-mono text-3xl font-bold">
            {s.nextWipeAt ? <Until iso={s.nextWipeAt} units={d.units} nowLabel={d.card.now} /> : "—"}
          </p>
          {s.nextWipeAt && (
            <p className="text-xs text-smoke">
              <LocalTime iso={s.nextWipeAt} locale={lang} withWeekday />
              {s.nextWipeSource && <> · {d.source[s.nextWipeSource]}</>}
            </p>
          )}
          {s.ownerSchedule && (
            <p className="text-xs text-toxic">
              {d.schedule.owner}: {describeSchedule(s.ownerSchedule, lang, d)}
            </p>
          )}
          {s.nextWipeAt && acc && (
            <p className="text-xs text-smoke">
              {fill(d.server.accuracy, { pct: Math.round((100 * acc.withinHour) / acc.wipes) })}
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <section className="p-4 plate">
            <h2 className="mb-3 font-display text-sm text-ash">{d.server.chart}</h2>
            <PlayersChart
              serverId={s.id}
              initial={metrics}
              maxPlayers={s.maxPlayers}
              wipes={s.wipes.map((w) => w.wipedAt)}
              locale={lang}
            />
          </section>

          {s.official && (
            <section className="p-4 plate">
              <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm text-ash">
                <ShieldCheck className="size-4 text-toxic" aria-hidden /> {d.server.official.title}
              </h2>
              <blockquote className="border-l-2 border-seam pl-3 text-sm text-bone/90">{s.official.quote}</blockquote>
              <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-smoke">
                <a href={s.official.sourceUrl} target="_blank" rel="noopener nofollow" className="text-cold hover:underline">
                  {d.server.official.source}
                </a>
                <span>
                  {d.server.official.checked}:{" "}
                  {new Date(`${s.official.checkedAt}T12:00:00Z`).toLocaleDateString(intlLocale(lang), { dateStyle: "medium" })}
                </span>
              </p>
            </section>
          )}

          {s.description && (
            <section className="p-4 plate">
              <h2 className="mb-2 font-display text-sm text-ash">{d.server.description}</h2>
              <p className="text-sm leading-relaxed whitespace-pre-line text-bone/90">{s.description}</p>
            </section>
          )}

          <section className="p-4 plate">
            <h2 className="mb-3 font-display text-sm text-ash">{d.server.history}</h2>
            <ol className="divide-y divide-seam text-sm">
              {s.wipes.map((w) => (
                <li key={w.wipedAt} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <span className={`stamp ${w.kind === "force" ? "border-rust text-rust-2" : "border-seam text-ash"}`}>
                    {d.server.kind[w.kind]}
                  </span>
                  <span className="min-w-36 text-bone">
                    <LocalTime iso={w.wipedAt} locale={lang} withWeekday />
                  </span>
                  {w.predictedAt && (
                    <span
                      title={d.server.forecastOff}
                      className={`font-mono text-xs ${
                        Math.abs(Date.parse(w.wipedAt) - Date.parse(w.predictedAt)) <= 3600_000 ? "text-toxic" : "text-hazard"
                      }`}
                    >
                      Δ {formatMiss(Date.parse(w.wipedAt) - Date.parse(w.predictedAt), d.units)}
                    </span>
                  )}
                  <span className="font-mono text-xs text-smoke">
                    {procedural && w.seed != null && w.worldSize ? (
                      <a href={rustmapsUrl(w.worldSize, w.seed)} target="_blank" rel="noreferrer" className="hover:text-rust-2">
                        {w.worldSize} · {w.seed}
                      </a>
                    ) : w.seed != null ? (
                      w.seed
                    ) : (
                      "—"
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="overflow-hidden plate">
            <h2 className="flex items-center gap-1.5 p-4 pb-3 font-display text-sm text-ash">
              <MapIcon className="size-4" aria-hidden /> {d.server.map}
            </h2>
            <MapImage
              src={s.mapImage}
              alt={`${d.server.map}: ${s.worldSize ?? ""} / ${s.seed ?? ""}`}
              fallback={
                s.seed != null && s.worldSize ? (
                  <MapPreview seed={s.seed} size={s.worldSize} label={d.server.mapNote} />
                ) : (
                  <div className="grid aspect-square place-items-center bg-ink-2 text-sm text-smoke">{s.map ?? "—"}</div>
                )
              }
            />
            <dl className="grid grid-cols-2 gap-2 p-4 font-mono text-sm">
              <div>
                <dt className="font-display text-[11px] text-smoke">{d.server.seed}</dt>
                <dd className="select-all">{s.seed ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-display text-[11px] text-smoke">{d.server.size}</dt>
                <dd>{s.worldSize ?? "—"}</dd>
              </div>
            </dl>
            {procedural && s.seed != null && s.worldSize && (
              <a
                href={rustmapsUrl(s.worldSize, s.seed)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 border-t border-seam py-3 font-display text-xs text-ash hover:bg-steel-3 hover:text-bone"
              >
                {d.server.openMap} <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </section>

          <section className="p-4 plate">
            <h2 className="mb-3 font-display text-sm text-ash">{d.server.details}</h2>
            <dl className="space-y-2 text-sm">
              {[
                [d.filters.region, s.region ? d.region[s.region] : "—"],
                [d.server.build, s.build ?? "—"],
                [d.server.fps, s.fps ?? "—"],
                [d.server.entities, (s.entities != null ? nf.format(s.entities) : null) ?? "—"],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between gap-4 border-b border-seam/60 pb-1.5">
                  <dt className="text-ash">{k}</dt>
                  <dd className="font-mono text-bone">{v}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4">
                <dt className="text-ash">{d.server.firstSeen}</dt>
                <dd className="font-mono text-bone">
                  <LocalTime iso={s.firstSeenAt} locale={lang} />
                </dd>
              </div>
            </dl>
            {s.url && /^https?:\/\//.test(s.url) && (
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer nofollow ugc"
                className="mt-4 flex items-center gap-1.5 text-sm text-cold hover:underline"
              >
                <ExternalLink className="size-3.5" aria-hidden /> {d.server.website}
              </a>
            )}
          </section>

          {similar.length > 0 && (
            <section className="p-4 plate">
              <h2 className="mb-3 font-display text-sm text-ash">{d.server.similar}</h2>
              <ul className="space-y-2">
                {similar.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/${lang}/server/${o.id}`}
                      className="flex items-center gap-3 border border-transparent p-1.5 hover:border-seam hover:bg-steel-3/40"
                    >
                      <ServerLogo name={o.name} src={o.logoImage} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-bone">{o.name}</span>
                        <span className="block font-mono text-xs text-smoke">
                          {o.players}/{o.maxPlayers}
                          {o.region && <> · {d.region[o.region]}</>}
                          {o.lastWipeAt && (
                            <>
                              {" · "}
                              <Since iso={o.lastWipeAt} units={d.units} suffix={d.card.ago} />
                            </>
                          )}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="border-dashed p-4 text-sm text-ash plate">
            <ClaimBox
              serverId={s.id}
              verified={s.verified}
              intro={d.server.claim}
              schedule={s.ownerSchedule}
              locale={lang}
              t={d.claim}
              ts={d.schedule}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}
