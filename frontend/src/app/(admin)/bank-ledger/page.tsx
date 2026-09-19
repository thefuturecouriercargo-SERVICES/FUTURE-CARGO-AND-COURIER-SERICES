"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { apiFetch } from "@/lib/api";
import { addDays, fmtNumber, todayStr } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { Employee, EMIRATES, Order, STATUSES, Vendor } from "@/types";

type SortKey = "cnNo" | "total" | "confirmed";
type SortDir = "asc" | "desc";

export default function BankLedgerPage() {
  const [date, setDate] = useState(todayStr());
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [statusFilter, setStatusFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [emirateFilter, setEmirateFilter] = useState("");
  const [confirmedFilter, setConfirmedFilter] = useState<"" | "yes" | "no">("");
  const [sortKey, setSortKey] = useState<SortKey>("confirmed");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ orders: Order[] }>("/orders", {
        query: {
          payment: "BANK",
          date,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(vendorFilter ? { vendorId: vendorFilter } : {}),
          ...(employeeFilter ? { employeeId: employeeFilter } : {}),
          ...(emirateFilter ? { emirate: emirateFilter } : {}),
          ...(confirmedFilter ? { bankPaymentConfirmed: confirmedFilter === "yes" ? "true" : "false" } : {}),
          limit: 500,
        },
      });
      setOrders(res.orders);
      setSelectedIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [date, statusFilter, vendorFilter, employeeFilter, emirateFilter, confirmedFilter]);

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
      if (sortKey === "cnNo") cmp = a.cnNo - b.cnNo;
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
    const next = !order.bankPaymentConfirmed;
    await apiFetch(`/orders/${order.id}/payment`, { method: "PATCH", body: { payment: "BANK", bankPaymentConfirmed: next } });
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, bankPaymentConfirmed: next } : o)));
  }

  function toggleSelectAll() {
    if (selectedIds.size === sorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map((o) => o.id)));
    }
  }

  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkSetConfirmed(confirmed: boolean) {
    setBulkSaving(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => apiFetch(`/orders/${id}/payment`, { method: "PATCH", body: { payment: "BANK", bankPaymentConfirmed: confirmed } }))
      );
      await load();
    } finally {
      setBulkSaving(false);
    }
  }

  function clearFilters() {
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

  const activeFilterCount = [statusFilter, vendorFilter, employeeFilter, emirateFilter, confirmedFilter].filter(Boolean).length;

  return (
    <AuthGate allow={["SUPER_ADMIN", "MANAGER"]}>
      <div>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Bank Payments Only</p>
            <h1 className="font-display text-3xl font-semibold text-navy">Bank Ledger</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDate(addDays(date, -1))} className="rounded border border-line bg-white px-2.5 py-1.5 text-xs hover:border-brass">
              ← Prev
            </button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-line px-2.5 py-1.5 text-sm" />
            <button onClick={() => setDate(addDays(date, 1))} className="rounded border border-line bg-white px-2.5 py-1.5 text-xs hover:border-brass">
              Next →
            </button>
            <button onClick={() => setDate(todayStr())} className="rounded bg-navy px-2.5 py-1.5 font-mono text-xs uppercase text-paper hover:bg-navy-2">
              Today
            </button>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
          <div className="bg-white p-4">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Bank Orders — {date}</div>
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

        {selectedIds.size > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2.5 border border-brass bg-brass/10 px-3 py-2.5">
            <span className="font-mono text-xs uppercase text-ink">{selectedIds.size} selected</span>
            <button
              onClick={() => bulkSetConfirmed(true)}
              disabled={bulkSaving}
              className="rounded bg-delivered px-4 py-2 font-mono text-xs uppercase tracking-wide text-white hover:opacity-90 disabled:opacity-60"
            >
              {bulkSaving ? "Saving…" : "✓ Confirm Selected"}
            </button>
            <button
              onClick={() => bulkSetConfirmed(false)}
              disabled={bulkSaving}
              className="rounded border border-cancelled px-4 py-2 font-mono text-xs uppercase tracking-wide text-cancelled hover:bg-cancelled-bg disabled:opacity-60"
            >
              ⚠ Mark Unconfirmed
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="rounded border border-line px-3 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass"
            >
              Clear selection
            </button>
          </div>
        )}

        <div className="border border-line bg-white p-5">
          <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
            {sorted.length} bank consignment{sorted.length === 1 ? "" : "s"} on {date}
          </h2>

          {loading ? (
            <p className="py-8 text-center text-sm text-ink-soft">Loading…</p>
          ) : sorted.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-soft">No bank consignments for this date.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-8">
                      <input type="checkbox" checked={selectedIds.size === sorted.length && sorted.length > 0} onChange={toggleSelectAll} />
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
                    <tr key={o.id} className={selectedIds.has(o.id) ? "bg-brass/5" : ""}>
                      <td>
                        <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelectOne(o.id)} />
                      </td>
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
                          className={`rounded px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide hover:opacity-90 ${
                            o.bankPaymentConfirmed ? "bg-delivered text-white" : "bg-cancelled text-white"
                          }`}
                        >
                          {o.bankPaymentConfirmed ? "✓ Confirmed" : "⚠ Unconfirmed"}
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
