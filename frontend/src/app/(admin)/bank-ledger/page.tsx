"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { Employee, EMIRATES, Order, STATUSES, Vendor } from "@/types";

type SortKey = "date" | "cnNo" | "total" | "confirmed";
type SortDir = "asc" | "desc";

export default function BankLedgerPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [emirateFilter, setEmirateFilter] = useState("");
  const [confirmedFilter, setConfirmedFilter] = useState<"" | "yes" | "no">("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ orders: Order[] }>("/orders", {
        query: {
          payment: "BANK",
          ...(fromDate ? { from: fromDate } : {}),
          ...(toDate ? { to: toDate } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(vendorFilter ? { vendorId: vendorFilter } : {}),
          ...(employeeFilter ? { employeeId: employeeFilter } : {}),
          ...(emirateFilter ? { emirate: emirateFilter } : {}),
          ...(confirmedFilter ? { bankPaymentConfirmed: confirmedFilter === "yes" ? "true" : "false" } : {}),
          limit: 1000,
        },
      });
      setOrders(res.orders);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, statusFilter, vendorFilter, employeeFilter, emirateFilter, confirmedFilter]);

  useEffect(() => {
    apiFetch<Vendor[]>("/vendors").then(setVendors);
    apiFetch<Employee[]>("/employees", { query: { isAgent: "false" } }).then(setEmployees);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSocketEvent("order:changed", load);

  const sorted = useMemo(() => {
    const copy = [...orders];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.date.localeCompare(b.date);
      else if (sortKey === "cnNo") cmp = a.cnNo - b.cnNo;
      else if (sortKey === "total") cmp = a.total - b.total;
      else if (sortKey === "confirmed") cmp = Number(a.bankPaymentConfirmed ?? false) - Number(b.bankPaymentConfirmed ?? false);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [orders, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sortArrow(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  async function toggleConfirmed(order: Order) {
    setSavingId(order.id);
    try {
      const next = !order.bankPaymentConfirmed;
      await apiFetch(`/orders/${order.id}/payment`, { method: "PATCH", body: { payment: "BANK", bankPaymentConfirmed: next } });
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, bankPaymentConfirmed: next } : o)));
    } finally {
      setSavingId(null);
    }
  }

  function clearFilters() {
    setFromDate("");
    setToDate("");
    setStatusFilter("");
    setVendorFilter("");
    setEmployeeFilter("");
    setEmirateFilter("");
    setConfirmedFilter("");
  }

  const totals = useMemo(() => {
    const total = sorted.reduce((s, o) => s + o.total, 0);
    const confirmed = sorted.filter((o) => o.bankPaymentConfirmed);
    const unconfirmed = sorted.filter((o) => !o.bankPaymentConfirmed);
    return {
      count: sorted.length,
      total,
      confirmedCount: confirmed.length,
      confirmedTotal: confirmed.reduce((s, o) => s + o.total, 0),
      unconfirmedCount: unconfirmed.length,
      unconfirmedTotal: unconfirmed.reduce((s, o) => s + o.total, 0),
    };
  }, [sorted]);

  const activeFilterCount = [fromDate, toDate, statusFilter, vendorFilter, employeeFilter, emirateFilter, confirmedFilter].filter(Boolean).length;

  return (
    <AuthGate allow={["SUPER_ADMIN", "MANAGER"]}>
      <div>
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Bank Payments Only</p>
        <h1 className="mb-2 font-display text-3xl font-semibold text-navy">Bank Ledger</h1>
        <p className="mb-6 max-w-2xl text-sm text-ink-soft">
          Every consignment paid via Bank, in one place — sort, filter, and track which ones still need the driver
          or admin to confirm the transfer actually landed.
        </p>

        <div className="mb-6 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
          <div className="bg-white p-4">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Total Bank Orders</div>
            <div className="font-display text-xl font-semibold text-navy">{totals.count}</div>
          </div>
          <div className="bg-white p-4">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Total Amount</div>
            <div className="font-display text-xl font-semibold text-navy">{fmtNumber(totals.total)} AED</div>
          </div>
          <div className="border border-delivered bg-delivered/5 p-4">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-delivered">✓ Confirmed</div>
            <div className="font-display text-xl font-semibold text-delivered">
              {totals.confirmedCount} <span className="text-sm font-normal">({fmtNumber(totals.confirmedTotal)} AED)</span>
            </div>
          </div>
          <div className="border border-cancelled bg-cancelled-bg p-4">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-cancelled">⚠ Unconfirmed</div>
            <div className="font-display text-xl font-semibold text-cancelled">
              {totals.unconfirmedCount} <span className="text-sm font-normal">({fmtNumber(totals.unconfirmedTotal)} AED)</span>
            </div>
          </div>
        </div>

        <div className="mb-6 border border-line bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">From</label>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded border border-line px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">To</label>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded border border-line px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded border border-line px-2.5 py-1.5 text-sm">
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Vendor</label>
              <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="rounded border border-line px-2.5 py-1.5 text-sm">
                <option value="">All vendors</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Employee</label>
              <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} className="rounded border border-line px-2.5 py-1.5 text-sm">
                <option value="">All employees</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Emirate</label>
              <select value={emirateFilter} onChange={(e) => setEmirateFilter(e.target.value)} className="rounded border border-line px-2.5 py-1.5 text-sm">
                <option value="">All emirates</option>
                {EMIRATES.map((em) => (
                  <option key={em} value={em}>
                    {em}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Receipt Status</label>
              <select
                value={confirmedFilter}
                onChange={(e) => setConfirmedFilter(e.target.value as "" | "yes" | "no")}
                className="rounded border border-line px-2.5 py-1.5 text-sm"
              >
                <option value="">All</option>
                <option value="yes">✓ Confirmed only</option>
                <option value="no">⚠ Unconfirmed only</option>
              </select>
            </div>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="mt-5 rounded border border-cancelled px-3 py-1.5 font-mono text-xs uppercase text-cancelled hover:bg-cancelled-bg">
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="border border-line bg-white p-5">
          <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
            {sorted.length} bank consignment{sorted.length === 1 ? "" : "s"}
          </h2>

          {loading ? (
            <p className="py-8 text-center text-sm text-ink-soft">Loading…</p>
          ) : sorted.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-soft">No bank consignments match these filters.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort("date")}>
                      Date{sortArrow("date")}
                    </th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort("cnNo")}>
                      CN No.{sortArrow("cnNo")}
                    </th>
                    <th>Vendor</th>
                    <th className="cursor-pointer select-none text-right" onClick={() => toggleSort("total")}>
                      Total{sortArrow("total")}
                    </th>
                    <th>Emirate</th>
                    <th>Employee</th>
                    <th>Status</th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort("confirmed")}>
                      Receipt{sortArrow("confirmed")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((o) => (
                    <tr key={o.id}>
                      <td>{o.date.slice(0, 10)}</td>
                      <td className="font-mono">{o.cnNo}</td>
                      <td>{o.brandName}</td>
                      <td className="text-right font-mono">{fmtNumber(o.total)}</td>
                      <td>{o.emirate}</td>
                      <td>{o.employee.name}</td>
                      <td>
                        <span className={`stamp ${o.status.toLowerCase()}`}>{o.status}</span>
                      </td>
                      <td>
                        <button
                          onClick={() => toggleConfirmed(o)}
                          disabled={savingId === o.id}
                          className={`rounded px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide disabled:opacity-50 ${
                            o.bankPaymentConfirmed ? "bg-delivered text-white hover:opacity-90" : "bg-cancelled text-white hover:opacity-90"
                          }`}
                        >
                          {savingId === o.id ? "…" : o.bankPaymentConfirmed ? "✓ Confirmed" : "⚠ Unconfirmed"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AuthGate>
  );
}
