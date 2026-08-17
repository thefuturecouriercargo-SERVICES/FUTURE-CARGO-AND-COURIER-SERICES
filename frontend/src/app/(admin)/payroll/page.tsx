"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { useAuth } from "@/context/AuthContext";
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
  const { user } = useAuth();
  const isReadOnly = user?.role === "MANAGER";
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

  const [showAddStaff, setShowAddStaff] = useState(false);
  const [staffForm, setStaffForm] = useState({ name: "", username: "", password: "", baseSalary: "" });
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);

  const [workingDaysInput, setWorkingDaysInput] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [empList, rows, entryList] = await Promise.all([
        apiFetch<Employee[]>("/employees", { query: { includeInactive: false, role: "ALL" } }),
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

  function isStaffRecord(e: Employee) {
    return e.role === "MANAGER" && e.username !== "manager";
  }

  function startEditStaff(e: Employee) {
    setEditingStaffId(e.id);
    setStaffForm({ name: e.name, username: e.username, password: "", baseSalary: String(e.baseSalary ?? "") });
    setShowAddStaff(true);
    setStaffError(null);
  }

  function resetStaffForm() {
    setStaffForm({ name: "", username: "", password: "", baseSalary: "" });
    setEditingStaffId(null);
    setShowAddStaff(false);
    setStaffError(null);
  }

  async function onSubmitStaff(ev: FormEvent) {
    ev.preventDefault();
    setStaffError(null);
    if (editingStaffId) {
      if (!staffForm.name) {
        setStaffError("Please fill in the name.");
        return;
      }
      setStaffSaving(true);
      try {
        await apiFetch(`/employees/${editingStaffId}`, {
          method: "PUT",
          body: {
            name: staffForm.name,
            baseSalary: Number(staffForm.baseSalary) || 0,
            ...(staffForm.password ? { password: staffForm.password } : {}),
          },
        });
        resetStaffForm();
        await load();
      } catch (err) {
        setStaffError(err instanceof Error ? err.message : "Failed to update staff member");
      } finally {
        setStaffSaving(false);
      }
      return;
    }
    if (!staffForm.name || !staffForm.username || !staffForm.password) {
      setStaffError("Please fill in name, username and password.");
      return;
    }
    setStaffSaving(true);
    try {
      await apiFetch("/employees", {
        method: "POST",
        body: {
          name: staffForm.name,
          username: staffForm.username,
          password: staffForm.password,
          baseSalary: Number(staffForm.baseSalary) || 0,
          role: "MANAGER",
        },
      });
      resetStaffForm();
      await load();
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : "Failed to add staff member");
    } finally {
      setStaffSaving(false);
    }
  }

  async function deactivateStaff(e: Employee) {
    if (!confirm(`Remove ${e.name} from payroll? This can be reversed later if needed.`)) return;
    await apiFetch(`/employees/${e.id}`, { method: "DELETE" });
    await load();
    }

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
      short: acc.short + r
      >
                {staffSaving ? "Saving…" : editingStaffId ? "Save changes" : "Add staff member"}
              </button>
              {editingStaffId && (
                <button
                  type="button"
                  onClick={resetStaffForm}
                  className="rounded border border-line px-4 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass"
                >
                  Cancel
                </button>
              )}
              {staffError && <span className="text-xs text-cancelled">{staffError}</span>}
            </div>
          </form>
        </div>
      )}

      {!isReadOnly && (
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
      )}

      <div className="mb-6 border border-line bg-white p-5">
        <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
          Payroll Statement — {month}
        </h2>
       {loading ? (
          <p className="py-8 text-center text-sm text-ink-soft">Loading…</p>
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <div className="space-y-3 md:hidden">
              {rows.map((r) => (
                <div key={r.employee.id} className="rounded border border-line p-3.5">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="font-display text-[15px] font-semibold text-navy">{r.employee.name}</span>
                    <span className="font-mono text-sm font-semibold text-navy">{fmtNumber(r.balance)} AED</span>
                  </div>
                  {!isReadOnly && isStaffRecord(r.employee) && (
                    <div className="mb-2.5 flex gap-3 text-xs">
                      <button type="button" onClick={() => startEditStaff(r.employee)} className="text-brass hover:underline">
                        Edit
                      </button>
                      <button type="button" onClick={() => deactivateStaff(r.employee)} className="text-cancelled hover:underline">
                        Remove
                      </button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Base Salary</span>
                      <span>{fmtNumber(r.employee.baseSalary)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-ink-soft">Working Days</span>
                      <input
                        type="number"
                        min={0}
                        max={31}
                        readOnly={isReadOnly}
                        value={workingDaysInput[r.employee.id] ?? ""}
                        onChange={(e) =>
                          !isReadOnly && setWorkingDaysInput((prev) => ({ ...prev, [r.employee.id]: e.target.value }))
                        }
                        onBlur={() => !isReadOnly && saveWorkingDays(r.employee.id)}
                        className={`w-12 rounded border border-line px-1 py-0.5 text-right text-xs ${isReadOnly ? "bg-paper-2" : ""}`}
                      />
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Prorated Salary</span>
                      <span>{fmtNumber(r.proratedSalary)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Short</span>
                      <span>{fmtNumber(r.short)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Bonus</span>
                      <span>{fmtNumber(r.bonus)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Paid</span>
                      <span>{fmtNumber(r.paid)}</span>
                    </div>
                  </div>
                </div>
            ))}
              <div className="rounded border-2 border-navy p-3.5">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="font-display text-[15px] font-semibold text-navy">TOTAL</span>
                  <span className="font-mono text-sm font-semibold text-navy">{fmtNumber(totals.balance)} AED</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">
                  <div className="flex justify-between">
                    <span className="text-ink-soft">Base Salary</span>
                    <span>{fmtNumber(totals.baseSalary)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">Prorated Salary</span>
                    <span>{fmtNumber(totals.proratedSalary)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">Short</span>
                    <span>{fmtNumber(totals.short)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">Bonus</span>
                    <span>{fmtNumber(totals.bonus)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">Paid</span>
                    <span>{fmtNumber(totals.paid)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop: full table */}
            <table className="data-table hidden md:table">
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
                  {!isReadOnly && <th>Actions</th>}
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
                          readOnly={isReadOnly}
                          value={workingDaysInput[r.employee.id] ?? ""}
                          onChange={(e) =>
                            !isReadOnly && setWorkingDaysInput((prev) => ({ ...prev, [r.employee.id]: e.target.value }))
                          }
                          onBlur={() => !isReadOnly && saveWorkingDays(r.employee.id)}
                          className={`w-14 rounded border border-line px-1.5 py-0.5 text-right text-xs ${isReadOnly ? "bg-paper-2" : ""}`}
                        />
                      </div>
                    </td>
                    <td className="text-right font-mono">{fmtNumber(r.proratedSalary)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.short)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.bonus)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.paid)}</td>
                    <td className="text-right font-mono font-semibold">{fmtNumber(r.balance)}</td>
                    {!isReadOnly && (
                      <td className="whitespace-nowrap">
                        {isStaffRecord(r.employee) && (
                          <>
                            <button onClick={() => startEditStaff(r.employee)} className="mr-2 text-xs text-brass hover:underline">
                              Edit
                            </button>
                            <button onClick={() => deactivateStaff(r.employee)} className="text-xs text-cancelled hover:underline">
                              Remove
                            </button>
                          </>
                        )}
                      </td>
                    )}
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
                  {!isReadOnly && <td></td>}
                </tr>
              </tbody>
            </table>
          </>
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
                    {!isReadOnly && (
                      <button onClick={() => deleteEntry(e.id)} className="text-xs text-cancelled hover:underline">
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
    </AuthGate>
  );
}
