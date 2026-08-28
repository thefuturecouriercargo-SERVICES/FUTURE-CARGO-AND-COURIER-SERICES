import { OrderStatus } from "@/types";
import { isAgingPending } from "@/lib/format";

export default function StatusStamp({ status, date }: { status: OrderStatus; date?: string }) {
  const aging = date ? isAgingPending(status, date) : false;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`stamp ${status.toLowerCase()}`}>{status}</span>
      {aging && (
        <span
          className="rounded bg-cancelled px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-white"
          title="Pending more than 2 days"
        >
          Aging
        </span>
      )}
    </span>
  );
}
