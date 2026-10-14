"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { Booking } from "@/types";
import { fmtNumber } from "@/lib/format";

export type LabelSize = "4x6" | "4x4" | "80mm" | "a4";

export const LABEL_SIZES: { value: LabelSize; label: string }[] = [
  { value: "4x6", label: "Label 100×150 mm (4×6 in)" },
  { value: "4x4", label: "Label 100×100 mm (4×4 in)" },
  { value: "80mm", label: "Receipt printer 80 mm" },
  { value: "a4", label: "A4 paper (4 per page)" },
];

/** CSS @page rules for each print size. Injected by LabelSheet. */
export function pageCss(size: LabelSize): string {
  if (size === "4x6") return "@page { size: 100mm 150mm; margin: 0; }";
  if (size === "4x4") return "@page { size: 100mm 100mm; margin: 0; }";
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

// Cut text to N lines with an ellipsis (so a long address can't push the footer off a small label).
function clamp(lines: number): React.CSSProperties {
  return { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" };
}

/**
 * One printable shipping label. Black on white only, so it prints cleanly on
 * thermal label/receipt printers as well as office printers.
 */
export default function ShippingLabel({ booking, size }: { booking: Booking; size: LabelSize }) {
  const sq = size === "4x4";
  const narrow = size === "80mm" || sq;
  const box: React.CSSProperties =
    size === "4x6"
      ? { width: "100mm", height: "150mm", padding: "5mm" }
      : size === "4x4"
        ? { width: "100mm", height: "100mm", padding: "3mm 4mm", overflow: "hidden" }
      : size === "80mm"
        ? { width: "80mm", padding: "3mm 4mm" }
        : { width: "92mm", minHeight: "132mm", padding: "5mm", border: "1px dashed #999" };

  return (
    <div className="label-page flex flex-col bg-white text-black" style={{ ...box, boxSizing: "border-box", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div className="flex items-baseline justify-between border-b-2 border-black pb-1">
        <span style={{ fontSize: narrow ? 14 : 16, fontWeight: 800, letterSpacing: 0.3 }}>FUTURE COURIER</span>
        <span style={{ fontSize: 10 }}>{dubaiDate(booking.createdAt)}</span>
      </div>

      {sq ? (
        // 100×100: barcode, then CN and COD side by side to save height.
        <div className="mt-1.5">
          <Barcode value={String(booking.cnNo)} height={34} />
          <div className="mt-1 flex items-center justify-between border-b-2 border-black pb-1">
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: 1, fontFamily: "'Courier New', monospace" }}>CN {booking.cnNo}</span>
            <span style={{ fontSize: 18, fontWeight: 800 }}>{booking.codAmount > 0 ? `COD AED ${fmtNumber(booking.codAmount)}` : "PREPAID"}</span>
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}

      <div className={sq ? "mt-1" : "mt-2"} style={{ fontSize: sq ? 11 : narrow ? 12 : 13, lineHeight: sq ? 1.25 : 1.35 }}>
        {!sq && <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 1 }}>Deliver to</div>}
        <div style={{ fontSize: sq ? 13 : narrow ? 15 : 16, fontWeight: 700 }} className={sq ? "truncate" : ""}>
          {booking.customerName}
          {sq && <span style={{ fontWeight: 700 }}> · {booking.customerPhone}</span>}
        </div>
        {!sq && <div style={{ fontWeight: 700 }}>{booking.customerPhone}</div>}
        <div style={sq ? clamp(3) : { whiteSpace: "pre-wrap" }}>{booking.address}</div>
        <div style={{ fontWeight: 700, textTransform: "uppercase" }}>{booking.emirate}</div>
      </div>

      {booking.items && (
        <div className={sq ? "mt-0.5" : "mt-2"} style={{ fontSize: sq ? 10 : 11, lineHeight: 1.25, ...(sq ? clamp(2) : {}) }}>
          <span style={{ fontWeight: 700 }}>Items: </span>
          <span style={{ whiteSpace: "pre-wrap" }}>{booking.items}</span>
        </div>
      )}
      {booking.notes && (
        <div className={sq ? "mt-0.5" : "mt-1"} style={{ fontSize: sq ? 10 : 11, lineHeight: 1.25, ...(sq ? clamp(1) : {}) }}>
          <span style={{ fontWeight: 700 }}>Note: </span>
          <span style={{ whiteSpace: "pre-wrap" }}>{booking.notes}</span>
        </div>
      )}

      <div className={`${size === "80mm" ? "mt-3" : "mt-auto"} flex justify-between border-t border-black pt-1`} style={{ fontSize: sq ? 9 : 10 }}>
        <span>
          From: <b>{booking.vendor.name}</b>
        </span>
        <span>The Future Courier Service L.L.C</span>
      </div>
    </div>
  );
}
