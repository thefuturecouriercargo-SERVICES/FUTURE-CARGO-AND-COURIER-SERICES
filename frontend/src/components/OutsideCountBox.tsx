"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { addDays, todayStr } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";

interface OutsideParcel {
  cnNo: number;
  vendorRef: string | null;
  customerName: string;
  address: string;
  area: string;
  codAmount: number;
  scanned: boolean;
}
interface OutsideRow {
  vendor: string;
  total: number;
  list?: OutsideParcel[];
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Beside the camera on Scan & Assign: Inspired & Escalo parcels already scanned
 * (office or driver) that go to outside areas, per scan day — so they can be pulled out.
 */
export default function OutsideCountBox({ refreshKey }: { refreshKey: number }) {
  const [day, setDay] = useState(todayStr());
  const [batchDay, setBatchDay] = useState<string | null>(null);
  const [rows, setRows] = useState<OutsideRow[] | null>(null);
  // Vendor whose outside list is open (tap a count), or "TOTAL" for both.
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch<{ batchDay: string; outside?: OutsideRow[] }>("/bookings/scan-progress", { query: { date: day } });
    setBatchDay(r.batchDay);
    setRows(r.outside ?? []);
  }, [day]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, refreshKey]);
  useSocketEvent("booking:changed", () => load().catch(() => undefined));

  const list = rows ?? [];
  const total = list.reduce((t, r) => t + r.total, 0);
  const cells: [string, number, boolean, string][] = [
    ...list.map((r) => [r.vendor.charAt(0) + r.vendor.slice(1).toLowerCase(), r.total, false, r.vendor] as [string, number, boolean, string]),
    ["Total", total, true, "TOTAL"],
  ];
  const shown = open ? list.filter((r) => open === "TOTAL" || r.vendor === open) : [];
  const parcels = shown.flatMap((r) => (r.list ?? []).map((p) => ({ ...p, vendor: r.vendor })));

  return (
    <div className="flex min-h-[64px] items-center gap-3 rounded-xl border border-line bg-white px-3 py-2">
      <div className="flex shrink-0 flex-col gap-1">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-brass">Outside areas</span>
        <div className="flex items-center overflow-hidden rounded-md border border-line">
          <button onClick={() => setDay(addDays(day, -1))} className="px-1.5 text-xs text-ink-soft hover:text-ink" aria-label="Previous day">
            ‹
          </button>
          <span className="px-1 font-mono text-[10px] font-semibold">{batchDay ? fmtDay(batchDay) : "…"}</span>
          <button onClick={() => setDay(addDays(day, 1))} disabled={day >= todayStr()} className="px-1.5 text-xs text-ink-soft hover:text-ink disabled:opacity-30" aria-label="Next day">
            ›
          </button>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-3">
        {cells.map(([label, n, isTotal, key]) => (
          <button
            type="button"
            key={label}
            onClick={() => n > 0 && setOpen(key)}
            disabled={!rows || !n}
            className="flex flex-col items-center border-l border-line disabled:cursor-default"
            aria-label={`Show ${label} outside parcels`}
          >
            <span className={`text-[11px] ${isTotal ? "font-bold text-ink" : "text-ink-soft"}`}>{label}</span>
            <span className={`font-mono text-xl font-bold leading-tight ${rows && n ? (isTotal ? "text-cancelled" : "text-navy") : "text-ink-soft"} ${rows && n ? "underline decoration-dotted underline-offset-4" : ""}`}>{rows ? n : "–"}</span>
          </button>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={() => setOpen(null)}>
          <div
            role="dialog"
            aria-label="Outside area parcels"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-white p-4 shadow-2xl"
            style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="mb-1 flex items-center justify-between">
              <div className="font-display text-lg font-semibold uppercase text-navy">
                Outside · {open === "TOTAL" ? "All" : open}
              </div>
              <button type="button" onClick={() => setOpen(null)} className="grid h-9 w-9 place-items-center rounded-full border border-line text-lg" aria-label="Close">
                ×
              </button>
            </div>
            <div className="mb-3 font-mono text-[11px] uppercase text-ink-soft">
              {batchDay ? fmtDay(batchDay) : ""} · {parcels.length} scanned parcels
            </div>
            <div className="-mx-1 flex-1 overflow-y-auto px-1">
              {parcels.map((p) => (
                <div key={`${p.vendor}-${p.cnNo}`} className="mb-1.5 flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-bold text-ink">{p.cnNo}</span>
                      {p.vendorRef && <span className="font-mono text-[10px] text-ink-soft">#{p.vendorRef}</span>}
                      {open === "TOTAL" && <span className="text-[10px] uppercase text-ink-soft">{p.vendor}</span>}
                    </div>
                    <div className="truncate text-[11px] uppercase text-ink-soft">
                      {p.customerName} · {p.address}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-md bg-navy px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">{p.area}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
