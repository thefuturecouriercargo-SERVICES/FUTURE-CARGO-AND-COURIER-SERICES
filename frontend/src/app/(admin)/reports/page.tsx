"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, reportExportUrl } from "@/lib/api";
import { Employee, EMIRATES, PAYMENTS, STATUSES, Vendor } from "@/types";
import { fmtDate } from "@/lib/format";

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
  resolved?: string;
}

interface PreviewData {
  filterSummary: string;
  rangeCount: number;
  carriedCount: number;
  statusCounts?: Record<string, number>;
  rows: PreviewRow[];
  truncated: boolean;
  totalRows: number;
  sumTotal: number;
  sumDl: number;
  sumCancelled: number;
  balance: number;
}

interface HistoryItem {
  from: string;
  to: string;
  format: string;
  rows: number;
  exportedAt: string;
}

interface VendorHistory {
  history: HistoryItem[];
  last: HistoryItem | null;
  suggestion: { from: string; to: string } | null;
  upToDate: boolean;
  yesterday: string;
}

type Filters = { from: string; to: string; employeeId: string; vendorId: string; payment: string; emirate: string };
const EMPTY: Filters = { from: "", to: "", employeeId: "", vendorId: "", payment: "", emirate: "" };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_META: Record<string, { label: string; dot: string; badge: string; bar: string }> = {
  PENDING: { label: "Pending", dot: "bg-pending", badge: "bg-pending-bg text-pending", bar: "#f5b544" },
  DELIVERED: { label: "Delivered", dot: "bg-delivered", badge: "bg-delivered-bg text-delivered", bar: "#34d399" },
  TRANSFER: { label: "Transfer", dot: "bg-transferred", badge: "bg-transferred-bg text-transferred", bar: "#60a5fa" },
  CANCELLED: { label: "Cancelled", dot: "bg-cancelled", badge: "bg-cancelled-bg text-cancelled", bar: "#f87171" },
};

// Calendar helpers on plain "YYYY-MM-DD" strings, Dubai time.
function dubaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
}
function shift(s: string, days: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
function nice(s: string): string {
  const [, m, d] = s.split("-").map(Number);
  return `${d} ${MON[m - 1]}`;
}
function span(a: string, b: string): string {
  return a === b ? nice(a) : `${nice(a)} – ${nice(b)}`;
}
function dayCount(a: string, b: string): number {
  const p = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((p(b) - p(a)) / 86400000) + 1;
}
function fmtNumber(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

const PRESETS: { id: string; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yest", label: "Yesterday" },
  { id: "week", label: "Last 7 days" },
  { id: "month", label: "This month" },
  { id: "lmonth", label: "Last month" },
];

function presetRange(id: string): [string, string] {
  const t = dubaiToday();
  const [y, m] = t.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (id === "today") return [t, t];
  if (id === "yest") return [shift(t, -1), shift(t, -1)];
  if (id === "week") return [shift(t, -7), shift(t, -1)];
  if (id === "month") return [`${y}-${pad(m)}-01`, t];
  if (id === "lmonth") {
    const firstThis = `${y}-${pad(m)}-01`;
    const lastPrev = shift(firstThis, -1);
    return [`${lastPrev.slice(0, 7)}-01`, lastPrev];
  }
  return ["", ""];
}

function pill(on: boolean) {
  return `rb-lift inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] ${
    on ? "border-brass bg-brass/15 text-brass-light" : "border-line text-ink-soft hover:border-ink-soft/50 hover:text-ink"
  }`;
}

export default function ReportsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [preset, setPreset] = useState("");
  const [flash, setFlash] = useState(0);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [vh, setVh] = useState<VendorHistory | null>(null);
  const [shown, setShown] = useState(0);
  const [exporting, setExporting] = useState<null | { format: string; pct: number }>(null);
  const [doneNote, setDoneNote] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    apiFetch<Employee[]>("/employees", { query: { isAgent: "false" } }).then(setEmployees);
    apiFetch<Vendor[]>("/vendors").then(setVendors);
  }, []);

  // Live preview: refresh shortly after any filter change — only once something
  // is selected, so the page never lists every CN in the system.
  const hasSelection = Object.values(filters).some(Boolean) || statuses.length > 0;
  useEffect(() => {
    const id = ++reqId.current;
    if (!hasSelection) {
      setPreview(null);
      setPreviewError(null);
      setLoadingPreview(false);
      return;
    }
    setLoadingPreview(true);
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch<PreviewData>("/reports/preview", { query: { ...filters, status: statuses.join(",") } });
        if (id === reqId.current) {
          setPreview(res);
          setPreviewError(null);
        }
      } catch {
        if (id === reqId.current) setPreviewError("Failed to load preview.");
      } finally {
        if (id === reqId.current) setLoadingPreview(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [filters, statuses, hasSelection]);

  function loadHistory(vendorId: string) {
    if (!vendorId) {
      setVh(null);
      return;
    }
    apiFetch<VendorHistory>("/reports/vendor-history", { query: { vendorId } })
      .then(setVh)
      .catch(() => setVh(null));
  }
  useEffect(() => loadHistory(filters.vendorId), [filters.vendorId]);

  // Count-up animation for the matching row count.
  const target = preview?.totalRows ?? 0;
  const shownRef = useRef(0);
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const step = () => {
      const s = shownRef.current;
      if (s === target) {
        rafRef.current = null;
        return;
      }
      const next = s + Math.ceil(Math.abs(target - s) / 7) * Math.sign(target - s);
      shownRef.current = next;
      setShown(next);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  function set<K extends keyof Filters>(key: K, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    if (key === "from" || key === "to") setPreset("");
  }

  function applyRange(from: string, to: string, id: string) {
    setFilters((f) => ({ ...f, from, to }));
    setPreset(id);
    setFlash((x) => (x === 1 ? 2 : 1));
  }

  function toggleStatus(s: string) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function clearFilters() {
    setFilters(EMPTY);
    setStatuses([]);
    setPreset("");
  }

  function exportReport(format: "excel" | "pdf") {
    if (exporting) return;
    const url = reportExportUrl({ ...filters, status: statuses.join(","), format });
    window.open(url, "_blank");
    setDoneNote(null);
    setExporting({ format, pct: 0 });
    let pct = 0;
    const iv = setInterval(() => {
      pct = Math.min(100, pct + 6 + Math.random() * 12);
      setExporting({ format, pct });
      if (pct >= 100) {
        clearInterval(iv);
        const vName = vendors.find((v) => v.id === filters.vendorId)?.name;
        const range = filters.from && filters.to ? span(filters.from, filters.to) : "all dates";
        setDoneNote(`${vName ? vName + " · " : ""}${range} · ${format === "pdf" ? "PDF" : "Excel"}`);
        setExporting(null);
        setPreset("");
        const vid = filters.vendorId;
        loadHistory(vid);
        setTimeout(() => loadHistory(vid), 4000);
        setTimeout(() => setDoneNote(null), 3500);
      }
    }, 90);
  }

  const vendor = vendors.find((v) => v.id === filters.vendorId) ?? null;
  const suggestion = vh?.suggestion ?? null;
  const presets = suggestion ? [...PRESETS, { id: "since", label: "Since last report" }] : PRESETS;
  const empName = employees.find((e) => e.id === filters.employeeId)?.name;

  const chips: { label: string; remove: () => void }[] = [];
  if (vendor) chips.push({ label: vendor.name, remove: () => set("vendorId", "") });
  if (empName) chips.push({ label: empName, remove: () => set("employeeId", "") });
  if (filters.payment) chips.push({ label: filters.payment, remove: () => set("payment", "") });
  if (filters.emirate) chips.push({ label: filters.emirate, remove: () => set("emirate", "") });
  if (filters.from || filters.to)
    chips.push({
      label: `${filters.from ? nice(filters.from) : "…"} – ${filters.to ? nice(filters.to) : "…"}`,
      remove: () => {
        setFilters((f) => ({ ...f, from: "", to: "" }));
        setPreset("");
      },
    });
  statuses.forEach((s) => chips.push({ label: STATUS_META[s]?.label ?? s, remove: () => toggleStatus(s) }));

  const rangeNote =
    filters.from && filters.to ? (filters.to < filters.from ? "End date is before start" : `${dayCount(filters.from, filters.to)} days selected`) : "";

  const counts = preview?.statusCounts ?? {};
  const mixTotal = STATUSES.reduce((a, s) => a + (counts[s] ?? 0), 0);
  const dateCls = flash === 1 ? "rb-flash-a" : flash === 2 ? "rb-flash-b" : "";
  const fieldCls = "h-11 w-full rounded-[10px] border border-line px-3 text-sm";
  const capCls = "mb-2 block font-mono text-[10px] uppercase tracking-[0.1em] text-ink-soft";

  return (
    <div>
      <header className="rb-fade-up mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Reports</p>
          <h1 className="font-display text-[26px] font-semibold tracking-tight text-navy md:text-[30px]">Report Builder</h1>
        </div>
        <div className="flex items-center gap-3 text-[13px] text-ink-soft">
          <span className={`h-2 w-2 rounded-full ${chips.length ? "bg-brass" : "bg-delivered"}`} />
          <span>{chips.length ? `${chips.length} filter${chips.length > 1 ? "s" : ""} active` : "No filters — exports everything"}</span>
          <button onClick={clearFilters} className="rb-lift h-10 rounded-[10px] border border-line px-4 text-[13px] text-ink hover:border-ink-soft/50">
            Reset
          </button>
        </div>
      </header>

      <section className="rb-fade-up rb-d1 flex flex-col gap-4 rounded-2xl border border-line bg-white p-5">
        <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="min-w-0">
            <span className={capCls}>Vendor</span>
            <select value={filters.vendorId} onChange={(e) => set("vendorId", e.target.value)} className={`${fieldCls} ${vendor ? "!border-brass" : ""}`}>
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className={capCls}>Employee</span>
            <select value={filters.employeeId} onChange={(e) => set("employeeId", e.target.value)} className={fieldCls}>
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className={capCls}>Payment mode</span>
            <select value={filters.payment} onChange={(e) => set("payment", e.target.value)} className={fieldCls}>
              <option value="">All methods</option>
              {PAYMENTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className={capCls}>Emirate</span>
            <select value={filters.emirate} onChange={(e) => set("emirate", e.target.value)} className={fieldCls}>
              <option value="">All emirates</option>
              {EMIRATES.map((em) => (
                <option key={em} value={em}>
                  {em}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className={capCls}>From date</span>
            <input type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} className={`${fieldCls} !px-2 ${dateCls}`} />
          </label>
          <label className="min-w-0">
            <span className={capCls}>To date</span>
            <input type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} className={`${fieldCls} !px-2 ${dateCls}`} />
          </label>
        </div>

        <div className="flex flex-wrap items-stretch gap-x-6 gap-y-4 border-t border-line pt-4">
          <div className="flex min-w-0 flex-[999_1_520px] flex-col justify-center gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-14 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-soft">Quick</span>
              {presets.map((p) => (
                <button
                  key={p.id}
                  aria-pressed={preset === p.id}
                  onClick={() => (p.id === "since" && suggestion ? applyRange(suggestion.from, suggestion.to, "since") : applyRange(...presetRange(p.id), p.id))}
                  className={pill(preset === p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Status" className="flex flex-wrap items-center gap-2">
              <span className="w-14 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-soft">Status</span>
              {STATUSES.map((s) => (
                <button key={s} aria-pressed={statuses.includes(s)} onClick={() => toggleStatus(s)} className={pill(statuses.includes(s))}>
                  <span className={`h-2 w-2 rounded-full ${STATUS_META[s]?.dot}`} />
                  {STATUS_META[s]?.label ?? s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex w-full max-w-[420px] flex-[1_1_340px] flex-col gap-2.5 rounded-xl border border-line bg-paper px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex items-baseline gap-1.5">
                <span className={`font-display text-[26px] font-bold tabular-nums tracking-tight text-ink ${loadingPreview ? "opacity-60" : ""}`}>
                  {shown.toLocaleString("en-US")}
                </span>
                <span className="text-xs text-ink-soft">
                  consignments{preview && preview.carriedCount > 0 ? ` · ${preview.carriedCount} carried` : ""}
                </span>
              </span>
              <span className="text-xs text-ink-soft">
                Balance <strong className="text-ink">{preview ? fmtNumber(preview.balance) : "—"}</strong>
              </span>
            </div>
            <div className="flex h-1 overflow-hidden rounded-full bg-line">
              {STATUSES.map((s) => (
                <span
                  key={s}
                  title={`${STATUS_META[s]?.label}: ${counts[s] ?? 0}`}
                  className="h-full transition-[width] duration-500"
                  style={{ width: `${mixTotal ? ((counts[s] ?? 0) / mixTotal) * 100 : 0}%`, background: STATUS_META[s]?.bar }}
                />
              ))}
            </div>
            {exporting ? (
              <div className="flex h-10 flex-col justify-center gap-2">
                <div className="flex justify-between text-xs text-ink">
                  <span>Preparing {exporting.format === "pdf" ? "PDF" : "Excel"}…</span>
                  <span className="tabular-nums">{Math.round(exporting.pct)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="rb-bar h-full rounded-full transition-[width] duration-100" style={{ width: `${exporting.pct}%` }} />
                </div>
              </div>
            ) : doneNote ? (
              <div className="rb-fade-up flex h-10 items-center gap-2.5 rounded-[10px] border border-delivered/30 bg-delivered-bg px-2.5">
                <span className="rb-pop flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-delivered">
                  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#06281c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                </span>
                <span className="min-w-0 truncate text-xs text-ink">
                  <strong>Downloaded</strong> <span className="text-ink-soft">· {doneNote}</span>
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => exportReport("excel")} className="rb-lift flex h-10 items-center justify-center gap-2 rounded-[10px] bg-navy text-[13px] font-semibold text-paper hover:bg-navy-2">
                  <DownloadIcon /> Excel
                </button>
                <button onClick={() => exportReport("pdf")} className="rb-lift flex h-10 items-center justify-center gap-2 rounded-[10px] border border-line text-[13px] font-semibold text-ink hover:border-ink-soft/50">
                  <DownloadIcon /> PDF
                </button>
              </div>
            )}
          </div>
        </div>

        {vendor && vh && (
          <div key={vendor.id} className="rb-fade-up flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-xl border border-brass/30 bg-brass/[0.06] px-4 py-3.5">
            <div className="flex min-w-0 flex-[1_1_360px] items-center gap-3.5">
              <span className="rb-pop flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-brass/15">
                <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brass-light">
                  <path d="M9 18h6" />
                  <path d="M10 22h4" />
                  <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
                </svg>
              </span>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                {vh.last ? (
                  <span className="text-[13px] text-ink-soft">
                    Last report · <strong className="text-brass-light">{span(vh.last.from, vh.last.to)}</strong>
                  </span>
                ) : (
                  <span className="text-[13px] text-ink-soft">No earlier report saved for {vendor.name} — from your next export, the next range will be suggested here.</span>
                )}
                {suggestion && (
                  <span className="text-base font-semibold text-ink">
                    Suggested: {span(suggestion.from, suggestion.to)}{" "}
                    <span className="text-[13px] font-normal text-ink-soft">· {dayCount(suggestion.from, suggestion.to)} days, ends yesterday</span>
                  </span>
                )}
                {vh.upToDate && <span className="text-base font-semibold text-delivered">Up to date — reported through yesterday</span>}
              </div>
            </div>
            {suggestion && (
              <button
                onClick={() => applyRange(suggestion.from, suggestion.to, "since")}
                className="rb-lift rb-glow inline-flex h-[42px] items-center gap-2 rounded-[10px] bg-navy px-4 text-sm font-semibold text-paper hover:bg-navy-2"
              >
                {preset === "since" ? "Range applied" : "Use this range"}
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </button>
            )}
          </div>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((c) => (
              <span key={c.label} className="rb-fade-up inline-flex h-[30px] items-center gap-0.5 rounded-full bg-paper-2 pl-3 pr-1 text-xs text-ink">
                {c.label}
                <button aria-label={`Remove ${c.label}`} onClick={c.remove} className="flex h-6 w-6 items-center justify-center rounded-full text-ink-soft hover:text-ink">
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </span>
            ))}
            {rangeNote && <span className="ml-1 text-xs text-ink-soft">{rangeNote}</span>}
          </div>
        )}
      </section>

      {previewError && <p className="mt-4 text-sm text-cancelled">{previewError}</p>}

      <div className="mt-5 flex flex-wrap items-start gap-5">
        <section className="rb-fade-up rb-d2 min-w-0 flex-[999_1_600px] overflow-hidden rounded-2xl border border-line bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 className="font-display text-[15px] font-semibold text-navy">
              Preview
              {preview && <span className="ml-2 text-xs font-normal text-ink-soft">{preview.filterSummary}</span>}
            </h2>
            <span className="font-mono text-xs text-ink-soft">
              {preview ? `${preview.totalRows} row${preview.totalRows === 1 ? "" : "s"}` : hasSelection ? "…" : "—"}
              {preview && preview.carriedCount > 0 && ` (${preview.rangeCount} in range + ${preview.carriedCount} carried forward)`}
            </span>
          </div>

          {preview && (
            <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
              {[
                ["Total", fmtNumber(preview.sumTotal), "text-ink"],
                ["Cancelled", fmtNumber(preview.sumCancelled), "text-ink"],
                ["DL Charge", fmtNumber(preview.sumDl), "text-ink"],
                ["Balance", fmtNumber(preview.balance), "text-brass"],
              ].map(([l, v, c]) => (
                <div key={l} className="bg-white px-5 py-3">
                  <div className="mb-1 font-mono text-[10px] uppercase text-ink-soft">{l}</div>
                  <div className={`font-display text-lg font-semibold tabular-nums ${c}`}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {preview?.truncated && (
            <p className="px-5 pt-3 text-xs text-ink-soft">Showing the first 500 of {preview.totalRows} rows — the export includes all of them.</p>
          )}

          {!hasSelection && (
            <div className="rb-fade-up px-5 py-14 text-center">
              <p className="text-sm font-semibold text-ink">Pick a vendor, date or filter to see its CNs</p>
              <p className="mt-1 text-xs text-ink-soft">Only the consignments matching your selection are shown here.</p>
            </div>
          )}

          {hasSelection && (
          <div className={`table-scroll transition-opacity ${loadingPreview ? "opacity-60" : ""}`}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>CN No</th>
                  <th>Vendor</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">DL Charge</th>
                  <th>Payment</th>
                  <th>Emirate</th>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Delivered / Cancelled</th>
                </tr>
              </thead>
              <tbody>
                {preview?.rows.map((r, i) => (
                  <tr key={`${r.cnNo}-${i}`}>
                    <td>{fmtDate(r.date)}</td>
                    <td className="font-mono">{r.cnNo}</td>
                    <td>{r.brand}</td>
                    <td className="text-right font-mono">{fmtNumber(r.total)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.dl)}</td>
                    <td>{r.payment}</td>
                    <td>{r.emirate}</td>
                    <td>{r.employee}</td>
                    <td>
                      <span className={`rounded-full px-2.5 py-1 text-xs ${STATUS_META[r.status]?.badge ?? ""}`}>{STATUS_META[r.status]?.label ?? r.status}</span>
                    </td>
                    <td className="font-mono text-xs">{r.resolved || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {preview && preview.rows.length === 0 && <div className="rb-fade-up px-5 py-12 text-center text-sm text-ink-soft">No consignments match these filters.</div>}
        </section>

        {vendor && vh && (
          <aside key={vendor.id} className="rb-fade-up flex w-full max-w-[340px] flex-[1_1_300px] flex-col gap-3.5 rounded-2xl border border-line bg-white p-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-soft">{vendor.name} · History</span>
            {vh.history.length === 0 && <span className="text-[13px] text-ink-soft">Nothing exported for this vendor yet.</span>}
            {vh.history.map((h, i) => (
              <div key={`${h.from}-${h.to}`} className="flex items-start gap-3">
                <span
                  className={`mt-[5px] h-2.5 w-2.5 flex-none rounded-full ${i === 0 ? "bg-brass shadow-[0_0_0_4px_rgba(212,175,90,0.18)]" : "border-2 border-line"}`}
                />
                <span className="flex flex-col gap-0.5 text-[13px]">
                  <strong className="text-sm text-ink">{span(h.from, h.to)}</strong>
                  <span className="text-ink-soft">
                    {dayCount(h.from, h.to)} days · {h.rows} rows · {h.format === "pdf" ? "PDF" : "Excel"} ·{" "}
                    {new Date(h.exportedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dubai" })}
                  </span>
                </span>
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
