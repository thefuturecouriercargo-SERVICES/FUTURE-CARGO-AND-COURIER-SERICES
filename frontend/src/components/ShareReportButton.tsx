"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/Feedback";
import { fmtDateLong } from "@/lib/format";

export interface ShareDriverRow {
  id: string;
  name: string;
  delivered: number;
  pending: number;
  cancelled: number;
  transferred: number;
  total: number;
}

interface Props {
  date: string;
  delivered: number;
  pending: number;
  transferred: number;
  cancelled: number;
  /** One row per driver (agents excluded). */
  drivers: ShareDriverRow[];
  /** The day's orders — delivery times feed the 1st-place and highlight lines. */
  orders: { employeeId: string; status: string; resolvedAt?: string | null }[];
  /** Consignments handed to each agent that day (count only, no other agent details). */
  agents: { name: string; count: number }[];
  /** Small square icon-only button (desktop header). */
  iconOnly?: boolean;
  /** Phone dashboard: icon-only WhatsApp button that fills its box. */
  whatsapp?: boolean;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function prettyDate(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? fmtDateLong(d) : d;
}

/** Drivers need more than this many deliveries to win an award. */
const MIN_FOR_AWARD = 20;

const timeFmt = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { timeZone: "Asia/Dubai", hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();

function dur(ms: number) {
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}H ${String(m % 60).padStart(2, "0")}M` : `${m}M`;
}

interface Achievements {
  qualified: ShareDriverRow[];
  top?: { name: string; value: number };
  rate?: { name: string; value: number };
  lead?: { name: string; ms: number; share: number };
  first?: { name: string; at: number };
  powerHour?: { name: string; count: number; from: number };
  last?: { name: string; at: number };
  leadChanges: number;
}

function achievements(p: Props): Achievements {
  const byId = new Map(p.drivers.map((d) => [d.id, d]));
  const qualified = p.drivers.filter((d) => d.delivered > MIN_FOR_AWARD);
  const qIds = new Set(qualified.map((d) => d.id));
  const out: Achievements = { qualified, leadChanges: 0 };
  if (!qualified.length) return out;

  const top = [...qualified].sort((a, b) => b.delivered - a.delivered)[0];
  out.top = { name: top.name, value: top.delivered };
  const rateOf = (d: ShareDriverRow) => (d.total > 0 ? (d.delivered / d.total) * 100 : 0);
  const best = [...qualified].sort((a, b) => rateOf(b) - rateOf(a) || b.delivered - a.delivered)[0];
  out.rate = { name: best.name, value: rateOf(best) };

  const events = p.orders
    .filter((o) => o.status === "DELIVERED" && o.resolvedAt && byId.has(o.employeeId))
    .map((o) => ({ id: o.employeeId, t: new Date(o.resolvedAt as string).getTime() }))
    .filter((e) => !Number.isNaN(e.t))
    .sort((a, b) => a.t - b.t);

  // Race from 10 AM to 10 PM Dubai: who sat in 1st place longest (all drivers race;
  // only drivers past the award line can win it). On a tie the earlier leader keeps 1st.
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.date) && events.length) {
    const winStart = new Date(`${p.date}T10:00:00+04:00`).getTime();
    const winEnd = Math.min(new Date(`${p.date}T22:00:00+04:00`).getTime(), Date.now());
    const counts = new Map<string, number>();
    const held = new Map<string, number>();
    let leader: string | null = null;
    let cursor = winStart;
    const credit = (until: number) => {
      const a = Math.max(cursor, winStart);
      const b = Math.min(until, winEnd);
      if (leader && b > a) held.set(leader, (held.get(leader) ?? 0) + (b - a));
      cursor = Math.max(cursor, until);
    };
    for (const e of events) {
      credit(e.t);
      const c = (counts.get(e.id) ?? 0) + 1;
      counts.set(e.id, c);
      if (!leader || c > (counts.get(leader) ?? 0)) {
        if (leader && leader !== e.id && e.t >= winStart && e.t <= winEnd) out.leadChanges += 1;
        leader = e.id;
      }
    }
    credit(winEnd);
    const window = winEnd - winStart;
    const king = [...held.entries()].filter(([id]) => qIds.has(id)).sort((a, b) => b[1] - a[1])[0];
    if (king && window > 0) out.lead = { name: byId.get(king[0])!.name, ms: king[1], share: (king[1] / window) * 100 };
  }

  const qEvents = events.filter((e) => qIds.has(e.id));
  if (qEvents.length) {
    out.first = { name: byId.get(qEvents[0].id)!.name, at: qEvents[0].t };
    const l = qEvents[qEvents.length - 1];
    out.last = { name: byId.get(l.id)!.name, at: l.t };
    // Power hour: most deliveries one driver made inside any 60-minute stretch.
    let bestPh: Achievements["powerHour"];
    for (const d of qualified) {
      const ts = qEvents.filter((e) => e.id === d.id).map((e) => e.t);
      let j = 0;
      for (let i = 0; i < ts.length; i++) {
        while (ts[i] - ts[j] > 3600000) j++;
        const n = i - j + 1;
        if (!bestPh || n > bestPh.count) bestPh = { name: d.name, count: n, from: ts[j] };
      }
    }
    out.powerHour = bestPh;
  }
  return out;
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

  const ach = useMemo(() => achievements(p), [p]);
  const agentTotal = p.agents.reduce((a, x) => a + x.count, 0);
  const tableRows = [...p.drivers].filter((d) => d.total > 0).sort((a, b) => b.delivered - a.delivered || a.name.localeCompare(b.name));

  // Shared with the employee WhatsApp group: no sales or delivery-charge figures.
  // Caption sent with the image: just the date — the image carries the rest.
  const text = prettyDate(p.date).toUpperCase();

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
        await nav.share({ files: [file], title: text, text });
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
          style={{ width: 460, padding: 26, background: "#0A1020", border: "1px solid #3A3220", borderRadius: 24, color: "#E8ECF4", fontFamily: "Inter, Arial, sans-serif", lineHeight: 1.3, display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#D4AF5A", color: "#0A1020", fontWeight: 800, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>FC</div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ whiteSpace: "nowrap", lineHeight: 1.2, fontSize: 17, fontWeight: 700 }}>FUTURE COURIER</span>
                <span style={{ whiteSpace: "nowrap", lineHeight: 1.2, fontSize: 10, letterSpacing: 2, color: "#D4AF5A", fontWeight: 700, marginTop: 3 }}>DAILY REPORT</span>
              </div>
            </div>
            <span style={{ whiteSpace: "nowrap", lineHeight: 1.2, fontSize: 12, color: "#9AA5BA" }}>{prettyDate(p.date).toUpperCase()}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[{ label: "TOTAL", value: total, color: "#E8ECF4" }, ...stats.filter((s) => s.label !== "Transfer" || s.value > 0)].slice(0, 4).map((s) => (
              <div key={s.label} style={{ background: "#111827", borderRadius: 12, padding: "10px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 10, color: s.color, fontWeight: 700, letterSpacing: 1 }}>{s.label.toUpperCase()}</span>
                <span style={{ fontSize: 22, fontWeight: 700 }}>{fmt(s.value)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", gap: 2, background: "#18213A" }}>
              {stats.map((s) => (
                <div key={s.label} style={{ width: `${pct(s.value)}%`, background: s.color }} />
              ))}
            </div>
            <span style={{ fontSize: 11, color: "#9AA5BA", letterSpacing: 1 }}>{Math.round(pct(p.delivered))}% DELIVERED</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 11, letterSpacing: 2, color: "#D4AF5A", fontWeight: 700 }}>TODAY&apos;S CHAMPIONS · ABOVE {MIN_FOR_AWARD} DELIVERIES</span>
            {ach.qualified.length === 0 ? (
              <div style={{ background: "#111827", borderRadius: 12, padding: 12, fontSize: 12, color: "#9AA5BA" }}>NO DRIVER CROSSED {MIN_FOR_AWARD} DELIVERIES YET</div>
            ) : (
              [
                ach.top && { icon: "🏆", title: "MOST DELIVERIES", name: ach.top.name, value: `${ach.top.value}`, color: "#D4AF5A" },
                ach.rate && { icon: "🎯", title: "HIGHEST SUCCESS RATE", name: ach.rate.name, value: `${Math.round(ach.rate.value)}%`, color: "#34D399" },
                ach.lead && { icon: "🥇", title: "LONGEST IN 1ST PLACE · 10 AM–10 PM", name: ach.lead.name, value: dur(ach.lead.ms), color: "#60A5FA" },
              ]
                .filter(Boolean)
                .map((c) => {
                  const x = c as { icon: string; title: string; name: string; value: string; color: string };
                  return (
                    <div key={x.title} style={{ display: "flex", alignItems: "center", gap: 12, background: "#111827", borderRadius: 12, padding: "10px 12px", borderLeft: `3px solid ${x.color}` }}>
                      <span style={{ fontSize: 22 }}>{x.icon}</span>
                      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                        <span style={{ fontSize: 10, letterSpacing: 1, color: "#9AA5BA", fontWeight: 600 }}>{x.title}</span>
                        <span style={{ fontSize: 15, fontWeight: 700 }}>{x.name.toUpperCase()}</span>
                      </div>
                      <span style={{ whiteSpace: "nowrap", lineHeight: 1.2, flexShrink: 0, fontSize: 18, fontWeight: 700, color: x.color }}>{x.value}</span>
                    </div>
                  );
                })
            )}
          </div>

          {(ach.first || ach.powerHour || ach.last || ach.leadChanges > 0) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#111827", borderRadius: 12, padding: "10px 12px", fontSize: 12, color: "#C9D1E0" }}>
              <span style={{ fontSize: 11, letterSpacing: 2, color: "#D4AF5A", fontWeight: 700 }}>HIGHLIGHTS</span>
              {ach.first && <span>⚡ FIRST DELIVERY · <b>{ach.first.name.toUpperCase()}</b> AT {timeFmt(ach.first.at)}</span>}
              {ach.powerHour && ach.powerHour.count > 1 && <span>🔥 POWER HOUR · <b>{ach.powerHour.name.toUpperCase()}</b> — {ach.powerHour.count} DELIVERIES FROM {timeFmt(ach.powerHour.from)}</span>}
              {ach.leadChanges > 0 && <span>🔄 1ST PLACE CHANGED HANDS {ach.leadChanges} TIME{ach.leadChanges === 1 ? "" : "S"}</span>}
              {ach.last && <span>🌙 LAST DELIVERY · <b>{ach.last.name.toUpperCase()}</b> AT {timeFmt(ach.last.at)}</span>}
              <span>👥 {ach.qualified.length} DRIVER{ach.qualified.length === 1 ? "" : "S"} CROSSED {MIN_FOR_AWARD} DELIVERIES</span>
            </div>
          )}

          {agentTotal > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#111827", borderRadius: 12, padding: "10px 12px", fontSize: 12 }}>
              <span style={{ whiteSpace: "nowrap", lineHeight: 1.2, color: "#9AA5BA" }}>📤 SCANNED TO {p.agents.filter((a) => a.count > 0).map((a) => a.name.toUpperCase()).join(" & ")}</span>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{fmt(agentTotal)}</span>
            </div>
          )}

          {tableRows.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 11, letterSpacing: 2, color: "#D4AF5A", fontWeight: 700 }}>EMPLOYEE PERFORMANCE</span>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#E8ECF4" }}>
                <thead>
                  <tr style={{ color: "#9AA5BA", fontSize: 10, letterSpacing: 1 }}>
                    {["#", "DRIVER", "TOTAL", "DLV", "PND", "CNL", "RATE"].map((h, i) => (
                      <th key={h} style={{ textAlign: i < 2 ? "left" : "right", padding: "6px 4px", borderBottom: "1px solid #24304A", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((d, i) => (
                    <tr key={d.id} style={{ background: i === 0 ? "rgba(212,175,90,0.08)" : "transparent" }}>
                      <td style={{ padding: "6px 4px", color: i === 0 ? "#D4AF5A" : "#6F7B93", fontWeight: 700 }}>{i + 1}</td>
                      <td style={{ padding: "6px 4px", fontWeight: 600 }}>{d.name.toUpperCase()}</td>
                      <td style={{ padding: "6px 4px", textAlign: "right" }}>{d.total}</td>
                      <td style={{ padding: "6px 4px", textAlign: "right", color: "#34D399", fontWeight: 700 }}>{d.delivered}</td>
                      <td style={{ padding: "6px 4px", textAlign: "right", color: "#F5B544" }}>{d.pending}</td>
                      <td style={{ padding: "6px 4px", textAlign: "right", color: "#F87171" }}>{d.cancelled}</td>
                      <td style={{ padding: "6px 4px", textAlign: "right" }}>{d.total > 0 ? Math.round((d.delivered / d.total) * 100) : 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6F7B93" }}>
            <span style={{ whiteSpace: "nowrap", lineHeight: 1.2,  }}>THE FUTURE COURIER SERVICE L.L.C</span>
            <span style={{ whiteSpace: "nowrap", lineHeight: 1.2,  }}>{fmt(total)} CONSIGNMENTS</span>
          </div>
        </div>
      </div>
    </>
  );
}
