"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { apiFetch, ApiClientError } from "@/lib/api";

const CATEGORIES = [
  "FUEL","INSURANCE","SALARY","WORKSHOP","CAR_WASH","ROOM_RENT","CAR_RENT",
  "STATIONARY","PARKING","VISA","MEDICAL","COMMISSION","OTHER","DARB",
  "SALIK","INTERNET","LICENSE",
];
interface ExpenseEntry {
  id: string;
  date: string;
  category: string;
  amount: number;
  remarks?: string | null;
  source: string;
  employee?: { id: string; name: string } | null;
}
interface Employee {
  id: string;
  name: string;
}

function dubaiToday(): string {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

const emptyForm = { date: dubaiToday(), category: CATEGORIES[0], amount: "", remarks: "", employeeId: "" };
export default function ExpensesPage() {
 const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
 const load = useCallback(async () => {
    setEntries(await apiFetch<ExpenseEntry[]>("/expenses"));
  }, []);

  useEffect(() => {
    apiFetch<Employee[]>("/employees", { query: { isAgent: "false" } }).then(setEmployees);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiFetch("/expenses", {
        method: "POST",
       body: { date: form.date, category: form.category, amount: Number(form.amount), remarks: form.remarks || undefined, employeeId: form.employeeId || undefined },
      });
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save expense");
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(entry: ExpenseEntry) {
    if (!confirm(`Remove this ${entry.category} expense?`)) return;
    await apiFetch(`/expenses/${entry.id}`, { method: "DELETE" });
    await load();
  }

  const total = entries.reduce((sum, e) => sum + e.amount, 0);

 return (
    <AuthGate allow={["SUPER_ADMIN"]}>
    <div>
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Settings</p>
      <h1 className="mb-6 font-display text-3xl font-semibold text-navy">Expense Ledger</h1>

      <div className="mb-6 border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-[17px] font-semibold text-navy">Add Expense</h2>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Driver (optional)</label>
          <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="rounded border border-line px-2.5 py-2 text-sm">
            <option value="">None (company expense)</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.name}</option>
            ))}
          </select>
        </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Category</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="rounded border border-line px-2.5 py-2 text-sm">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Amount (AED)</label>
            <input required type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="rounded border border-line px-2.5 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Remarks</label>
            <input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className="rounded border border-line px-2.5 py-2 text-sm" />
          </div>
          <button type="submit" disabled={saving} className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60">
            {saving ? "Saving…" : "Add expense"}
          </button>
          {error && <span className="text-xs text-cancelled">{error}</span>}
        </form>
      </div>

      <div className="border border-line bg-white p-5">
        <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
          Entries ({entries.length}) · Total {total} AED
        </h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th className="text-right">Amount (AED)</th>
              <th>Source</th>
              <th>Driver</th>
              <th>Remarks</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.date.slice(0, 10)}</td>
                <td>{e.category}</td>
                <td className="text-right font-mono">{e.amount}</td>
                <td>{e.source}</td>
                <td>{e.employee?.name ?? "-"}</td>
                <td>{e.remarks ?? "-"}</td>
                <td className="whitespace-nowrap">
                  <button onClick={() => removeEntry(e)} className="text-xs text-cancelled hover:underline">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
     </div>
    </div>
    </AuthGate>
  );
}
