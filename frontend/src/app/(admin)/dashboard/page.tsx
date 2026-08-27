"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, employeePerformancePdfUrl } from "@/lib/api";
import { addDays, fmtNumber, todayStr } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import KpiCard from "@/components/KpiCard";
import StatusStamp from "@/components/StatusStamp";
import StatusDoughnut from "@/components/charts/StatusDoughnut";
import BarChart from "@/components/charts/BarChart";
import { Order, OrderStatus, Summary, Vendor } from "@/types";

interface DailyResponse {
  date: string;
  summary: Summary;
employeeBreakdown: ({ employee: { id: string; name: string } } & Summary & { totalExpenses: number; otherDeduction: number; otherDeductionEntries: { id: string; amount: number }[]; cashBalance: number })[];
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
  const [globalResults, setGlobalResults] = useState<Order[] | null>(null);
const [globalSearching, setGlobalSearching] = useState(false);
const [deductionInput, setDeductionInput] = useState<Record<string, string>>({});
  const [deductionVendor, setDeductionVendor] = useState<Record<string, string>>({});
  const [savingDeduction, setSavingDeduction] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<{ id: string; employeeId: string; amount: number; vendor?: { id: string; name: string } | null }[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  function adjTotal(employeeId: string) {
    return purchases.filter((p) => p.employeeId === employeeId).reduce((s, p) => s + p.amount, 0);
  }

  async function addDeduction(employeeId: string) {
    const amount = Number(deductionInput[employeeId]);
    if (!amount || amount <= 0) return;
    setSavingDeduction(employeeId);
    try {
      await apiFetch("/purchases", {
        method: "POST",
        body: { date, amount, employeeId, vendorId: deductionVendor[employeeId] || undefined },
      });
      setDeductionInput((prev) => ({ ...prev, [employeeId]: "" }));
      setDeductionVendor((prev) => ({ ...prev, [employeeId]: "" }));
      await load();
    } finally {
      setSavingDeduction(null);
    }
  }
  async function removeDeduction(entryId: string) {
    await apiFetch(`/purchases/${entryId}`, { method: "DELETE" });
    await load();
  }
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
        const purchasesRes = await apiFetch<{ id: string; employeeId: string; amount: number; vendor?: { id: string; name: string } | null }[]>("/purchases", { query: { date } });
        setPurchases(purchasesRes);
      } finally {
        setLoading(false);
      }
  }, [date, useRange, fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    apiFetch<Vendor[]>("/vendors").then(setVendors);
  }, []);
  useEffect(() => {
  if (!search.trim()) {
    setGlobalResults(null);
    return;
  }
  const t = setTimeout(async () => {
    setGlobalSearching(true);
    try {
      const res = await apiFetch<{ orders: Order[] }>("/orders", { query: { search } });
      setGlobalResults(res.orders);
    } finally {
      setGlobalSearching(false);
    }
  }, 300);
  return () => clearTimeout(t);
}, [search]);

  useSocketEvent("order:changed", load);

  const employeeRows = data?.employeeBreakdown ?? [];

const sourceOrders =
  search.trim() && globalResults
    ? globalResults
    : [...(data?.orders ?? []), ...pendingCarryover];

const filteredOrders = sourceOrders.filter((o) => {
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
              <div className="mb-3 flex items-center justify-between border-b border-line pb-2.5">
                <h2 className="font-display text-[17px] font-semibold text-navy">
                  Employee-wise Performance
                               </h2>
                <a
                  href={employeePerformancePdfUrl({ date })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:border-brass hover:text-navy"
                >
                  Download PDF
                </a>
              </div>
             {/* Mobile: stacked cards */}
              <div className="space-y-3 md:hidden">
                {employeeRows.map((r) => {
                  const empPending = r.pending + pendingCarryover.filter((o) => o.employeeId === r.employee.id).length;
                  const empTotal = r.delivered + empPending + r.transferred + r.cancelled;
                  return (
                    <div key={r.employee.id} className="rounded border border-line p-3.5">
                      <div className="mb-2.5 flex items-center justify-between">
                        <span className="font-display text-[15px] font-semibold text-navy">{r.employee.name}</span>
                        <span className="font-mono text-sm font-semibold text-navy">{empTotal} total</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">
                        <div className="flex justify-between">
                          <span className="text-ink-soft">Delivered</span>
                          <span>{r.delivered}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-soft">Sales</span>
                          <span>{fmtNumber(r.totalSales)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-soft">DL Charge</span>
                          <span>{fmtNumber(r.totalDeliveryCharge)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-soft">Pending</span>
                          <span>{empPending}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-soft">Cancelled</span>
                          <span>{r.cancelled}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-soft">Transfer</span>
                          <span>{r.transferred}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="rounded border-2 border-navy p-3.5">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="font-display text-[15px] font-semibold text-navy">TOTAL</span>
                    <span className="font-mono text-sm font-semibold text-navy">
                      {employeeRows.reduce((s, r) => s + r.delivered, 0) +
                        data.summary.pending + pendingCarryover.length +
                        employeeRows.reduce((s, r) => s + r.transferred, 0) +
                        employeeRows.reduce((s, r) => s + r.cancelled, 0)}{" "}
                      total
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Delivered</span>
                      <span>{employeeRows.reduce((s, r) => s + r.delivered, 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Sales</span>
                      <span>{fmtNumber(employeeRows.reduce((s, r) => s + r.totalSales, 0))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-soft">DL Charge</span>
                      <span>{fmtNumber(employeeRows.reduce((s, r) => s + r.totalDeliveryCharge, 0))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Pending</span>
                      <span>{data.summary.pending + pendingCarryover.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Cancelled</span>
                      <span>{employeeRows.reduce((s, r) => s + r.cancelled, 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Transfer</span>
                      <span>{employeeRows.reduce((s, r) => s + r.transferred, 0)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Desktop: full table */}
              <table className="data-table hidden md:table">
                <thead>
                  <tr>
                   <th>Employee</th>
    <th className="text-right">Delivered</th>
    <th className="text-right">Sales</th>
    <th className="text-right">DL Charge</th>
    <th className="text-right">Pending</th>
    <th className="text-right">Cancelled</th>
    <th className="text-right">Transfer</th>
    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                 {employeeRows.map((r) => {
      const empPending = r.pending + pendingCarryover.filter((o) => o.employeeId === r.employee.id).length;
      const empTotal = r.delivered + empPending + r.transferred + r.cancelled;
      return (
        <tr key={r.employee.id}>
          <td>{r.employee.name}</td>
          <td className="text-right font-mono">{r.delivered}</td>
          <td className="text-right font-mono">{fmtNumber(r.totalSales)}</td>
          <td className="text-right font-mono">{fmtNumber(r.totalDeliveryCharge)}</td>
          <td className="text-right font-mono">{empPending}</td>
          <td className="text-right font-mono">{r.cancelled}</td>
          <td className="text-right font-mono">{r.transferred}</td>
          <td className="text-right font-mono">{empTotal}</td>
        </tr>
      );
    })}
                 <tr className="font-semibold border-t-2 border-line">
  <td>TOTAL</td>
  <td className="text-right font-mono">{employeeRows.reduce((s, r) => s + r.delivered, 0)}</td>
  <td className="text-right font-mono">{fmtNumber(employeeRows.reduce((s, r) => s + r.totalSales, 0))}</td>
  <td className="text-right font-mono">{fmtNumber(employeeRows.reduce((s, r) => s + r.totalDeliveryCharge, 0))}</td>
  <td className="text-right font-mono">{data.summary.pending + pendingCarryover.length}</td>
  <td className="text-right font-mono">{employeeRows.reduce((s, r) => s + r.cancelled, 0)}</td>
  <td className="text-right font-mono">{employeeRows.reduce((s, r) => s + r.transferred, 0)}</td>
  <td className="text-right font-mono">
    {employeeRows.reduce((s, r) => s + r.delivered, 0) +
      data.summary.pending + pendingCarryover.length +
      employeeRows.reduce((s, r) => s + r.transferred, 0) +
      employeeRows.reduce((s, r) => s + r.cancelled, 0)}
  </td>
</tr>
                </tbody>
              </table>
            </div>
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">Delivery Status</h2>
              <StatusDoughnut summary={data.summary} />
            </div>
          </div>
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
                  const finalBalance = r.cashCollected - r.totalExpenses - adjTotal(r.employee.id);
                    return (
                      <tr key={r.employee.id}>
                        <td>{r.employee.name}</td>
                        <td className="text-right font-mono">{fmtNumber(r.cashCollected)}</td>
                        <td className="text-right font-mono">{fmtNumber(r.totalExpenses)}</td>
                     <td className="text-right font-mono">
                          <div className="flex flex-col items-end gap-1">
                            {purchases.filter((p) => p.employeeId === r.employee.id).map((entry) => (
                              <span
                                key={entry.id}
                                className="flex items-center gap-1 rounded bg-paper px-1.5 py-0.5 text-xs"
                                title={entry.vendor ? `Paid to ${entry.vendor.name}` : "General deduction"}
                              >
                                {fmtNumber(entry.amount)}
                                {entry.vendor && (
                                  <span className="rounded bg-brass/20 px-1 text-[9px] uppercase text-brass">
                                    {entry.vendor.name}
                                  </span>
                                )}
                                <button
                                  onClick={() => removeDeduction(entry.id)}
                                  className="text-red-600 hover:text-red-800"
                                  title="Remove"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                            <div className="flex items-center gap-1.5">
                              <select
                                value={deductionVendor[r.employee.id] ?? ""}
                                onChange={(e) =>
                                  setDeductionVendor((prev) => ({ ...prev, [r.employee.id]: e.target.value }))
                                }
                                className="rounded border border-line px-1 py-0.5 text-[10px]"
                                title="Vendor (optional) — leave blank for a general deduction"
                              >
                                <option value="">No vendor</option>
                                {vendors.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                placeholder="+ add"
                                value={deductionInput[r.employee.id] ?? ""}
                                onChange={(e) =>
                                  setDeductionInput((prev) => ({ ...prev, [r.employee.id]: e.target.value }))
                                }
                                onKeyDown={(e) => e.key === "Enter" && addDeduction(r.employee.id)}
                                className="w-16 rounded border border-line px-1.5 py-0.5 text-right text-xs"
                              />
                              <button
                                onClick={() => addDeduction(r.employee.id)}
                                disabled={savingDeduction === r.employee.id}
                                className="rounded bg-navy px-2 py-0.5 text-xs text-paper hover:bg-navy-2 disabled:opacity-50"
                              >
                                +
                              </button>
                            </div>
                          </div>
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
                      {fmtNumber(employeeRows.reduce((s, r) => s + r.totalExpenses, 0))}
                    </td>
                    <td className="text-right font-mono">
                     {fmtNumber(employeeRows.reduce((s, r) => s + adjTotal(r.employee.id), 0))}
                    </td>
                    <td className="text-right font-mono">
                      {fmtNumber(
                       employeeRows.reduce((s, r) => s + (r.cashCollected - r.totalExpenses - adjTotal(r.employee.id)), 0)
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
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
           <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy flex items-center justify-between">
             <span>
  Consignment Ledger — {search.trim() ? "All dates (search)" : data.date}
  {globalSearching && <span className="ml-2 text-xs text-ink-soft">searching…</span>}
</span>
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
