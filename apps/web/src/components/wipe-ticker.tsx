import Link from "next/link";
import { Flame } from "lucide-react";
import type { ServerSummary } from "@wiperadar/shared";
import type { Dict, Locale } from "@/i18n";
import { regionCode } from "./badges";
import { Since } from "./clock";

/** Endless strip of the latest wipes — the "radar sweep" of the home page. */
export function WipeTicker({ items, d, locale }: { items: ServerSummary[]; d: Dict; locale: Locale }) {
  if (items.length < 3) return null;
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center gap-6 pr-6" aria-hidden={hidden || undefined}>
      {items.map((s) => (
        <li key={s.id} className="flex shrink-0 items-center gap-2 text-sm">
          <span className="border-seam stamp px-1 py-0.5 text-[9px] text-ash">{regionCode(s.region, d)}</span>
          <Link
            href={`/${locale}/server/${s.id}`}
            tabIndex={hidden ? -1 : undefined}
            className="max-w-72 truncate text-bone hover:text-rust-2"
          >
            {s.name}
          </Link>
          <span className="font-mono text-xs text-hazard">
            {s.lastWipeAt && <Since iso={s.lastWipeAt} units={d.units} suffix={d.card.ago} />}
          </span>
          <span className="text-seam" aria-hidden>
            {"///"}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <section className="flex items-stretch overflow-hidden plate" aria-label={d.feed.title}>
      <h2 className="z-10 flex shrink-0 items-center gap-2 bg-rust px-3 py-2 font-display text-xs text-white">
        <Flame className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">{d.feed.title}</span>
      </h2>
      <div className="ticker-mask relative flex min-w-0 flex-1 items-center overflow-hidden py-2">
        <div className="ticker flex w-max">
          {row(false)}
          {row(true)}
        </div>
      </div>
    </section>
  );
}
