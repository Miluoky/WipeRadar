"use client";

/** Last-resort boundary for an unexpected render error: the layout stays, the page offers a retry. */
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto my-16 max-w-lg space-y-4 rivets p-8 text-center plate" role="alert">
      <div className="mx-auto h-2 w-24 hazard" aria-hidden />
      <p className="text-ash">Something broke on our side. / Что-то сломалось на нашей стороне.</p>
      <button
        type="button"
        onClick={reset}
        className="inline-block bg-rust px-4 py-2 font-display text-sm text-white hover:bg-rust-2"
      >
        Try again / Повторить
      </button>
    </div>
  );
}
