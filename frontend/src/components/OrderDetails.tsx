import { OrderBookingDetails } from "@/types";
import { fmtNumber } from "@/lib/format";

/** Digits only, with a UAE 05x number turned into 9715x for WhatsApp links. */
function waNumber(phone: string) {
  const d = phone.replace(/[^0-9]/g, "");
  if (d.startsWith("00")) return d.slice(2);
  if (d.startsWith("0")) return "971" + d.slice(1);
  return d;
}

/**
 * Customer details for an order that came from a vendor booking, with tap-to-call
 * and WhatsApp. Shows a short note instead when the order was typed in directly.
 */
export default function OrderDetails({
  booking,
  cnNo,
  vendorName,
  total,
  compact,
}: {
  booking?: OrderBookingDetails | null;
  cnNo: number;
  vendorName?: string;
  total?: number;
  compact?: boolean;
}) {
  if (!booking) {
    return (
      <p className="text-sm text-ink-soft">
        No customer details — this consignment was entered directly, not through the vendor portal.
      </p>
    );
  }

  const tel = booking.customerPhone.replace(/[^0-9+]/g, "");
  const waText = encodeURIComponent(
    `Hello ${booking.customerName}, this is Future Courier about your ${vendorName ? `${vendorName} ` : ""}order (CN ${cnNo}).`
  );
  const row = "flex gap-2";
  const label = "w-20 shrink-0 font-mono text-[10px] uppercase leading-5 text-ink-soft";

  return (
    <div className={`space-y-1.5 text-sm ${compact ? "" : "max-w-xl"}`}>
      <div className={row}>
        <span className={label}>Customer</span>
        <b>{booking.customerName}</b>
      </div>
      <div className={row}>
        <span className={label}>Phone</span>
        <span className="font-mono">{booking.customerPhone}</span>
      </div>
      <div className={row}>
        <span className={label}>Address</span>
        <span className="whitespace-pre-wrap">
          {booking.address}
          {booking.emirate ? `, ${booking.emirate}` : ""}
        </span>
      </div>
      {booking.items && (
        <div className={row}>
          <span className={label}>Items</span>
          <span>{booking.items}</span>
        </div>
      )}
      {booking.notes && (
        <div className={row}>
          <span className={label}>Note</span>
          <span className="font-medium text-pending">{booking.notes}</span>
        </div>
      )}
      <div className={row}>
        <span className={label}>COD</span>
        <span className="font-mono">
          {(total ?? booking.codAmount) === 0 ? (
            <b className="text-cancelled">PREPAID — do not collect cash</b>
          ) : (
            <>AED {fmtNumber(total ?? booking.codAmount)}</>
          )}
          {total !== undefined && total !== booking.codAmount && (
            <span className="ml-2 text-xs text-ink-soft">(vendor entered {fmtNumber(booking.codAmount)})</span>
          )}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 pt-1.5">
        <a href={`tel:${tel}`} className="rounded bg-navy px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-paper">
          📞 Call
        </a>
        <a
          href={`https://wa.me/${waNumber(booking.customerPhone)}?text=${waText}`}
          target="_blank"
          rel="noreferrer"
          className="rounded bg-delivered px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-white"
        >
          WhatsApp
        </a>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${booking.address}, ${booking.emirate}, UAE`)}`}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-navy bg-white px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-navy"
        >
          📍 Map
        </a>
      </div>
    </div>
  );
}
