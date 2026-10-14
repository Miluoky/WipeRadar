import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarView } from "@/components/calendar-view";
import { alternates, getDict, hasLocale } from "@/i18n";
import { api } from "@/lib/api";

export async function generateMetadata({ params }: PageProps<"/[lang]/calendar">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  return { title: getDict(lang).calendar.title, alternates: alternates("/calendar") };
}

export default async function CalendarPage({ params }: PageProps<"/[lang]/calendar">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const d = getDict(lang);
  const qs = new URLSearchParams({ nextWithinHours: "168", sort: "players", limit: "1000", quality: "1" });
  const list = await api.servers(qs).catch(() => null);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{d.calendar.title}</h1>
        <p className="text-sm text-ash">{d.calendar.subtitle}</p>
      </header>
      <CalendarView servers={list?.items ?? []} d={d} locale={lang} />
    </div>
  );
}
