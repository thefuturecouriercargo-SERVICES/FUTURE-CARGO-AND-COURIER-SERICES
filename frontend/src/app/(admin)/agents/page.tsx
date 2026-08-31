"use client";

import { Fragment, FormEvent, useCallback, useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { useAuth } from "@/context/AuthContext";
import { apiFetch, ApiClientError, agentCreditExportUrl } from "@/lib/api";
import { fmtNumber, todayStr, addDays, currentMonthStr } from "@/lib/format";
import { Employee } from "@/types";

const emptyForm = { name: "", username: "", email: "", phone: "", password: "", baseSalary: "" };

interface AgentBreakdownRow {
  employee: { id: string; name: string };
  delivered: number;
  pending: number;
  transferred: number;
  cancelled: number;
  totalSales: number;
  totalDeliveryCharge: number;
  cashCollected?: number;
  totalExpenses?: number;
  cashBalance?: number;
}

interface AgentCreditRow {
  agent: { id: string; name: string; active: boolean };
  totalAmount: number;
  cancelledTotal: number;
  totalDeliveryCharge: number;
  totalPaid: number;
  balance: number;
}

interface AgentPayment {
  id: string;
  date: string;
  amount: number;
  note?: string | null;
}

export default function AgentsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const [agents, setAgents] = useState<Employee[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [date, setDate] = useState(todayStr());
  const [performance, setPerformance] = useState<AgentBreakdownRow[]>([]);
  const [creditRows, setCreditRows] = useState<AgentCreditRow[]>([]);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [payments, setPayments] = useState<AgentPayment[]>([]);
  const [payForm, setPayForm] = useState({ date: todayStr(), amount: "", note: "" });
  const [payError, setPayError] = useState<string | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);

  const [month, setMonth] = useState(currentMonthStr());
  const [monthlyRows, setMonthlyRows] = useState<AgentBreakdownRow[]>([]);
  const [loadingMonthly, setLoadingMonthly] = useState(false);

  const load = useCallback(async () => {
    const list = await apiFetch<Employee[]>("/employees", { query: { includeInactive: true, isAgent: "true" } });
    setAgents(list);
    const daily = await apiFetch<{ agentBreakdown: AgentBreakdownRow[] }>("/dashboard/daily", { query: { date } });
    setPerformance(daily.agentBreakdown ?? []);
    setCreditRows(await apiFetch<AgentCreditRow[]>("/agent-credit"));
  }, [date]);

  const loadMonthly = useCallback(async () => {
    setLoadingMonthly(true);
    try {
      const res = await apiFetch<{ agentBreakdown: AgentBreakdownRow[] }>("/dashboard/monthly", { query: { month } });
      setMonthlyRows(res.agentBreakdown ?? []);
    } finally {
      setLoadingMonthly(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadMonthly();
  }, [loadMonthly]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function startEdit(a: Employee) {
    setEditingId(a.id);
    setForm({ name: a.name, username: a.username, email: a.email ?? "", phone: a.phone ?? "", password: "", baseSalary: String(a.baseSalary ?? "") });
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
            isAgent: true,
            ...(form.password ? { password: form.password } : {}),
          },
        });
      } else {
        await apiFetch("/employees", {
          method: "POST",
          body: { ...form, baseSalary: Number(form.baseSalary) || 0, isAgent: true },
        });
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save agent");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(a: Employee) {
    if (a.active) {
      if (!confirm(`Deactivate ${a.name}? They will no longer be able to log in.`)) return;
      await apiFetch(`/employees/${a.id}`, { method: "DELETE" });
    } else {
      await apiFetch(`/employees/${a.id}`, { method: "PUT", body: { active: true } });
    }
    await load();
  }

  async function removeAgent(a: Employee) {
    if (!confirm(`Permanently remove ${a.name}? This only works if they have no order or cash history — otherwise deactivate them instead.`)) return;
    try {
      await apiFetch(`/employees/${a.id}/permanent`, { method: "DELETE" });
      await load();
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : "Failed to remove agent");
    }
  }

  async function toggleExpand(agentId: string) {
    if (expandedAgentId === agentId) {
      setExpandedAgentId(null);
      return;
    }
    setExpandedAgentId(agentId);
    setPayForm({ date: todayStr(), amount: "", note: "" });
    setPayError(null);
    setLoadingPayments(true);
    try {
      setPayments(await apiFetch<AgentPayment[]>(`/agent-credit/${agentId}/payments`));
    } finally {
      setLoadingPayments(false);
    }
  }

  async function addPayment(agentId: string, e: FormEvent) {
    e.preventDefault();
    setPayError(null);
    setPaySaving(true);
    try {
      await apiFetch(`/agent-credit/${agentId}/payments`, {
        method: "POST",
        body: { date: payForm.date, amount: Number(payForm.amount), note: payForm.note || undefined },
      });
      setPayForm({ date: todayStr(), amount: "", note: "" });
      setPayments(await apiFetch<AgentPayment[]>(`/agent-credit/${agentId}/payments`));
      await load();
    } catch (err) {
      setPayError(err instanceof ApiClientError ? err.message : "Failed to save payment");
    } finally {
      setPaySaving(false);
    }
  }

  async function removePayment(agentId: string, paymentId: string) {
    if (!confirm("Remove this payment entry?")) return;
    await apiFetch(`/agent-credit/payments/${paymentId}`, { method: "DELETE" });
    setPayments(await apiFetch<AgentPayment[]>(`/agent-credit/${agentId}/payments`));
    await load();
  }

  return (
    <AuthGate allow={["SUPER_ADMIN", "MANAGER"]}>
      <div>
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Settings</p>
        <h1 className="mb-2 font-display text-3xl font-semibold text-navy">Agent Management</h1>
        <p className="mb-6 max-w-2xl text-sm text-ink-soft">
          Agents are tracked completely separately from drivers — their own performance, cash collection, and
          credit balance never mix into employee reports. An agent keeps the delivery charge on their own
          orders and owes the rest back to us.
        </p>

        {isSuperAdmin && (
          <div className="mb-6 border border-line bg-white p-5">
            <h2 className="mb-4 font-display text-[17px] font-semibold text-navy">{editingId ? "Edit Agent" : "Add Agent"}</h2>
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
                  {saving ? "Saving…" : editingId ? "Save changes" : "Add agent"}
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
        )}

        <div className="mb-6 border border-line bg-white p-5">
          <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
            Agents ({agents.filter((a) => a.active).length} active)
          </h2>

          {/* Mobile: stacked cards */}
          <div className="space-y-2.5 md:hidden">
            {agents.map((a) => (
              <div key={a.id} className={`rounded border border-line p-3.5 ${a.active ? "" : "opacity-50"}`}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="font-display text-[15px] font-semibold text-navy">{a.name}</span>
                  <span className={`stamp ${a.active ? "delivered" : "cancelled"}`}>{a.active ? "Active" : "Inactive"}</span>
                </div>
                <div className="mb-2.5 font-mono text-xs text-ink-soft">
                  {a.username} {(a.email || a.phone) && `· ${a.email || a.phone}`}
                </div>
                {isSuperAdmin && (
                  <div className="flex flex-wrap gap-3 border-t border-line pt-2">
                    <button onClick={() => startEdit(a)} className="text-xs text-brass hover:underline">
                      Edit
                    </button>
                    <button onClick={() => toggleActive(a)} className="text-xs text-cancelled hover:underline">
                      {a.active ? "Deactivate" : "Reactivate"}
                    </button>
                    <button onClick={() => removeAgent(a)} className="text-xs text-cancelled hover:underline">
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
            {agents.length === 0 && <p className="py-8 text-center text-sm text-ink-soft">No agents added yet.</p>}
          </div>

          {/* Desktop: table */}
          <table className="data-table hidden md:table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="font-mono">Username</th>
                <th>Contact</th>
                <th>Status</th>
                {isSuperAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} className={a.active ? "" : "opacity-50"}>
                  <td>{a.name}</td>
                  <td className="font-mono">{a.username}</td>
                  <td className="text-ink-soft">{a.email || a.phone || "—"}</td>
                  <td>
                    <span className={`stamp ${a.active ? "delivered" : "cancelled"}`}>{a.active ? "Active" : "Inactive"}</span>
                  </td>
                  {isSuperAdmin && (
                    <td className="whitespace-nowrap">
                      <button onClick={() => startEdit(a)} className="mr-2 text-xs text-brass hover:underline">
                        Edit
                      </button>
                      <button onClick={() => toggleActive(a)} className="mr-2 text-xs text-cancelled hover:underline">
                        {a.active ? "Deactivate" : "Reactivate"}
                      </button>
                      <button onClick={() => removeAgent(a)} className="text-xs text-cancelled hover:underline">
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {agents.length === 0 && (
                <tr>
                  <td colSpan={isSuperAdmin ? 5 : 4} className="py-8 text-center text-ink-soft">
                    No agents added yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mb-6 border border-line bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
            <h2 className="font-display text-[17px] font-semibold text-navy">Agent Performance &amp; Cash Collection</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => setDate(addDays(date, -1))} className="rounded border border-line bg-white px-2.5 py-1.5 text-xs hover:border-brass">
                ← Prev
              </button>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-line px-2.5 py-1.5 text-sm" />
              <button onClick={() => setDate(addDays(date, 1))} className="rounded border border-line bg-white px-2.5 py-1.5 text-xs hover:border-brass">
                Next →
              </button>
              <button onClick={() => setDate(todayStr())} className="rounded bg-navy px-2.5 py-1.5 font-mono text-xs uppercase text-paper hover:bg-navy-2">
                Today
              </button>
            </div>
          </div>

          {/* Mobile: stacked cards */}
          <div className="space-y-2.5 md:hidden">
            {performance.map((r) => (
              <div key={r.employee.id} className="rounded border border-line p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-display text-[15px] font-semibold text-navy">{r.employee.name}</span>
                  <span className="font-mono text-sm font-semibold text-navy">{fmtNumber(r.cashBalance ?? 0)}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">
                  <div className="flex justify-between"><span className="text-ink-soft">Delivered</span><span>{r.delivered}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Pending</span><span>{r.pending}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Sales</span><span>{fmtNumber(r.totalSales)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">DL Charge</span><span>{fmtNumber(r.totalDeliveryCharge)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Cash Collected</span><span>{fmtNumber(r.cashCollected ?? 0)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Expenses</span><span>{fmtNumber(r.totalExpenses ?? 0)}</span></div>
                </div>
              </div>
            ))}
            {performance.length === 0 && <p className="py-8 text-center text-sm text-ink-soft">No agent activity on this date.</p>}
          </div>

          {/* Desktop: table */}
          <table className="data-table hidden md:table">
            <thead>
              <tr>
                <th>Agent</th>
                <th className="text-right">Delivered</th>
                <th className="text-right">Pending</th>
                <th className="text-right">Sales</th>
                <th className="text-right">DL Charge</th>
                <th className="text-right">Cash Collected</th>
                <th className="text-right">Expenses</th>
                <th className="text-right">Cash Balance</th>
              </tr>
            </thead>
            <tbody>
              {performance.map((r) => (
                <tr key={r.employee.id}>
                  <td>{r.employee.name}</td>
                  <td className="text-right font-mono">{r.delivered}</td>
                  <td className="text-right font-mono">{r.pending}</td>
                  <td className="text-right font-mono">{fmtNumber(r.totalSales)}</td>
                  <td className="text-right font-mono">{fmtNumber(r.totalDeliveryCharge)}</td>
                  <td className="text-right font-mono">{fmtNumber(r.cashCollected ?? 0)}</td>
                  <td className="text-right font-mono">{fmtNumber(r.totalExpenses ?? 0)}</td>
                  <td className="text-right font-mono font-semibold">{fmtNumber(r.cashBalance ?? 0)}</td>
                </tr>
              ))}
              {performance.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-ink-soft">
                    No agent activity on this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mb-6 border border-line bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
            <h2 className="font-display text-[17px] font-semibold text-navy">Agent Monthly Report</h2>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-line px-2.5 py-1.5 text-sm" />
          </div>
          {loadingMonthly ? (
            <p className="text-sm text-ink-soft">Loading…</p>
          ) : (
            <>
              {/* Mobile: stacked cards */}
              <div className="space-y-2.5 md:hidden">
                {monthlyRows.map((r) => (
                  <div key={r.employee.id} className="rounded border border-line p-3.5">
                    <div className="mb-2 font-display text-[15px] font-semibold text-navy">{r.employee.name}</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">
                      <div className="flex justify-between"><span className="text-ink-soft">Delivered</span><span>{r.delivered}</span></div>
                      <div className="flex justify-between"><span className="text-ink-soft">Pending</span><span>{r.pending}</span></div>
                      <div className="flex justify-between"><span className="text-ink-soft">Transfer</span><span>{r.transferred}</span></div>
                      <div className="flex justify-between"><span className="text-ink-soft">Cancelled</span><span>{r.cancelled}</span></div>
                      <div className="flex justify-between"><span className="text-ink-soft">Sales</span><span>{fmtNumber(r.totalSales)}</span></div>
                      <div className="flex justify-between"><span className="text-ink-soft">DL Charge</span><span>{fmtNumber(r.totalDeliveryCharge)}</span></div>
                    </div>
                  </div>
                ))}
                {monthlyRows.length === 0 && <p className="py-8 text-center text-sm text-ink-soft">No agent activity this month.</p>}
              </div>

              {/* Desktop: table */}
              <table className="data-table hidden md:table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Pending</th>
                    <th className="text-right">Transfer</th>
                    <th className="text-right">Cancelled</th>
                    <th className="text-right">Sales</th>
                    <th className="text-right">DL Charge</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRows.map((r) => (
                    <tr key={r.employee.id}>
                      <td>{r.employee.name}</td>
                      <td className="text-right font-mono">{r.delivered}</td>
                      <td className="text-right font-mono">{r.pending}</td>
                      <td className="text-right font-mono">{r.transferred}</td>
                      <td className="text-right font-mono">{r.cancelled}</td>
                      <td className="text-right font-mono">{fmtNumber(r.totalSales)}</td>
                      <td className="text-right font-mono">{fmtNumber(r.totalDeliveryCharge)}</td>
                    </tr>
                  ))}
                  {monthlyRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-ink-soft">
                        No agent activity this month.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="border border-line bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
            <h2 className="font-display text-[17px] font-semibold text-navy">
              Agent Credit — What They Owe Back
            </h2>
            <a
              href={agentCreditExportUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-line bg-white px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass hover:text-navy"
            >
              Download Excel
            </a>
          </div>
          {/* Mobile: stacked cards */}
          <div className="space-y-2.5 md:hidden">
            {creditRows.map((r) => (
              <div key={r.agent.id} className={`rounded border border-line p-3.5 ${r.agent.active ? "" : "opacity-50"}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-display text-[15px] font-semibold text-navy">{r.agent.name}</span>
                  <span className={`font-mono text-sm font-bold ${r.balance > 0 ? "text-cancelled" : "text-delivered"}`}>
                    {fmtNumber(r.balance)}
                  </span>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">
                  <div className="flex justify-between"><span className="text-ink-soft">Total Amount</span><span>{fmtNumber(r.totalAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Cancelled</span><span>{fmtNumber(r.cancelledTotal)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">DL Charge (Kept)</span><span>{fmtNumber(r.totalDeliveryCharge)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Paid Back</span><span>{fmtNumber(r.totalPaid)}</span></div>
                </div>
                <button
                  onClick={() => toggleExpand(r.agent.id)}
                  className="w-full rounded border border-line py-2 text-xs font-semibold text-brass hover:border-brass"
                >
                  {expandedAgentId === r.agent.id ? "Close" : "Add / View Payments"}
                </button>

                {expandedAgentId === r.agent.id && (
                  <div className="mt-3 border-t border-line pt-3">
                    {isSuperAdmin && (
                      <form onSubmit={(e) => addPayment(r.agent.id, e)} className="mb-4 space-y-2.5">
                        <div>
                          <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Date</label>
                          <input
                            type="date"
                            required
                            value={payForm.date}
                            onChange={(e) => setPayForm({ ...payForm, date: e.target.value })}
                            className="w-full rounded border border-line px-2.5 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Amount Paid Back (AED)</label>
                          <input
                            type="number"
                            required
                            min={1}
                            value={payForm.amount}
                            onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                            className="w-full rounded border border-line px-2.5 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Note (optional)</label>
                          <input
                            value={payForm.note}
                            onChange={(e) => setPayForm({ ...payForm, note: e.target.value })}
                            className="w-full rounded border border-line px-2.5 py-2 text-sm"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={paySaving}
                          className="w-full rounded bg-navy py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60"
                        >
                          {paySaving ? "Saving…" : "Add Payment"}
                        </button>
                        {payError && <p className="text-xs text-cancelled">{payError}</p>}
                      </form>
                    )}

                    <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-ink-soft">Payment history</h3>
                    {loadingPayments ? (
                      <p className="text-sm text-ink-soft">Loading…</p>
                    ) : payments.length === 0 ? (
                      <p className="text-sm text-ink-soft">No payments logged yet.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {payments.map((p) => (
                          <div key={p.id} className="flex items-center justify-between rounded border border-line px-2.5 py-2 text-xs">
                            <span>
                              {p.date.slice(0, 10)}
                              {p.note && <span className="text-ink-soft"> — {p.note}</span>}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="font-mono">{fmtNumber(p.amount)}</span>
                              {isSuperAdmin && (
                                <button onClick={() => removePayment(r.agent.id, p.id)} className="text-cancelled hover:underline">
                                  Remove
                                </button>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {creditRows.length === 0 && <p className="py-8 text-center text-sm text-ink-soft">No agents added yet.</p>}
          </div>

          {/* Desktop: table */}
          <table className="data-table hidden md:table">
            <thead>
              <tr>
                <th>Agent</th>
                <th className="text-right">Total Amount</th>
                <th className="text-right">Cancelled</th>
                <th className="text-right">DL Charge (Kept)</th>
                <th className="text-right">Paid Back</th>
                <th className="text-right">Balance Owed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {creditRows.map((r) => (
                <Fragment key={r.agent.id}>
                  <tr className={r.agent.active ? "" : "opacity-50"}>
                    <td>{r.agent.name}</td>
                    <td className="text-right font-mono">{fmtNumber(r.totalAmount)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.cancelledTotal)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.totalDeliveryCharge)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.totalPaid)}</td>
                    <td className={`text-right font-mono font-semibold ${r.balance > 0 ? "text-cancelled" : "text-delivered"}`}>
                      {fmtNumber(r.balance)}
                    </td>
                    <td>
                      <button onClick={() => toggleExpand(r.agent.id)} className="text-xs text-brass hover:underline">
                        {expandedAgentId === r.agent.id ? "Close" : "Add / View Payments"}
                      </button>
                    </td>
                  </tr>
                  {expandedAgentId === r.agent.id && (
                    <tr>
                      <td colSpan={7} className="bg-paper-2 p-4">
                        {isSuperAdmin && (
                          <form onSubmit={(e) => addPayment(r.agent.id, e)} className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                            <div>
                              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Date</label>
                              <input
                                type="date"
                                required
                                value={payForm.date}
                                onChange={(e) => setPayForm({ ...payForm, date: e.target.value })}
                                className="w-full rounded border border-line px-2.5 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Amount Paid Back (AED)</label>
                              <input
                                type="number"
                                required
                                min={1}
                                value={payForm.amount}
                                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                                className="w-full rounded border border-line px-2.5 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Note (optional)</label>
                              <input
                                value={payForm.note}
                                onChange={(e) => setPayForm({ ...payForm, note: e.target.value })}
                                className="w-full rounded border border-line px-2.5 py-2 text-sm"
                              />
                            </div>
                            <div className="flex items-end gap-3">
                              <button
                                type="submit"
                                disabled={paySaving}
                                className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60"
                              >
                                {paySaving ? "Saving…" : "Add Payment"}
                              </button>
                            </div>
                            {payError && <span className="col-span-full text-xs text-cancelled">{payError}</span>}
                          </form>
                        )}

                        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-ink-soft">Payment history</h3>
                        {loadingPayments ? (
                          <p className="text-sm text-ink-soft">Loading…</p>
                        ) : payments.length === 0 ? (
                          <p className="text-sm text-ink-soft">No payments logged yet.</p>
                        ) : (
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th className="text-right">Amount</th>
                                <th>Note</th>
                                {isSuperAdmin && <th>Actions</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {payments.map((p) => (
                                <tr key={p.id}>
                                  <td>{p.date.slice(0, 10)}</td>
                                  <td className="text-right font-mono">{fmtNumber(p.amount)}</td>
                                  <td className="text-ink-soft">{p.note || "—"}</td>
                                  {isSuperAdmin && (
                                    <td>
                                      <button onClick={() => removePayment(r.agent.id, p.id)} className="text-xs text-cancelled hover:underline">
                                        Remove
                                      </button>
                                    </td>
                                  )}
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
              {creditRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-soft">
                    No agents added yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AuthGate>
  );
}
