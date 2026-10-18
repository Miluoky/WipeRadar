import type { A2SPlayer } from "@wiperadar/a2s";
// Shared fixtures for the worker's integration tests.
import { PGlite, types } from "@electric-sql/pglite";
import type { Db } from "./db";
import { migrate } from "./db/migrations";
import type { ListEntry, ServerSource } from "./sources/types";

export const HOUR = 3_600_000;

/** Fresh in-memory PGlite with all migrations applied. */
export async function memoryDb(): Promise<Db> {
  const lite = await PGlite.create({ parsers: { [types.INT8]: (v: string) => Number(v) } });
  const db: Db = {
    kind: "pglite",
    query: (sql, params) => lite.query(sql, params) as never,
    exec: async (sql) => void (await lite.exec(sql)),
    close: () => lite.close(),
  };
  await migrate(db);
  return db;
}

/** A Steam list row for server #n with the given wipe time. */
export function entry(n: number, bornAt: Date, opts: { players?: number; name?: string; maxPlayers?: number } = {}): ListEntry {
  const players = opts.players ?? 10;
  return {
    ip: `10.0.0.${n}`,
    queryPort: 28017,
    gamePort: 28015,
    name: opts.name ?? `Test server ${n}`,
    map: "Procedural Map",
    players,
    maxPlayers: opts.maxPlayers ?? 100,
    keywords: `mp${opts.maxPlayers ?? 100},cp${players},born${Math.floor(bornAt.getTime() / 1000)},weekly`,
  };
}

/** Scripted source: tests swap `list` and `rules` between cycles. */
export class FakeSource implements ServerSource {
  readonly name = "fake";
  list: ListEntry[] = [];
  rules = new Map<string, Record<string, string> | Error>();
  async fetchList() {
    return this.list;
  }
  players = new Map<string, A2SPlayer[]>();
  async fetchPlayers(ip: string) {
    const p = this.players.get(ip);
    if (!p) throw new Error("timeout");
    return p;
  }
  async fetchRules(ip: string) {
    const r = this.rules.get(ip);
    if (!r || r instanceof Error) throw r ?? new Error("timeout");
    return r;
  }
}
