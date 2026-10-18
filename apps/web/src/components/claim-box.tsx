"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";
import type { ClaimStatus } from "@wiperadar/shared";
import type { Dict } from "@/i18n";

const key = (id: number) => `wr:claim:${id}`;

/**
 * Owner verification: contact → code → owner puts the code into the server description or name →
 * the worker sees it on its next RULES read. The code is kept in localStorage so a reload doesn't lose it.
 */
export function ClaimBox({
  serverId,
  verified,
  intro,
  t,
}: {
  serverId: number;
  verified: boolean;
  intro: string;
  t: Dict["claim"];
}) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState("");
  const [claim, setClaim] = useState<ClaimStatus | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error" | "pending">("idle");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key(serverId)) ?? "null") as ClaimStatus | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring client-only state after hydration
      if (saved && Date.parse(saved.expiresAt) > Date.now()) setClaim(saved);
    } catch {
      // storage unavailable — start over
    }
  }, [serverId]);

  const remember = (c: ClaimStatus) => {
    setClaim(c);
    try {
      if (c.verified) localStorage.removeItem(key(serverId));
      else localStorage.setItem(key(serverId), JSON.stringify(c));
    } catch {
      // not fatal
    }
  };

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    try {
      const res = await fetch(`/api/servers/${serverId}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact }),
      });
      if (!res.ok) throw new Error(String(res.status));
      remember(await res.json());
      setState("idle");
    } catch {
      setState("error");
    }
  };

  const check = async () => {
    if (!claim) return;
    setState("busy");
    try {
      const res = await fetch(`/api/claims/${claim.code}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const c = (await res.json()) as ClaimStatus;
      remember(c);
      setState(c.verified ? "idle" : "pending");
    } catch {
      setState("error");
    }
  };

  if (verified || claim?.verified) {
    return (
      <p className="flex items-center gap-2 text-toxic">
        <ShieldCheck className="size-5" aria-hidden /> {t.verified}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ShieldCheck className="size-5 text-toxic" aria-hidden />
      <p>{intro}</p>
      {claim ? (
        <>
          <p>{t.step}</p>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(claim.code).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
            className="flex w-full items-center justify-between gap-2 bg-ink-2 px-3 py-2 font-mono text-base text-bone ring-1 ring-seam select-all"
          >
            {claim.code}
            {copied ? <Check className="size-4 text-toxic" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          </button>
          <button type="button" onClick={check} disabled={state === "busy"} className="w-full px-3 py-2 btn-dim text-sm">
            {t.check}
          </button>
          {state === "pending" && <p className="text-xs text-hazard">{t.pending}</p>}
        </>
      ) : open ? (
        <form onSubmit={request} className="space-y-2">
          <input
            required
            maxLength={120}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={t.contact}
            aria-label={t.contact}
            className="w-full bg-ink-2 px-3 py-2 text-sm text-bone ring-1 ring-seam placeholder:text-smoke"
          />
          <button type="submit" disabled={state === "busy"} className="w-full px-3 py-2 btn-dim text-sm">
            {t.submit}
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="w-full px-3 py-2 btn-dim text-sm">
          {t.start}
        </button>
      )}
      {state === "error" && <p className="text-xs text-rust-2">{t.error}</p>}
    </div>
  );
}
