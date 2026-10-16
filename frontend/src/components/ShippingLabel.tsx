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

/** "4 × Noir, 1 × Akoya" or "Akoya, Noir" → [{qty, name}] (qty 1 when not given). */
export function splitItems(items?: string | null): { qty: string; name: string }[] {
  if (!items) return [];
  const parts = /\d+\s*[×x]\s/i.test(items) ? items.split(/,\s*(?=\d+\s*[×x]\s)/i) : items.split(/\s*,\s*/);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^(\d+)\s*[×x]\s*(.+)$/i);
      return m ? { qty: m[1], name: m[2].trim() } : { qty: "1", name: p };
    });
}

/**
 * One printable shipping label. Black on white only, so it prints cleanly on
 * thermal label/receipt printers as well as office printers.
 *
 * Layout puts what the packers need first: a compact barcode in the corner,
 * then COD, customer, and a boxed item list with a tick box per line.
 */
export default function ShippingLabel({ booking, size }: { booking: Booking; size: LabelSize }) {
  const sq = size === "4x4";
  const narrow = size === "80mm" || sq;
  const box: React.CSSProperties =
    size === "4x6"
      ? { width: "100mm", height: "150mm", padding: "4mm" }
      : sq
        ? { width: "100mm", height: "100mm", padding: "3mm", overflow: "hidden" }
        : size === "80mm"
          ? { width: "80mm", padding: "3mm" }
          : { width: "92mm", minHeight: "132mm", padding: "4mm", border: "1px dashed #999" };

  const items = splitItems(booking.items);
  const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const itemFont = sq ? 11 : narrow ? 12 : 15;

  return (
    <div className="label-page flex flex-col bg-white text-black" style={{ ...box, boxSizing: "border-box", fontFamily: "Arial, Helvetica, sans-serif" }}>
      {/* Header: brand + date on the left, compact barcode + CN on the right */}
      <div className="flex items-start justify-between gap-2 border-b-2 border-black pb-1.5">
        <div className="min-w-0">
          <div style={{ fontSize: narrow ? 13 : 15, fontWeight: 800, letterSpacing: 0.3 }}>FUTURE COURIER</div>
          <div style={{ fontSize: 9 }}>{dubaiDate(booking.createdAt)}</div>
          <div className="mt-0.5" style={{ fontSize: 9 }}>
            From: <b>{booking.vendor.name}</b>
          </div>
        </div>
        <div className="shrink-0 text-center" style={{ width: sq ? "48%" : "52%" }}>
          <Barcode value={String(booking.cnNo)} height={sq ? 26 : 34} />
          <div className="mt-1" style={{ fontSize: sq ? 13 : 15, fontWeight: 800, letterSpacing: 1.5, fontFamily: "'Courier New', monospace", lineHeight: 1.1 }}>
            CN {booking.cnNo}
          </div>
        </div>
      </div>

      {/* COD */}
      <div className="mt-1.5 flex items-center justify-between border-2 border-black px-2 py-1">
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>{booking.codAmount > 0 ? "Cash on delivery" : "Payment"}</span>
        <span style={{ fontSize: sq ? 18 : 22, fontWeight: 800 }}>{booking.codAmount > 0 ? `AED ${fmtNumber(booking.codAmount)}` : "PREPAID"}</span>
      </div>

      {/* Customer */}
      <div className="mt-1.5" style={{ fontSize: sq ? 11 : 12, lineHeight: 1.3 }}>
        <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 1 }}>Deliver to</div>
        <div style={{ fontSize: sq ? 13 : 15, fontWeight: 700 }} className={sq ? "truncate" : ""}>
          {booking.customerName} · {booking.customerPhone}
        </div>
        <div style={sq ? clamp(2) : clamp(3)}>{booking.address}</div>
        <div style={{ fontWeight: 700, textTransform: "uppercase" }}>{booking.emirate}</div>
      </div>

      {/* Items — boxed table, one row per product, tick box for packing */}
      {items.length > 0 && (
        <div className="mt-1.5 border-2 border-black" style={{ fontSize: itemFont }}>
          <div className="flex border-b-2 border-black bg-black px-1.5 py-0.5 text-white" style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>
            <span style={{ width: 18 }}>✓</span>
            <span style={{ width: 30 }}>Qty</span>
            <span className="flex-1">Item</span>
            <span>{items.length} item{items.length === 1 ? "" : "s"}{totalQty && totalQty !== items.length ? ` · ${totalQty} pcs` : ""}</span>
          </div>
          {items.slice(0, sq ? 5 : 9).map((it, i) => (
            <div key={i} className="flex items-center border-b border-black px-1.5 last:border-b-0" style={{ minHeight: sq ? 16 : narrow ? 20 : 26 }}>
              <span style={{ width: 18 }}>
                <span style={{ display: "inline-block", width: sq ? 10 : 12, height: sq ? 10 : 12, border: "1.5px solid #000" }} />
              </span>
              <span style={{ width: 30, fontWeight: 800 }}>{it.qty}</span>
              <span className="flex-1" style={{ fontWeight: 700, lineHeight: 1.2 }}>
                {it.name}
              </span>
            </div>
          ))}
          {items.length > (sq ? 5 : 9) && (
            <div className="px-1.5 py-0.5" style={{ fontSize: 10, fontWeight: 700 }}>
              + {items.length - (sq ? 5 : 9)} more — see order details
            </div>
          )}
        </div>
      )}

      {booking.notes && (
        <div className="mt-1" style={{ fontSize: 10, lineHeight: 1.25, ...(sq ? clamp(1) : clamp(2)) }}>
          <b>Note: </b>
          {booking.notes}
        </div>
      )}

      <div className={`${size === "80mm" ? "mt-2" : "mt-auto"} border-t border-black pt-0.5 text-right`} style={{ fontSize: 8 }}>
        The Future Courier Service L.L.C
      </div>
    </div>
  );
}
