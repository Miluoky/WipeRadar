"use client";

import { Check, Link2 } from "lucide-react";
import { useState } from "react";

/** Copies the page URL — Discord/Telegram unfurl it with the OG image. */
export function ShareButton({ labels }: { labels: { share: string; shared: string } }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          // clipboard unavailable — nothing to do, the URL bar has it
        }
      }}
      className="flex items-center gap-1.5 px-4 py-3 btn-dim text-base"
    >
      {done ? <Check className="size-4 text-toxic" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
      <span className="hidden sm:inline">{done ? labels.shared : labels.share}</span>
    </button>
  );
}
