import dgram from "node:dgram";
import { Reader } from "./reader";

/**
 * Valve Server Query (A2S) client.
 * https://developer.valvesoftware.com/wiki/Server_queries
 *
 * Handles:
 *  - S2C_CHALLENGE (0x41) for INFO/RULES/PLAYER (mandatory since late 2020)
 *  - split packets (0xFFFFFFFE header, Source layout) — Rust RULES often exceed one MTU
 */

const SIMPLE = 0xffffffff | 0; // -1
const SPLIT = 0xfffffffe | 0; // -2

const S2C_CHALLENGE = 0x41;
const A2S_INFO = 0x54;
const A2S_INFO_REPLY = 0x49;
const A2S_RULES = 0x56;
const A2S_RULES_REPLY = 0x45;
const A2S_PLAYER = 0x55;
const A2S_PLAYER_REPLY = 0x44;

export interface A2SInfo {
  protocol: number;
  name: string;
  map: string;
  folder: string;
  game: string;
  appId: number;
  players: number;
  maxPlayers: number;
  bots: number;
  serverType: string;
  environment: string;
  visibility: boolean;
  vac: boolean;
  version: string;
  gamePort: number | null;
  steamId: bigint | null;
  keywords: string | null;
  gameId: bigint | null;
  pingMs: number;
}

export interface A2SPlayer {
  name: string;
  score: number;
  durationSec: number;
}

export interface QueryOptions {
  timeoutMs?: number;
  /** retries on timeout (UDP loss), not on protocol errors */
  retries?: number;
}

export class A2SError extends Error {
  constructor(
    message: string,
    readonly code: "timeout" | "protocol" | "network",
  ) {
    super(message);
  }
}

function header(type: number, payload?: Buffer) {
  const h = Buffer.alloc(5);
  h.writeInt32LE(SIMPLE, 0);
  h.writeUInt8(type, 4);
  return payload ? Buffer.concat([h, payload]) : h;
}

const INFO_PAYLOAD = Buffer.from("Source Engine Query\0", "latin1");

/**
 * Sends `build(challenge)` and resolves with the reassembled reply body
 * (starting with the reply type byte), following one challenge round-trip.
 */
function exchange(
  host: string,
  port: number,
  build: (challenge: Buffer | null) => Buffer,
  expect: number,
  timeoutMs: number,
): Promise<{ body: Buffer; pingMs: number }> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    const parts = new Map<number, Buffer>();
    let total = 0;
    let challenged = false;
    let sentAt = performance.now();

    const done = (err: Error | null, body?: Buffer) => {
      clearTimeout(timer);
      sock.removeAllListeners();
      sock.close();
      if (err) reject(err);
      else resolve({ body: body!, pingMs: Math.round(performance.now() - sentAt) });
    };
    const timer = setTimeout(() => done(new A2SError(`timeout ${host}:${port}`, "timeout")), timeoutMs);

    const send = (buf: Buffer) => {
      sentAt = performance.now();
      sock.send(buf, port, host, (err) => err && done(new A2SError(err.message, "network")));
    };

    const handleBody = (body: Buffer) => {
      const type = body[0];
      if (type === S2C_CHALLENGE && !challenged && body.length >= 5) {
        challenged = true;
        send(build(body.subarray(1, 5)));
        return;
      }
      if (type === expect) return done(null, body);
      done(new A2SError(`unexpected reply 0x${type?.toString(16)} from ${host}:${port}`, "protocol"));
    };

    sock.on("error", (err) => done(new A2SError(err.message, "network")));
    sock.on("message", (msg, rinfo) => {
      if (rinfo.address !== host && !host.match(/[a-z]/i)) return; // ignore spoofed sources
      if (msg.length < 5) return;
      const kind = msg.readInt32LE(0);
      if (kind === SIMPLE) return handleBody(msg.subarray(4));
      if (kind !== SPLIT || msg.length < 12) return;

      // Source split: id(4) total(1) number(1) size(2) [payload]
      const id = msg.readInt32LE(4);
      if (id < 0) return done(new A2SError("compressed split packets are not supported", "protocol"));
      total = msg.readUInt8(8);
      const number = msg.readUInt8(9);
      parts.set(number, msg.subarray(12));
      if (parts.size === total) {
        const whole = Buffer.concat([...Array(total).keys()].map((i) => parts.get(i)!));
        parts.clear();
        if (whole.readInt32LE(0) !== SIMPLE) return done(new A2SError("bad split payload", "protocol"));
        handleBody(whole.subarray(4));
      }
    });

    send(build(null));
  });
}

async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof A2SError) || e.code !== "timeout" || attempt >= retries) throw e;
    }
  }
}

export async function queryInfo(host: string, port: number, opts: QueryOptions = {}): Promise<A2SInfo> {
  const { timeoutMs = 2000, retries = 1 } = opts;
  const { body, pingMs } = await withRetry(
    () =>
      exchange(
        host,
        port,
        (ch) => header(A2S_INFO, ch ? Buffer.concat([INFO_PAYLOAD, ch]) : INFO_PAYLOAD),
        A2S_INFO_REPLY,
        timeoutMs,
      ),
    retries,
  );
  const r = new Reader(body, 1);
  const info: A2SInfo = {
    protocol: r.u8(),
    name: r.cstring(),
    map: r.cstring(),
    folder: r.cstring(),
    game: r.cstring(),
    appId: r.u16(),
    players: r.u8(),
    maxPlayers: r.u8(),
    bots: r.u8(),
    serverType: String.fromCharCode(r.u8()),
    environment: String.fromCharCode(r.u8()),
    visibility: r.u8() === 1,
    vac: r.u8() === 1,
    version: r.cstring(),
    gamePort: null,
    steamId: null,
    keywords: null,
    gameId: null,
    pingMs,
  };
  if (r.remaining() > 0) {
    const edf = r.u8();
    if (edf & 0x80) info.gamePort = r.u16();
    if (edf & 0x10) info.steamId = r.u64();
    if (edf & 0x40) {
      r.u16();
      r.cstring();
    }
    if (edf & 0x20) info.keywords = r.cstring();
    if (edf & 0x01) info.gameId = r.u64();
  }
  return info;
}

export async function queryRules(host: string, port: number, opts: QueryOptions = {}): Promise<Record<string, string>> {
  const { timeoutMs = 2500, retries = 1 } = opts;
  const noChallenge = Buffer.alloc(4, 0xff);
  const { body } = await withRetry(
    () => exchange(host, port, (ch) => header(A2S_RULES, ch ?? noChallenge), A2S_RULES_REPLY, timeoutMs),
    retries,
  );
  const r = new Reader(body, 1);
  const count = r.u16();
  const rules: Record<string, string> = {};
  for (let i = 0; i < count && r.remaining() > 0; i++) {
    const k = r.cstring();
    rules[k] = r.cstring();
  }
  return rules;
}

export async function queryPlayers(host: string, port: number, opts: QueryOptions = {}): Promise<A2SPlayer[]> {
  const { timeoutMs = 2500, retries = 1 } = opts;
  const noChallenge = Buffer.alloc(4, 0xff);
  const { body } = await withRetry(
    () => exchange(host, port, (ch) => header(A2S_PLAYER, ch ?? noChallenge), A2S_PLAYER_REPLY, timeoutMs),
    retries,
  );
  const r = new Reader(body, 1);
  const count = r.u8();
  const players: A2SPlayer[] = [];
  for (let i = 0; i < count && r.remaining() > 0; i++) {
    r.u8(); // index
    players.push({ name: r.cstring(), score: r.i32(), durationSec: r.f32() });
  }
  return players;
}

/** Rust splits long descriptions into description_0..N rules. */
export function joinDescription(rules: Record<string, string>): string | null {
  const keys = Object.keys(rules)
    .filter((k) => /^description_\d+$/.test(k))
    .sort((a, b) => Number(a.slice(12)) - Number(b.slice(12)));
  if (keys.length === 0) return rules.description ?? null;
  return keys
    .map((k) => rules[k])
    .join("")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}
