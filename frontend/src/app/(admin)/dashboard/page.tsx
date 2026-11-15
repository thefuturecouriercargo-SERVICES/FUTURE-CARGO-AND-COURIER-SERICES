"use client";

import { useCallback, useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch, employeePerformancePdfUrl } from "@/lib/api";
import { addDays, fmtNumber, todayStr, fmtDayDate, fmtDate, fmtDateTime } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";

// Minimal typing for the Web Speech API (not in default TS lib).
interface SpeechRecognitionResultLike {
  transcript: string;
}
interface SpeechRecognitionEventLike {
  results: { [key: number]: { [key: number]: SpeechRecognitionResultLike } };
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function useVoiceSearch(onResult: (digits: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);

  function start() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const digits = transcript.replace(/\D/g, "");
      if (digits) onResult(digits);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  return { listening, supported, start };
}
import KpiCard, { ACCENTS } from "@/components/KpiCard";
import KpiFocusRow from "@/components/KpiFocusRow";
import StatusStamp from "@/components/StatusStamp";
import DeliveryStatusRing from "@/components/charts/DeliveryStatusRing";
import EmployeeLeaderboard from "@/components/EmployeeLeaderboard";
import AdminRace from "@/components/AdminRace";
import LiveFlowPanel from "@/components/LiveFlowPanel";
import BarChart from "@/components/charts/BarChart";
import { Order, OrderStatus, Summary, Vendor } from "@/types";

import { DashboardSkeleton, PageSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import ShareReportButton from "@/components/ShareReportButton";
import ManagerReminder from "@/components/ManagerReminder";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
interface DailyResponse {
  date: string;
  summary: Summary;
employeeBreakdown: ({ employee: { id: string; name: string } } & Summary & { totalExpenses: number; otherDeduction: number; otherDeductionEntries: { id: string; amount: number }[]; cashBalance: number })[];
  agentBreakdown: ({ employee: { id: string; name: string } } & Summary & { totalExpenses: number; otherDeduction: number; otherDeductionEntries: { id: string; amount: number }[]; cashBalance: number })[];
  vendorBreakdown: ({ vendor: { id: string; name: string } } & Summary)[];
  emirateBreakdown: ({ emirate: string } & Summary)[];
  paymentBreakdown: ({ method: string } & Summary)[];
  orders: Order[];
}

export default function DailyDashboardPage() {
  const [date, setDate] = useState(todayStr());
  // On desktop, Today + Share sit as two small boxes in the top header bar.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const pick = () => setHeaderSlot(mq.matches ? document.getElementById("shell-actions") : null);
    pick();
    mq.addEventListener("change", pick);
    return () => mq.removeEventListener("change", pick);
  }, []);
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingCarryover, setPendingCarryover] = useState<Order[]>([]);
  const [search, setSearch] = useState("");
  const [newEntriesMonth, setNewEntriesMonth] = useState(() => todayStr().slice(0, 7));
  const [newEntriesRows, setNewEntriesRows] = useState<{ date: string; vendorId: string; vendorName: string; count: number; totalAmount: number }[]>([]);
  const [loadingNewEntries, setLoadingNewEntries] = useState(false);
  const voiceSearch = useVoiceSearch((digits) => setSearch(digits));
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
      // Carryover backlog should reflect what was still unresolved as of the date being
      // viewed — not always today's live backlog — so historical dates stay accurate.
      const carryoverRes = await apiFetch<{ orders: Order[] }>("/orders/pending-carryover", {
        query: { date: useRange ? toDate : date },
      });
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

  // Previous 6 days' summaries, for the KPI "vs yesterday" chips and 7-day lines.
  // Cached per date so moving between days only fetches what's new.
  const historyCache = useRef(new Map<string, Summary>());
  const [history, setHistory] = useState<{ date: string; summary: Summary }[]>([]);
  useEffect(() => {
    if (useRange) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    const days = Array.from({ length: 6 }, (_, i) => addDays(date, -(6 - i)));
    Promise.all(
      days.map(async (d) => {
        const hit = historyCache.current.get(d);
        if (hit) return { date: d, summary: hit };
        const r = await apiFetch<DailyResponse>("/dashboard/daily", { query: { date: d } });
        historyCache.current.set(d, r.summary);
        return { date: d, summary: r.summary };
      })
    )
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [date, useRange]);
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
  useLiveRefresh(load, { socket: false });

  const loadNewEntries = useCallback(async () => {
    setLoadingNewEntries(true);
    try {
      const res = await apiFetch<{ rows: typeof newEntriesRows }>("/vendor-credit/new-entries", { query: { month: newEntriesMonth } });
      setNewEntriesRows(res.rows);
    } finally {
      setLoadingNewEntries(false);
    }
  }, [newEntriesMonth]);


  // Records before the shown day (personal bests, team best days) for the share image.
  const [records, setRecords] = useState<{ driverBest: { employeeId: string; value: number }[]; teamBest: number; teamBestMonth: number; teamTop: number[] } | null>(null);
  useEffect(() => {
    if (useRange) { setRecords(null); return; }
    let alive = true;
    apiFetch<NonNullable<typeof records>>("/dashboard/records", { query: { date } })
      .then((r) => { if (alive) setRecords(r); })
      .catch(() => { if (alive) setRecords(null); });
    return () => { alive = false; };
  }, [date, useRange]);

  const employeeRows = data?.employeeBreakdown ?? [];

  // Agent IDs, so we can exclude their carryover from every top-level total below —
  // the Dashboard (including its top summary) intentionally shows drivers only.
  const agentIdSet = new Set((data?.agentBreakdown ?? []).map((r) => r.employee.id));
  const nonAgentPendingCarryover = pendingCarryover.filter((o) => !agentIdSet.has(o.employeeId));

  // One row per driver, shared by the live race and the Employee-wise table.
  const leaderRows = employeeRows.map((r) => {
    const empPending = r.pending + pendingCarryover.filter((o) => o.employeeId === r.employee.id).length;
    return {
      id: r.employee.id,
      name: r.employee.name,
      delivered: r.delivered,
      pending: empPending,
      cancelled: r.cancelled,
      transferred: r.transferred,
      total: r.delivered + empPending + r.transferred + r.cancelled,
    };
  });
  // Sum of each driver's own attributed pending (their own carryover included) —
  // used for the TOTAL row so it matches the sum of the rows actually shown, instead
  // of the company-wide pending figure (which also includes agents' carryover).
  const employeePendingTotal = employeeRows.reduce(
    (s, r) => s + r.pending + pendingCarryover.filter((o) => o.employeeId === r.employee.id).length,
    0
  );

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

const todayButton = (
  <button
    onClick={() => setDate(todayStr())}
    className={headerSlot ? "h-9 rounded-xl bg-navy px-3 text-xs font-semibold text-paper hover:bg-navy-2" : "touch-target rounded-xl bg-navy px-4 text-sm font-semibold text-paper hover:bg-navy-2"}
  >
    Today
  </button>
);
const shareButton = data ? (
  <ShareReportButton
      iconOnly={!!headerSlot}
              date={useRange ? `${fromDate} → ${toDate}` : date}
              drivers={leaderRows}
              orders={data.orders}
              agents={(data.agentBreakdown ?? []).map((a) => ({ name: a.employee.name, count: a.totalOrders }))}
              records={records}
              delivered={data.summary.delivered}
              pending={data.summary.pending + nonAgentPendingCarryover.length}
              transferred={data.summary.transferred}
              cancelled={data.summary.cancelled}
            />
) : null;

return (
          <div>
            {/* Phone view (layout 9): title, then one compact date row; Today / range / share sit under the KPI cards. */}
            <div className="mb-4 md:hidden">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Manifest Summary</p>
              <h1 className="font-display text-[24px] font-semibold tracking-tight text-navy">DASHBOARD</h1>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-line bg-white p-1.5">
                <button onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-ink-soft hover:border-brass">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
                </button>
                <label className="relative flex flex-1 cursor-pointer flex-col items-center leading-tight">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-soft">
                    {useRange ? "Date range" : new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long" })}
                  </span>
                  <span className="text-[15px] font-semibold uppercase text-brass">
                    {useRange ? `${fmtDate(fromDate)} – ${fmtDate(toDate)}` : fmtDate(date)}
                  </span>
                  {!useRange && (
                    <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick date" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  )}
                </label>
                <button onClick={() => setDate(addDays(date, 1))} aria-label="Next day" className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-ink-soft hover:border-brass">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                </button>
              </div>
            </div>
            <div className="mb-6 hidden md:grid md:grid-cols-[1fr_auto_1fr] md:items-end md:justify-between md:gap-4">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Manifest Summary</p>
          <h1 className="inline-flex items-center gap-2 font-display text-[26px] font-semibold tracking-tight text-navy md:text-[32px]">
            DASHBOARD
          </h1>
       </div>
          <div id="date-nav" className="flex flex-wrap items-center gap-2">
            <button onClick={() => setDate(addDays(date, -1))} className="touch-target rounded-xl border border-line bg-white px-3.5 text-sm hover:border-brass">
            ← Prev
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-line px-3 py-2 text-sm"
          />
          <button onClick={() => setDate(addDays(date, 1))} className="touch-target rounded-xl border border-line bg-white px-3.5 text-sm hover:border-brass">
            Next →
          </button>
          {headerSlot && createPortal(<>{todayButton}<ManagerReminder compact />{shareButton}</>, headerSlot)}
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-self-end">
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
        <DashboardSkeleton />
      ) : data ? (
        <>
          {(() => {
            const pendingAll = data.summary.pending + nonAgentPendingCarryover.length;
            const total = data.summary.delivered + pendingAll + data.summary.transferred + data.summary.cancelled;
            const pct = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}% of consignments` : "—");
            const sales = Number(data.summary.totalSales) || 0;
            const dl = Number(data.summary.totalDeliveryCharge) || 0;
            const hasHistory = !useRange && history.length === 6;
            const prev = hasHistory ? history[5].summary : null;
            const series = (pick: (x: Summary) => number) => (hasHistory ? [...history.map((h) => Number(pick(h.summary)) || 0), Number(pick(data.summary)) || 0] : undefined);
            const diff = (pick: (x: Summary) => number) => (prev ? (Number(pick(data.summary)) || 0) - (Number(pick(prev)) || 0) : null);
            return (
              <KpiFocusRow
                gridClassName="stagger mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-3.5"
                items={[
                  { key: "Total Sales", color: ACCENTS.gold, node: <KpiCard label="Total Sales" value={sales} unit="AED" accent="gold" sub="Delivered value" delta={diff((x) => x.totalSales)} spark={series((x) => x.totalSales)} /> },
                  { key: "DL Charge", color: ACCENTS.violet, node: <KpiCard label="DL Charge" value={dl} unit="AED" accent="violet" sub={sales > 0 ? `${((dl / sales) * 100).toFixed(1)}% of sales` : "—"} delta={diff((x) => x.totalDeliveryCharge)} spark={series((x) => x.totalDeliveryCharge)} /> },
                  { key: "Delivered", color: ACCENTS.delivered, node: <KpiCard label="Delivered" value={data.summary.delivered} accent="delivered" sub={pct(data.summary.delivered)} delta={diff((x) => x.delivered)} spark={series((x) => x.delivered)} /> },
                  { key: "Pending", color: ACCENTS.pending, node: <KpiCard label="Pending" value={pendingAll} accent="pending" sub={pct(pendingAll)} /> },
                  { key: "Transfer", color: ACCENTS.transferred, node: <KpiCard label="Transfer" value={data.summary.transferred} accent="transferred" sub={pct(data.summary.transferred)} delta={diff((x) => x.transferred)} upIsGood={false} spark={series((x) => x.transferred)} /> },
                  { key: "Cancelled", color: ACCENTS.cancelled, node: <KpiCard label="Cancelled" value={data.summary.cancelled} accent="cancelled" sub={pct(data.summary.cancelled)} delta={diff((x) => x.cancelled)} upIsGood={false} spark={series((x) => x.cancelled)} /> },
                  { key: "Total Consignments", color: ACCENTS.neutral, node: <KpiCard label="Total Consignments" value={total} accent="neutral" sub="All statuses" /> },
                  // Phone view only: Today / date range / WhatsApp share in a box beside Total Consignments.
                  ...(!headerSlot
                    ? [{
                        key: "Quick Actions",
                        color: ACCENTS.gold,
                        node: (
                          <div className="flex h-full flex-col rounded-2xl border border-line bg-white p-4">
                            <div className="mb-2.5 flex items-center gap-2">
                              <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: ACCENTS.gold }} aria-hidden />
                              <span className="text-[11px] font-medium uppercase leading-tight tracking-[0.12em] text-ink-soft">Quick Actions</span>
                            </div>
                            <div className="flex flex-1 flex-col gap-2">
                              <button onClick={() => { setUseRange(false); setDate(todayStr()); }} className="min-h-[44px] flex-1 rounded-xl bg-navy text-sm font-semibold uppercase text-paper hover:bg-navy-2">
                                Today
                              </button>
                              <div className="flex min-h-[44px] flex-1 gap-2">
                                <button
                                  onClick={() => setUseRange(!useRange)}
                                  aria-label="Use date range"
                                  title="Use date range"
                                  className={`flex flex-1 items-center justify-center rounded-xl border ${useRange ? "border-brass bg-brass/15 text-brass" : "border-line text-ink-soft hover:border-brass"}`}
                                >
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M16 3v4M8 3v4M4 11h16M8 15h3" /></svg>
                                </button>
                                <div className="flex-1">
                                  <ShareReportButton
                                    whatsapp
                                    date={useRange ? `${fromDate} → ${toDate}` : date}
                                    drivers={leaderRows}
                                    orders={data.orders}
                                    agents={(data.agentBreakdown ?? []).map((a) => ({ name: a.employee.name, count: a.totalOrders }))}
              records={records}
                                    delivered={data.summary.delivered}
                                    pending={pendingAll}
                                    transferred={data.summary.transferred}
                                    cancelled={data.summary.cancelled}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        ),
                      }]
                    : []),
                ]}
              />
            );
          })()}

          {!headerSlot && (
            <div className="-mt-3 mb-6 flex flex-col gap-2 empty:hidden md:hidden">
              {useRange && (
                <div className="flex items-center gap-2">
                  <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-sm" />
                  <span className="text-xs uppercase text-ink-soft">to</span>
                  <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-sm" />
                </div>
              )}
              <ManagerReminder />
            </div>
          )}

          <LiveFlowPanel
            pending={data.summary.pending + nonAgentPendingCarryover.length}
            transferred={data.summary.transferred}
            delivered={data.summary.delivered}
            cancelled={data.summary.cancelled}
            totalConsignments={
              data.summary.delivered + data.summary.pending + nonAgentPendingCarryover.length + data.summary.transferred + data.summary.cancelled
            }
          />

          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_1fr]">
           <div className="border border-line bg-white p-5">
              <div className="mb-3 flex items-center justify-between border-b border-line pb-2.5">
                <h2 className="font-display text-[18px] font-semibold text-navy">
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
              <AdminRace rows={leaderRows} live={!useRange && date === todayStr()} />
              <EmployeeLeaderboard
                rows={leaderRows}
                totals={{
                  delivered: employeeRows.reduce((s, r) => s + r.delivered, 0),
                  pending: employeePendingTotal,
                  cancelled: employeeRows.reduce((s, r) => s + r.cancelled, 0),
                  transferred: employeeRows.reduce((s, r) => s + r.transferred, 0),
                  total:
                    employeeRows.reduce((s, r) => s + r.delivered, 0) +
                    employeePendingTotal +
                    employeeRows.reduce((s, r) => s + r.transferred, 0) +
                    employeeRows.reduce((s, r) => s + r.cancelled, 0),
                }}
              />
            </div>
            <div className="border border-line bg-white p-5">
              <h2 className="mb-5 border-b border-line pb-2.5 font-display text-[18px] font-semibold text-navy">Delivery Status</h2>
              <DeliveryStatusRing
                delivered={data.summary.delivered}
                pending={data.summary.pending + nonAgentPendingCarryover.length}
                transferred={data.summary.transferred}
                cancelled={data.summary.cancelled}
              />
            </div>
          </div>

<div className="mb-5 border border-line bg-white p-5">
            <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[18px] font-semibold text-navy">
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
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[18px] font-semibold text-navy">
         
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
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[18px] font-semibold text-navy">
                Employee Sales (AED)
              </h2>
              <BarChart labels={employeeRows.map((r) => r.employee.name)} data={employeeRows.map((r) => r.totalSales)} />
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[18px] font-semibold text-navy">
                Payment-wise Summary
              </h2>
              <div className="table-wrap"><table className="data-table">
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
              </table></div>
            </div>
            <div className="border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[18px] font-semibold text-navy">
                Emirate-wise Summary
              </h2>
              <div className="table-wrap"><table className="data-table">
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
              </table></div>
            </div>
          </div>

       
        </>
      ) : null}
    </div>
  );
}
