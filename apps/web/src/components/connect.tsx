"use client";

import { Check, Copy, Play } from "lucide-react";
import { useState } from "react";

export function ConnectButtons({
  addr,
  labels,
  size = "md",
}: {
  addr: string;
  labels: { connect: string; copy: string; copied: string };
  size?: "md" | "lg";
}) {
  const [copied, setCopied] = useState(false);
  const big = size === "lg";

  const copy = async () => {
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
