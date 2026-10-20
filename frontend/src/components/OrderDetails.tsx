"use client";

import { OrderBookingDetails } from "@/types";
import { useState } from "react";
import { fmtNumber } from "@/lib/format";

/** Small "📋 Copy" — copies all the parcel details as plain text (to paste in WhatsApp etc.). */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older phones / non-https: fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy all details"
      className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${done ? "border-delivered bg-delivered-bg text-delivered" : "border-line bg-white text-ink-soft hover:border-navy"}`}
    >
      {done ? "✓ Copied" : "📋 Copy"}
    </button>
  );
}

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
  waHref,
}: {
  booking?: OrderBookingDetails | null;
  cnNo: number;
  vendorName?: string;
  total?: number;
  compact?: boolean;
  /** Ready WhatsApp link with a pre-filled message (driver page); default is a short greeting. */
  waHref?: string;
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
  const cod = total ?? booking.codAmount;
  const copyText = [
    `CN ${cnNo}${vendorName ? ` — ${vendorName}` : ""}`,
    `Customer: ${booking.customerName}`,
    `Phone: ${booking.customerPhone}`,
    `Address: ${booking.address}${booking.emirate && !booking.address.toLowerCase().includes(booking.emirate.toLowerCase()) ? `, ${booking.emirate}` : ""}`,
    booking.items ? `Items: ${booking.items}` : "",
    booking.notes ? `Note: ${booking.notes}` : "",
    cod === 0 ? "PREPAID — do not collect cash" : `COD: AED ${fmtNumber(cod)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const row = "flex gap-2";
  const label = "w-20 shrink-0 font-mono text-[10px] uppercase leading-5 text-ink-soft";

  return (
    <div className={`space-y-1.5 text-sm ${compact ? "" : "max-w-xl"}`}>
      <div className={`${row} items-start`}>
        <span className={label}>Customer</span>
        <b className="flex-1">{booking.customerName}</b>
        <CopyButton text={copyText} />
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
          📞 Call customer
        </a>
        <a
          href={waHref ?? `https://wa.me/${waNumber(booking.customerPhone)}?text=${waText}`}
          target="_blank"
          rel="noreferrer"
          className="rounded bg-delivered px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-white"
        >
          💬 WhatsApp customer
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
