/**
 * Rejects a server-list snapshot that shrank suspiciously against the last accepted one.
 * Steam sometimes answers `servers: []` or a truncated shard; trusting that for three cycles
 * would mark every missing server offline. A real shrink is accepted after `acceptAfter`
 * consecutive rejections, so the guard can't wedge forever.
 */
export class ShrinkGuard {
  private rejects = 0;

  constructor(
    private baseline = 0,
    private ratio = 0.5,
    private acceptAfter = 5,
  ) {}

  /** true → trust the snapshot (and make it the new baseline). */
  accept(count: number): boolean {
    if (count >= this.baseline * this.ratio || ++this.rejects >= this.acceptAfter) {
      this.baseline = count;
      this.rejects = 0;
      return true;
    }
    return false;
  }
}
