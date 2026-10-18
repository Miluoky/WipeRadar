"use client";

import Link from "next/link";
import { Flame, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LiveEvent, ServerSummary } from "@wiperadar/shared";
import type { Dict, Locale } from "@/i18n";

/**
 * SSE subscription to /api/live:
 *  - "wipe" → toast + refresh the server-rendered list (throttled)
 *  - connection status pill in the header
 */
export function LiveFeed({ d, locale, refreshOnWipe }: { d: Dict; locale: Locale; refreshOnWipe: boolean }) {
  const router = useRouter();
  const [online, setOnline] = useState(false);
  const [toasts, setToasts] = useState<ServerSummary[]>([]);
  const lastRefresh = useRef(0);

  useEffect(() => {
    const es = new EventSource("/api/live");
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false); // EventSource reconnects by itself
    es.addEventListener("wipe", (msg) => {
      const e = JSON.parse((msg as MessageEvent).data) as Extract<LiveEvent, { type: "wipe" }>;
      setToasts((t) => [e.server, ...t.filter((x) => x.id !== e.server.id)].slice(0, 3));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== e.server.id)), 9000);
      if (refreshOnWipe && Date.now() - lastRefresh.current > 5000) {
        lastRefresh.current = Date.now();
        router.refresh();
      }
    });
    return () => es.close();
  }, [refreshOnWipe, router]);

  return (
    <>
      <span
        className={`flex items-center gap-1.5 stamp ${online ? "border-toxic-dark text-toxic" : "border-seam text-smoke"}`}
        title={online ? undefined : d.live.reconnecting}
      >
        <span className={`size-1.5 rounded-full ${online ? "live-dot bg-toxic" : "bg-smoke"}`} aria-hidden />
        {d.live.connected}
      </span>

      {/* portal: the sticky header uses backdrop-filter, which would trap position:fixed children */}
      {toasts.length > 0 &&
        createPortal(
          <div
            className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
            aria-live="polite"
          >
            {toasts.map((s) => (
              <div
                key={s.id}
                className="toast-in pointer-events-auto relative overflow-hidden p-3 pl-4 shadow-2xl plate shadow-black/60"
              >
                <span className="absolute inset-y-0 left-0 w-1 hazard" aria-hidden />
                <div className="flex items-start gap-2">
                  <Flame className="mt-0.5 size-4 shrink-0 text-rust-2" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Link href={`/${locale}/server/${s.id}`} className="line-clamp-2 text-sm font-semibold hover:text-rust-2">
                      {s.name}
                    </Link>
                    <p className="mt-0.5 font-display text-[11px] text-hazard">
                      {d.live.wiped} · {s.players}/{s.maxPlayers}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => setToasts((t) => t.filter((x) => x.id !== s.id))}
                    className="text-smoke hover:text-bone"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
