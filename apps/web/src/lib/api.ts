import "server-only";
import type { MetricPoint, MetricRange, Paged, ServerDetail, ServerSummary, Stats } from "@wiperadar/shared";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (res.status === 404) throw new NotFound();
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export class NotFound extends Error {}

export const api = {
  stats: () => get<Stats>("/api/stats"),
  servers: (qs: URLSearchParams) => get<Paged<ServerSummary>>(`/api/servers?${qs}`),
  server: (id: number) => get<ServerDetail>(`/api/servers/${id}`),
  similar: (id: number) => get<ServerSummary[]>(`/api/servers/${id}/similar`),
  metrics: (id: number, range: MetricRange) => get<MetricPoint[]>(`/api/servers/${id}/metrics?range=${range}`),
};
