/** Shimmering placeholder blocks shown while data loads (see .skeleton in globals.css). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** Generic page/section placeholder: a few cards and table-style rows. */
export function PageSkeleton({ rows = 5, cards = 0 }: { rows?: number; cards?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      {cards > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-white p-4">
              <Skeleton className="mb-3 h-2.5 w-3/5" />
              <Skeleton className="mb-3 h-7 w-4/5" />
              <Skeleton className="h-2 w-2/5" />
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3.5 rounded-2xl border border-line bg-white p-5">
        <Skeleton className="mb-2 h-3.5 w-1/4" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3.5">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className={`h-3 ${["w-1/3", "w-1/4", "w-2/5", "w-1/3", "w-1/5"][i % 5]}`} />
            <div className="flex-1" />
            <Skeleton className="hidden h-3 w-16 sm:block" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Dashboard-shaped placeholder: KPI row, Live Flow and the two-column cards. */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard" className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-white p-4 md:p-5">
            <Skeleton className="mb-3 h-2.5 w-3/5" />
            <Skeleton className="mb-3 h-7 w-4/5" />
            <Skeleton className="h-2 w-1/2" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-line bg-white p-6">
        <Skeleton className="mb-6 h-4 w-28" />
        <div className="mb-6 flex items-center justify-between">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-14 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-3 w-full rounded-full" />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_1fr]">
        <PageSkeleton rows={6} />
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-line bg-white p-6">
          <Skeleton className="h-48 w-48 rounded-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Placeholder rows inside an existing <tbody>. */
export function TableRowsSkeleton({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} aria-hidden>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c}>
              <Skeleton className={`h-3 ${c === 0 ? "w-4" : c % 3 === 0 ? "w-20" : "w-12"}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
