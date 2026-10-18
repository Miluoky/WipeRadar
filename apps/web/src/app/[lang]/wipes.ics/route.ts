import { buildIcs, type IcsEvent } from "@wiperadar/shared";
import { SITE } from "@/components/json-ld";
import { getDict, hasLocale } from "@/i18n";
import { api } from "@/lib/api";

/**
 * Next wipes of the given servers as an iCalendar file: "Add to calendar" on a server page downloads it,
 * the favorites tab offers it as a webcal:// subscription that calendar apps re-poll.
 */
export async function GET(req: Request, { params }: RouteContext<"/[lang]/wipes.ics">) {
  const { lang } = await params;
  if (!hasLocale(lang)) return new Response("not found", { status: 404 });
  const d = getDict(lang);
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 200);
  if (!ids.length) return new Response("ids required", { status: 400 });

  const [list, stats] = await Promise.all([
    api.servers(new URLSearchParams({ ids: ids.join(","), limit: "200" })),
    api.stats().catch(() => null),
  ]);
  const events: IcsEvent[] = list.items
    .filter((s) => s.nextWipeAt)
    .map((s) => {
      const start = new Date(s.nextWipeAt!);
      const url = `${SITE}/${lang}/server/${s.id}`;
      return {
        // the time is part of the UID: when a prediction moves, subscribers get the new event instead of a stale one
        uid: `wipe-${s.id}-${start.getTime() / 1000}@wiperadar`,
        start,
        minutes: 60,
        summary: `${d.ics.wipe}: ${s.name}`,
        description: [s.nextWipeSource && d.source[s.nextWipeSource], `client.connect ${s.addr}`, url].filter(Boolean).join("\n"),
        url,
        alarmMinutes: 30,
      };
    });
  if (stats) {
    const start = new Date(stats.nextForceWipe);
    events.push({ uid: `force-${start.getTime() / 1000}@wiperadar`, start, minutes: 60, summary: d.ics.force });
  }
  const name = ids.length === 1 && list.items[0] ? `WipeRadar: ${list.items[0].name}` : d.ics.feed;
  return new Response(buildIcs(name, events), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="wiperadar.ics"',
      "Cache-Control": "public, max-age=300",
    },
  });
}
