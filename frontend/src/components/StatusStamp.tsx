import { OrderStatus } from "@/types";
import { agingDays, agingBadgeClass } from "@/lib/format";

export default function StatusStamp({ status, date }: { status: OrderStatus; date?: string }) {
  const days = date ? agingDays(status, date) : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`stamp ${status.toLowerCase()}`}>{status}</span>
      {days !== null && (
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${agingBadgeClass(days)}`}
          title={`Pending ${days} day${days === 1 ? "" : "s"}`}
        >
          {days}d
        </span>
      )}
    </span>
  );
}
