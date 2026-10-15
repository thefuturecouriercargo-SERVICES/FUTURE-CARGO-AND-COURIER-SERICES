const CLS: Record<string, string> = {
  DELIVERED: "bg-delivered text-white",
  PENDING: "bg-pending text-white",
  TRANSFER: "bg-transferred text-white",
  CANCELLED: "bg-cancelled text-white",
  AWAITING_PICKUP: "bg-pending-bg text-pending",
  REJECTED: "bg-cancelled-bg text-cancelled",
};
const LABEL: Record<string, string> = {
  DELIVERED: "Delivered",
  PENDING: "Out for delivery",
  TRANSFER: "Out for delivery",
  CANCELLED: "Cancelled",
  AWAITING_PICKUP: "Awaiting pickup",
  REJECTED: "Rejected",
};

/** Status as a vendor should read it. */
export default function VendorOrderStatus({ status }: { status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide ${CLS[status] ?? "bg-paper-2"}`}>
      {LABEL[status] ?? status}
    </span>
  );
}
