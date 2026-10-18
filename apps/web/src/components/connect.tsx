"use client";

import { Check, Copy, Play } from "lucide-react";
import { useEffect, useState } from "react";

/** Counts a page view or a Play/copy click for the owner's stats; fire-and-forget, never blocks the click. */
export function sendHit(serverId: number, kind: "view" | "connect") {
  try {
    navigator.sendBeacon(`/api/servers/${serverId}/hit?kind=${kind}`);
  } catch {
    // beacons unsupported or blocked: stats are best-effort
  }
}

/** One view per page load of a server page. */
export function ViewBeacon({ serverId }: { serverId: number }) {
  useEffect(() => sendHit(serverId, "view"), [serverId]);
  return null;
}

export function ConnectButtons({
  addr,
  serverId,
  labels,
  size = "md",
}: {
  addr: string;
  serverId?: number;
  labels: { connect: string; copy: string; copied: string };
  size?: "md" | "lg";
}) {
  const [copied, setCopied] = useState(false);
  const big = size === "lg";

  const counted = () => {
    if (serverId) sendHit(serverId, "connect");
  };

  const copy = async () => {
    counted();
    try {
      await navigator.clipboard.writeText(`client.connect ${addr}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked (http, permissions) — the address stays visible to copy by hand
    }
  };

  return (
    <div className="flex items-stretch gap-1.5">
      <a
        href={`steam://connect/${addr}`}
        onClick={counted}
        className={`flex items-center gap-1.5 btn-go ${big ? "px-5 py-3 text-base" : "px-3 py-2 text-sm"}`}
      >
        <Play className={big ? "size-4" : "size-3.5"} fill="currentColor" aria-hidden />
        {labels.connect}
      </a>
      <button
        type="button"
        onClick={copy}
        title={`client.connect ${addr}`}
        className={`flex items-center gap-1.5 btn-dim ${big ? "px-4 py-3 text-base" : "px-2.5 py-2 text-sm"}`}
      >
        {copied ? <Check className="size-3.5 text-toxic" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        <span>{copied ? labels.copied : labels.copy}</span>
      </button>
    </div>
  );
}
