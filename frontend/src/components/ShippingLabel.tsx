"use client";

import { NO_AGENT, NotesText, isPickup, parseNotes, visibleParts } from "@/lib/notes";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Booking } from "@/types";
import { fmtNumber, fmtDate } from "@/lib/format";
import { detectArea, isWesternArea } from "@/lib/areas";

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
        // Quiet zone on both sides — phone cameras need it to find the barcode.
        margin: 8,
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

/** Name printed on the label when a vendor wants its brand shown differently. */
const LABEL_VENDOR_NAMES: Record<string, string> = {
  INSPIRED: "Inspired.market",
};
const labelVendorName = (name: string) => LABEL_VENDOR_NAMES[name.trim().toUpperCase()] ?? name;

function dubaiDate(iso: string) {
  return fmtDate(iso);
}

// Cut text to N lines with an ellipsis (so a long address can't push the footer off a small label).
function clamp(lines: number): React.CSSProperties {
  return { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" };
}

export type LabelItem = { qty: string; name: string; price?: string; header?: boolean };

/**
 * "4 × Noir (AED 160), 1 × Akoya" or "Akoya, Noir" → rows (qty 1 when not given).
 * A combo / bundle line ("Signature Combo Offer (ALF+TSUKI)") followed by its
 * unpriced contents becomes a header row — it is not a separate piece to pack.
 * Website orders mark such lines with a leading "▸ ".
 */
export function splitItems(items?: string | null): LabelItem[] {
  if (!items) return [];
  const parts = /\d+\s*[×x]\s/i.test(items) ? items.split(/,\s*(?=(?:▸\s*)?\d+\s*[×x]\s)/i) : items.split(/\s*,\s*/);
  const rows: LabelItem[] = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const marked = p.startsWith("▸");
      const raw = p.replace(/^▸\s*/, "");
      const priced = raw.match(/^(.*?)\s*\((?:AED|aed)\s*([\d.,]+)\)\s*$/);
      const body = priced ? priced[1] : raw;
      const price = priced ? priced[2] : undefined;
      const m = body.match(/^(\d+)\s*[×x]\s*(.+)$/i);
      // "2 items", "2 pcs", "3 shoes", "2pc bag" — a leading count without "×" is still the quantity.
      const n = !m ? body.match(/^(\d{1,3})(?:\s*(?:pcs?|pces?|pieces?|items?|nos?|qty)\b\.?|\s+)\s*(.*)$/i) : null;
      const row: LabelItem = m
        ? { qty: m[1], name: m[2].trim(), price }
        : n && Number(n[1]) > 0 && (n[2].trim() || /\D/.test(body))
          ? { qty: n[1], name: n[2].trim() || "Item", price }
          : { qty: "1", name: body, price };
      if (marked) row.header = true;
      return row;
    });
  // Older entries without the marker: a priced combo line whose next rows are unpriced parts of it.
  for (let i = 0; i < rows.length - 1; i++) {
    const r = rows[i];
    if (r.header || !r.price) continue;
    const next = rows[i + 1];
    if (next.price) continue;
    const lname = r.name.toLowerCase();
    const listsNext = lname.includes(next.name.toLowerCase().trim());
    if (listsNext || /combo|bundle|\bset\b|\bpack\b|\boffer\b|\+/i.test(r.name)) r.header = true;
  }
  return rows;
}

type Fit = { font: number; row: number; cols: 1 | 2; clampName: number; tick: number; qtyW: number; priceW: number };
const fitLevel = (font: number, row: number, cols: 1 | 2, clampName = 1): Fit => ({
  font, row, cols, clampName, tick: font <= 7 ? 7 : font <= 10 ? 9 : font <= 12 ? 10 : 12, qtyW: font <= 7 ? 14 : font <= 9 ? 18 : font <= 12 ? 24 : 30,
  priceW: font <= 9 ? 34 : font <= 12 ? 44 : 54,
});
/** Item-list sizes from biggest to smallest. The label steps down until every item fits. */
const FIT_LEVELS: Record<LabelSize, Fit[]> = {
  "4x6": [fitLevel(15, 24, 1, 2), fitLevel(13, 20, 1), fitLevel(11, 16, 1), fitLevel(10, 15, 2), fitLevel(8.5, 12, 2), fitLevel(7.5, 10, 2), fitLevel(6.5, 8, 2), fitLevel(6, 7, 2)],
  a4: [fitLevel(15, 24, 1, 2), fitLevel(13, 20, 1), fitLevel(11, 16, 1), fitLevel(10, 15, 2), fitLevel(8.5, 12, 2), fitLevel(7.5, 10, 2), fitLevel(6.5, 8, 2), fitLevel(6, 7, 2)],
  "4x4": [fitLevel(11, 17, 1), fitLevel(9.5, 14, 1), fitLevel(8.5, 12, 2), fitLevel(7.5, 10, 2), fitLevel(6.5, 8, 2), fitLevel(6, 7, 2)],
  "80mm": [fitLevel(12, 20, 1, 0)],
};

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
      ? { width: "100mm", height: "150mm", padding: "4mm", overflow: "hidden" }
      : sq
        ? { width: "100mm", height: "100mm", padding: "3mm", overflow: "hidden" }
        : size === "80mm"
          ? { width: "80mm", padding: "3mm" }
          : { width: "92mm", height: "132mm", padding: "4mm", border: "1px dashed #999", overflow: "hidden" };

  const items = splitItems(booking.items);
  const pieces = items.filter((i) => !i.header);
  const totalQty = pieces.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const hasPrices = items.some((i) => i.price);
  const levels = FIT_LEVELS[size];
  // Remember the fitted size per item list, so a new order starts again at the biggest size.
  const fitKey = `${size}|${booking.items ?? ""}|${booking.address ?? ""}|${booking.notes ?? ""}`;
  const [fitState, setFitState] = useState({ key: fitKey, level: 0 });
  const level = fitState.key === fitKey ? fitState.level : 0;
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // After each render, if the items don't fit on the label, step down one size.
  useLayoutEffect(() => {
    const root = rootRef.current, box = boxRef.current;
    if (!root || !box || size === "80mm" || level >= levels.length - 1) return;
    const over = root.scrollHeight > root.clientHeight + 1 || box.scrollHeight > box.clientHeight + 1;
    if (over) setFitState({ key: fitKey, level: level + 1 });
  });
  const fit = levels[Math.min(level, levels.length - 1)];
  const parsed = parseNotes(booking.notes);
  const pickup = isPickup(booking);
  const noteParts = visibleParts(parsed.parts, pickup);
  const hasOrderNo = Boolean(booking.vendorRef && booking.vendorRef !== String(booking.cnNo));
  const billNo = (booking as { billNo?: string | null }).billNo || parsed.bill;

  return (
    <div ref={rootRef} className="label-page flex flex-col bg-white text-black" style={{ ...box, boxSizing: "border-box", fontFamily: "Arial, Helvetica, sans-serif" }}>
      {/* Header: brand + date on the left, compact barcode + CN on the right */}
      <div className="flex items-start justify-between gap-2 border-b-2 border-black pb-1.5">
        <div className="min-w-0 flex-1">
          <div style={{ fontSize: narrow ? 13 : 15, fontWeight: 800, letterSpacing: 0.3, lineHeight: 1.1 }}>FUTURE COURIER</div>
          <div style={{ fontSize: 9 }}>{dubaiDate(booking.createdAt)}</div>
          <div className="mt-0.5" style={{ fontSize: 9 }}>
            From: <b style={{ textTransform: "none" }}>{labelVendorName(booking.vendor.name)}</b>
          </div>
          {(hasOrderNo || billNo || parsed.agent) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1" style={{ fontSize: 10, fontWeight: 800, lineHeight: 1.1 }}>
              {hasOrderNo ? <span>ORDER #{booking.vendorRef}</span> : billNo ? <span>BILL: {billNo}</span> : null}
              {parsed.agent && (
                <span style={{ border: "1.5px solid #000", padding: "0 3px", fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>
                  AGENT: {parsed.agent === NO_AGENT ? <span style={{ display: "inline-block", width: 28 }} /> : parsed.agent}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0 text-center" style={{ width: sq ? "48%" : "52%" }}>
          <Barcode value={String(booking.cnNo)} height={sq ? 26 : 34} />
          <div className="mt-1" style={{ fontSize: sq ? 13 : 15, fontWeight: 800, letterSpacing: 1.5, fontFamily: "'Courier New', monospace", lineHeight: 1.1 }}>
            CN {booking.cnNo}
          </div>
        </div>
      </div>

      {/* Pickup delivery — we collect the parcel from the customer. */}
      {pickup && (
        <div className="mt-1.5 border-black text-center" style={{ borderWidth: 3, borderStyle: "solid", padding: "2px 4px", fontSize: sq ? 17 : 20, fontWeight: 900, letterSpacing: 1.5, lineHeight: 1.1 }}>
          ⇄ PICKUP DELIVERY
        </div>
      )}

      {/* COD */}
      <div className="mt-1.5 flex items-center justify-between border-2 border-black px-2 py-1">
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
          {pickup
            ? booking.codAmount > 0
              ? "Collect delivery charge"
              : booking.codAmount < 0
                ? "Refund — give customer"
                : "Pickup payment"
            : booking.codAmount > 0
              ? "Cash on delivery"
              : booking.codAmount < 0
                ? "Refund — give customer"
                : "Payment"}
        </span>
        <span style={{ fontSize: sq ? 18 : 22, fontWeight: 800 }}>
          {booking.codAmount > 0 ? `AED ${fmtNumber(booking.codAmount)}` : booking.codAmount < 0 ? `AED ${fmtNumber(-booking.codAmount)}` : pickup ? "NO PAYMENT" : "PREPAID"}
        </span>
      </div>

      {/* Customer */}
      <div className="mt-1.5" style={{ fontSize: sq ? 11 : 12, lineHeight: 1.3 }}>
        <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 1 }}>Deliver to</div>
        <div style={{ fontSize: sq ? 13 : 15, fontWeight: 700 }} className={sq ? "truncate" : ""}>
          {booking.customerName} · {booking.customerPhone}
        </div>
        <div style={sq || items.length > 14 ? clamp(2) : clamp(3)}>{booking.address}</div>
        <div style={{ fontWeight: 800, textTransform: "uppercase", fontSize: sq ? 12 : 14 }}>
          📍 {(() => {
            // Never print "OTHER AREA" / "NO ADDRESS" on a label: show only the emirate then.
            const a = detectArea(booking.address, booking.emirate);
            const em = booking.emirate && booking.emirate !== "OTHER" && booking.emirate !== "EXCHANGED" ? booking.emirate : "";
            if (a === "OTHER AREA" || a === "NO ADDRESS") return em || "—";
            // Western Region parcels must not go with the Abu Dhabi city driver.
            if (isWesternArea(a)) return `${a} · WESTERN REGION`;
            return em ? `${a} · ${em}` : a;
          })()}
        </div>
      </div>

      {/* Items — boxed table that fills the label down to the footer.
          Every item is printed: rows shrink, then split into 2 columns for big orders. */}
      {items.length > 0 && (
        <div ref={boxRef} className={`mt-1.5 flex flex-col border-2 border-black ${size === "80mm" ? "" : "min-h-0 flex-1 overflow-hidden"}`} style={{ fontSize: fit.font }}>
          {/* No background colour here: many browsers drop backgrounds when printing, which left this row blank. */}
          <div className="flex border-b-2 border-black bg-white px-1.5 py-0.5 text-black" style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase" }}>
            <span style={{ width: fit.tick + 6 }}>✓</span>
            <span style={{ width: fit.qtyW }}>{fit.qtyW < 24 ? "#" : "Qty"}</span>
            <span className="flex-1">
              Item
              <span className="ml-2 opacity-90">
                · {pieces.length} item{pieces.length === 1 ? "" : "s"}
                {totalQty && totalQty !== pieces.length ? ` · ${totalQty} pcs` : ""}
              </span>
            </span>
            {hasPrices && fit.cols === 1 && <span className="text-right" style={{ width: fit.priceW }}>AED</span>}
          </div>
          <div className={fit.cols === 2 ? "grid grid-cols-2" : "flex flex-col"}>
            {items.map((it, i) =>
              it.header ? (
                <div
                  key={i}
                  className="flex items-center border-b border-dashed border-black px-1.5"
                  style={{ minHeight: fit.row * 0.8, lineHeight: 1.1, borderRight: fit.cols === 2 && i % 2 === 0 ? "1px solid #000" : undefined, fontSize: "0.8em" }}
                >
                  <span className="min-w-0 flex-1" style={{ fontWeight: 700, fontStyle: "italic", ...(fit.clampName ? clamp(fit.clampName) : {}) }}>
                    🎁 {it.name}
                  </span>
                  {hasPrices && (
                    <span className="shrink-0 pl-1 text-right" style={{ width: fit.cols === 1 ? fit.priceW : undefined, fontWeight: 700, whiteSpace: "nowrap" }}>
                      {it.price ?? ""}
                    </span>
                  )}
                </div>
              ) : (
              <div
                key={i}
                className="flex items-center border-b border-black px-1.5"
                style={{ minHeight: fit.row, lineHeight: 1.1, borderRight: fit.cols === 2 && i % 2 === 0 ? "1px solid #000" : undefined }}
              >
                <span className="flex shrink-0 items-center" style={{ width: fit.tick + 6 }}>
                  <span style={{ display: "inline-block", width: fit.tick, height: fit.tick, border: "1.5px solid #000" }} />
                </span>
                <span className="shrink-0" style={{ width: fit.qtyW, fontWeight: 800 }}>{it.qty}</span>
                <span className="min-w-0 flex-1" style={{ fontWeight: 700, lineHeight: 1.1, ...(fit.clampName ? clamp(fit.clampName) : {}) }}>
                  {it.name}
                </span>
                {hasPrices && (
                  <span className="shrink-0 pl-1 text-right" style={{ width: fit.cols === 1 ? fit.priceW : undefined, fontWeight: 700, fontSize: "0.9em", whiteSpace: "nowrap" }}>
                    {it.price ?? ""}
                  </span>
                )}
              </div>
              )
            )}
          </div>
          {/* empty space stays inside the box */}
          <div className="flex-1" />
        </div>
      )}

      {noteParts.length > 0 && (
        <div className="mt-1 border border-black px-1.5 py-0.5" style={{ fontSize: 10.5, lineHeight: 1.25, ...(sq ? clamp(1) : clamp(2)) }}>
          <b style={{ fontWeight: 800 }}>NOTES: </b>
          <NotesText notes={booking.notes} hideBill hideAgent hidePickup={pickup} />
        </div>
      )}

      <div className={`${size === "80mm" || items.length ? "mt-1" : "mt-auto"} border-t border-black pt-0.5 text-right`} style={{ fontSize: 8 }}>
        The Future Courier Service L.L.C
      </div>
    </div>
  );
}
