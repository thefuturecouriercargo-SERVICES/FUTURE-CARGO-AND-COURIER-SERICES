"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, currentMonthStr, fmtDate, fmtDateLong } from "@/lib/format";
import { Order } from "@/types";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

interface DayRow {
  date: string;
  delivered: number;
  pending: number;
  transferred: number;
  cancelled: number;
  totalSales: number;
  totalDeliveryCharge: number;
}

interface PerformanceResponse {
  month: string;
  days: DayRow[];
}

interface HistoryResponse {
  date: string;
  orders: Order[];
}

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const monthLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1] ?? ""} ${ym.slice(0, 4)}`;
function shiftMonth(ym: string, delta: number) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function DriverHistoryPage() {
  const [month, setMonth] = useState(currentMonthStr());
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<Order[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<PerformanceResponse>("/driver/performance", { query: { month } });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [month]);
  useLiveRefresh(load);

  useEffect(() => {
    load();
    setExpandedDate(null);
    setDayDetail(null);
  }, [load]);

  async function toggleDay(date: string) {
    if (expandedDate === date) {
      setExpandedDate(null);
      setDayDetail(null);
      return;
    }
    setExpandedDate(date);
    setDetailLoading(true);
    setDayDetail(null);
    try {
      const res = await apiFetch<HistoryResponse>("/driver/history", { query: { date } });
      setDayDetail(res.orders);
    } finally {
      setDetailLoading(false);
    }
  }

  const days = data?.days ?? [];
  const totals = days.reduce(
    (acc, d) => ({
      delivered: acc.delivered + d.delivered,
      pending: acc.pending + d.pending,
      transferred: acc.transferred + d.transferred,
      cancelled: acc.cancelled + d.cancelled,
      totalSales: acc.totalSales + d.totalSales,
    }),
    { delivered: 0, pending: 0, transferred: 0, cancelled: 0, totalSales: 0 }
  );
  const finished = totals.delivered + totals.cancelled;
  const success = finished > 0 ? Math.round((totals.delivered / finished) * 100) : 0;
  const best = days.reduce<DayRow | null>((b, d) => (!b || d.delivered > b.delivered ? d : b), null);
  const maxDel = Math.max(1, ...days.map((d) => d.delivered));
  const isCurrent = month >= currentMonthStr();
  const newestFirst = [...days].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="mx-auto max-w-4xl px-4 pb-8 pt-1 font-mono uppercase">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button type="button" onClick={() => (window.history.length > 1 ? window.history.back() : (window.location.href = "/driver"))} aria-label="Back" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white active:scale-95">←</button>
        <div className="flex items-center gap-1 rounded-full bg-white px-1 py-1 shadow-sm ring-1 ring-line">
          <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month" className="grid h-7 w-7 place-items-center rounded-full text-navy active:bg-paper-2">‹</button>
          <span className="min-w-[78px] text-center text-[12px] font-bold tracking-wide text-navy">{monthLabel(month)}</span>
          <button type="button" disabled={isCurrent} onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month" className="grid h-7 w-7 place-items-center rounded-full text-navy active:bg-paper-2 disabled:opacity-25">›</button>
        </div>
      </div>

      {loading && !data ? (
        <p className="py-10 text-center text-xs text-ink-soft">LOADING…</p>
      ) : days.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center text-xs text-ink-soft shadow-sm ring-1 ring-line">NO CONSIGNMENTS IN {monthLabel(month)}</div>
      ) : (
        <>
          <div className="rounded-2xl bg-navy p-4 text-white shadow-md">
            <div className="text-[10px] font-bold tracking-widest text-[#F3D58E]">{monthLabel(month)} DELIVERED</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-4xl font-extrabold">{fmtNumber(totals.delivered)}</span>
              <span className="text-[11px] text-white/60">· {success}% SUCCESS</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <MiniStat label="CANCELLED" value={totals.cancelled} />
              <MiniStat label="TRANSFERRED" value={totals.transferred} />
              <MiniStat label="DAYS" value={days.length} />
            </div>

            <div className="mt-4 flex h-16 items-end gap-[3px]">
              {days.map((d) => (
                <button
                  type="button"
                  key={d.date}
                  onClick={() => toggleDay(d.date)}
                  aria-label={`${fmtDate(d.date)}: ${d.delivered} delivered`}
                  className="flex-1 rounded-t-[3px] transition-all"
                  style={{
                    height: `${Math.max(6, Math.round((d.delivered / maxDel) * 100))}%`,
                    background: expandedDate === d.date ? "#FFFFFF" : best && d.date === best.date ? "#F3D58E" : "#C9A24A",
                    opacity: expandedDate && expandedDate !== d.date ? 0.45 : 1,
                  }}
                />
              ))}
            </div>
            {best && (
              <div className="mt-2 flex justify-between text-[10px] text-white/60">
                <span>{fmtDate(days[0].date).slice(0, 6)}</span>
                <span className="text-[#F3D58E]">BEST {fmtDate(best.date).slice(0, 6)} · {best.delivered}</span>
                <span>{fmtDate(days[days.length - 1].date).slice(0, 6)}</span>
              </div>
            )}
          </div>

          <div className="mt-3 space-y-2">
            {newestFirst.map((d) => {
              const open = expandedDate === d.date;
              return (
                <div key={d.date} className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ${open ? "ring-brass" : "ring-line"}`}>
                  <button type="button" onClick={() => toggleDay(d.date)} className="flex w-full items-center gap-3 p-3 text-left active:bg-paper-2">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-paper-2 text-center leading-none">
                      <span className="font-display text-lg font-extrabold text-navy">{d.date.slice(8, 10)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-bold text-navy">{fmtDateLong(d.date)}</div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-bold">
                        <Chip cls="bg-delivered-bg text-delivered" label={`${d.delivered} DELIVERED`} />
                        {d.pending > 0 && <Chip cls="bg-pending-bg text-pending" label={`${d.pending} PENDING`} />}
                        {d.cancelled > 0 && <Chip cls="bg-cancelled-bg text-cancelled" label={`${d.cancelled} CANCELLED`} />}
                        {d.transferred > 0 && <Chip cls="bg-transferred-bg text-transferred" label={`${d.transferred} TRANSFERRED`} />}
                      </div>
                    </div>
                    <span className={`text-lg text-brass transition-transform ${open ? "rotate-90" : ""}`}>›</span>
                  </button>
                  {open && (
                    <div className="space-y-2 border-t border-line bg-paper p-3">
                      {detailLoading ? (
                        <p className="text-center text-[11px] text-ink-soft">LOADING…</p>
                      ) : dayDetail && dayDetail.length > 0 ? (
                        dayDetail.map((o) => (
                          <div key={o.id} className={`flex items-center justify-between gap-2 rounded-xl border-l-4 bg-white p-2.5 ring-1 ring-line ${statusBorderClass(o.status)}`}>
                            <div className="min-w-0">
                              <div className="truncate text-[12px] font-bold text-navy">CN {o.cnNo} <span className="font-normal text-ink-soft">· {o.brandName}</span></div>
                              <div className="mt-0.5 truncate text-[10.5px] text-ink-soft">
                                AED <b className="text-ink">{fmtNumber(o.total)}</b> · {o.payment} · {o.emirate}
                              </div>
                            </div>
                            <span className={`stamp shrink-0 ${statusStampClass(o.status)}`}>{o.status}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-center text-[11px] text-ink-soft">NO CONSIGNMENTS FOR THIS DAY</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/[0.07] px-1 py-2">
      <div className="font-display text-lg font-extrabold text-[#F3D58E]">{fmtNumber(value)}</div>
      <div className="text-[9px] tracking-wide text-white/60">{label}</div>
    </div>
  );
}

function Chip({ cls, label }: { cls: string; label: string }) {
  return <span className={`rounded-md px-1.5 py-0.5 ${cls}`}>{label}</span>;
}

function statusBorderClass(status: string) {
  switch (status) {
    case "DELIVERED":
      return "border-l-delivered";
    case "PENDING":
      return "border-l-pending";
    case "CANCELLED":
      return "border-l-cancelled";
    default:
      return "border-l-transferred";
  }
}

function statusStampClass(status: string) {
  switch (status) {
    case "DELIVERED":
      return "delivered";
    case "PENDING":
      return "pending";
    case "CANCELLED":
      return "cancelled";
    default:
      return "transferred";
  }
}
