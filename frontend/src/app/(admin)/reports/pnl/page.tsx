"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface PnlData {
  revenue: number;
  totalExpenses: number;
  netProfit: number;
  deliveredCount: number;
  categoryBreakdown: { category: string; amount: number }[];
  topCategory: { category: string; amount: number } | null;
}

function monthRangeDefaults() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  return { from, to };
}

export default function PnlPage() {
  const [from, setFrom] = useState(monthRangeDefaults().from);
  const [to, setTo] = useState(monthRangeDefaults().to);
  const [data, setData] = useState<PnlData | null>(null);

  const load = useCallback(async () => {
    setData(await apiFetch<PnlData>("/reports/pnl", { query: { from, to } }));
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  function setThisMonth() {
    const d = monthRangeDefaults();
    setFrom(d.from);
    setTo(d.to);
  }

  function setLastMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
  }

  return (
    <div>
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Reports</p>
      <h1 className="mb-6 font-display text-3xl font-semibold text-navy">Profit &amp; Loss</h1>

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

          <div className="border border-line bg-white p-5">
            <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
              Expense Breakdown by Category
            </h2>
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
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td className="text-right font-mono">{c.amount}</td>
                    <td className="text-right font-mono">
                      {data.totalExpenses > 0 ? ((c.amount / data.totalExpenses) * 100).toFixed(1) : "0.0"}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
