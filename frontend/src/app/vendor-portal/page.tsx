"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { VendorAuthProvider, useVendorAuth } from "@/context/VendorAuthContext";
import { EMIRATES } from "@/types";

interface VendorOrder {
  id: string;
  date: string;
  cnNo: number;
  total: number;
  deliveryCharge: number;
  status: "PENDING" | "DELIVERED" | "TRANSFER" | "CANCELLED";
  emirate: string;
  remarks?: string | null;
}

interface CreditSummary {
  openingAmount: number;
  openingCancelled: number;
  todayAmount: number;
  todayCancelled: number;
  totalAmount: number;
  cancelledTotal: number;
  totalDeliveryCharge: number;
  totalPaid: number;
  balance: number;
}

interface VendorPayment {
  id: string;
  date: string;
  amount: number;
  note?: string | null;
}

interface MonthlySummary {
  totalOrders: number;
  delivered: number;
  pending: number;
  transferred: number;
  cancelled: number;
  totalSales: number;
  totalDeliveryCharge: number;
}

interface MonthlyReport {
  month: string;
  summary: MonthlySummary;
  dailyBreakdown: ({ date: string } & MonthlySummary)[];
}

function currentMonthStr(): string {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 7);
}

function dubaiToday(): string {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function addDaysStr(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function statusClass(status: VendorOrder["status"]) {
  switch (status) {
    case "DELIVERED":
      return "bg-delivered text-white";
    case "PENDING":
      return "bg-pending text-white";
    case "CANCELLED":
      return "bg-cancelled text-white";
    default:
      return "bg-transferred text-white";
  }
}

function VendorPortalContent() {
  const { vendor, loading, logout } = useVendorAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<VendorOrder[]>([]);
  const [credit, setCredit] = useState<CreditSummary | null>(null);
  const [payments, setPayments] = useState<VendorPayment[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [emirateFilter, setEmirateFilter] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [tab, setTab] = useState<"orders" | "monthly">("orders");
  const [month, setMonth] = useState(currentMonthStr());
  const [monthly, setMonthly] = useState<MonthlyReport | null>(null);
  const [creditDate, setCreditDate] = useState(dubaiToday());

  const load = useCallback(async () => {
    const [ordersRes, creditRes, paymentsRes] = await Promise.all([
      apiFetch<{ orders: VendorOrder[] }>("/vendor-portal/orders", {
        query: {
          ...(fromDate ? { from: fromDate } : {}),
          ...(toDate ? { to: toDate } : {}),
        },
      }),
      apiFetch<CreditSummary>("/vendor-portal/credit", { query: { date: creditDate } }),
      apiFetch<VendorPayment[]>("/vendor-portal/credit/payments"),
    ]);
    setOrders(ordersRes.orders);
    setCredit(creditRes);
    setPayments(paymentsRes);
  }, [fromDate, toDate, creditDate]);

  const loadMonthly = useCallback(async () => {
    setMonthly(await apiFetch<MonthlyReport>("/vendor-portal/monthly", { query: { month } }));
  }, [month]);

  useEffect(() => {
    if (!loading && !vendor) {
      router.push("/vendor-login");
    }
  }, [loading, vendor, router]);

  useEffect(() => {
    if (vendor) load();
  }, [vendor, load]);

  useEffect(() => {
    if (vendor && tab === "monthly") loadMonthly();
  }, [vendor, tab, loadMonthly]);

  if (loading || !vendor) {
    return <div className="flex min-h-screen items-center justify-center text-ink-soft">Loading…</div>;
  }

  const filtered = orders.filter((o) => {
    if (statusFilter && o.status !== statusFilter) return false;
    if (search.trim() && !String(o.cnNo).includes(search.trim())) return false;
    if (emirateFilter && o.emirate !== emirateFilter) return false;
    if (minAmount && o.total < Number(minAmount)) return false;
    if (maxAmount && o.total > Number(maxAmount)) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-paper">
      <div className="flex h-16 items-center justify-between border-b-[3px] border-brass bg-navy px-4 text-paper md:px-6">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-lg font-bold md:text-xl">{vendor.name}</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-brass-light sm:inline">
            Vendor Portal
          </span>
        </div>
        <button
          onClick={logout}
          className="rounded border border-white/25 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-line hover:border-brass-light hover:text-white"
        >
          Sign out
        </button>
      </div>

      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Overview</p>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-display text-3xl font-semibold text-navy">Your Account</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => setCreditDate(addDaysStr(creditDate, -1))} className="rounded border border-line bg-white px-2.5 py-1.5 text-xs hover:border-brass">
              ← Prev
            </button>
            <input type="date" value={creditDate} onChange={(e) => setCreditDate(e.target.value)} className="rounded border border-line px-2.5 py-1.5 text-sm" />
            <button onClick={() => setCreditDate(addDaysStr(creditDate, 1))} className="rounded border border-line bg-white px-2.5 py-1.5 text-xs hover:border-brass">
              Next →
            </button>
            <button onClick={() => setCreditDate(dubaiToday())} className="rounded bg-navy px-2.5 py-1.5 font-mono text-xs uppercase text-paper hover:bg-navy-2">
              Today
            </button>
          </div>
        </div>
        <p className="mb-6 max-w-2xl text-sm text-ink-soft">
          Shown as a ledger for <b>{creditDate}</b>: Opening figures are everything up to the day before, Today
          figures are just this date's activity, and Total Amount is the running total through this date.
        </p>

        {credit && (
          <div className="mb-8 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4 lg:grid-cols-8">
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Opening Amount</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(credit.openingAmount)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Opening Cancelled</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(credit.openingCancelled)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Today's Amount</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(credit.todayAmount)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Today's Cancelled</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(credit.todayCancelled)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Total Amount</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(credit.totalAmount)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Delivery Charge</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(credit.totalDeliveryCharge)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Paid</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(credit.totalPaid)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Balance</div>
              <div className={`font-display text-xl font-semibold ${credit.balance > 0 ? "text-cancelled" : "text-delivered"}`}>
                {fmtNumber(credit.balance)}
              </div>
            </div>
          </div>
        )}

        <div className="mb-8 border border-line bg-white p-5">
          <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
            Payment History
          </h2>
          {payments.length === 0 ? (
            <p className="text-sm text-ink-soft">No payments recorded yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="text-right">Amount</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.date.slice(0, 10)}</td>
                    <td className="text-right font-mono">{fmtNumber(p.amount)}</td>
                    <td className="text-ink-soft">{p.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border border-line bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
            <div className="flex gap-2">
              <button
                onClick={() => setTab("orders")}
                className={`rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide ${
                  tab === "orders" ? "bg-navy text-paper" : "border border-line text-ink-soft hover:border-brass"
                }`}
              >
                Consignments
              </button>
              <button
                onClick={() => setTab("monthly")}
                className={`rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide ${
                  tab === "monthly" ? "bg-navy text-paper" : "border border-line text-ink-soft hover:border-brass"
                }`}
              >
                Monthly Report
              </button>
            </div>
          </div>

          {tab === "orders" ? (
            <>
              <div className="mb-3 flex flex-wrap gap-2.5">
                <input
                  placeholder="Search CN No…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="rounded border border-line px-2.5 py-1.5 text-sm"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded border border-line px-2.5 py-1.5 text-sm"
                >
                  <option value="">All statuses</option>
                  <option value="DELIVERED">Delivered</option>
                  <option value="PENDING">Pending</option>
                  <option value="TRANSFER">Transfer</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="rounded border border-line px-2.5 py-1.5 text-sm"
                />
                <span className="self-center text-xs text-ink-soft">to</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="rounded border border-line px-2.5 py-1.5 text-sm"
                />
                {(fromDate || toDate) && (
                  <button
                    onClick={() => {
                      setFromDate("");
                      setToDate("");
                    }}
                    className="rounded border border-line px-2.5 py-1.5 text-xs text-ink-soft hover:border-brass"
                  >
                    Clear dates
                  </button>
                )}
                <select
                  value={emirateFilter}
                  onChange={(e) => setEmirateFilter(e.target.value)}
                  className="rounded border border-line px-2.5 py-1.5 text-sm"
                >
                  <option value="">All emirates</option>
                  {EMIRATES.map((em) => (
                    <option key={em} value={em}>
                      {em}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Min AED"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  className="w-24 rounded border border-line px-2.5 py-1.5 text-sm"
                />
                <input
                  type="number"
                  placeholder="Max AED"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  className="w-24 rounded border border-line px-2.5 py-1.5 text-sm"
                />
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>CN No.</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">DL Charge</th>
                      <th>Emirate</th>
                      <th>Status</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-ink-soft">
                          No consignments found.
                        </td>
                      </tr>
                    ) : (
                      filtered.map((o) => (
                        <tr key={o.id}>
                          <td>{o.date.slice(0, 10)}</td>
                          <td className="font-mono">{o.cnNo}</td>
                          <td className="text-right font-mono">{fmtNumber(o.total)}</td>
                          <td className="text-right font-mono">{fmtNumber(o.deliveryCharge)}</td>
                          <td>{o.emirate}</td>
                          <td>
                            <span className={`rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide ${statusClass(o.status)}`}>
                              {o.status}
                            </span>
                          </td>
                          <td className="max-w-[160px] truncate text-ink-soft" title={o.remarks || ""}>
                            {o.remarks || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2">
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="rounded border border-line px-2.5 py-1.5 text-sm"
                />
              </div>
              {!monthly ? (
                <p className="text-sm text-ink-soft">Loading…</p>
              ) : (
                <>
                  <div className="mb-5 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
                    <div className="bg-white p-4">
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Delivered</div>
                      <div className="font-display text-xl font-semibold text-navy">{monthly.summary.delivered}</div>
                    </div>
                    <div className="bg-white p-4">
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Sales</div>
                      <div className="font-display text-xl font-semibold text-navy">{fmtNumber(monthly.summary.totalSales)}</div>
                    </div>
                    <div className="bg-white p-4">
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">DL Charge</div>
                      <div className="font-display text-xl font-semibold text-navy">{fmtNumber(monthly.summary.totalDeliveryCharge)}</div>
                    </div>
                    <div className="bg-white p-4">
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Cancelled</div>
                      <div className="font-display text-xl font-semibold text-navy">{monthly.summary.cancelled}</div>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th className="text-right">Delivered</th>
                          <th className="text-right">Pending</th>
                          <th className="text-right">Transfer</th>
                          <th className="text-right">Cancelled</th>
                          <th className="text-right">Sales</th>
                          <th className="text-right">DL Charge</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthly.dailyBreakdown.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-ink-soft">
                              No activity this month.
                            </td>
                          </tr>
                        ) : (
                          monthly.dailyBreakdown.map((d) => (
                            <tr key={d.date}>
                              <td>{d.date}</td>
                              <td className="text-right font-mono">{d.delivered}</td>
                              <td className="text-right font-mono">{d.pending}</td>
                              <td className="text-right font-mono">{d.transferred}</td>
                              <td className="text-right font-mono">{d.cancelled}</td>
                              <td className="text-right font-mono">{fmtNumber(d.totalSales)}</td>
                              <td className="text-right font-mono">{fmtNumber(d.totalDeliveryCharge)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VendorPortalPage() {
  return (
    <VendorAuthProvider>
      <VendorPortalContent />
    </VendorAuthProvider>
  );
}
