"use client";

import { useEffect, useState } from "react";
import { apiFetch, reportExportUrl } from "@/lib/api";
import { Employee, EMIRATES, PAYMENTS, STATUSES, Vendor } from "@/types";

interface PreviewRow {
  date: string;
  slNo: number;
  cnNo: number;
  brand: string;
  total: number;
  dl: number;
  payment: string;
  emirate: string;
  employee: string;
  status: string;
}

interface PreviewData {
  filterSummary: string;
  rangeCount: number;
  carriedCount: number;
  rows: PreviewRow[];
  truncated: boolean;
  totalRows: number;
  sumTotal: number;
  sumDl: number;
  sumCancelled: number;
  balance: number;
}

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
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Employee[]>("/employees", { query: { isAgent: "false" } }).then(setEmployees);
    apiFetch<Vendor[]>("/vendors").then(setVendors);
  }, []);

  function set<K extends keyof typeof filters>(key: K, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPreview(null);
  }

  function toggleStatus(s: string) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
    setPreview(null);
  }

  function clearFilters() {
    setFilters({ from: "", to: "", employeeId: "", vendorId: "", payment: "", emirate: "" });
    setStatuses([]);
    setPreview(null);
  }

  const activeFilters = [...Object.entries(filters).filter(([, v]) => v), ...(statuses.length > 0 ? [["status", statuses.join(", ")]] : [])];

  function exportReport(format: "excel" | "pdf") {
    const url = reportExportUrl({ ...filters, status: statuses.join(","), format });
    window.open(url, "_blank");
  }

  async function loadPreview() {
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await apiFetch<PreviewData>("/reports/preview", { query: { ...filters, status: statuses.join(",") } });
      setPreview(res);
    } catch {
      setPreviewError("Failed to load preview.");
    } finally {
      setLoadingPreview(false);
    }
  }

  function fmtNumber(n: number) {
    return Math.round(n).toLocaleString("en-US");
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
          <button onClick={loadPreview} disabled={loadingPreview} className="rounded border border-brass px-5 py-2.5 font-mono text-xs uppercase tracking-wide text-brass hover:bg-brass/10 disabled:opacity-60">
            {loadingPreview ? "Loading…" : "Preview"}
          </button>
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

      {previewError && <p className="mt-4 text-sm text-cancelled">{previewError}</p>}

      {preview && (
        <div className="mt-6 border border-line bg-white p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[17px] font-semibold text-navy">Preview</h2>
            <span className="font-mono text-xs text-ink-soft">
              {preview.totalRows} row{preview.totalRows === 1 ? "" : "s"}
              {preview.carriedCount > 0 && ` (${preview.rangeCount} in range + ${preview.carriedCount} carried forward)`}
            </span>
          </div>
          <p className="mb-4 text-xs font-semibold text-navy">{preview.filterSummary}</p>

          <div className="mb-4 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
            <div className="bg-white p-3">
              <div className="mb-1 font-mono text-[10px] uppercase text-ink-soft">Total</div>
              <div className="font-display text-lg font-semibold text-navy">{fmtNumber(preview.sumTotal)}</div>
            </div>
            <div className="bg-white p-3">
              <div className="mb-1 font-mono text-[10px] uppercase text-ink-soft">Cancelled</div>
              <div className="font-display text-lg font-semibold text-navy">{fmtNumber(preview.sumCancelled)}</div>
            </div>
            <div className="bg-white p-3">
              <div className="mb-1 font-mono text-[10px] uppercase text-ink-soft">DL Charge</div>
              <div className="font-display text-lg font-semibold text-navy">{fmtNumber(preview.sumDl)}</div>
            </div>
            <div className="bg-white p-3">
              <div className="mb-1 font-mono text-[10px] uppercase text-ink-soft">Balance</div>
              <div className="font-display text-lg font-semibold text-brass">{fmtNumber(preview.balance)}</div>
            </div>
          </div>

          {preview.truncated && (
            <p className="mb-3 text-xs text-ink-soft">
              Showing the first 500 of {preview.totalRows} rows — the actual export will include all of them.
            </p>
          )}

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>SL No</th>
                  <th>CN No</th>
                  <th>Vendor</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">DL Charge</th>
                  <th>Payment</th>
                  <th>Emirate</th>
                  <th>Employee</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.date}</td>
                    <td className="font-mono">{r.slNo}</td>
                    <td className="font-mono">{r.cnNo}</td>
                    <td>{r.brand}</td>
                    <td className="text-right font-mono">{fmtNumber(r.total)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.dl)}</td>
                    <td>{r.payment}</td>
                    <td>{r.emirate}</td>
                    <td>{r.employee}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
