"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { addDays, fmtNumber, todayStr } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import KpiCard from "@/components/KpiCard";
import StatusStamp from "@/components/StatusStamp";
import StatusDoughnut from "@/components/charts/StatusDoughnut";
import BarChart from "@/components/charts/BarChart";
import { Order, OrderStatus, Summary } from "@/types";

interface DailyResponse {
  date: string;
  summary: Summary;
  employeeBreakdown: ({ employee: { id: string; name: string } } & Summary)[];
  vendorBreakdown: ({ vendor: { id: string; name: string } } & Summary)[];
  emirateBreakdown: ({ emirate: string } & Summary)[];
  paymentBreakdown: ({ method: string } & Summary)[];
  orders: Order[];
}

export default function DailyDashboardPage() {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<DailyResponse>("/dashboard/daily", { query: { date } });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useSocketEvent("order:changed", load);

  const employeeRows = data?.employeeBreakdown ?? [];

  const filteredOrders = (data?.orders ?? []).filter((o) => {
    if (statusFilter && o.status !== statusFilter) return false;
    if (search && !String(o.cnNo).includes(search) && !o.brandName.toUpperCase().includes(search.toUpperCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Manifest Summary</p>
          <h1 className="font-display text-3xl font-semibold text-navy">Operations Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(addDays(date, -1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
            ← Prev
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-line px-3 py-2 text-sm"
          />
          <button onClick={() => setDate(addDays(date, 1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
            Next →
          </button>
          <button onClick={() => setDate(todayStr())} className="rounded bg-navy px-3 py-2 font-mono text-xs uppercase text-paper hover:bg-navy-2">
            Today
          </button>
        </div>
      </div>

      {loading && !data ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : data ? (
        <>
          <div className="mb-8 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
            <div className="bg-white">
              <KpiCard label="Total Sales" value={fmtNumber(data.summary.totalSales)} unit="AED" />
            </div>
            <div className="bg-white">
              <KpiCard label="DL Charge" value={fmtNumber(data.summary.totalDeliveryCharge)} unit="AED" />
            </div>
            <div className="bg-white">
              <KpiCard label="Delivered" value={data.summary.delivered} />
            </div>
            <div className="bg-white">
              <KpiCard label="Pending" value={data.summary.pending} />
            </div>
            <div className="bg-white">
              <KpiCard label="Transfer" value={data.summary.transferred} />
            </div>
            <div className="bg-white">
              <KpiCard label="Cancelled" value={data.summary.cancelled} />
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_1fr]">
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
                Employee-wise Performance
              </h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Sales</th>
                    <th className="text-right">DL Charge</th>
                    <th className="text-right">Pending</th>
                    <th className="text-right">Cancelled</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeRows.map((r) => (
                    <tr key={r.employee.id}>
                      <td>{r.employee.name}</td>
                      <td className="text-right font-mono">{r.delivered}</td>
                      <td className="text-right font-mono">{fmtNumber(r.totalSales)}</td>
                      <td className="text-right font-mono">{fmtNumber(r.totalDeliveryCharge)}</td>
                      <td className="text-right font-mono">{r.pending}</td>
                      <td className="text-right font-mono">{r.cancelled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">Delivery Status</h2>
              <StatusDoughnut summary={data.summary} />
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_1fr]">
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
                Vendor-wise Performance
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
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
                Employee Sales (AED)
              </h2>
              <BarChart labels={employeeRows.map((r) => r.employee.name)} data={employeeRows.map((r) => r.totalSales)} />
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
                Payment-wise Summary
              </h2>
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
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
                Emirate-wise Summary
              </h2>
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
          </div>

          <div className="border border-line bg-white p-5">
            <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
              Consignment Ledger — {data.date}
            </h2>
            <div className="mb-3 flex flex-wrap gap-2.5">
              <input
                placeholder="Search CN No. or brand…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded border border-line px-3 py-1.5 text-sm"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as OrderStatus | "")}
                className="rounded border border-line px-3 py-1.5 text-sm"
              >
                <option value="">All statuses</option>
                <option value="DELIVERED">Delivered</option>
                <option value="PENDING">Pending</option>
                <option value="TRANSFER">Transfer</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SL</th>
                    <th>CN No.</th>
                    <th>Vendor</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">DL Chg</th>
                    <th>Payment</th>
                    <th>Emirate</th>
                    <th>Employee</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-ink-soft">
                        No consignments match this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((o) => (
                      <tr key={o.id}>
                        <td className="font-mono">{o.slNo}</td>
                        <td className="font-mono">{o.cnNo}</td>
                        <td>{o.brandName}</td>
                        <td className="text-right font-mono">{fmtNumber(o.total)}</td>
                        <td className="text-right font-mono">{fmtNumber(o.deliveryCharge)}</td>
                        <td>{o.payment}</td>
                        <td>{o.emirate}</td>
                        <td>{o.employee.name}</td>
                        <td>
                          <StatusStamp status={o.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
