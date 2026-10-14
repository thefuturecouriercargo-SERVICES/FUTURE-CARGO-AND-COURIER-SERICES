"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { Booking } from "@/types";
import { fmtNumber } from "@/lib/format";

export type LabelSize = "4x6" | "80mm" | "a4";

export const LABEL_SIZES: { value: LabelSize; label: string }[] = [
  { value: "4x6", label: "Label 4×6 in (100×150 mm)" },
  { value: "80mm", label: "Receipt printer 80 mm" },
  { value: "a4", label: "A4 paper (4 per page)" },
];

/** CSS @page rules for each print size. Injected by LabelSheet. */
export function pageCss(size: LabelSize): string {
  if (size === "4x6") return "@page { size: 100mm 150mm; margin: 0; }";
  if (size === "80mm") return "@page { size: 80mm auto; margin: 0; }";
  return "@page { size: A4; margin: 8mm; }";
}

function Barcode({ value, height }: { value: string; height: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        height,
        width: 2,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      /* invalid value — leave blank */
    }
  }, [value, height]);
  return <svg ref={ref} className="block h-auto w-full" preserveAspectRatio="none" />;
}

function dubaiDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Dubai" });
}

/**
 * One printable shipping label. Black on white only, so it prints cleanly on
 * thermal label/receipt printers as well as office printers.
 */
export default function ShippingLabel({ booking, size }: { booking: Booking; size: LabelSize }) {
  const narrow = size === "80mm";
  const box: React.CSSProperties =
    size === "4x6"
      ? { width: "100mm", height: "150mm", padding: "5mm" }
      : size === "80mm"
        ? { width: "80mm", padding: "3mm 4mm" }
        : { width: "92mm", minHeight: "132mm", padding: "5mm", border: "1px dashed #999" };

  return (
    <div className="label-page flex flex-col bg-white text-black" style={{ ...box, boxSizing: "border-box", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div className="flex items-baseline justify-between border-b-2 border-black pb-1">
        <span style={{ fontSize: narrow ? 14 : 16, fontWeight: 800, letterSpacing: 0.3 }}>FUTURE COURIER</span>
        <span style={{ fontSize: 10 }}>{dubaiDate(booking.createdAt)}</span>
      </div>

      <div className="mt-2">
        <Barcode value={String(booking.cnNo)} height={narrow ? 55 : 70} />
        <div className="mt-1 text-center" style={{ fontSize: narrow ? 20 : 24, fontWeight: 800, letterSpacing: 2, fontFamily: "'Courier New', monospace" }}>
          CN {booking.cnNo}
        </div>
      </div>

      <div className="mt-2 border-y-2 border-black py-1.5 text-center">
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>{booking.codAmount > 0 ? "Cash on delivery" : "Payment"}</div>
        <div style={{ fontSize: narrow ? 24 : 28, fontWeight: 800 }}>
          {booking.codAmount > 0 ? `AED ${fmtNumber(booking.codAmount)}` : "PREPAID"}
        </div>
      </div>

      <div className="mt-2" style={{ fontSize: narrow ? 12 : 13, lineHeight: 1.35 }}>
        <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 1 }}>Deliver to</div>
        <div style={{ fontSize: narrow ? 15 : 16, fontWeight: 700 }}>{booking.customerName}</div>
        <div style={{ fontWeight: 700 }}>{booking.customerPhone}</div>
        <div style={{ whiteSpace: "pre-wrap" }}>{booking.address}</div>
        <div style={{ fontWeight: 700, textTransform: "uppercase" }}>{booking.emirate}</div>
      </div>

      {booking.items && (
        <div className="mt-2" style={{ fontSize: 11, lineHeight: 1.3 }}>
          <span style={{ fontWeight: 700 }}>Items: </span>
          <span style={{ whiteSpace: "pre-wrap" }}>{booking.items}</span>
        </div>
      )}
      {booking.notes && (
        <div className="mt-1" style={{ fontSize: 11, lineHeight: 1.3 }}>
          <span style={{ fontWeight: 700 }}>Note: </span>
          <span style={{ whiteSpace: "pre-wrap" }}>{booking.notes}</span>
        </div>
      )}

      <div className={`${size === "80mm" ? "mt-3" : "mt-auto"} flex justify-between border-t border-black pt-1`} style={{ fontSize: 10 }}>
        <span>
          From: <b>{booking.vendor.name}</b>
        </span>
        <span>The Future Courier Service L.L.C</span>
      </div>
    </div>
  );
}
