"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { apiFetch, ApiClientError, expenseReportUrl } from "@/lib/api";
import { addDays } from "@/lib/format";

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(dubaiToday());
  const [useRange, setUseRange] = useState(false);
  const [fromDate, setFromDate] = useState(dubaiToday());
  const [toDate, setToDate] = useState(dubaiToday());
  const [categoryFilter, setCategoryFilter] = useState("");

 const load = useCallback(async () => {
    setEntries(
      await apiFetch<ExpenseEntry[]>("/expenses", {
        query: useRange
          ? { from: fromDate, to: toDate, category: categoryFilter || undefined }
          : { date, category: categoryFilter || undefined },
      })
    );
  }, [date, useRange, fromDate, toDate, categoryFilter]);

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
      if (editingId) {
        await apiFetch(`/expenses/${editingId}`, {
          method: "PUT",
          body: {
            date: form.date,
            category: form.category,
            amount: Number(form.amount),
            remarks: form.remarks || undefined,
            employeeId: form.employeeId || null,
          },
        });
      } else {
        await apiFetch("/expenses", {
          method: "POST",
         body: { date: form.date, category: form.category, amount: Number(form.amount), remarks: form.remarks || undefined, employeeId: form.employeeId || undefined },
        });
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save expense");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function startEdit(entry: ExpenseEntry) {
    setEditingId(entry.id);
    setForm({
      date: entry.date.slice(0, 10),
      category: entry.category,
      amount: String(entry.amount),
      remarks: entry.remarks ?? "",
      employeeId: entry.employee?.id ?? "",
    });
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold text-navy">Expense Ledger</h1>
        <div className="flex gap-2">
          
            href={expenseReportUrl(
              useRange
                ? { from: fromDate, to: toDate, category: categoryFilter || undefined, format: "pdf" }
                : { from: date, to: date, category: categoryFilter || undefined, format: "pdf" }
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-line bg-white px-3 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass hover:text-navy"
          >
            Download PDF
          </a>
          
            href={expenseReportUrl(
              useRange
                ? { from: fromDate, to: toDate, category: categoryFilter || undefined, format: "excel" }
                : { from: date, to: date, category: categoryFilter || undefined, format: "excel" }
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-line bg-white px-3 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass hover:text-navy"
          >
            Download Excel
          </a>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {!useRange && (
          <>
            <button onClick={() => setDate(addDays(date, -1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
              ← Prev
            </button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-line px-3 py-2 text-sm" />
            <button onClick={() => setDate(addDays(date, 1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
              Next →
            </button>
            <button onClick={() => setDate(dubaiToday())} className="rounded bg-navy px-3 py-2 font-mono text-xs uppercase text-paper hover:bg-navy-2">
              Today
            </button>
          </>
        )}
        <label className="ml-2 flex items-center gap-1.5 font-mono text-[11px] uppercase text-ink-soft">
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
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded border border-line px-2.5 py-2 text-sm">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="mb-6 border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-[17px] font-semibold text-navy">{editingId ? "Edit Expense" : "Add Expense"}</h2>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Date</label>
            <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded border border-line px-2.5 py-2 text-sm" />
          </div>
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
            {saving ? "Saving…" : editingId ? "Save changes" : "Add expense"}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="rounded border border-line px-4 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass">
              Cancel
            </button>
          )}
          {error && <span className="text-xs text-cancelled">{error}</span>}
        </form>
      </div>

      <div className="border border-line bg-white p-5">
        <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
          Entries for {useRange ? `${fromDate} to ${toDate}` : date} ({entries.length}) · Total {total} AED
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
                  <button onClick={() => startEdit(e)} className="mr-2 text-xs text-brass hover:underline">
                    Edit
                  </button>
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
