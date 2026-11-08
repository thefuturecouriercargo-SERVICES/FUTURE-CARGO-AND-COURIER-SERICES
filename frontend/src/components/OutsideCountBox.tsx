"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { addDays, todayStr } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";

interface OutsideRow {
  vendor: string;
  total: number;
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Beside the camera on Scan & Assign: Inspired & Escalo parcels going to outside
 * areas, per scan day (orders booked the day before) — so they can be pulled out.
 */
export default function OutsideCountBox({ refreshKey }: { refreshKey: number }) {
  const [day, setDay] = useState(todayStr());
  const [batchDay, setBatchDay] = useState<string | null>(null);
  const [rows, setRows] = useState<OutsideRow[] | null>(null);

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
  const cells: [string, number, boolean][] = [
    ...list.map((r) => [r.vendor.charAt(0) + r.vendor.slice(1).toLowerCase(), r.total, false] as [string, number, boolean]),
    ["Total", total, true],
  ];

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
        {cells.map(([label, n, isTotal]) => (
          <div key={label} className="flex flex-col items-center border-l border-line">
            <span className={`text-[11px] ${isTotal ? "font-bold text-ink" : "text-ink-soft"}`}>{label}</span>
            <span className={`font-mono text-xl font-bold leading-tight ${rows && n ? (isTotal ? "text-cancelled" : "text-navy") : "text-ink-soft"}`}>{rows ? n : "–"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
