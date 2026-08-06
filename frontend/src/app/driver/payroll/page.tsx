"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, currentMonthStr } from "@/lib/format";

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
  const [month, setMonth] = useState(currentMonthStr());
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
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">My Payroll</p>
          <h1 className="font-display text-2xl font-semibold text-navy">Payroll Statement</h1>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border border-line px-3 py-2 text-sm"
        />
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
            <table className="data-table">
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
            </table>
          </div>

          <div className="border border-line bg-white p-5">
            <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
              Entry Log — {month}
            </h2>
            <table className="data-table">
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
            </table>
          </div>
        </>
      )}
    </div>
  );
}
