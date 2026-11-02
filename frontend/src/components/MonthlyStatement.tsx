"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, cashStatementUrl } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";

interface StatementMonth {
  month: string;
  revenue: number;
  deliveredCount: number;
  expenses: number;
  expenseCategories: { category: string; amount: number }[];
  profit: number;
  workingDays: number;
  dailyRate: number;
  costEdited: boolean;
  dailyCost: number;
  netForMonth: number;
  openingCash: number;
  closingCash: number;
  isCurrent: boolean;
}
interface StatementData {
  months: StatementMonth[];
  manual: { amount: number };
}

const monthLong = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};
const signed = (n: number) => (n < 0 ? `−${fmtNumber(Math.abs(n))}` : fmtNumber(n));

/**
 * Monthly P&L statement — the first thing on the P&L page, made to be shared
 * with officials. Each month: revenue − expenses − daily cost = net, and the
 * cash in hand at the end of that month (opening + net). Manual entry counts
 * as the opening balance of the first month.
 */
export default function MonthlyStatement() {
  const [data, setData] = useState<StatementData | null>(null);
  const [selected, setSelected] = useState<string>("");

  const load = useCallback(async () => {
    const d = await apiFetch<StatementData>("/cash-in-hand/statement");
    setData(d);
    setSelected((cur) => {
      if (cur && d.months.some((m) => m.month === cur)) return cur;
      // Default to the last completed month — that's the one to send to officials.
      const done = d.months.filter((m) => !m.isCurrent);
      return (done[done.length - 1] ?? d.months[d.months.length - 1])?.month ?? "";
    });
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    const onChange = () => load().catch(() => undefined);
    window.addEventListener("cash-in-hand-changed", onChange);
    return () => window.removeEventListener("cash-in-hand-changed", onChange);
  }, [load]);

  if (!data) {
    return (
      <div className="mb-6 space-y-3 border border-line bg-white p-5" role="status" aria-label="Loading">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (data.months.length === 0) return null;

  const m = data.months.find((x) => x.month === selected) ?? data.months[data.months.length - 1];
  const btn = "rounded border border-line bg-white px-3 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass hover:text-navy";

  const Line = ({ label, value, strong, indent, tone }: { label: string; value: string; strong?: boolean; indent?: boolean; tone?: "good" | "bad" | "soft" }) => (
    <div className={`flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 ${strong ? "font-semibold text-navy" : ""} ${indent ? "pl-9 text-[13px]" : ""}`}>
      <span className={tone === "soft" ? "text-ink-soft" : ""}>{label}</span>
      <span className={`font-mono ${tone === "good" ? "text-delivered" : tone === "bad" ? "text-cancelled" : tone === "soft" ? "text-ink-soft" : ""}`}>{value}</span>
    </div>
  );

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[20px] font-semibold text-navy md:text-[22px]">Monthly Statement</h2>
          <p className="text-xs text-ink-soft">Profit &amp; loss of each month with cash in hand at month end · amounts in AED</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={m.month}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded border border-line bg-white px-2.5 py-2 text-sm"
            aria-label="Month"
          >
            {[...data.months].reverse().map((x) => (
              <option key={x.month} value={x.month}>
                {monthLong(x.month)}
                {x.isCurrent ? " (to date)" : ""}
              </option>
            ))}
          </select>
          <a href={cashStatementUrl({ month: m.month, format: "pdf" })} target="_blank" rel="noopener noreferrer" className={btn}>
            PDF · {monthLong(m.month).split(" ")[0]}
          </a>
          <a href={cashStatementUrl({ format: "pdf" })} target="_blank" rel="noopener noreferrer" className={btn}>
            PDF · All months
          </a>
          <a href={cashStatementUrl({ format: "excel" })} target="_blank" rel="noopener noreferrer" className={btn}>
            Excel
          </a>
        </div>
      </div>

      {/* Selected month — the statement itself */}
      <div className="mb-5 border border-brass/50 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 bg-navy px-4 py-3">
          <span className="font-display text-[17px] font-semibold text-white">{monthLong(m.month)}</span>
          {m.isCurrent && <span className="font-mono text-[10px] uppercase tracking-widest text-brass-light">Month to date · not final</span>}
        </div>
        <Line label="Opening cash (start of month)" value={signed(m.openingCash)} tone="soft" />
        <Line label={`Revenue — delivery charges (${fmtNumber(m.deliveredCount)} delivered)`} value={signed(m.revenue)} strong />
        <Line label="Less: Expenses" value={signed(-m.expenses)} strong />
        {m.expenseCategories.length === 0 ? (
          <Line label="No expenses recorded" value="0" indent tone="soft" />
        ) : (
          m.expenseCategories.map((c) => <Line key={c.category} label={c.category} value={fmtNumber(c.amount)} indent tone="soft" />)
        )}
        <Line label="Gross profit" value={signed(m.profit)} strong />
        <Line
          label={`Less: Daily cost (${m.costEdited ? "fixed amount" : `${m.workingDays} working days × ${fmtNumber(m.dailyRate)}`})`}
          value={signed(-m.dailyCost)}
        />
        <Line label="Net for the month" value={signed(m.netForMonth)} strong tone={m.netForMonth >= 0 ? "good" : "bad"} />
        <div className="flex flex-wrap items-baseline justify-between gap-3 bg-brass px-4 py-3.5 text-white">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em]">
            {m.isCurrent ? "Cash in hand (as of today)" : "Cash in hand at month end"}
          </span>
          <span className="font-display text-[22px] font-semibold">{signed(m.closingCash)} AED</span>
        </div>
      </div>

      {/* Every month at a glance */}
      <div className="border border-line bg-white p-5">
        <h3 className="mb-3 border-b border-line pb-2.5 font-display text-[16px] font-semibold text-navy">All Months</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Opening</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Expenses</th>
                <th className="text-right">Daily Cost</th>
                <th className="text-right">Net</th>
                <th className="text-right">Cash in Hand</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((r) => (
                <tr
                  key={r.month}
                  onClick={() => setSelected(r.month)}
                  className={`cursor-pointer hover:bg-paper-2 ${r.month === m.month ? "bg-brass/5" : ""}`}
                >
                  <td>
                    {monthLong(r.month)}
                    {r.isCurrent && <span className="ml-1.5 font-mono text-[10px] uppercase text-ink-soft">to date</span>}
                  </td>
                  <td className="text-right font-mono text-ink-soft">{signed(r.openingCash)}</td>
                  <td className="text-right font-mono">{signed(r.revenue)}</td>
                  <td className="text-right font-mono">{signed(r.expenses)}</td>
                  <td className="text-right font-mono">{signed(r.dailyCost)}</td>
                  <td className={`text-right font-mono ${r.netForMonth >= 0 ? "text-delivered" : "text-cancelled"}`}>{signed(r.netForMonth)}</td>
                  <td className="text-right font-mono font-semibold text-navy">{signed(r.closingCash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.manual.amount !== 0 && (
          <p className="mt-2 text-[11px] text-ink-soft">
            Manual entry of {signed(data.manual.amount)} AED is counted as opening cash for {monthLong(data.months[0].month)}.
          </p>
        )}
      </div>
    </section>
  );
}
