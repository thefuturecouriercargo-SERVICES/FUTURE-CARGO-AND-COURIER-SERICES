/**
 * Prepaid orders (paid online on the vendor's website): nothing to collect.
 * Shown loudly wherever a driver or the office handles the order.
 */
export function isPrepaid(order: { total: number; booking?: { codAmount: number } | null }) {
  return Boolean(order.booking) && order.total === 0;
}

export default function PrepaidBadge({ large }: { large?: boolean }) {
  return large ? (
    <div className="my-2 rounded border-2 border-cancelled bg-cancelled-bg px-3 py-2 text-center font-mono text-sm font-bold uppercase tracking-wide text-cancelled">
      💳 Prepaid — do not collect any cash
    </div>
  ) : (
    <span className="ml-1 rounded bg-cancelled px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-white" title="Paid online — do not collect cash">
      Prepaid · don&apos;t collect
    </span>
  );
}
