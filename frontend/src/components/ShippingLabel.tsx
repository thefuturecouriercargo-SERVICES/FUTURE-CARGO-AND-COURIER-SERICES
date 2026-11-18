"use client";

import { NO_AGENT, NotesText, isPickup, parseNotes, visibleParts } from "@/lib/notes";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Booking } from "@/types";
import { fmtNumber, fmtDate } from "@/lib/format";
import { detectArea, isWesternArea, emirateOfAreaName, emirateFromAddress } from "@/lib/areas";
import Icon from "@/components/Icon";

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

/** One line that must never wrap (the PDF snapshot can measure text a hair wider than the screen). */
const oneLine: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "clip", maxWidth: "100%" };

/** Font that steps down for long text so it stays on one line in its box. */
function fitFont(text: string, base: number, roomChars: number, min: number): number {
  const len = text.length;
  return len <= roomChars ? base : Math.max(min, Math.floor(((base * roomChars) / len) * 2) / 2);
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
          : /^\d{1,3}$/.test(body.trim()) && Number(body) > 0
            ? { qty: body.trim(), name: "Item", price } // just a number ("2") is the piece count
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

  // Area worked out by the system — printed small; the vendor's own address is the highlighted line.
  const area = (() => {
    // Never print "OTHER AREA" / "NO ADDRESS" on a label: show only the emirate then.
    const picked = booking.emirate && booking.emirate !== "OTHER" && booking.emirate !== "EXCHANGED" ? booking.emirate : "";
    // Emirate picked wrong (Mussafah saved as Dubai) → the address decides, also for old entries.
    const saved = picked ? emirateFromAddress(picked, booking.address) || picked : "";
    const a = detectArea(booking.address, saved || booking.emirate);
    // The area decides the emirate printed (Al Warqa / Jumeirah are Dubai, whatever was selected).
    const em = emirateOfAreaName(a) ?? saved;
    if (a === "OTHER AREA" || a === "NO ADDRESS") return { text: em || "—", western: false };
    // Western Region parcels must not go with the Abu Dhabi city driver.
    if (isWesternArea(a)) return { text: `${a} · WESTERN REGION · ABU DHABI`, western: true };
    // Area and emirate the same (RAS AL KHAIMAH · RAS AL KHAIMAH) → print it once.
    const same = em && a.replace(/[^A-Z]/gi, "").toUpperCase() === em.replace(/[^A-Z]/gi, "").toUpperCase();
    return { text: em && !same ? `${a} · ${em}` : a, western: false };
  })();
  // No "CASH ON DELIVERY" heading — the amount says it. Only refunds / pickup charges get a heading.
  const payLabel = booking.codAmount < 0 ? "REFUND — GIVE CUSTOMER" : pickup && booking.codAmount > 0 ? "COLLECT DELIVERY CHARGE" : "";
  const payValue = booking.codAmount > 0 ? `AED ${fmtNumber(booking.codAmount)}` : booking.codAmount < 0 ? `AED ${fmtNumber(-booking.codAmount)}` : pickup ? "NO CASH" : "PREPAID";
  const B = "2.5px solid #000"; // thick outer boxes — thin lines fade on thermal printers
  const T = "1.3px solid #000";
  const k: React.CSSProperties = { fontSize: 7, fontWeight: 700, letterSpacing: 0.9, color: "#444", textTransform: "uppercase", lineHeight: 1.2 };
  // Pickup and Western Region go inside the notes box — no separate tags.
  const flags = [pickup && "PICKUP DELIVERY", area.western && "WESTERN REGION"].filter(Boolean) as string[];
  const showNotes = noteParts.length > 0 || flags.length > 0;
  // With no notes, the address gets the extra lines.
  const addrLines = sq ? (showNotes ? 2 : 3) : items.length > 14 ? 2 : showNotes ? 3 : 5;

  return (
    <div ref={rootRef} className="label-page flex flex-col bg-white text-black" style={{ ...box, boxSizing: "border-box", fontFamily: "Arial, Helvetica, sans-serif" }}>
      {/* Header grid: brand + date | barcode — from / bill / agent | payment. Outlines only, no black fills. */}
      <div style={{ border: B, display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ padding: narrow ? "4px 6px" : "6px 8px", borderRight: T, borderBottom: T }}>
          <div style={{ fontSize: narrow ? 12 : 14, fontWeight: 800, letterSpacing: 0.3, lineHeight: 1.1, ...oneLine }}>FUTURE COURIER</div>
          <div style={{ fontSize: 8.5, marginTop: 2, color: "#333", textTransform: "uppercase", ...oneLine }}>{dubaiDate(booking.createdAt)}</div>
        </div>
        <div className="flex flex-col items-center justify-center" style={{ padding: "3px 6px", borderBottom: T }}>
          <Barcode value={String(booking.cnNo)} height={sq ? 22 : 26} />
          <div className="w-full text-center" style={{ fontSize: sq ? 9 : 10, fontWeight: 800, letterSpacing: 1.5, fontFamily: "'Courier New', monospace", lineHeight: 1.1, marginTop: 1, ...oneLine }}>
            CN {booking.cnNo}
          </div>
        </div>
        <div style={{ padding: narrow ? "3px 6px" : "5px 8px", borderRight: T, fontSize: 9, lineHeight: 1.6, textTransform: "uppercase" }}>
          <div className="truncate" style={{ whiteSpace: "nowrap" }}>
            FROM <b>{labelVendorName(booking.vendor.name)}</b>
          </div>
          {(hasOrderNo || billNo || parsed.agent) && (
            <div>
              {hasOrderNo ? <>ORDER <b>#{booking.vendorRef}</b></> : billNo ? <>BILL <b>{billNo}</b></> : null}
              {(hasOrderNo || billNo) && parsed.agent ? " · " : ""}
              {parsed.agent && (
                <>
                  AGENT <b>{parsed.agent === NO_AGENT ? <span style={{ display: "inline-block", width: 26, borderBottom: T }} /> : parsed.agent}</b>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-center justify-center text-center" style={{ padding: "3px 4px" }}>
          {payLabel && <div className="w-full" style={{ ...k, ...oneLine }}>{payLabel}</div>}
          <div className="w-full" style={{ fontSize: fitFont(payValue, sq ? 15 : 18, 10, 11), fontWeight: 800, lineHeight: 1.15, ...oneLine }}>{payValue}</div>
        </div>
      </div>

      {/* Customer box (layout 4): name | phone, then the vendor-given address across the full width,
          system area small underneath. Same 2-column split as the header grid so the lines align. */}
      <div style={{ marginTop: sq ? 5 : 7, marginBottom: sq ? 4 : 6, border: B, display: "grid", gridTemplateColumns: "1fr 1fr", textTransform: "uppercase" }}>
        <div className="flex min-w-0 items-center" style={{ padding: "5px 8px", borderRight: T, borderBottom: T }}>
          <div className="w-full" style={{ fontSize: sq ? 11 : 12, fontWeight: 700, lineHeight: 1.2, ...clamp(2) }}>{booking.customerName}</div>
        </div>
        <div className="flex min-w-0 items-center" style={{ padding: "5px 8px", borderBottom: T }}>
          <div className="w-full" style={{ fontSize: fitFont(booking.customerPhone ?? "", sq ? 11 : 12, 19, 7.5), fontWeight: 700, lineHeight: 1.2, ...oneLine }}>{booking.customerPhone}</div>
        </div>
        <div className="min-w-0" style={{ gridColumn: "1 / 3", padding: "4px 8px" }}>
          {booking.address && (
            <div style={{ fontSize: sq ? 11 : 11.5, fontWeight: 800, lineHeight: 1.3, ...clamp(addrLines) }}>{booking.address}</div>
          )}
          <div style={{ fontSize: 8.5, color: "#555", marginTop: 2, fontWeight: 500, ...oneLine }}>
            <Icon name="pin" className="mr-0.5" />
            {area.text}
          </div>
        </div>
      </div>

      {/* Notes sit above the items, same width. No notes → no box, the space goes to the address and items. */}
      {showNotes && (
        <div className="flex items-center gap-2" style={{ border: B, padding: "4px 8px", marginBottom: 5, fontSize: 10.5, fontWeight: 700, lineHeight: 1.25, textTransform: "uppercase" }}>
          <span style={{ ...k, color: "#000" }}>NOTES</span>
          <span className="min-w-0 flex-1" style={sq ? clamp(1) : clamp(2)}>
            {flags.length > 0 && (
              <span style={{ fontWeight: 800 }}>
                {flags.join(" · ")}
                {noteParts.length > 0 ? " · " : ""}
              </span>
            )}
            {noteParts.length > 0 && <NotesText notes={booking.notes} hideBill hideAgent hidePickup={pickup} />}
          </span>
        </div>
      )}

      {/* Items — boxed table that fills the label down to the footer.
          Every item is printed: rows shrink, then split into 2 columns for big orders. */}
      {items.length > 0 && (
        <div ref={boxRef} className={`flex flex-col border-black ${size === "80mm" ? "" : "min-h-0 flex-1 overflow-hidden"}`} style={{ fontSize: fit.font, border: B }}>
          {/* No background colour here: many browsers drop backgrounds when printing, which left this row blank. */}
          <div className="flex border-b border-black bg-white px-1.5 text-black" style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", paddingTop: 4, paddingBottom: 4 }}>
            <span style={{ width: fit.tick + 6 }}>✓</span>
            <span style={{ width: fit.qtyW }}>{fit.qtyW < 24 ? "#" : "Qty"}</span>
            <span className="flex-1">
              Item
              <span className="ml-2" style={{ fontWeight: 600, color: "#444" }}>
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
                  className="flex items-center px-1.5"
                  style={{ borderBottom: "1.3px dashed #000", minHeight: fit.row * 0.8, lineHeight: 1.1, borderRight: fit.cols === 2 && i % 2 === 0 ? T : undefined, fontSize: "0.8em" }}
                >
                  <span className="min-w-0 flex-1" style={{ fontWeight: 700, fontStyle: "italic", ...(fit.clampName ? clamp(fit.clampName) : {}) }}>
                    {it.name}
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
                className="flex items-center px-1.5"
                style={{ borderBottom: T, minHeight: fit.row, lineHeight: 1.1, borderRight: fit.cols === 2 && i % 2 === 0 ? T : undefined }}
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

      <div className={`${size === "80mm" || items.length ? "mt-1" : "mt-auto"} text-right`} style={{ fontSize: 7, letterSpacing: 0.6, color: "#555" }}>
        THE FUTURE COURIER SERVICE L.L.C
      </div>
    </div>
  );
}
