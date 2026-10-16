"use client";

import { useEffect, useRef, useState } from "react";
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

  const gridRef = useRef<HTMLDivElement>(null);
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);

  /** Build one PDF with every label (one per page, or 4 per A4 sheet) and download it. */
  async function downloadPdf() {
    const els = Array.from(gridRef.current?.querySelectorAll<HTMLElement>(".label-page") ?? []);
    if (!els.length) return;
    setPdfProgress(`0 / ${els.length}`);
    try {
      const [{ jsPDF }, { toPng }] = await Promise.all([import("jspdf"), import("html-to-image")]);
      const pxToMm = (px: number) => (px * 25.4) / 96;
      let doc: InstanceType<typeof jsPDF> | null = null;
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        const img = await toPng(el, { pixelRatio: 3, backgroundColor: "#ffffff", skipFonts: true, cacheBust: false });
        const w = pxToMm(el.offsetWidth);
        const h = pxToMm(el.offsetHeight);
        if (size === "a4") {
          const slot = i % 4;
          if (!doc) doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
          else if (slot === 0) doc.addPage("a4", "portrait");
          doc.addImage(img, "PNG", 8 + (slot % 2) * (w + 4), 8 + Math.floor(slot / 2) * (h + 4), w, h, undefined, "FAST");
        } else {
          const fmt: [number, number] = size === "4x6" ? [100, 150] : size === "4x4" ? [100, 100] : [80, h];
          const orient = fmt[0] > fmt[1] ? "landscape" : "portrait";
          if (!doc) doc = new jsPDF({ unit: "mm", format: fmt, orientation: orient });
          else doc.addPage(fmt, orient);
          doc.addImage(img, "PNG", 0, 0, fmt[0], fmt[1], undefined, "FAST");
        }
        setPdfProgress(`${i + 1} / ${els.length}`);
      }
      const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Dubai" }).slice(0, 16).replace(/[: ]/g, "-");
      doc?.save(`labels-${stamp}-${els.length}.pdf`);
      onPrinted?.(bookings.map((b) => b.id));
    } catch (err) {
      alert(`Could not make the PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPdfProgress(null);
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
          onClick={downloadPdf}
          disabled={bookings.length === 0 || pdfProgress !== null}
          className="ml-auto rounded border border-navy bg-white px-4 py-2 font-mono text-xs uppercase tracking-wide text-navy hover:bg-paper-2 disabled:opacity-60"
        >
          {pdfProgress ? `Making PDF… ${pdfProgress}` : `⬇ Download PDF (${bookings.length})`}
        </button>
        <button
          onClick={print}
          disabled={bookings.length === 0}
          className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-50"
        >
          🖨 Print
        </button>
      </div>

      <div
        ref={gridRef}
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
