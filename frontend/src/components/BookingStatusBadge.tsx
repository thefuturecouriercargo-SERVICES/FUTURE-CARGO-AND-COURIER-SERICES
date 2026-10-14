import { Booking } from "@/types";

/** Where a booking is in its life: waiting for us, rejected, or its live order status. */
export default function BookingStatusBadge({ booking }: { booking: Booking }) {
  let text: string;
  let cls: string;
  if (booking.status === "AWAITING_PICKUP") {
    text = "Awaiting pickup";
    cls = "bg-pending-bg text-pending";
  } else if (booking.status === "REJECTED") {
    text = "Rejected";
    cls = "bg-cancelled-bg text-cancelled";
  } else {
    const s = booking.order?.status ?? "PENDING";
    text = s === "PENDING" ? "Picked up" : s === "TRANSFER" ? "Picked up" : s === "DELIVERED" ? "Delivered" : "Cancelled";
    cls =
      s === "DELIVERED"
        ? "bg-delivered-bg text-delivered"
        : s === "CANCELLED"
          ? "bg-cancelled-bg text-cancelled"
          : "bg-transferred-bg text-transferred";
  }
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {text}
    </span>
  );
}
