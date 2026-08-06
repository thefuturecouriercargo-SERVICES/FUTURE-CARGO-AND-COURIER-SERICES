"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, currentMonthStr } from "@/lib/format";
import { Employee } from "@/types";

interface PayrollRow {
  id: string;
  month: string;
  employeeId: string;
  workingDays: number;
}

interface PayrollEntry {
  id: string;
  month: string;
  date: string;
  employeeId: string;
  employee: { id: string; name: string };
 type: "PAID" | "SHORT" | "BONUS";
  amount: number;
  note?: string | null;
}

export default function PayrollPage() {
  const [month, setMonth] = useState(currentMonthStr());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrollRows, setPayrollRows] = useState<PayrollRow[]>([]);
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [formEmployeeId, setFormEmployeeId] = useState("");
 const [formType, setFormType] = useState<"PAID" | "SHORT" | "BONUS">("PAID");
  const [formAmount, setFormAmount] = useState("");
  const [formNote, setFormNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [workingDaysInput, setWorkingDaysInput] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [empList, rows, entryList] = await Promise.all([
        apiFetch<Employee[]>("/employees", { query: { includeInactive: false } }),
        apiFetch<PayrollRow[]>("/payroll", { query: { month } }),
        apiFetch<PayrollEntry[]>("/payroll/entries", { query: { month } }),
      ]);
      setEmployees(empList);
      setPayrollRows(rows);
      setEntries(entryList);
      const wd: Record<string, string> = {};
      empList.forEach((e) => {
        const row = rows.find((r) => r.employeeId === e.id);
        wd[e.id] = String(row?.workingDays ?? 30);
      });
      setWorkingDaysInput(wd);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveWorkingDays(employeeId: string) {
    const workingDays = Number(workingDaysInput[employeeId]) || 0;
    await apiFetch("/payroll", {
      method: "POST",
      body: { month, employeeId, workingDays },
    });
    await load();
  }

  async function onSubmitEntry(ev: FormEvent) {
    ev.preventDefault();
    const amount = Number(formAmount);
    if (!formEmployeeId || !amount || amount <= 0) return;
    setSaving(true);
    try {
      await apiFetch("/payroll/entries", {
        method: "POST",
        body: {
          month,
          date: new Date().toISOString().slice(0, 10),
          employeeId: formEmployeeId,
          type: formType,
          amount,
          note: formNote || undefined,
        },
      });
      setFormAmount("");
      setFormNote("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm("Delete this entry?")) return;
    await apiFetch(`/payroll/entries/${id}`, { method: "DELETE" });
    await load();
  }

function sumFor(employeeId: string, type: "PAID" | "SHORT" | "BONUS") {
    return entries.filter((e) => e.employeeId === employeeId && e.type === type).reduce((s, e) => s + e.amount, 0);
  }

  const rows = employees.map((e) => {
    const workingDays = Number(workingDaysInput[e.id]) || 0;
    const proratedSalary = Math.round((e.baseSalary / 30) * workingDays);
   const short = sumFor(e.id, "SHORT");
    const paid = sumFor(e.id, "PAID");
    const bonus = sumFor(e.id, "BONUS");
    const balance = proratedSalary + bonus - short - paid;
    return { employee: e, workingDays, proratedSalary, short, paid, bonus, balance };
  });

  const totals = rows.reduce(
   (acc, r) => ({
      baseSalary: acc.baseSalary + r.employee.baseSalary,
      proratedSalary: acc.proratedSalary + r.proratedSalary,
      short: acc.short + r.short,
      paid: acc.paid + r.paid,
      bonus: acc.bonus + r.bonus,
      balance: acc.balance + r.balance,
    }),
    { baseSalary: 0, proratedSalary: 0, short: 0, paid: 0, bonus: 0, balance: 0 }
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Settings</p>
          <h1 className="font-display text-3xl font-semibold text-navy">Payroll Statement</h1>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border border-line px-3 py-2 text-sm"
        />
      </div>

      <div className="mb-6 border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-[17px] font-semibold text-navy">New Entry</h2>
        <form onSubmit={onSubmitEntry} className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Employee</label>
            <select
              required
              value={formEmployeeId}
              onChange={(e) => setFormEmployeeId(e.target.value)}
              className="w-full rounded border border-line px-2.5 py-2 text-sm"
            >
              <option value="">Select…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Type</label>
            <div className="flex items-center gap-3 rounded border border-line px-2.5 py-2 text-sm">
           <label className="flex items-center gap-1.5">
                <input type="radio" checked={formType === "PAID"} onChange={() => setFormType("PAID")} />
                Paid
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={formType === "SHORT"} onChange={() => setFormType("SHORT")} />
                Short
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={formType === "BONUS"} onChange={() => setFormType("BONUS")} />
                Bonus
              </label>
            </div>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Amount (AED)</label>
            <input
              required
              type="number"
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value)}
              className="w-full rounded border border-line px-2.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Note (optional)</label>
            <input
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              className="w-full rounded border border-line px-2.5 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>

      <div className="mb-6 border border-line bg-white p-5">
        <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
          Payroll Statement — {month}
        </h2>
        {loading ? (
          <p className="py-8 text-center text-sm text-ink-soft">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="text-right">Base Salary</th>
                <th className="text-right">Working Days</th>
                <th className="text-right">Prorated Salary</th>
                <th className="text-right">Short</th>
                <th className="text-right">Bonus</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee.id}>
                  <td>{r.employee.name}</td>
                  <td className="text-right font-mono">{fmtNumber(r.employee.baseSalary)}</td>
                  <td className="text-right font-mono">
                    <div className="flex items-center justify-end gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={31}
                        value={workingDaysInput[r.employee.id] ?? ""}
                        onChange={(e) =>
                          setWorkingDaysInput((prev) => ({ ...prev, [r.employee.id]: e.target.value }))
                        }
                        onBlur={() => saveWorkingDays(r.employee.id)}
                        className="w-14 rounded border border-line px-1.5 py-0.5 text-right text-xs"
                      />
                    </div>
                  </td>
                  <td className="text-right font-mono">{fmtNumber(r.proratedSalary)}</td>
                 <td className="text-right font-mono">{fmtNumber(r.short)}</td>
                  <td className="text-right font-mono">{fmtNumber(r.bonus)}</td>
                  <td className="text-right font-mono">{fmtNumber(r.paid)}</td>
                  <td className="text-right font-mono font-semibold">{fmtNumber(r.balance)}</td>
                </tr>
              ))}
              <tr className="font-semibold border-t-2 border-line">
                <td>TOTAL</td>
                <td className="text-right font-mono">{fmtNumber(totals.baseSalary)}</td>
                <td></td>
                <td className="text-right font-mono">{fmtNumber(totals.proratedSalary)}</td>
                <td className="text-right font-mono">{fmtNumber(totals.short)}</td>
                <td className="text-right font-mono">{fmtNumber(totals.bonus)}</td>
                <td className="text-right font-mono">{fmtNumber(totals.paid)}</td>
                <td className="text-right font-mono">{fmtNumber(totals.balance)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="border border-line bg-white p-5">
        <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
          Entry Log — {month}
        </h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Type</th>
              <th className="text-right">Amount</th>
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-ink-soft">
                  No entries yet.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono">{e.date.slice(0, 10)}</td>
                  <td>{e.employee.name}</td>
                  <td>
                 <span className={`stamp ${e.type === "PAID" ? "delivered" : e.type === "BONUS" ? "pending" : "cancelled"}`}>{e.type}</span>
                  </td>
                  <td className="text-right font-mono">{fmtNumber(e.amount)}</td>
                  <td className="text-ink-soft">{e.note || "—"}</td>
                  <td className="whitespace-nowrap">
                    <button onClick={() => deleteEntry(e.id)} className="text-xs text-cancelled hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
