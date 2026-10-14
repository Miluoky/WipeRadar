import type { Cadence, Region } from "./types";

/**
 * Parsed form of the `keywords` (a.k.a. `gametype`) field that Rust servers put
 * into A2S_INFO and into Steam's GetServerList response.
 *
 * Real example (Oct 2026 survey of 11.4k servers):
 *   "mp300,cp237,ptrak,jp7,qp0,$r?,v2634,^w,born1791799318,gmrust,cs167781,ts150,^o^z"
 *
 * Server tags are compressed to "^<letter>" (several may be glued: "^o^z").
 * The letter meanings below were inferred from name co-occurrence on live data
 * (e.g. 73% of "^p" servers have PVE in the name, ×5 the base rate). Letters we
 * could not pin down (o, z, y, t, q, x) are kept as raw flags.
 * Re-check with `npm run tags:survey -w @wiperadar/worker` after big Rust updates.
 */
export interface RustKeywords {
  maxPlayers: number | null;
  players: number | null;
  queue: number | null;
  protocol: number | null;
  /** Save creation time = time of the last map wipe. The main wipe signal. */
  bornAt: Date | null;
  gamemode: string | null;
  changeset: number | null;
  /** max team size ("ts3" = trio) */
  teamSize: number | null;
  modded: boolean;
  region: Region | null;
  cadence: Cadence | null;
  styleTags: string[]; // vanilla, hardcore, softcore, pve, ...
  flags: string[];
}

/** Compressed "^x" server tags. */
const CARET_TAGS: Record<string, { cadence?: Cadence; style?: string }> = {
  m: { cadence: "monthly" },
  w: { cadence: "weekly" },
  b: { cadence: "biweekly" },
  v: { style: "vanilla" },
  p: { style: "pve" },
  h: { style: "hardcore" },
  s: { style: "softcore" },
  r: { style: "roleplay" },
  c: { style: "creative" },
  k: { style: "builds" },
  j: { style: "broyale" },
  i: { style: "battlefield" },
  d: { style: "training" },
  e: { style: "minigame" },
};

/** Plain region tags ("EU") and hosting-region tokens ("$ruk1", "$rger", "$rus5"). */
const REGION_TOKENS: Record<string, Region> = {
  eu: "eu",
  europe: "eu",
  uk: "eu",
  fra: "eu",
  ger: "eu",
  de: "eu",
  pol: "eu",
  na: "na",
  us: "na",
  ca: "na",
  america: "na",
  sa: "sa",
  br: "sa",
  wa: "asia", // West Asia
  ea: "asia", // East Asia
  as: "asia",
  ja: "asia",
  tyo: "asia",
  ind: "asia",
  isr: "asia",
  oc: "oce",
  au: "oce",
  aus: "oce",
  af: "af",
  ru: "cis",
  cis: "cis",
};

const CADENCE_TOKENS: Record<string, Cadence> = {
  monthly: "monthly",
  biweekly: "biweekly",
  everytwoweeks: "biweekly",
  weekly: "weekly",
};

const STYLE_TOKENS = new Set([
  "vanilla",
  "hardcore",
  "softcore",
  "pve",
  "roleplay",
  "creative",
  "minigame",
  "training",
  "battlefield",
  "broyale",
  "builds",
]);

const MOD_TOKENS = new Set(["oxide", "carbon", "modded", "umod"]);

const int = (s: string) => {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

export function parseRustKeywords(raw: string | null | undefined): RustKeywords {
  const out: RustKeywords = {
    maxPlayers: null,
    players: null,
    queue: null,
    protocol: null,
    bornAt: null,
    gamemode: null,
    changeset: null,
    teamSize: null,
    modded: false,
    region: null,
    cadence: null,
    styleTags: [],
    flags: [],
  };
  if (!raw) return out;

  const style = (s: string) => {
    if (!out.styleTags.includes(s)) out.styleTags.push(s);
  };

  for (const token of raw.split(",")) {
    const t = token.trim().toLowerCase();
    if (!t) continue;
    let m: RegExpMatchArray | null;

    if (t.startsWith("^")) {
      for (const letter of t.match(/\^(.)/g) ?? []) {
        const tag = CARET_TAGS[letter[1]];
        if (tag?.cadence) out.cadence = tag.cadence;
        else if (tag?.style) style(tag.style);
        else out.flags.push(letter);
      }
    } else if ((m = t.match(/^\$r([a-z]+)\d*\.?$/))) {
      if (REGION_TOKENS[m[1]]) out.region ??= REGION_TOKENS[m[1]];
    } else if (t === "$r?") {
      // hosting region not set
    } else if ((m = t.match(/^mp(\d+)$/))) out.maxPlayers = int(m[1]);
    else if ((m = t.match(/^cp(\d+)$/))) out.players = int(m[1]);
    else if ((m = t.match(/^qp(\d+)$/))) out.queue = int(m[1]);
    else if ((m = t.match(/^ts(\d+)$/))) out.teamSize = int(m[1]);
    else if ((m = t.match(/^v(\d+)$/))) out.protocol = int(m[1]);
    else if ((m = t.match(/^born(\d+)$/))) {
      const sec = int(m[1]);
      // ignore garbage like born0 or far-future values
      if (sec && sec > 1_400_000_000 && sec < Date.now() / 1000 + 86_400) out.bornAt = new Date(sec * 1000);
    } else if ((m = t.match(/^gm(\w+)$/))) out.gamemode = m[1];
    else if ((m = t.match(/^cs(\d+)$/))) out.changeset = int(m[1]);
    else if (MOD_TOKENS.has(t)) out.modded = true;
    else if (t in REGION_TOKENS) out.region = REGION_TOKENS[t];
    else if (t in CADENCE_TOKENS) out.cadence = CADENCE_TOKENS[t];
    else if (STYLE_TOKENS.has(t)) style(t);
    else out.flags.push(t);
  }
  return out;
}
