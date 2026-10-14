/** Instant skeleton while the server list streams in. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-3">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton h-12 w-full max-w-3xl" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-16" />
          ))}
        </div>
      </div>
      <div className="skeleton h-10" />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-24" style={{ opacity: 1 - i * 0.13 }} />
        ))}
      </div>
    </div>
  );
}
