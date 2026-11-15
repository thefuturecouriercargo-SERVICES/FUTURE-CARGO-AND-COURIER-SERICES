"use client";

import { useRef, useState } from "react";
import { toast } from "@/components/ui/Feedback";
import { fmtDateLong } from "@/lib/format";

interface Props {
  date: string;
  sales: number;
  dlCharge: number;
  delivered: number;
  pending: number;
  transferred: number;
  cancelled: number;
  /** Small square icon-only button (desktop header). */
  iconOnly?: boolean;
  /** Phone dashboard: icon-only WhatsApp button that fills its box. */
  whatsapp?: boolean;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function prettyDate(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? fmtDateLong(d) : d;
}

/**
 * "Share daily report": draws a branded summary card, turns it into a PNG and
 * opens the phone's share sheet (WhatsApp etc.). Where sharing files isn't
 * supported (most desktops) it downloads the image and opens WhatsApp with the
 * text summary instead.
 */
export default function ShareReportButton(p: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const total = p.delivered + p.pending + p.transferred + p.cancelled;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  const text =
    `📦 *Future Courier — ${p.date}*\n\n` +
    `Delivered: ${p.delivered}\nPending: ${p.pending}\nTransfer: ${p.transferred}\nCancelled: ${p.cancelled}\n\n` +
    `Total Sales: ${fmt(p.sales)} AED\nDL Charge: ${fmt(p.dlCharge)} AED`;

  async function share() {
    if (!cardRef.current) return;
    setBusy(true);
    try {
      const { toBlob } = await import("html-to-image");
      const opts = { pixelRatio: 2, cacheBust: true, backgroundColor: "#070B16" };
      let blob: Blob | null = null;
      try {
        blob = await toBlob(cardRef.current, opts);
      } catch {
        // Cross-origin font CSS can block embedding — fall back to system fonts.
        blob = await toBlob(cardRef.current, { ...opts, skipFonts: true });
      }
      if (!blob) throw new Error("Could not draw the report image");
      const file = new File([blob], `future-courier-${p.date}.png`, { type: "image/png" });

      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: `Future Courier — ${p.date}`, text });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      toast("Report image downloaded", "success", "Attach it in WhatsApp — the chat opened with the text summary.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // share sheet closed
      toast("Could not make the report image", "error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const stats = [
    { label: "Delivered", value: p.delivered, color: "#34D399" },
    { label: "Pending", value: p.pending, color: "#F5B544" },
    { label: "Transfer", value: p.transferred, color: "#60A5FA" },
    { label: "Cancelled", value: p.cancelled, color: "#F87171" },
  ];

  return (
    <>
      <button
        onClick={share}
        disabled={busy}
        aria-label="Share report"
        title={busy ? "Preparing…" : "Share report"}
        className={
          p.whatsapp
            ? "flex h-full w-full items-center justify-center rounded-xl border border-[#1f6b52] bg-[#0d2a22] text-[#25D366] hover:bg-[#123a2f] disabled:opacity-60"
            : p.iconOnly
            ? "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-delivered/50 bg-delivered/10 text-delivered hover:bg-delivered/20 disabled:opacity-60"
            : "touch-target inline-flex items-center gap-2 rounded-xl border border-delivered/50 bg-delivered/10 px-4 text-sm font-semibold text-delivered hover:bg-delivered/20 disabled:opacity-60"
        }
      >
        {p.whatsapp ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden className={busy ? "animate-pulse" : ""}>
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.23 8.24c0 4.54-3.7 8.23-8.23 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" />
          </svg>
        )}
        {!p.iconOnly && !p.whatsapp && (busy ? "Preparing…" : "Share report")}
      </button>

      {/* Off-screen card that becomes the shared image. */}
      <div aria-hidden style={{ position: "fixed", left: -10000, top: 0, pointerEvents: "none" }}>
        <div
          ref={cardRef}
          style={{ width: 420, padding: 28, background: "#0A1020", border: "1px solid #3A3220", borderRadius: 24, color: "#E8ECF4", fontFamily: "Inter, Arial, sans-serif", display: "flex", flexDirection: "column", gap: 20 }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#D4AF5A", color: "#0A1020", fontWeight: 800, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>FC</div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>Future Courier</span>
                <span style={{ fontSize: 10, letterSpacing: 2, color: "#D4AF5A", fontWeight: 700 }}>DAILY REPORT</span>
              </div>
            </div>
            <span style={{ fontSize: 13, color: "#9AA5BA" }}>{prettyDate(p.date)}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 12, color: "#9AA5BA" }}>Total sales</span>
            <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>
              {fmt(p.sales)} <span style={{ fontSize: 16, color: "#9AA5BA", fontWeight: 400 }}>AED</span>
            </span>
            <span style={{ fontSize: 13, color: "#C9D1E0" }}>
              DL charge {fmt(p.dlCharge)} AED · {total > 0 ? Math.round(pct(p.delivered)) : 0}% delivered
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {stats.map((s) => (
              <div key={s.label} style={{ background: "#111827", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>{s.label}</span>
                <span style={{ fontSize: 24, fontWeight: 700 }}>{fmt(s.value)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", gap: 2, background: "#18213A" }}>
            {stats.map((s) => (
              <div key={s.label} style={{ width: `${pct(s.value)}%`, background: s.color }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6F7B93" }}>
            <span>The Future Courier Service L.L.C</span>
            <span>{fmt(total)} consignments</span>
          </div>
        </div>
      </div>
    </>
  );
}
