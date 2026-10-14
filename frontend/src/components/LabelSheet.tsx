"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Booking } from "@/types";
import ShippingLabel, { LABEL_SIZES, LabelSize, pageCss } from "@/components/ShippingLabel";

const SIZE_KEY = "labelSize";

/**
 * Print preview + toolbar for one or more shipping labels. Each label prints on
 * its own page (label / receipt sizes) or 4 to a sheet (A4).
 */
export default function LabelSheet({
  bookings,
  backHref,
  onPrinted,
}: {
  bookings: Booking[];
  backHref: string;
  onPrinted?: (ids: string[]) => void;
}) {
  const [size, setSize] = useState<LabelSize>("4x6");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIZE_KEY) as LabelSize | null;
      if (saved && LABEL_SIZES.some((s) => s.value === saved)) setSize(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  function changeSize(next: LabelSize) {
    setSize(next);
    try {
      localStorage.setItem(SIZE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  function print() {
    window.print();
    onPrinted?.(bookings.map((b) => b.id));
  }

  const isA4 = size === "a4";

  return (
    <div className="min-h-screen bg-paper-2 print:bg-white">
      <style>{`
        ${pageCss(size)}
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .label-page { box-shadow: none !important; }
          ${isA4 ? ".label-grid { gap: 4mm !important; } .label-wrap { break-inside: avoid; }" : ".label-wrap { break-after: page; } .label-wrap:last-child { break-after: auto; }"}
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-3">
        <Link href={backHref} className="rounded border border-line px-3 py-1.5 text-sm hover:border-brass">
          ← Back
        </Link>
        <span className="text-sm text-ink-soft">
          {bookings.length} label{bookings.length === 1 ? "" : "s"}
        </span>
        <select value={size} onChange={(e) => changeSize(e.target.value as LabelSize)} className="rounded border border-line px-2.5 py-1.5 text-sm">
          {LABEL_SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          onClick={print}
          disabled={bookings.length === 0}
          className="ml-auto rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-50"
        >
          🖨 Print
        </button>
      </div>

      <div
        className={`label-grid mx-auto flex flex-wrap justify-center gap-4 p-4 print:p-0 ${isA4 ? "max-w-[200mm] print:justify-start" : "flex-col items-center print:gap-0"}`}
      >
        {bookings.map((b) => (
          <div key={b.id} className="label-wrap shadow-md print:shadow-none">
            <ShippingLabel booking={b} size={size} />
          </div>
        ))}
      </div>
    </div>
  );
}
