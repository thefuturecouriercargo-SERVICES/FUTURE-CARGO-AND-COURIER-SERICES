"use client";

import { useRef, useState } from "react";
import { toast } from "@/components/ui/Feedback";

interface Props {
  date: string;
  sales: number;
  dlCharge: number;
  delivered: number;
  pending: number;
  transferred: number;
  cancelled: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function prettyDate(d: string) {
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
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
        className="touch-target inline-flex items-center gap-2 rounded-xl border border-delivered/50 bg-delivered/10 px-4 text-sm font-semibold text-delivered hover:bg-delivered/20 disabled:opacity-60"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" />
        </svg>
        {busy ? "Preparing…" : "Share report"}
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
