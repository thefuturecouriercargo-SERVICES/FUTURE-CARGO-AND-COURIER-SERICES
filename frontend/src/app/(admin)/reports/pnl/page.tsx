"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch, pnlExportUrl } from "@/lib/api";

interface PnlData {
  revenue: number;
  totalExpenses: number;
  netProfit: number;
  deliveredCount: number;
  categoryBreakdown: { category: string; amount: number }[];
  topCategory: { category: string; amount: number } | null;
}

interface ExpenseDetail {
  id: string;
  date: string;
  amount: number;
  remarks: string | null;
  employeeName: string | null;
  source: string;
}

function dubaiNow() {
  return new Date(Date.now() + 4 * 60 * 60 * 1000);
}

function monthRangeDefaults() {
  const now = dubaiNow();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  return { from, to };
}

function lastMonthRange() {
  const now = dubaiNow();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null; // null = "new", can't express as a %
  return ((curr - prev) / Math.abs(prev)) * 100;
}

export default function PnlPage() {
  const [from, setFrom] = useState(monthRangeDefaults().from);
  const [to, setTo] = useState(monthRangeDefaults().to);
  const [data, setData] = useState<PnlData | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expenseDetails, setExpenseDetails] = useState<ExpenseDetail[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Month-over-month comparison — always this calendar month vs. last calendar
  // month, independent of whatever custom From/To range is selected above.
  const [thisMonthData, setThisMonthData] = useState<PnlData | null>(null);
  const [lastMonthData, setLastMonthData] = useState<PnlData | null>(null);

  const load = useCallback(async () => {
    setData(await apiFetch<PnlData>("/reports/pnl", { query: { from, to } }));
  }, [from, to]);

  const loadComparison = useCallback(async () => {
    const thisMonth = monthRangeDefaults();
    const lastMonth = lastMonthRange();
    const [thisRes, lastRes] = await Promise.all([
      apiFetch<PnlData>("/reports/pnl", { query: thisMonth }),
      apiFetch<PnlData>("/reports/pnl", { query: lastMonth }),
    ]);
    setThisMonthData(thisRes);
    setLastMonthData(lastRes);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadComparison();
  }, [loadComparison]);

  async function toggleCategory(category: string) {
    if (expandedCategory === category) {
      setExpandedCategory(null);
      return;
    }
    setExpandedCategory(category);
    setLoadingDetails(true);
    try {
      const res = await apiFetch<{ expenses: ExpenseDetail[] }>("/reports/pnl/expenses", { query: { from, to, category } });
      setExpenseDetails(res.expenses);
    } finally {
      setLoadingDetails(false);
    }
  }

 function setThisMonth() {
    const d = monthRangeDefaults();
    setFrom(d.from);
    setTo(d.to);
  }

  function setLastMonth() {
    const now = dubaiNow();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
  }

  return (
    <div>
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Reports</p>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold text-navy">Profit &amp; Loss</h1>
        <div className="flex gap-2">
          <a
            href={pnlExportUrl({ from, to, format: "pdf" })}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-line bg-white px-3 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass hover:text-navy"
          >
            Download PDF
          </a>
          <a
            href={pnlExportUrl({ from, to, format: "excel" })}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-line bg-white px-3 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass hover:text-navy"
          >
            Download Excel
          </a>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-3 border border-line bg-white p-5">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-line px-2.5 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-line px-2.5 py-2 text-sm" />
        </div>
        <button onClick={setThisMonth} className="rounded border border-line px-3 py-2 text-xs uppercase tracking-wide text-ink-soft hover:border-brass">
          This month
        </button>
        <button onClick={setLastMonth} className="rounded border border-line px-3 py-2 text-xs uppercase tracking-wide text-ink-soft hover:border-brass">
          Last month
        </button>
      </div>

      {data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Revenue (DL Charges)</div>
              <div className="font-display text-xl font-semibold text-navy">{data.revenue} AED</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Total Expenses</div>
              <div className="font-display text-xl font-semibold text-navy">{data.totalExpenses} AED</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Net Profit</div>
              <div className={`font-display text-xl font-semibold ${data.netProfit >= 0 ? "text-navy" : "text-cancelled"}`}>
                {data.netProfit} AED
              </div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Delivered Orders</div>
              <div className="font-display text-xl font-semibold text-navy">{data.deliveredCount}</div>
            </div>
          </div>

          {data.topCategory && (
            <div className="mb-6 border border-brass/40 bg-paper-2 px-4 py-3">
              <span className="font-mono text-xs uppercase tracking-wide text-ink-soft">Biggest expense category: </span>
              <span className="font-display text-lg font-semibold text-navy">
                {data.topCategory.category} — {data.topCategory.amount} AED
              </span>
            </div>
          )}

          {thisMonthData && lastMonthData && (
            <div className="mb-6 border border-line bg-white p-5">
              <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
                This Month vs. Last Month
              </h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th className="text-right">This Month</th>
                    <th className="text-right">Last Month</th>
                    <th className="text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      { label: "Revenue (DL Charges)", key: "revenue" as const, goodIfUp: true },
                      { label: "Total Expenses", key: "totalExpenses" as const, goodIfUp: false },
                      { label: "Net Profit", key: "netProfit" as const, goodIfUp: true },
                      { label: "Delivered Orders", key: "deliveredCount" as const, goodIfUp: true },
                    ] as const
                  ).map((row) => {
                    const curr = thisMonthData[row.key];
                    const prev = lastMonthData[row.key];
                    const change = pctChange(curr, prev);
                    const isGood = change === null ? null : row.goodIfUp ? change >= 0 : change <= 0;
                    return (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td className="text-right font-mono">{curr}</td>
                        <td className="text-right font-mono">{prev}</td>
                        <td className={`text-right font-mono font-semibold ${isGood === null ? "text-ink-soft" : isGood ? "text-delivered" : "text-cancelled"}`}>
                          {change === null ? "New" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <h3 className="mb-2 mt-5 font-mono text-[11px] uppercase tracking-wide text-ink-soft">By Category</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="text-right">This Month</th>
                    <th className="text-right">Last Month</th>
                    <th className="text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(new Set([...thisMonthData.categoryBreakdown.map((c) => c.category), ...lastMonthData.categoryBreakdown.map((c) => c.category)]))
                    .sort()
                    .map((category) => {
                      const curr = thisMonthData.categoryBreakdown.find((c) => c.category === category)?.amount ?? 0;
                      const prev = lastMonthData.categoryBreakdown.find((c) => c.category === category)?.amount ?? 0;
                      const change = pctChange(curr, prev);
                      const isGood = change === null ? null : change <= 0;
                      return (
                        <tr key={category}>
                          <td>{category}</td>
                          <td className="text-right font-mono">{curr}</td>
                          <td className="text-right font-mono">{prev}</td>
                          <td className={`text-right font-mono font-semibold ${isGood === null ? "text-ink-soft" : isGood ? "text-delivered" : "text-cancelled"}`}>
                            {change === null ? "New" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          <div className="border border-line bg-white p-5">
            <h2 className="mb-1 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
              Expense Breakdown by Category
            </h2>
            <p className="mb-3 text-xs text-ink-soft">Click any category to see the individual entries behind its total.</p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="text-right">Amount (AED)</th>
                  <th className="text-right">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {data.categoryBreakdown.map((c) => (
                  <Fragment key={c.category}>
                    <tr
                      onClick={() => toggleCategory(c.category)}
                      className={`cursor-pointer hover:bg-paper-2 ${expandedCategory === c.category ? "bg-brass/5" : ""}`}
                    >
                      <td>
                        <span className="mr-1.5 inline-block w-3 text-brass">{expandedCategory === c.category ? "▾" : "▸"}</span>
                        {c.category}
                      </td>
                      <td className="text-right font-mono">{c.amount}</td>
                      <td className="text-right font-mono">
                        {data.totalExpenses > 0 ? ((c.amount / data.totalExpenses) * 100).toFixed(1) : "0.0"}%
                      </td>
                    </tr>
                    {expandedCategory === c.category && (
                      <tr>
                        <td colSpan={3} className="bg-paper-2 p-0">
                          {loadingDetails ? (
                            <p className="px-4 py-3 text-sm text-ink-soft">Loading…</p>
                          ) : expenseDetails.length === 0 ? (
                            <p className="px-4 py-3 text-sm text-ink-soft">No individual entries found.</p>
                          ) : (
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>Date</th>
                                  <th className="text-right">Amount</th>
                                  <th>Employee</th>
                                  <th>Source</th>
                                  <th>Note</th>
                                </tr>
                              </thead>
                              <tbody>
                                {expenseDetails.map((d) => (
                                  <tr key={d.id}>
                                    <td>{d.date}</td>
                                    <td className="text-right font-mono">{d.amount}</td>
                                    <td>{d.employeeName ?? "—"}</td>
                                    <td className="font-mono text-xs">{d.source}</td>
                                    <td className="text-ink-soft">{d.remarks ?? "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
