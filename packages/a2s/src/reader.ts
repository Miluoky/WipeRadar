/** Little-endian cursor over a UDP payload. Throws RangeError on truncation. */
export class Reader {
  constructor(
    private buf: Buffer,
    private pos = 0,
  ) {}

  remaining() {
    return this.buf.length - this.pos;
  }
  u8() {
    return this.buf.readUInt8(this.pos++);
  }
  u16() {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  i32() {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  f32() {
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }
  u64() {
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return v;
  }
  cstring() {
    const end = this.buf.indexOf(0, this.pos);
    if (end < 0) throw new RangeError("unterminated string");
    const s = this.buf.toString("utf8", this.pos, end);
    this.pos = end + 1;
    return s;
  }
}
