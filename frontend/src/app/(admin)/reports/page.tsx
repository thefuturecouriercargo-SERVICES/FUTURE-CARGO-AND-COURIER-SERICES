"use client";

import { useEffect, useState } from "react";
import { apiFetch, reportExportUrl } from "@/lib/api";
import { Employee, EMIRATES, PAYMENTS, STATUSES, Vendor } from "@/types";

export default function ReportsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    employeeId: "",
    vendorId: "",
    status: "",
    payment: "",
    emirate: "",
  });

  useEffect(() => {
    apiFetch<Employee[]>("/employees").then(setEmployees);
    apiFetch<Vendor[]>("/vendors").then(setVendors);
  }, []);

  function set<K extends keyof typeof filters>(key: K, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function exportReport(format: "excel" | "pdf") {
    const url = reportExportUrl({ ...filters, format });
    window.open(url, "_blank");
  }

  return (
    <div>
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Reports</p>
      <h1 className="mb-6 font-display text-3xl font-semibold text-navy">Report Builder</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-soft">
        Filter by any combination of date range, employee, vendor, status, payment mode, or emirate, then export to
        Excel or PDF.
      </p>

      <div className="border border-line bg-white p-6">
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">From date</label>
            <input type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} className="w-full rounded border border-line px-2.5 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">To date</label>
            <input type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} className="w-full rounded border border-line px-2.5 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Employee</label>
            <select value={filters.employeeId} onChange={(e) => set("employeeId", e.target.value)} className="w-full rounded border border-line px-2.5 py-2 text-sm">
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Vendor</label>
            <select value={filters.vendorId} onChange={(e) => set("vendorId", e.target.value)} className="w-full rounded border border-line px-2.5 py-2 text-sm">
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Status</label>
            <select value={filters.status} onChange={(e) => set("status", e.target.value)} className="w-full rounded border border-line px-2.5 py-2 text-sm">
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Payment mode</label>
            <select value={filters.payment} onChange={(e) => set("payment", e.target.value)} className="w-full rounded border border-line px-2.5 py-2 text-sm">
              <option value="">All methods</option>
              {PAYMENTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Emirate</label>
            <select value={filters.emirate} onChange={(e) => set("emirate", e.target.value)} className="w-full rounded border border-line px-2.5 py-2 text-sm">
              <option value="">All emirates</option>
              {EMIRATES.map((em) => (
                <option key={em} value={em}>
                  {em}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => exportReport("excel")} className="rounded bg-navy px-5 py-2.5 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2">
            Export Excel
          </button>
          <button onClick={() => exportReport("pdf")} className="rounded border border-navy px-5 py-2.5 font-mono text-xs uppercase tracking-wide text-navy hover:bg-paper-2">
            Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}
