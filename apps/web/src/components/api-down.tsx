import { ServerCrash } from "lucide-react";
import type { Dict } from "@/i18n";

/** Shown in place of data when the worker doesn't answer; a plain link reloads the same page. */
export function ApiDown({ t, href }: { t: Dict["down"]; href: string }) {
  return (
    <div className="flex items-start gap-3 p-6 text-sm text-ash" role="alert">
      <ServerCrash className="size-6 shrink-0 text-rust-2" aria-hidden />
      <div className="space-y-2">
        <p className="font-display text-bone">{t.title}</p>
        <p>{t.body}</p>
        <a href={href} className="inline-block px-3 py-1.5 btn-dim text-xs">
          {t.retry}
        </a>
      </div>
    </div>
  );
}
