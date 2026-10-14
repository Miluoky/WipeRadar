import { EventEmitter } from "node:events";
import type { LiveEvent } from "@wiperadar/shared";

/**
 * In-process bus for SSE. With several API instances, swap for Redis pub/sub
 * (same interface: publish/subscribe of LiveEvent JSON on channel "live").
 */
const bus = new EventEmitter();
bus.setMaxListeners(10_000);

export const publish = (e: LiveEvent) => bus.emit("live", e);
export const subscribe = (fn: (e: LiveEvent) => void) => {
  bus.on("live", fn);
  return () => bus.off("live", fn);
};
