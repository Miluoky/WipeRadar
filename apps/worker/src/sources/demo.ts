import { lastForceWipe, type Cadence, type Region } from "@wiperadar/shared";
import type { Db } from "../db";
import type { ListEntry, ServerSource } from "./types";

/**
 * Synthetic but realistic Rust world for local development without a Steam key.
 * Produces the same shape as Steam GetServerList (incl. keywords with born=…),
 * so the real ingest + wipe-detection pipeline runs on it unchanged.
 * All network names are fictional.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoServer {
  ip: string;
  queryPort: number;
  gamePort: number;
  baseName: string;
  region: Region;
  tzOffset: number; // hours
  cadence: Cadence;
  wipeDow: number; // 0..6 UTC
  wipeHourUtc: number;
  maxPlayers: number;
  popularity: number; // 0..1
  modded: boolean;
  worldSize: number;
  bornAt: number;
  seed: number;
  hostnameDate: boolean;
  description: string;
  url: string;
}

const NETWORKS: {
  name: string;
  region: Region;
  tz: number;
  modded: boolean;
  dow: number;
  hour: number;
  variants: string[];
  hostnameDate?: boolean;
  url: string;
}[] = [
  {
    name: "Ironclad",
    region: "eu",
    tz: 1,
    modded: false,
    dow: 4,
    hour: 15,
    url: "https://ironclad.example",
    variants: ["Main | Monthly", "Weekly | Solo/Duo/Trio", "Biweekly | Quad", "Vanilla | Weekly", "Long | Monthly"],
  },
  {
    name: "Scrapheap",
    region: "eu",
    tz: 1,
    modded: true,
    dow: 5,
    hour: 16,
    url: "https://scrapheap.example",
    variants: ["2x | Weekly | No BPs", "5x | Solo/Duo", "10x | Trio | Kits", "3x | Quad | Biweekly", "2x | Monthly"],
  },
  {
    name: "Oxide Valley",
    region: "eu",
    tz: 1,
    modded: true,
    dow: 1,
    hour: 18,
    url: "https://oxidevalley.example",
    variants: ["PVE | Monthly", "Build Server", "2x Barren | Weekly"],
  },
  {
    name: "Bandit Camp",
    region: "na",
    tz: -6,
    modded: false,
    dow: 4,
    hour: 21,
    url: "https://banditcamp.example",
    variants: ["US Main | Monthly", "US Weekly | Solo/Duo", "US Long | Biweekly", "US Vanilla | Trio", "US Softcore | Weekly"],
  },
  {
    name: "Lowgrade",
    region: "na",
    tz: -6,
    modded: true,
    dow: 5,
    hour: 22,
    url: "https://lowgrade.example",
    variants: ["US 2x | Weekly", "US 5x | No Limit", "US 10x | Solo"],
  },
  {
    name: "ГРОМ RUST",
    region: "cis",
    tz: 3,
    modded: true,
    dow: 5,
    hour: 12,
    hostnameDate: true,
    url: "https://vk.com/example_grom",
    variants: ["#1 [X2] МАКС 3", "#2 [X2] СОЛО", "#3 [X3] ДУО", "#4 [X5] БЕЗ ЛИМИТА", "#5 [X2] КЛАССИКА"],
  },
  {
    name: "СИБИРЬ",
    region: "cis",
    tz: 3,
    modded: true,
    dow: 3,
    hour: 11,
    hostnameDate: true,
    url: "https://vk.com/example_siberia",
    variants: ["[RU] x2 ТРИО", "[RU] x3 МАКС 4", "[RU] x10 СОЛО", "[RU] Vanilla ДУО"],
  },
  {
    name: "Пепел",
    region: "cis",
    tz: 3,
    modded: false,
    dow: 4,
    hour: 15,
    url: "https://t.me/example_pepel",
    variants: ["[RU] Vanilla | Monthly", "[RU] Vanilla | Weekly | Trio", "[RU] Softcore | Biweekly"],
  },
  {
    name: "Rad Town",
    region: "asia",
    tz: 8,
    modded: false,
    dow: 4,
    hour: 9,
    url: "https://radtown.example",
    variants: ["[SG] Main | Monthly", "[SG] Weekly | Duo", "[JP] 2x | Weekly"],
  },
  {
    name: "Outback Raid",
    region: "oce",
    tz: 10,
    modded: false,
    dow: 4,
    hour: 7,
    url: "https://outback.example",
    variants: ["[AU] Main | Monthly", "[AU] Weekly | Trio", "[AU] 2x | Biweekly"],
  },
  {
    name: "Favela",
    region: "sa",
    tz: -3,
    modded: true,
    dow: 5,
    hour: 20,
    url: "https://favela.example",
    variants: ["[BR] 2x | Weekly", "[BR] Vanilla | Monthly"],
  },
  {
    name: "КАРЬЕР",
    region: "cis",
    tz: 3,
    modded: true,
    dow: 6,
    hour: 10,
    hostnameDate: true,
    url: "https://vk.com/example_karier",
    variants: ["[X2] СОЛО/ДУО", "[X3] ТРИО", "[X5] КЛАНЫ БЕЗ ЛИМИТА", "[X1000] СОЛО"],
  },
  {
    name: "Нефтевышка",
    region: "cis",
    tz: 5,
    modded: false,
    dow: 4,
    hour: 13,
    url: "https://t.me/example_oilrig",
    variants: ["[KZ] Vanilla | Weekly", "[KZ] Vanilla | Monthly", "[KZ] Trio | Biweekly"],
  },
  {
    name: "Launch Site",
    region: "eu",
    tz: 2,
    modded: true,
    dow: 2,
    hour: 17,
    url: "https://launchsite.example",
    variants: ["3x | Solo/Duo", "3x | Trio", "5x | Clans", "1.5x | Monthly", "2x Barren | Quad"],
  },
  {
    name: "Cargo Run",
    region: "na",
    tz: -8,
    modded: false,
    dow: 4,
    hour: 23,
    url: "https://cargorun.example",
    variants: ["US West Main | Monthly", "US West Weekly | Duo", "US West Biweekly | Trio", "US West Softcore"],
  },
  {
    name: "Corrugated",
    region: "eu",
    tz: 1,
    modded: false,
    dow: 4,
    hour: 18,
    url: "https://corrugated.example",
    variants: [
      "EU Monthly | Main",
      "EU Monthly | Solo Only",
      "EU Weekly | Duo",
      "EU Weekly | Trio",
      "EU Weekly | Quad",
      "EU Biweekly | Main",
    ],
  },
];

function cadenceOf(variant: string, r: () => number): Cadence {
  const v = variant.toLowerCase();
  if (v.includes("monthly") || v.includes("long") || v.includes("main")) return "monthly";
  if (v.includes("biweekly")) return "biweekly";
  if (v.includes("weekly")) return "weekly";
  return r() < 0.6 ? "weekly" : "biweekly";
}

/** Most recent scheduled wipe at or before `now` for this server. */
function scheduledWipeBefore(s: Pick<DemoServer, "cadence" | "wipeDow" | "wipeHourUtc">, now: number): number {
  const force = lastForceWipe(new Date(now)).getTime();
  if (s.cadence === "monthly") return force;
  const d = new Date(now);
  d.setUTCHours(s.wipeHourUtc, 0, 0, 0);
  const back = (d.getUTCDay() - s.wipeDow + 7) % 7;
  let t = d.getTime() - back * DAY;
  if (t > now) t -= 7 * DAY;
  if (s.cadence === "biweekly" && Math.floor(t / (7 * DAY)) % 2 === 1) t -= 7 * DAY;
  // a force wipe after the last scheduled one resets everyone
  return Math.max(t, force);
}

/** Expected online fraction: hype after wipe decays over the cycle, plus a daily wave. */
export function demoLoad(s: DemoServer, at: number, bornAt: number, noise: number): { players: number; queue: number } {
  const cycle = s.cadence === "weekly" ? 7 : s.cadence === "biweekly" ? 14 : 30;
  const age = Math.max(0, (at - bornAt) / DAY);
  const hype = 0.28 + 0.72 * Math.exp((-3 * age) / cycle) + (age < 0.25 ? 0.35 : 0);
  const localHour = (new Date(at).getUTCHours() + new Date(at).getUTCMinutes() / 60 + s.tzOffset + 24) % 24;
  const diurnal = 0.3 + 0.7 * (0.5 - 0.5 * Math.cos((2 * Math.PI * (localHour - 8)) / 24));
  const want = s.maxPlayers * s.popularity * hype * diurnal * (0.92 + 0.16 * noise);
  const players = Math.max(0, Math.min(s.maxPlayers, Math.round(want)));
  const queue = Math.max(0, Math.round(want - s.maxPlayers));
  return { players, queue };
}

export class DemoSource implements ServerSource {
  readonly name = "demo";
  readonly servers: DemoServer[] = [];
  private rand = mulberry32(42);
  private nextSurprise = Date.now() + 45_000;

  constructor() {
    const r = mulberry32(1337);
    let n = 0;
    for (const net of NETWORKS) {
      for (const [idx, variant] of net.variants.entries()) {
        n++;
        const cadence = cadenceOf(variant, r);
        const modded = net.modded || /\dx|x\d|[хx]\d/i.test(variant);
        const s: DemoServer = {
          ip: `${45 + (n % 7)}.${130 + (n % 50)}.${(n * 37) % 250}.${(n * 13) % 250}`,
          queryPort: 28017 + (n % 3) * 100,
          gamePort: 28015 + (n % 3) * 100,
          baseName: composeName(net.name, net.region, variant),
          region: net.region,
          tzOffset: net.tz,
          cadence,
          wipeDow: (net.dow + (idx % 3 === 2 ? 1 : 0)) % 7,
          wipeHourUtc: net.hour,
          maxPlayers: [100, 150, 200, 250, 300, 400, 500][Math.floor(r() * 7)],
          popularity: 0.25 + r() * 0.8,
          modded,
          worldSize: [3000, 3500, 3750, 4000, 4250, 4500][Math.floor(r() * 6)],
          bornAt: 0,
          seed: Math.floor(r() * 2_147_483_647),
          hostnameDate: !!net.hostnameDate,
          description: `${net.name} — ${variant}.\\nWipe schedule: ${cadence}.\\nDiscord / VK: ${net.url}`,
          url: net.url,
        };
        s.bornAt = scheduledWipeBefore(s, Date.now());
        this.servers.push(s);
      }
    }
  }

  async fetchList(): Promise<ListEntry[]> {
    const now = Date.now();
    for (const s of this.servers) {
      const scheduled = scheduledWipeBefore(s, now);
      if (scheduled > s.bornAt) this.wipe(s, scheduled);
    }
    // keep the live feed lively: an unscheduled wipe every ~1–3 minutes
    if (now >= this.nextSurprise) {
      const pool = this.servers.filter((s) => now - s.bornAt > 2 * DAY);
      const s = pool[Math.floor(this.rand() * pool.length)];
      if (s) this.wipe(s, now - Math.floor(this.rand() * 20_000));
      this.nextSurprise = now + 60_000 + this.rand() * 120_000;
    }
    return this.servers.map((s) => {
      const { players, queue } = demoLoad(s, now, s.bornAt, this.rand());
      return {
        ip: s.ip,
        queryPort: s.queryPort,
        gamePort: s.gamePort,
        name: this.hostname(s),
        map: "Procedural Map",
        players: Math.min(players, 255),
        maxPlayers: Math.min(s.maxPlayers, 255),
        keywords: [
          `mp${s.maxPlayers}`,
          `cp${players}`,
          `qp${queue}`,
          `born${Math.floor(s.bornAt / 1000)}`,
          "gmrust",
          s.cadence,
          s.region === "cis" ? "eu" : s.region === "asia" ? "ea" : s.region === "oce" ? "oc" : s.region,
          ...(s.modded ? ["oxide", "modded"] : []),
          "v2593",
        ].join(","),
      };
    });
  }

  async fetchRules(ip: string, queryPort: number) {
    const s = this.servers.find((x) => x.ip === ip && x.queryPort === queryPort);
    if (!s) throw new Error("unknown demo server");
    return {
      "world.seed": String(s.seed),
      "world.size": String(s.worldSize),
      ent_cnt: String(Math.round(20_000 + ((Date.now() - s.bornAt) / DAY) * 40_000)),
      fps_avg: String(Math.round(40 + this.rand() * 60)),
      url: s.url,
      description_0: s.description,
      build: "2593",
    };
  }

  private wipe(s: DemoServer, at: number) {
    s.bornAt = at;
    s.seed = Math.floor(this.rand() * 2_147_483_647);
  }

  private hostname(s: DemoServer) {
    if (!s.hostnameDate) return s.baseName;
    const d = new Date(s.bornAt + 3 * HOUR); // MSK date of the wipe
    return `${s.baseName} | ВАЙП ${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  /** Backfill 30 days of wipes and online history on an empty database. */
  async seedHistory(db: Db, idByAddr: Map<string, number>) {
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM wipes WHERE detected_by = 'demo'`);
    if (rows[0].n > 0) return;
    console.log("[demo] seeding 30 days of history…");
    const now = Date.now();
    const r = mulberry32(7);

    const wipeSid: number[] = [];
    const wipeAt: string[] = [];
    const wipeKind: string[] = [];
    const wipeSeed: number[] = [];
    for (const s of this.servers) {
      const id = idByAddr.get(`${s.ip}:${s.queryPort}`);
      if (!id) continue;
      const wipes: number[] = [];
      for (let t = s.bornAt - 1; t > now - 95 * DAY;) {
        const w = scheduledWipeBefore(s, t);
        wipes.push(w);
        t = w - 1;
      }
      for (const w of wipes) {
        wipeSid.push(id);
        wipeAt.push(new Date(w).toISOString());
        wipeKind.push(w === lastForceWipe(new Date(w + 1000)).getTime() ? "force" : "map");
        wipeSeed.push(Math.floor(r() * 2_147_483_647));
      }

      const sid: number[] = [];
      const ts: string[] = [];
      const pl: number[] = [];
      const qu: number[] = [];
      const bornAtTime = (t: number) => [s.bornAt, ...wipes].find((w) => w <= t) ?? t;
      const push = (t: number) => {
        const { players, queue } = demoLoad(s, t, bornAtTime(t), r());
        sid.push(id);
        ts.push(new Date(t).toISOString());
        pl.push(players);
        qu.push(queue);
      };
      const step5 = 5 * 60_000;
      const start24 = Math.floor((now - DAY) / step5) * step5;
      for (let t = Math.floor((now - 30 * DAY) / (30 * 60_000)) * 30 * 60_000; t < start24; t += 30 * 60_000) push(t);
      for (let t = start24; t < now; t += step5) push(t);
      await db.query(
        `INSERT INTO metrics (server_id, ts, players, queue)
         SELECT * FROM unnest($1::int[], $2::timestamptz[], $3::smallint[], $4::smallint[])
         ON CONFLICT DO NOTHING`,
        [sid, ts, pl, qu],
      );
    }
    await db.query(
      `INSERT INTO wipes (server_id, wiped_at, kind, seed, map, detected_by)
       SELECT sid, at, kind, seed, 'Procedural Map', 'demo'
       FROM unnest($1::int[], $2::timestamptz[], $3::text[], $4::bigint[]) AS t(sid, at, kind, seed)
       ON CONFLICT DO NOTHING`,
      [wipeSid, wipeAt, wipeKind, wipeSeed],
    );
    // mark a few servers as promoted so the UI shows the ad slot
    await db.query(`UPDATE servers SET promoted = true WHERE id IN (SELECT id FROM servers ORDER BY id LIMIT 2)`);
    console.log(`[demo] seeded ${wipeSid.length} wipes`);
  }
}

function composeName(network: string, region: Region, variant: string) {
  const tag = variant.match(/^\[[^\]]+\]\s*/)?.[0];
  if (tag) return `${tag.trim()} ${network} ${variant.slice(tag.length)}`;
  if (/^(EU|US)\b/.test(variant) || region === "cis") return `${network} ${variant}`;
  return `${region === "eu" ? "[EU] " : region === "na" ? "[NA] " : ""}${network} ${variant}`;
}
