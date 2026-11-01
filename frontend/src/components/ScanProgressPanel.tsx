"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, addDays, todayStr } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";

interface Left {
  id: string;
  cnNo: number;
  customerName: string;
  codAmount: number;
  emirate: string;
  printed: boolean;
  addedOn?: string;
}
interface VendorRow {
  vendorId: string;
  vendor: string;
  total: number;
  byDriver: number;
  byOffice: number;
  byHand: number;
  rejected: number;
  left: number;
  leftList: Left[];
  older: Left[];
  addedToday: number;
}
interface Progress {
  scanDay: string;
  batchDay: string;
  vendors: VendorRow[];
  totals: { total: number; byDriver: number; byOffice: number; byHand: number; left: number; older: number; addedToday: number };
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });

/**
 * Right side of Scan & Assign: per vendor, which of yesterday's orders are still
 * not scanned. Vendors add orders during the day and parcels are scanned the next
 * morning (after 12 midnight), so today's check = what vendors added yesterday.
 */
export default function ScanProgressPanel({ refreshKey }: { refreshKey: number }) {
  const [day, setDay] = useState(todayStr());
  const [data, setData] = useState<Progress | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    setData(await apiFetch<Progress>("/bookings/scan-progress", { query: { date: day } }));
  }, [day]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, refreshKey]);
  useSocketEvent("booking:changed", () => load().catch(() => undefined));
  useSocketEvent("order:changed", () => load().catch(() => undefined));

  if (!data) return <div className="border border-line bg-white p-4 text-sm text-ink-soft">Loading scan check…</div>;
  const t = data.totals;
  const done = t.byDriver + t.byOffice + t.byHand;
  const pct = t.total ? Math.round((done / t.total) * 100) : 100;
  const list = data.vendors.filter((v) => showDone || v.left > 0 || v.older.length > 0 || v.total === 0);

  return (
    <div className="border border-line bg-white">
      <div className="border-b border-line p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="font-display text-[17px] font-semibold text-navy">Left to scan</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setDay(addDays(day, -1))} className="rounded border border-line px-2 py-0.5 text-xs" aria-label="Previous day">
              ←
            </button>
            <span className="font-mono text-[11px]">{fmtDay(data.scanDay)}</span>
            <button onClick={() => setDay(addDays(day, 1))} disabled={day >= todayStr()} className="rounded border border-line px-2 py-0.5 text-xs disabled:opacity-30" aria-label="Next day">
              →
            </button>
          </div>
        </div>
        <p className="text-[11px] text-ink-soft">
          Orders vendors added on <b>{fmtDay(data.batchDay)}</b> — scanned after 12 midnight.
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded bg-paper-2">
          <div className={`h-full ${t.left ? "bg-pending" : "bg-delivered"}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1 text-center">
          {[
            ["Left", t.left, t.left ? "text-cancelled" : "text-delivered"],
            ["Driver", t.byDriver, "text-navy"],
            ["Office", t.byOffice, "text-navy"],
            ["By hand", t.byHand, "text-ink-soft"],
          ].map(([l, n, c]) => (
            <div key={l as string}>
              <div className="font-mono text-[9px] uppercase text-ink-soft">{l}</div>
              <div className={`font-display text-lg font-semibold ${c}`}>{n as number}</div>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-ink-soft">
          {done} of {t.total} done
          {t.older ? <span className="text-cancelled"> · {t.older} older still waiting</span> : null}
          {t.addedToday ? ` · ${t.addedToday} added today (scan tomorrow)` : ""}
        </p>
      </div>

      {data.vendors.length === 0 ? (
        <p className="p-3 text-sm text-ink-soft">No vendor orders for this day.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th className="text-right">Left</th>
                <th className="text-right">Drv</th>
                <th className="text-right">Off</th>
                <th className="text-right">Of</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => {
                const isOpen = open === v.vendorId;
                const waiting = [...v.leftList, ...v.older];
                return (
                  <Fragment key={v.vendorId}>
                    <tr onClick={() => waiting.length && setOpen(isOpen ? null : v.vendorId)} className={waiting.length ? "cursor-pointer" : ""}>
                      <td className="font-semibold">
                        {waiting.length ? <span className="mr-1 text-[10px] text-ink-soft">{isOpen ? "▾" : "▸"}</span> : null}
                        {v.vendor}
                        {v.older.length > 0 && <span className="ml-1 rounded bg-cancelled-bg px-1 font-mono text-[9px] text-cancelled">+{v.older.length} old</span>}
                        {v.total === 0 && v.addedToday > 0 && <span className="ml-1 text-[10px] font-normal text-ink-soft">{v.addedToday} today</span>}
                      </td>
                      <td className={`text-right font-mono font-bold ${v.left ? "text-cancelled" : "text-delivered"}`}>{v.left ? v.left : v.total ? "✓" : "—"}</td>
                      <td className="text-right font-mono">{v.byDriver || ""}</td>
                      <td className="text-right font-mono">{v.byOffice || ""}</td>
                      <td className="text-right font-mono text-ink-soft">{v.total}</td>
                    </tr>
                    {isOpen &&
                      waiting.map((b) => (
                        <tr key={b.id} className="bg-paper-2">
                          <td colSpan={5} className="!bg-paper-2 text-xs">
                            <span className="font-mono font-bold text-navy">CN {b.cnNo}</span> · {b.customerName} · {b.emirate} ·{" "}
                            <span className="font-mono">{fmtNumber(b.codAmount)}</span>
                            {!b.printed && <span className="ml-1 rounded bg-pending-bg px-1 text-[10px] text-pending">label not printed</span>}
                            {b.addedOn && <span className="ml-1 text-[10px] text-cancelled">added {fmtDay(b.addedOn)}</span>}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <button onClick={() => setShowDone((s) => !s)} className="w-full border-t border-line p-2 text-xs text-navy">
        {showDone ? "Hide finished vendors" : `Show finished vendors (${data.vendors.length - list.length})`}
      </button>
    </div>
  );
}
