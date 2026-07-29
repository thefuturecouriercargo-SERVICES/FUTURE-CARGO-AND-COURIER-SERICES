"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { currentMonthStr, fmtNumber } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import KpiCard from "@/components/KpiCard";
import BarChart from "@/components/charts/BarChart";
import { Summary } from "@/types";

interface MonthlyResponse {
  month: string;
  summary: Summary;
  employeeBreakdown: ({ employee: { id: string; name: string } } & Summary)[];
  vendorBreakdown: ({ vendor: { id: string; name: string } } & Summary)[];
  emirateBreakdown: ({ emirate: string } & Summary)[];
  dailyBreakdown: ({ date: string } & Summary)[];
  paymentBreakdown: ({ method: string } & Summary)[];
}

export default function MonthlyDashboardPage() {
  const [month, setMonth] = useState(currentMonthStr());
  const [data, setData] = useState<MonthlyResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<MonthlyResponse>("/dashboard/monthly", { query: { month } });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  useSocketEvent("order:changed", load);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Automatic Roll-up</p>
          <h1 className="font-display text-3xl font-semibold text-navy">Monthly Dashboard</h1>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-line px-3 py-2 text-sm" />
      </div>

      {loading && !data ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : data ? (
        <>
          <div className="mb-8 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
            <div className="bg-white">
              <KpiCard label="Total Orders" value={data.summary.totalOrders} />
            </div>
            <div className="bg-white">
              <KpiCard label="Delivered" value={data.summary.delivered} />
            </div>
            <div className="bg-white">
              <KpiCard label="Pending" value={data.summary.pending} />
            </div>
            <div className="bg-white">
              <KpiCard label="Cancelled" value={data.summary.cancelled} />
            </div>
            <div className="bg-white">
              <KpiCard label="Total Sales" value={fmtNumber(data.summary.totalSales)} unit="AED" />
            </div>
            <div className="bg-white">
              <KpiCard label="Total DL Charge" value={fmtNumber(data.summary.totalDeliveryCharge)} unit="AED" />
            </div>
          </div>

          <div className="mb-5 border border-line bg-white p-5">
            <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
              Daily Deliveries — {data.month}
            </h2>
            <BarChart labels={data.dailyBreakdown.map((d) => d.date.slice(8))} data={data.dailyBreakdown.map((d) => d.delivered)} color="#141F33" />
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
                Employee-wise Deliveries &amp; Charges
              </h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Sales</th>
                    <th className="text-right">DL Charge</th>
                  </tr>
                </thead>
                <tbody>
                  {data.employeeBreakdown.map((r) => (
                    <tr key={r.employee.id}>
                      <td>{r.employee.name}</td>
                      <td className="text-right font-mono">{r.delivered}</td>
                      <td className="text-right font-mono">{fmtNumber(r.totalSales)}</td>
                      <td className="text-right font-mono">{fmtNumber(r.totalDeliveryCharge)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
                Vendor-wise Deliveries &amp; Charges
              </h2>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th className="text-right">Delivered</th>
                      <th className="text-right">Sales</th>
                      <th className="text-right">DL Charge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.vendorBreakdown.map((v) => (
                      <tr key={v.vendor.id}>
                        <td>{v.vendor.name}</td>
                        <td className="text-right font-mono">{v.delivered}</td>
                        <td className="text-right font-mono">{fmtNumber(v.totalSales)}</td>
                        <td className="text-right font-mono">{fmtNumber(v.totalDeliveryCharge)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">Emirate-wise Summary</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Emirate</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.emirateBreakdown.map((e) => (
                    <tr key={e.emirate}>
                      <td>{e.emirate}</td>
                      <td className="text-right font-mono">{e.delivered}</td>
                      <td className="text-right font-mono">{fmtNumber(e.totalSales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">Payment-wise Summary</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.paymentBreakdown.map((p) => (
                    <tr key={p.method}>
                      <td>{p.method}</td>
                      <td className="text-right font-mono">{p.delivered}</td>
                      <td className="text-right font-mono">{fmtNumber(p.totalSales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
