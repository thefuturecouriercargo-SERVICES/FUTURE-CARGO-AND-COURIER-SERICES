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
  employeeBreakdown: ({ employee: { id: string; name: string } } & Summary & { totalExpenses: number; cashBalance: number })[];
  vendorBreakdown: ({ vendor: { id: string; name: string } } & Summary)[];
  emirateBreakdown: ({ emirate: string } & Summary)[];
  paymentBreakdown: ({ method: string } & Summary)[];
  orders: Order[];
}

export default function DailyDashboardPage() {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingCarryover, setPendingCarryover] = useState<Order[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
const [useRange, setUseRange] = useState(false);
const [fromDate, setFromDate] = useState(todayStr());
const [toDate, setToDate] = useState(todayStr());
const [paymentFilter, setPaymentFilter] = useState<"" | "CASH" | "BANK">("");
const [emirateFilter, setEmirateFilter] = useState("");
const [employeeFilter, setEmployeeFilter] = useState("");
const [minAmount, setMinAmount] = useState("");
const [maxAmount, setMaxAmount] = useState("");
  const [manualDeductions, setManualDeductions] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    setLoading(true);
    try {
    const query: Record<string, string> = useRange
  ? { from: fromDate, to: toDate }
  : { date };
const res = await apiFetch<DailyResponse>("/dashboard/daily", { query });
        setData(res);
        const carryoverRes = await apiFetch<{ orders: Order[] }>("/orders/pending-carryover");
        setPendingCarryover(carryoverRes.orders);
      } finally {
        setLoading(false);
      }
  }, [date, useRange, fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  useSocketEvent("order:changed", load);

  const employeeRows = data?.employeeBreakdown ?? [];

 const filteredOrders = [...(data?.orders ?? []), ...pendingCarryover].filter((o) => {
  if (statusFilter && o.status !== statusFilter) return false;
  if (search && !String(o.cnNo).includes(search) && !o.brandName.toUpperCase().includes(search.toUpperCase())) return false;
  if (paymentFilter && o.payment !== paymentFilter) return false;
  if (emirateFilter && o.emirate !== emirateFilter) return false;
  if (employeeFilter && o.employee.id !== employeeFilter) return false;
  if (minAmount && o.total < Number(minAmount)) return false;
  if (maxAmount && o.total > Number(maxAmount)) return false;
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
        <div className="flex flex-wrap items-center gap-2">
  <label className="flex items-center gap-1.5 font-mono text-[11px] uppercase text-ink-soft">
    <input type="checkbox" checked={useRange} onChange={(e) => setUseRange(e.target.checked)} />
    Use date range
  </label>
  {useRange && (
    <>
      <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded border border-line px-3 py-2 text-sm" />
      <span className="text-xs text-ink-soft">to</span>
      <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded border border-line px-3 py-2 text-sm" />
    </>
  )}
</div>
      </div>

      {loading && !data ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : data ? (
        <>
         <div className="mb-8 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-7">
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
            <KpiCard label="Pending" value={data.summary.pending + pendingCarryover.length} />
            </div>
           <div className="bg-white">
              <KpiCard label="Transfer" value={data.summary.transferred} />
            </div>
            <div className="bg-white">
              <KpiCard label="Cancelled" value={data.summary.cancelled} />
            </div>
            <div className="bg-white">
              <KpiCard
                label="Total Consignments"
                value={
                  data.summary.delivered +
                  data.summary.pending +
                  pendingCarryover.length +
                  data.summary.transferred +
                  data.summary.cancelled
                }
              />
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
                     <td className="text-right font-mono">{r.pending + pendingCarryover.filter((o) => o.employeeId === r.employee.id).length}</td>
                      <td className="text-right font-mono">{r.cancelled}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold border-t-2 border-line">
                  <td>TOTAL</td>
                  <td className="text-right font-mono">{employeeRows.reduce((s, r) => s + r.delivered, 0)}</td>
                  <td className="text-right font-mono">{fmtNumber(employeeRows.reduce((s, r) => s + r.totalSales, 0))}</td>
                  <td className="text-right font-mono">{fmtNumber(employeeRows.reduce((s, r) => s + r.totalDeliveryCharge, 0))}</td>
                  <td className="text-right font-mono">{data.summary.pending + pendingCarryover.length}</td>
                  <td className="text-right font-mono">{employeeRows.reduce((s, r) => s + r.cancelled, 0)}</td>
                </tr>
                </tbody>
              </table>
            </div>
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">Delivery Status</h2>
              <StatusDoughnut summary={data.summary} />
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_1fr]">
            <div className="mb-5 border border-line bg-white p-5">
            <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
              Cash Closing Summary — {data.date}
            </h2>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="text-right">Cash Collected</th>
                    <th className="text-right">Expenses</th>
                    <th className="text-right">Other Deduction</th>
                    <th className="text-right">Final Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeRows.map((r) => {
                    const manual = Number(manualDeductions[r.employee.id] || 0);
                    const finalBalance = r.cashCollected - (r.totalExpenses ?? 0) - manual;
                    return (
                      <tr key={r.employee.id}>
                        <td>{r.employee.name}</td>
                        <td className="text-right font-mono">{fmtNumber(r.cashCollected)}</td>
                        <td className="text-right font-mono">{fmtNumber(r.totalExpenses ?? 0)}</td>
                        <td className="text-right">
                          <input
                            type="number"
                            placeholder="0"
                            value={manualDeductions[r.employee.id] ?? ""}
                            onChange={(e) =>
                              setManualDeductions((prev) => ({
                                ...prev,
                                [r.employee.id]: e.target.value,
                              }))
                            }
                            className="w-24 rounded border border-line px-2 py-1 text-right text-sm"
                          />
                        </td>
                        <td className="text-right font-mono font-semibold">{fmtNumber(finalBalance)}</td>
                      </tr>
                    );
                  })}
                  <tr className="font-semibold border-t-2 border-line">
                    <td>TOTAL</td>
                    <td className="text-right font-mono">
                      {fmtNumber(employeeRows.reduce((s, r) => s + r.cashCollected, 0))}
                    </td>
                    <td className="text-right font-mono">
                      {fmtNumber(employeeRows.reduce((s, r) => s + (r.totalExpenses ?? 0), 0))}
                    </td>
                    <td className="text-right font-mono">
                      {fmtNumber(
                        employeeRows.reduce((s, r) => s + Number(manualDeductions[r.employee.id] || 0), 0)
                      )}
                    </td>
                    <td className="text-right font-mono">
                      {fmtNumber(
                        employeeRows.reduce((s, r) => {
                          const manual = Number(manualDeductions[r.employee.id] || 0);
                          return s + (r.cashCollected - (r.totalExpenses ?? 0) - manual);
                        }, 0)
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
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
           <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy flex items-center justify-between">
                <span>Consignment Ledger — {data.date}</span>
                <span className="font-mono text-sm text-ink-soft">
                  {filteredOrders.length} consignment{filteredOrders.length === 1 ? "" : "s"}
                </span>
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
              <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value as "" | "CASH" | "BANK")} className="rounded border border-line px-3 py-1.5 text-sm">
  <option value="">All payments</option>
  <option value="CASH">Cash</option>
  <option value="BANK">Bank</option>
</select>
<select value={emirateFilter} onChange={(e) => setEmirateFilter(e.target.value)} className="rounded border border-line px-3 py-1.5 text-sm">
  <option value="">All emirates</option>
  {(data.emirateBreakdown ?? []).map((e) => (
    <option key={e.emirate} value={e.emirate}>{e.emirate}</option>
  ))}
</select>
<select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} className="rounded border border-line px-3 py-1.5 text-sm">
  <option value="">All employees</option>
  {employeeRows.map((r) => (
    <option key={r.employee.id} value={r.employee.id}>{r.employee.name}</option>
  ))}
</select>
<input type="number" placeholder="Min AED" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="w-24 rounded border border-line px-3 py-1.5 text-sm" />
<input type="number" placeholder="Max AED" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="w-24 rounded border border-line px-3 py-1.5 text-sm" />
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
                   filteredOrders.map((o, i) => (
                <tr key={o.id}>
                  <td className="font-mono">{i + 1}</td>
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
