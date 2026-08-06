"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, currentMonthStr } from "@/lib/format";
import { Order } from "@/types";

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
      totalDeliveryCharge: acc.totalDeliveryCharge + d.totalDeliveryCharge,
    }),
    { delivered: 0, pending: 0, transferred: 0, cancelled: 0, totalSales: 0, totalDeliveryCharge: 0 }
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Read-only</p>
          <h1 className="font-display text-2xl font-semibold text-navy">My History</h1>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border border-line px-3 py-2 text-sm"
        />
      </div>

      <div className="border border-line bg-white p-5">
        <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
          Day-wise Breakdown — {month}
        </h2>
        <p className="mb-3 text-xs text-ink-soft">Click a date to see that day&apos;s individual consignments.</p>
        {loading ? (
          <p className="py-8 text-center text-sm text-ink-soft">Loading…</p>
        ) : days.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-soft">No consignments this month.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="text-right">Delivered</th>
                <th className="text-right">Pending</th>
                <th className="text-right">Transferred</th>
                <th className="text-right">Cancelled</th>
                <th className="text-right">Sales</th>
                <th className="text-right">DL Charge</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <>
                  <tr
                    key={d.date}
                    onClick={() => toggleDay(d.date)}
                    className={`cursor-pointer hover:bg-paper-2 ${expandedDate === d.date ? "bg-paper-2" : ""}`}
                  >
                    <td className="font-mono text-brass">{expandedDate === d.date ? "▾ " : "▸ "}{d.date}</td>
                    <td className="text-right font-mono">{d.delivered}</td>
                    <td className="text-right font-mono">{d.pending}</td>
                    <td className="text-right font-mono">{d.transferred}</td>
                    <td className="text-right font-mono">{d.cancelled}</td>
                    <td className="text-right font-mono">{fmtNumber(d.totalSales)}</td>
                    <td className="text-right font-mono">{fmtNumber(d.totalDeliveryCharge)}</td>
                  </tr>
                  {expandedDate === d.date && (
                    <tr>
                      <td colSpan={7} className="bg-paper p-4">
                        {detailLoading ? (
                          <p className="text-center text-xs text-ink-soft">Loading consignments…</p>
                        ) : dayDetail && dayDetail.length > 0 ? (
                          <div className="space-y-2">
                            {dayDetail.map((o) => (
                              <div
                                key={o.id}
                                className={`flex flex-wrap items-center justify-between gap-3 rounded border border-line border-l-4 bg-white p-3 ${statusBorderClass(o.status)}`}
                              >
                                <div>
                                  <div className="font-mono text-sm font-bold text-navy">
                                    CN {o.cnNo} <span className="font-normal text-ink-soft">— {o.brandName}</span>
                                  </div>
                                  <div className="mt-0.5 text-xs text-ink-soft">
                                    Total <b className="text-ink">{fmtNumber(o.total)} AED</b> · DL Charge{" "}
                                    <b className="text-ink">{fmtNumber(o.deliveryCharge)} AED</b> · {o.payment} · {o.emirate}
                                  </div>
                                </div>
                                <span className={`stamp ${statusStampClass(o.status)}`}>{o.status}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-center text-xs text-ink-soft">No consignments found for this date.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
              <tr className="font-semibold border-t-2 border-line">
                <td>TOTAL</td>
                <td className="text-right font-mono">{totals.delivered}</td>
                <td className="text-right font-mono">{totals.pending}</td>
                <td className="text-right font-mono">{totals.transferred}</td>
                <td className="text-right font-mono">{totals.cancelled}</td>
                <td className="text-right font-mono">{fmtNumber(totals.totalSales)}</td>
                <td className="text-right font-mono">{fmtNumber(totals.totalDeliveryCharge)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
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
