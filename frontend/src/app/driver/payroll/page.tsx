"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, previousMonthStr, currentMonthStr } from "@/lib/format";

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const monthLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1] ?? ""} ${ym.slice(0, 4)}`;
function shiftMonth(ym: string, delta: number) {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

interface PayrollEntry {
  id: string;
  date: string;
  type: "PAID" | "SHORT" | "BONUS";
  amount: number;
  note?: string | null;
}

interface DriverPayrollResponse {
  employee: { id: string; name: string; baseSalary: number } | null;
  workingDays: number;
  entries: PayrollEntry[];
}

export default function DriverPayrollPage() {
  const [month, setMonth] = useState(previousMonthStr());
  const [data, setData] = useState<DriverPayrollResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<DriverPayrollResponse>("/driver/payroll", { query: { month } });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const baseSalary = data?.employee?.baseSalary ?? 0;
  const workingDays = data?.workingDays ?? 30;
  const proratedSalary = Math.round((baseSalary / 30) * workingDays);
  const entries = data?.entries ?? [];
  const short = entries.filter((e) => e.type === "SHORT").reduce((s, e) => s + e.amount, 0);
  const paid = entries.filter((e) => e.type === "PAID").reduce((s, e) => s + e.amount, 0);
  const bonus = entries.filter((e) => e.type === "BONUS").reduce((s, e) => s + e.amount, 0);
  const balance = proratedSalary + bonus - short - paid;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-8 pt-1">
      <div className="mb-4 flex items-center justify-between gap-3">
        <button type="button" onClick={() => (window.history.length > 1 ? window.history.back() : (window.location.href = "/driver"))} aria-label="Back" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white active:scale-95">←</button>
        <div className="flex items-center gap-1 rounded-full bg-white px-1 py-1 font-mono shadow-sm ring-1 ring-line">
          <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month" className="grid h-7 w-7 place-items-center rounded-full text-navy active:bg-paper-2">‹</button>
          <span className="min-w-[78px] text-center text-[12px] font-bold uppercase tracking-wide text-navy">{monthLabel(month)}</span>
          <button type="button" disabled={month >= currentMonthStr()} onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month" className="grid h-7 w-7 place-items-center rounded-full text-navy active:bg-paper-2 disabled:opacity-25">›</button>
        </div>
      </div>

      {loading && !data ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Base Salary</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(baseSalary)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Working Days</div>
              <div className="font-display text-xl font-semibold text-navy">{workingDays}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Prorated Salary</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(proratedSalary)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Balance</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(balance)}</div>
            </div>
          </div>

          <div className="mb-6 border border-line bg-white p-5">
            <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
              Summary — {month}
            </h2>
            <div className="table-wrap"><table className="data-table">
              <tbody>
                <tr>
                  <td>Prorated Salary</td>
                  <td className="text-right font-mono">{fmtNumber(proratedSalary)}</td>
                </tr>
                <tr>
                  <td>Bonus</td>
                  <td className="text-right font-mono">+{fmtNumber(bonus)}</td>
                </tr>
                <tr>
                  <td>Short</td>
                  <td className="text-right font-mono">−{fmtNumber(short)}</td>
                </tr>
                <tr>
                  <td>Paid</td>
                  <td className="text-right font-mono">−{fmtNumber(paid)}</td>
                </tr>
                <tr className="font-semibold border-t-2 border-line">
                  <td>Balance</td>
                  <td className="text-right font-mono">{fmtNumber(balance)}</td>
                </tr>
              </tbody>
            </table></div>
          </div>

          <div className="border border-line bg-white p-5">
            <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
              Entry Log — {month}
            </h2>
            <div className="table-wrap"><table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th className="text-right">Amount</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-ink-soft">
                      No entries yet.
                    </td>
                  </tr>
                ) : (
                  entries.map((e) => (
                    <tr key={e.id}>
                      <td className="font-mono">{e.date.slice(0, 10)}</td>
                      <td>
                        <span
                          className={`stamp ${
                            e.type === "PAID" ? "delivered" : e.type === "BONUS" ? "pending" : "cancelled"
                          }`}
                        >
                          {e.type}
                        </span>
                      </td>
                      <td className="text-right font-mono">{fmtNumber(e.amount)}</td>
                      <td className="text-ink-soft">{e.note || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table></div>
          </div>
        </>
      )}
    </div>
  );
}
