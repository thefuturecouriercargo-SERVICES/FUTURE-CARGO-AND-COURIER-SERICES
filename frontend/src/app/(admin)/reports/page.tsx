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
    payment: "",
    emirate: "",
  });
  const [statuses, setStatuses] = useState<string[]>([]);

  useEffect(() => {
    apiFetch<Employee[]>("/employees", { query: { isAgent: "false" } }).then(setEmployees);
    apiFetch<Vendor[]>("/vendors").then(setVendors);
  }, []);

  function set<K extends keyof typeof filters>(key: K, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function toggleStatus(s: string) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function clearFilters() {
    setFilters({ from: "", to: "", employeeId: "", vendorId: "", payment: "", emirate: "" });
    setStatuses([]);
  }

  const activeFilters = [...Object.entries(filters).filter(([, v]) => v), ...(statuses.length > 0 ? [["status", statuses.join(", ")]] : [])];

  function exportReport(format: "excel" | "pdf") {
    const url = reportExportUrl({ ...filters, status: statuses.join(","), format });
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
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 rounded border border-line px-2.5 py-2">
              {STATUSES.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={statuses.includes(s)} onChange={() => toggleStatus(s)} />
                  {s}
                </label>
              ))}
            </div>
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

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => exportReport("excel")} className="rounded bg-navy px-5 py-2.5 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2">
            Export Excel
          </button>
          <button onClick={() => exportReport("pdf")} className="rounded border border-navy px-5 py-2.5 font-mono text-xs uppercase tracking-wide text-navy hover:bg-paper-2">
            Export PDF
          </button>
          {activeFilters.length > 0 && (
            <button onClick={clearFilters} className="rounded border border-cancelled px-4 py-2.5 font-mono text-xs uppercase tracking-wide text-cancelled hover:bg-cancelled-bg">
              Clear all filters
            </button>
          )}
        </div>

        {activeFilters.length > 0 ? (
          <p className="mt-4 text-xs text-ink-soft">
            <span className="font-semibold text-navy">Active filters:</span>{" "}
            {activeFilters.map(([k, v]) => `${k}=${v}`).join(", ")}
          </p>
        ) : (
          <p className="mt-4 text-xs text-ink-soft">No filters active — this will export everything.</p>
        )}
      </div>
    </div>
  );
}
