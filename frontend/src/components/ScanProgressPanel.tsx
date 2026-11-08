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
interface OutsideRow {
  vendor: string;
  counts: Record<string, number>;
  total: number;
}
interface Progress {
  scanDay: string;
  batchDay: string;
  vendors: VendorRow[];
  outside?: OutsideRow[];
  outsideAreas?: string[];
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

  if (!data) return <div className="h-full rounded-xl border border-line bg-white p-4 text-sm text-ink-soft">Loading scan check…</div>;
  const t = data.totals;
  const done = t.byDriver + t.byOffice + t.byHand;
  const pct = t.total ? Math.round((done / t.total) * 1000) / 10 : 100;
  const list = data.vendors.filter((v) => showDone || v.left > 0 || v.older.length > 0 || v.total === 0);
  const finished = data.vendors.length - data.vendors.filter((v) => v.left > 0 || v.older.length > 0 || v.total === 0).length;
  const w = (n: number) => `${t.total ? (n / t.total) * 100 : 0}%`;
  const parts: [string, number, string][] = [
    ["Driver", t.byDriver, "bg-brass"],
    ["Office", t.byOffice, "bg-transferred"],
    ["By hand", t.byHand, "bg-ink-soft"],
    ["Left", t.left, "bg-cancelled"],
  ];

  return (
    <div className="flex h-full flex-col gap-3">
      <OutsideBox rows={data.outside ?? []} />
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-[17px] font-semibold text-navy">Left to scan</h2>
          <div className="flex items-center overflow-hidden rounded-md border border-line">
            <button onClick={() => setDay(addDays(day, -1))} className="px-2 py-1 text-xs text-ink-soft hover:text-ink" aria-label="Previous day">
              ‹
            </button>
            <span className="px-1.5 font-mono text-[11px] font-semibold">{fmtDay(data.batchDay)}</span>
            <button onClick={() => setDay(addDays(day, 1))} disabled={day >= todayStr()} className="px-2 py-1 text-xs text-ink-soft hover:text-ink disabled:opacity-30" aria-label="Next day">
              ›
            </button>
          </div>
        </div>
        <p className="mt-0.5 text-[11px] text-ink-soft">Vendor orders booked {fmtDay(data.batchDay)}, scanned after midnight</p>
      </div>

      <div className="border-b border-line px-4 py-4">
        <div className="flex items-end justify-between">
          <div className="flex items-baseline gap-2">
            <span className={`font-mono text-4xl font-bold leading-none ${t.left ? "text-cancelled" : "text-delivered"}`}>{t.left}</span>
            <span className="text-sm text-ink-soft">of {t.total} left</span>
          </div>
          <span className="font-mono text-sm font-semibold text-ink">{pct}% done</span>
        </div>
        <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded bg-paper-2">
          {parts.map(([l, n, c]) => (n ? <div key={l} className={c} style={{ width: w(n) }} /> : null))}
        </div>
        <div className="mt-3 grid grid-cols-4">
          {parts.map(([l, n, c], i) => (
            <div key={l} className={`flex flex-col gap-0.5 ${i ? "border-l border-line pl-2.5" : ""}`}>
              <span className="flex items-center gap-1.5 text-[11px] text-ink-soft">
                <span className={`h-2 w-2 rounded-sm ${c}`} />
                {l}
              </span>
              <span className="font-mono text-lg font-bold text-ink">{n}</span>
            </div>
          ))}
        </div>
        {t.older ? <p className="mt-2 text-[11px] text-cancelled">{t.older} older orders still waiting</p> : null}
      </div>

      {data.vendors.length === 0 ? (
        <p className="p-4 text-sm text-ink-soft">No vendor orders for this day.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th className="text-right">Booked</th>
                <th className="text-right">Scanned</th>
                <th className="text-right">Left</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => {
                const isOpen = open === v.vendorId;
                const waiting = [...v.leftList, ...v.older];
                const scanned = v.byDriver + v.byOffice + v.byHand;
                return (
                  <Fragment key={v.vendorId}>
                    <tr onClick={() => waiting.length && setOpen(isOpen ? null : v.vendorId)} className={waiting.length ? "cursor-pointer" : ""}>
                      <td>
                        <div className="flex items-center gap-1 font-semibold">
                          {waiting.length ? <span className="text-[10px] text-ink-soft">{isOpen ? "▾" : "▸"}</span> : null}
                          {v.vendor}
                          {v.older.length > 0 && <span className="ml-1 rounded bg-cancelled-bg px-1 font-mono text-[9px] text-cancelled">+{v.older.length} old</span>}
                          {v.total === 0 && v.addedToday > 0 && <span className="ml-1 text-[10px] font-normal text-ink-soft">{v.addedToday} today</span>}
                        </div>
                        {v.total > 0 && (
                          <div className="mt-1.5 h-[3px] overflow-hidden rounded bg-paper-2">
                            <div className={v.left ? "h-full bg-brass" : "h-full bg-delivered"} style={{ width: `${Math.max(3, (scanned / v.total) * 100)}%` }} />
                          </div>
                        )}
                      </td>
                      <td className="text-right font-mono text-ink-soft">{v.total}</td>
                      <td className="text-right font-mono text-ink-soft">{scanned}</td>
                      <td className="text-right">
                        {v.left ? (
                          <span className="inline-block min-w-[28px] rounded bg-cancelled-bg px-2 py-0.5 text-center font-mono text-xs font-bold text-cancelled">{v.left}</span>
                        ) : (
                          <span className="font-mono text-xs font-bold text-delivered">{v.total ? "✓" : "—"}</span>
                        )}
                      </td>
                    </tr>
                    {isOpen &&
                      waiting.map((b) => (
                        <tr key={b.id} className="bg-paper-2">
                          <td colSpan={4} className="!bg-paper-2 text-xs">
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
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-ink-soft">
        <button onClick={() => setShowDone((s) => !s)} className="font-semibold text-brass hover:underline">
          {showDone ? "Hide finished vendors" : `${finished} vendors complete`}
        </button>
        {t.addedToday ? <span>+{t.addedToday} booked today · due tomorrow</span> : null}
      </div>
    </div>
    </div>
  );
}

/** Inspired & Escalo parcels for outside areas in this batch — CN count per vendor. */
function OutsideBox({ rows }: { rows: OutsideRow[]; areas?: string[] }) {
  if (!rows.length) return null;
  const name = (v: string) => v.charAt(0) + v.slice(1).toLowerCase();
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-brass">Outside areas</span>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {rows.map((r, i) => (
          <div key={r.vendor} className={`flex items-baseline justify-between ${i ? "border-l border-line pl-3" : ""}`}>
            <span className="text-sm font-semibold text-ink">{name(r.vendor)}</span>
            <span className={`font-mono text-2xl font-bold ${r.total ? "text-navy" : "text-ink-soft"}`}>{r.total}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
