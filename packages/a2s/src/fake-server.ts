import dgram from "node:dgram";

/**
 * Minimal Rust-like A2S server for tests and local development.
 * Requires a challenge for every query, like real servers do, and splits
 * RULES replies over `splitSize` bytes.
 */
export interface FakeServerState {
  name: string;
  map: string;
  players: number;
  maxPlayers: number;
  keywords: string;
  gamePort: number;
  rules: Record<string, string>;
  playerList: { name: string; score: number; durationSec: number }[];
}

const cstr = (s: string) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);

export async function startFakeServer(state: FakeServerState, splitSize = 600) {
  const sock = dgram.createSocket("udp4");
  const challenge = Buffer.from([0x11, 0x22, 0x33, 0x44]);

  const reply = (body: Buffer, port: number, addr: string) => {
    const whole = Buffer.concat([Buffer.alloc(4, 0xff), body]);
    if (whole.length <= splitSize) return sock.send(whole, port, addr);
    const chunks: Buffer[] = [];
    for (let i = 0; i < whole.length; i += splitSize) chunks.push(whole.subarray(i, i + splitSize));
    chunks.forEach((c, i) => {
      const h = Buffer.alloc(12);
      h.writeInt32LE(-2, 0);
      h.writeInt32LE(1234, 4);
      h.writeUInt8(chunks.length, 8);
      h.writeUInt8(i, 9);
      h.writeUInt16LE(splitSize, 10);
      // send out of order to exercise reassembly
      setTimeout(() => sock.send(Buffer.concat([h, c]), port, addr), (chunks.length - i) * 2);
    });
  };

  sock.on("message", (msg, r) => {
    const type = msg[4];
    const given = type === 0x54 ? msg.subarray(25, 29) : msg.subarray(5, 9);
    if (!given.equals(challenge)) return reply(Buffer.concat([Buffer.from([0x41]), challenge]), r.port, r.address);

    if (type === 0x54) {
      const u16 = (n: number) => {
        const b = Buffer.alloc(2);
        b.writeUInt16LE(n);
        return b;
      };
      reply(
        Buffer.concat([
          Buffer.from([0x49, 17]),
          cstr(state.name),
          cstr(state.map),
          cstr("rust"),
          cstr("Rust"),
          u16(0),
          Buffer.from([Math.min(state.players, 255), Math.min(state.maxPlayers, 255), 0, 0x64, 0x6c, 0, 1]),
          cstr("2593"),
          Buffer.from([0x80 | 0x20]),
          u16(state.gamePort),
          cstr(state.keywords),
        ]),
        r.port,
        r.address,
      );
    } else if (type === 0x56) {
      const entries = Object.entries(state.rules);
      const n = Buffer.alloc(2);
      n.writeUInt16LE(entries.length);
      reply(Buffer.concat([Buffer.from([0x45]), n, ...entries.flatMap(([k, v]) => [cstr(k), cstr(v)])]), r.port, r.address);
    } else if (type === 0x55) {
      const rows = state.playerList.map((p, i) => {
        const nums = Buffer.alloc(8);
        nums.writeInt32LE(p.score, 0);
        nums.writeFloatLE(p.durationSec, 4);
        return Buffer.concat([Buffer.from([i]), cstr(p.name), nums]);
      });
      reply(Buffer.concat([Buffer.from([0x44, rows.length]), ...rows]), r.port, r.address);
    }
  });

  await new Promise<void>((res) => sock.bind(0, "127.0.0.1", res));
  return {
    port: sock.address().port,
    state,
    close: () => new Promise<void>((res) => sock.close(() => res())),
  };
}
