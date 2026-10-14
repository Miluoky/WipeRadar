import Link from "next/link";
import { AlertTriangle, Flame, Timer, Users } from "lucide-react";
import type { ServerSummary } from "@wiperadar/shared";
import type { Dict, Locale } from "@/i18n";
import { Badges, CycleBar, PopBar, Sparkline } from "./badges";
import { LocalTime, Since, Until } from "./clock";
import { ConnectButtons } from "./connect";
import { FavoriteButton } from "./favorite-button";
import { ServerLogo } from "./server-logo";

const FRESH_MS = 3 * 3600_000;

/**
 * Row in the server list.
 * Layout: [strip] [emblem + name + badges] [population + 24h spark] [wipe timing + cycle] [actions]
 * Collapses to a stacked card under md.
 */
export function ServerCard({ s, d, locale, fav = false }: { s: ServerSummary; d: Dict; locale: Locale; fav?: boolean }) {
  const fresh = s.lastWipeAt && Date.now() - Date.parse(s.lastWipeAt) < FRESH_MS;
  const href = `/${locale}/server/${s.id}`;

  return (
    <article
      className={`group relative grid grid-cols-1 gap-3 border border-seam/50 bg-ink-2/70 p-3 pl-4 transition-colors hover:border-seam hover:bg-steel-3/40 md:grid-cols-[minmax(0,1fr)_150px_200px_auto] md:items-center md:gap-4 xl:grid-cols-[minmax(0,1fr)_160px_220px_auto] ${
        fresh ? "bg-[linear-gradient(90deg,rgb(232_169_58/0.08),transparent_40%)]" : ""
      }`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1 ${fresh ? "hazard" : s.online ? "bg-toxic-dark" : "bg-smoke"}`}
      />

      <div className="flex min-w-0 gap-3">
        <Link href={href} tabIndex={-1} aria-hidden className="hidden sm:block">
          <ServerLogo name={s.name} src={s.logoImage} />
        </Link>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start gap-2">
            {s.promoted && <span className="mt-0.5 shrink-0 border-hazard stamp text-hazard">{d.card.ad}</span>}
            {/* fresh wipes are marked by the hazard edge + amber time; a badge here only stole name width */}
            {fresh && <Flame className="mt-0.5 size-4 shrink-0 text-hazard" aria-label="WIPE" />}
            <h3 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold text-bone">
              <Link href={href} className="line-clamp-2 break-words group-hover:text-rust-2 focus-visible:text-rust-2">
                {s.name}
              </Link>
            </h3>
            <FavoriteButton id={s.id} initial={fav} labels={{ add: d.card.favorite, remove: d.card.unfavorite }} />
          </div>
          <Badges s={s} d={d} />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2 font-mono text-sm">
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5 text-ash" aria-hidden />
            <b className="text-bone">{s.players}</b>
            <span className="text-smoke">/ {s.maxPlayers}</span>
          </span>
          {s.queue > 0 && (
            <span className="text-xs text-hazard">
              +{s.queue} {d.card.queue}
            </span>
          )}
        </div>
        <PopBar players={s.players} max={s.maxPlayers} queue={s.queue} />
        {s.spark && <Sparkline data={s.spark} label={d.card.online24h} />}
        {s.suspicious && (
          <p className="flex items-center gap-1 text-xs text-hazard">
            <AlertTriangle className="size-3" aria-hidden /> {d.card.suspicious}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm md:grid-cols-1">
          <div className="flex items-center gap-1.5">
            <dt className="shrink-0 font-display text-[11px] text-smoke md:w-24">{d.card.wiped}</dt>
            <dd className={fresh ? "font-semibold text-hazard" : "text-bone"}>
              {s.lastWipeAt ? <Since iso={s.lastWipeAt} units={d.units} suffix={d.card.ago} /> : d.card.unknown}
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="flex shrink-0 items-center gap-1 font-display text-[11px] text-smoke md:w-24">
              <Timer className="size-3" aria-hidden /> {d.card.next}
            </dt>
            <dd className="text-ash" title={s.nextWipeSource ? d.source[s.nextWipeSource] : undefined}>
              {s.nextWipeAt ? (
                <>
                  <span className="text-bone">
                    <Until iso={s.nextWipeAt} units={d.units} nowLabel={d.card.now} />
                  </span>
                  <span className="ml-1.5 hidden text-xs text-smoke lg:inline">
                    <LocalTime iso={s.nextWipeAt} locale={locale} withWeekday withDate={false} />
                  </span>
                </>
              ) : (
                d.card.unknown
              )}
            </dd>
          </div>
        </dl>
        <div className="hidden md:block">
          <CycleBar last={s.lastWipeAt} next={s.nextWipeAt} d={d} />
        </div>
      </div>

      <ConnectButtons addr={s.addr} labels={{ connect: d.card.connect, copy: d.card.copy, copied: d.card.copied }} />
    </article>
  );
}
