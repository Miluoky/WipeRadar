"use client";

import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FAV_COOKIE, parseFavorites } from "@/lib/favorites";

/**
 * Favorites live in a cookie so the server can render the Favorites tab (no account needed).
 */
export function FavoriteButton({
  id,
  initial,
  labels,
}: {
  id: number;
  initial: boolean;
  labels: { add: string; remove: string };
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [, startTransition] = useTransition();

  const toggle = () => {
    const current = parseFavorites(document.cookie.match(new RegExp(`(?:^|; )${FAV_COOKIE}=([^;]*)`))?.[1]);
    const next = on ? current.filter((x) => x !== id) : [id, ...current.filter((x) => x !== id)].slice(0, 50);
    document.cookie = `${FAV_COOKIE}=${next.join(".")}; path=/; max-age=31536000; samesite=lax`;
    setOn(!on);
    startTransition(() => router.refresh());
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? labels.remove : labels.add}
      title={on ? labels.remove : labels.add}
      className={`grid size-8 shrink-0 place-items-center transition-colors ${on ? "text-hazard" : "text-smoke hover:text-bone"}`}
    >
      <Star className="size-[18px]" fill={on ? "currentColor" : "none"} aria-hidden />
    </button>
  );
}
