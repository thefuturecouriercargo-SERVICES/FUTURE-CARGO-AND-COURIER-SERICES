"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { fmtNumber, currentMonthStr } from "@/lib/format";
import { Employee } from "@/types";

const emptyForm = { name: "", username: "", email: "", phone: "", password: "", baseSalary: "" };

interface PerformanceMap {
  [id: string]: { delivered: number; totalSales: number; totalDeliveryCharge: number };
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [performance, setPerformance] = useState<PerformanceMap>({});
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await apiFetch<Employee[]>("/employees", { query: { includeInactive: true } });
    setEmployees(list);
    const month = currentMonthStr();
    const perfEntries = await Promise.all(
      list.map(async (e) => {
        const perf = await apiFetch<{ delivered: number; totalSales: number; totalDeliveryCharge: number }>(
          `/employees/${e.id}/performance`,
          { query: { month } }
        );
        return [e.id, perf] as const;
      })
    );
    setPerformance(Object.fromEntries(perfEntries));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function startEdit(e: Employee) {
    setEditingId(e.id);
   setForm({ name: e.name, username: e.username, email: e.email ?? "", phone: e.phone ?? "", password: "", baseSalary: String(e.baseSalary ?? "") });
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    setSaving(true);
    try {
     if (editingId) {
        await apiFetch(`/employees/${editingId}`, {
          method: "PUT",
          body: {
            name: form.name,
            email: form.email,
            phone: form.phone,
            baseSalary: Number(form.baseSalary) || 0,
            ...(form.password ? { password: form.password } : {}),
          },
        });
      } else {
        await apiFetch("/employees", { method: "POST", body: { ...form, baseSalary: Number(form.baseSalary) || 0 } });
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save employee");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(e: Employee) {
    if (e.active) {
      if (!confirm(`Deactivate ${e.name}? They will no longer be able to log in.`)) return;
      await apiFetch(`/employees/${e.id}`, { method: "DELETE" });
    } else {
      await apiFetch(`/employees/${e.id}`, { method: "PUT", body: { active: true } });
    }
    await load();
  }

  return (
    <div>
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Settings</p>
      <h1 className="mb-6 font-display text-3xl font-semibold text-navy">Employee Management</h1>

      <div className="mb-6 border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-[17px] font-semibold text-navy">{editingId ? "Edit Employee" : "Add Employee"}</h2>
        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Full name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded border border-line px-2.5 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Username</label>
            <input
              required
              disabled={!!editingId}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="w-full rounded border border-line px-2.5 py-2 text-sm disabled:bg-paper-2"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Email (optional)</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded border border-line px-2.5 py-2 text-sm" />
          </div>
           <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Phone (optional)</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded border border-line px-2.5 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Base Salary (AED)</label>
            <input type="number" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} className="w-full rounded border border-line px-2.5 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">{editingId ? "New password (optional)" : "Password"}</label>
            <input
              type="password"
              required={!editingId}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full rounded border border-line px-2.5 py-2 text-sm"
            />
          </div>
          <div className="col-span-2 flex items-end gap-3 md:col-span-5">
            <button type="submit" disabled={saving} className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60">
              {saving ? "Saving…" : editingId ? "Save changes" : "Add employee"}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="rounded border border-line px-4 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass">
                Cancel
              </button>
            )}
            {error && <span className="text-xs text-cancelled">{error}</span>}
          </div>
        </form>
      </div>

      <div className="border border-line bg-white p-5">
        <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
          Drivers ({employees.filter((e) => e.active).length} active)
        </h2>
        <table className="data-table">
          <thead>
            <tr>
            <th>Name</th>
              <th>Username</th>
              <th>Contact</th>
              <th className="text-right">Base Salary</th>
              <th className="text-right">Delivered (MTD)</th>
              <th className="text-right">Sales (MTD)</th>
              <th className="text-right">DL Charge (MTD)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const p = performance[e.id];
              return (
                <tr key={e.id} className={e.active ? "" : "opacity-50"}>
                  <td>{e.name}</td>
                  <td className="font-mono">{e.username}</td>
                  <td className="text-ink-soft">{e.email || e.phone || "—"}</td>
                  <td className="text-right font-mono">{fmtNumber(e.baseSalary ?? 0)}</td>
                  <td className="text-right font-mono">{p?.delivered ?? "—"}</td>
                  <td className="text-right font-mono">{p ? fmtNumber(p.totalSales) : "—"}</td>
                  <td className="text-right font-mono">{p ? fmtNumber(p.totalDeliveryCharge) : "—"}</td>
                  <td>
                    <span className={`stamp ${e.active ? "delivered" : "cancelled"}`}>{e.active ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    <button onClick={() => startEdit(e)} className="mr-2 text-xs text-brass hover:underline">
                      Edit
                    </button>
                    <button onClick={() => toggleActive(e)} className="text-xs text-cancelled hover:underline">
                      {e.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
