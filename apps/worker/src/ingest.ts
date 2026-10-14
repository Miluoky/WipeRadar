import {
  detectRegion,
  detectType,
  groupFromTeamSize,
  nextForceWipe,
  lastForceWipe,
  parseGroupLimit,
  parseHostnameWipeDate,
  parseRate,
  parseRustKeywords,
  searchKey,
  type WipeKind,
} from "@wiperadar/shared";
import { countryOf, regionFromSteamCode } from "./geo";
import type { ListEntry } from "./sources/types";

/** Pure: list entry → normalized server row. */
export function deriveRow(e: ListEntry, now: Date) {
  const kw = parseRustKeywords(e.keywords);
  const country = countryOf(e.ip);
  const rate = parseRate(e.name) ?? (kw.styleTags.includes("vanilla") ? "x1" : null);
  // A2S player/max fields are single bytes; keywords carry real values for big servers
  const players = kw.players ?? e.players;
  const maxPlayers = kw.maxPlayers ?? e.maxPlayers;
  const queue = kw.queue ?? 0;
  const hostnameDate = parseHostnameWipeDate(e.name, now);
  return {
    ip: e.ip,
    queryPort: e.queryPort,
    gamePort: e.gamePort,
    name: e.name.trim().slice(0, 200),
    searchKey: searchKey(e.name).slice(0, 200),
    map: e.map || null,
    players,
    maxPlayers,
    queue,
    region: detectRegion(e.name, kw, country) ?? regionFromSteamCode(e.steamRegion),
    country,
    rate,
    // the ts<n> tag is the server's real team limit; the name is a fallback
    groupLimit: groupFromTeamSize(kw.teamSize) ?? parseGroupLimit(e.name),
    type: detectType(e.name, kw, rate),
    cadence: kw.cadence,
    tags: [...kw.styleTags, ...(kw.modded ? ["modded"] : [])],
    build: kw.protocol ? String(kw.protocol) : null,
    bornAt: kw.bornAt,
    hostnameWipeDate: hostnameDate ? hostnameDate.toISOString().slice(0, 10) : null,
    // impossible numbers → likely faked online
    suspicious: players > maxPlayers + 10 && queue === 0,
  };
}

export type DerivedRow = ReturnType<typeof deriveRow>;

const MIN_WIPE_GAP = 10 * 60_000;

/**
 * Wipe = save file is newer than the one we saw before.
 * Restarts keep `born`; restoring from backup moves it back (ignored).
 */
export function detectWipe(prevBorn: Date | null, nextBorn: Date | null): "initial" | "wipe" | null {
  if (!nextBorn) return null;
  if (!prevBorn) return "initial";
  return nextBorn.getTime() - prevBorn.getTime() > MIN_WIPE_GAP ? "wipe" : null;
}

export function wipeKind(at: Date): WipeKind {
  const near = [lastForceWipe(at), nextForceWipe(at)];
  return near.some((f) => Math.abs(f.getTime() - at.getTime()) < 6 * 3_600_000) ? "force" : "map";
}
