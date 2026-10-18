export const REGIONS = ["eu", "cis", "na", "sa", "asia", "oce", "af"] as const;
export type Region = (typeof REGIONS)[number];

export const RATES = ["x1", "x2", "x3", "x5", "x10"] as const;
/** x10 means "x10 and above". */
export type Rate = (typeof RATES)[number];

export const GROUP_LIMITS = ["solo", "duo", "trio", "quad", "nolimit"] as const;
export type GroupLimit = (typeof GROUP_LIMITS)[number];

export const SERVER_TYPES = ["official", "community", "modded", "barren", "softcore", "pve"] as const;
export type ServerType = (typeof SERVER_TYPES)[number];

export const CADENCES = ["weekly", "biweekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];

export type WipeKind = "map" | "full" | "force";
export type ScheduleSource = "owner" | "official" | "hostname" | "tags" | "history" | "force";

export interface ServerSummary {
  id: number;
  addr: string; // ip:gamePort (what players connect to)
  name: string;
  region: Region | null;
  country: string | null;
  players: number;
  maxPlayers: number;
  queue: number;
  map: string | null;
  seed: number | null;
  worldSize: number | null;
  rate: Rate | null;
  groupLimit: GroupLimit | null;
  type: ServerType;
  cadence: Cadence | null;
  lastWipeAt: string | null; // ISO
  nextWipeAt: string | null; // ISO
  nextWipeSource: ScheduleSource | null;
  online: boolean;
  headerImage: string | null;
  logoImage: string | null;
  /** max players seen since the last wipe */
  peakPlayers: number;
  promoted: boolean;
  suspicious: boolean;
  /** hourly average players for the last 24h (list endpoints only) */
  spark?: number[];
}

export interface WipeRecord {
  wipedAt: string;
  kind: WipeKind;
  seed: number | null;
  worldSize: number | null;
  map: string | null;
  /** what the site predicted for this wipe just before it happened, and from which source */
  predictedAt: string | null;
  predictedSource: ScheduleSource | null;
}

/** How close each prediction source landed to the real wipe time (last 30 days). */
export interface SourceAccuracy {
  source: ScheduleSource;
  wipes: number;
  /** wipes that happened within an hour of the prediction */
  withinHour: number;
  medianErrorMinutes: number;
}

export interface ServerDetail extends ServerSummary {
  description: string | null;
  /** Facepunch-rendered map (A2S "map_image_url") */
  mapImage: string | null;
  url: string | null;
  tags: string[];
  build: string | null;
  fps: number | null;
  entities: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  wipes: WipeRecord[];
  /** wipe schedule the network publishes itself, when we have a checked one */
  official: OfficialInfo | null;
}

export interface OfficialInfo {
  /** the network's own words, verbatim (English or Russian, as published) */
  quote: string;
  sourceUrl: string;
  /** YYYY-MM-DD when we last checked it against observed wipes */
  checkedAt: string;
}

export interface MetricPoint {
  t: string; // ISO bucket start
  players: number;
  queue: number;
}

export type MetricRange = "24h" | "7d" | "30d";

export interface Stats {
  servers: number;
  online: number;
  players: number;
  wipedLast24h: number;
  upcoming24h: number;
  nextForceWipe: string;
  demo: boolean;
}

export interface ServerQuery {
  q?: string;
  region?: Region[];
  rate?: Rate[];
  group?: GroupLimit[];
  type?: ServerType[];
  cadence?: Cadence[];
  minPlayers?: number;
  sort?: "players" | "wiped" | "next" | "name" | "hot";
  limit?: number;
  offset?: number;
  ids?: number[];
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export type LiveEvent = { type: "wipe"; server: ServerSummary } | { type: "tick"; stats: Stats };
