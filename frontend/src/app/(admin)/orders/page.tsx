"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { apiFetch, ApiClientError } from "@/lib/api";
import { addDays, fmtNumber, todayStr } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { Employee, Order, OrderStatus, PAYMENTS, EMIRATES, STATUSES, Vendor } from "@/types";

const emptyForm = {
  cnNo: "",
  vendorId: "",
  payment: "CASH" as (typeof PAYMENTS)[number],
  emirate: "DUBAI",
  employeeId: "",
  total: "",
  status: "PENDING" as OrderStatus,
};

export default function OrdersPage() {
  const [date, setDate] = useState(todayStr());
  const [orders, setOrders] = useState<Order[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
const [saving, setSaving] = useState(false);
  const [lockFields, setLockFields] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
const [paymentFilter, setPaymentFilter] = useState<"" | "CASH" | "BANK">("");
const [emirateFilter, setEmirateFilter] = useState("");
const [employeeFilter, setEmployeeFilter] = useState("");
const [minAmount, setMinAmount] = useState("");
const [maxAmount, setMaxAmount] = useState("");
const [pendingCarryover, setPendingCarryover] = useState<Order[]>([]);
const cnNoRef = useRef<HTMLInputElement>(null);
const vendorRef = useRef<HTMLSelectElement>(null);
const totalRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ordersRes, vendorsRes, employeesRes] = await Promise.all([
        apiFetch<{ orders: Order[]; total: number }>("/orders", { query: { date } }),
        apiFetch<Vendor[]>("/vendors"),
        apiFetch<Employee[]>("/employees"),
      ]);
    setOrders(ordersRes.orders);
        setVendors(vendorsRes);
        setEmployees(employeesRes);
        const carryoverRes = await apiFetch<{ orders: Order[] }>("/orders/pending-carryover");
        setPendingCarryover(carryoverRes.orders);
      } finally {
        setLoading(false);
      }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useSocketEvent("order:changed", load);

 const selectedVendor = useMemo(() => vendors.find((v) => v.id === form.vendorId), [vendors, form.vendorId]);

const filteredOrders = useMemo(() => {
 const allOrders = date === todayStr() ? [...pendingCarryover, ...orders] : orders;
  return allOrders.filter((o) => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!String(o.cnNo).includes(q) && !o.brandName?.toLowerCase().includes(q)) return false;
    }
    if (statusFilter && o.status !== statusFilter) return false;
    if (paymentFilter && o.payment !== paymentFilter) return false;
    if (emirateFilter && o.emirate !== emirateFilter) return false;
    if (employeeFilter && o.employee.id !== employeeFilter) return false;
    if (minAmount && o.total < Number(minAmount)) return false;
    if (maxAmount && o.total > Number(maxAmount)) return false;
    return true;
  });
}, [orders, pendingCarryover, date, search, statusFilter, paymentFilter, emirateFilter, employeeFilter, minAmount, maxAmount]);

 function resetForm() {
    setForm(lockFields ? { ...emptyForm, emirate: form.emirate, employeeId: form.employeeId } : emptyForm);
    setEditingId(null);
  }

  function startEdit(order: Order) {
    setEditingId(order.id);
    setForm({
      cnNo: String(order.cnNo),
      vendorId: order.vendorId,
      payment: order.payment,
      emirate: order.emirate,
      employeeId: order.employeeId,
      total: String(order.total),
      status: order.status,
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.vendorId || !form.employeeId || !form.cnNo || !form.total) {
      setError("Please fill in CN No., Vendor, Employee and Total.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        date,
        cnNo: Number(form.cnNo),
        vendorId: form.vendorId,
        payment: form.payment,
        emirate: form.emirate,
        employeeId: form.employeeId,
        total: Number(form.total),
        status: form.status,
      };
      if (editingId) {
        await apiFetch(`/orders/${editingId}`, { method: "PUT", body: payload });
      } else {
        await apiFetch("/orders", { method: "POST", body: payload });
      }
     resetForm();
cnNoRef.current?.focus();
await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save consignment");
    } finally {
      setSaving(false);
    }
  }

  async function deleteOrder(id: string) {
    if (!confirm("Delete this consignment? This cannot be undone.")) return;
    await apiFetch(`/orders/${id}`, { method: "DELETE" });
    await load();
  }

  async function quickStatus(id: string, status: OrderStatus) {
    await apiFetch(`/orders/${id}/status`, { method: "PATCH", body: { status } });
    await load();
  }

  const totals = orders.reduce(
    (acc, o) => {
      acc.total += o.status === "DELIVERED" ? o.total : 0;
      acc.dl += o.status === "DELIVERED" ? o.deliveryCharge : 0;
      return acc;
    },
    { total: 0, dl: 0 }
  );

return (
    <AuthGate allow={["SUPER_ADMIN"]}>
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Daily Entry</p>
          <h1 className="font-display text-3xl font-semibold text-navy">Consignments — {date}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(addDays(date, -1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
            ← Prev day
          </button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-line px-3 py-2 text-sm" />
          <button onClick={() => setDate(addDays(date, 1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
            Next day →
          </button>
          <button onClick={() => setDate(todayStr())} className="rounded bg-navy px-3 py-2 font-mono text-xs uppercase text-paper hover:bg-navy-2">
            Today
          </button>
        </div>
      </div>

      <div className="mb-6 border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-[17px] font-semibold text-navy">{editingId ? "Edit Consignment" : "New Consignment"}</h2>
        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">CN No.</label>
            <input
             ref={cnNoRef}
value={form.cnNo}
onChange={(e) => setForm({ ...form, cnNo: e.target.value })}
onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); vendorRef.current?.focus(); } }}
className="w-full rounded border border-line px-2.5 py-2 text-sm"
type="number"
required
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Vendor</label>
            <select
             ref={vendorRef}
value={form.vendorId}
onChange={(e) => setForm({ ...form, vendorId: e.target.value })}
onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); totalRef.current?.focus(); } }}
className="w-full rounded border border-line px-2.5 py-2 text-sm"
required
            >
              <option value="">Select…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">DL Charge</label>
            <input value={selectedVendor ? selectedVendor.deliveryCharge : ""} readOnly className="w-full rounded border border-line bg-paper-2 px-2.5 py-2 text-sm text-ink-soft" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Total (AED)</label>
           <input
  ref={totalRef}
  value={form.total}
  onChange={(e) => setForm({ ...form, total: e.target.value })}
  className="w-full rounded border border-line px-2.5 py-2 text-sm"
  type="number"
  required
/>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Payment</label>
            <select value={form.payment} onChange={(e) => setForm({ ...form, payment: e.target.value as (typeof PAYMENTS)[number] })} className="w-full rounded border border-line px-2.5 py-2 text-sm">
              {PAYMENTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Emirate</label>
            <select value={form.emirate} onChange={(e) => setForm({ ...form, emirate: e.target.value })} className="w-full rounded border border-line px-2.5 py-2 text-sm">
              {EMIRATES.map((em) => (
                <option key={em} value={em}>
                  {em}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Employee</label>
            <select
              value={form.employeeId}
              onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              className="w-full rounded border border-line px-2.5 py-2 text-sm"
              required
            >
              <option value="">Select…</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2 md:col-span-4 lg:col-span-7 flex items-end gap-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as OrderStatus })} className="rounded border border-line px-2.5 py-2 text-sm">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          <label className="flex items-center gap-1.5 text-xs font-mono text-ink-soft mr-2">
                <input type="checkbox" checked={lockFields} onChange={(e) => setLockFields(e.target.checked)} />
                Lock Emirate & Employee
              </label>
              <button type="submit" disabled={saving} className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60">

              {saving ? "Saving…" : editingId ? "Save changes" : "Add consignment"}
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
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-[17px] font-semibold text-navy">
               {filteredOrders.length} consignment{filteredOrders.length === 1 ? "" : "s"}
          </h2>
          <div className="font-mono text-xs text-ink-soft">
            Delivered total <b className="text-ink">{fmtNumber(totals.total)} AED</b> · DL charge <b className="text-ink">{fmtNumber(totals.dl)} AED</b>
          </div>
        </div>
     <div className="mb-3 flex flex-wrap gap-2.5">
  <input
    placeholder="Search CN No. or brand…"
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    className="rounded border border-line px-3 py-1.5 text-sm"
  />
  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as OrderStatus | "")} className="rounded border border-line px-3 py-1.5 text-sm">
    <option value="">All statuses</option>
    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
  </select>
  <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value as "" | "CASH" | "BANK")} className="rounded border border-line px-3 py-1.5 text-sm">
    <option value="">All payments</option>
    {PAYMENTS.map((p) => <option key={p} value={p}>{p}</option>)}
  </select>
  <select value={emirateFilter} onChange={(e) => setEmirateFilter(e.target.value)} className="rounded border border-line px-3 py-1.5 text-sm">
    <option value="">All emirates</option>
    {EMIRATES.map((em) => <option key={em} value={em}>{em}</option>)}
  </select>
  <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} className="rounded border border-line px-3 py-1.5 text-sm">
    <option value="">All employees</option>
    {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
  </select>
  <input type="number" placeholder="Min AED" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="w-24 rounded border border-line px-3 py-1.5 text-sm" />
  <input type="number" placeholder="Max AED" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="w-24 rounded border border-line px-3 py-1.5 text-sm" />
</div>
            <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>SL</th>
                <th>CN No.</th>
                <th>Vendor</th>
                <th className="text-right">Total</th>
                <th className="text-right">DL Chg</th>
                <th>Payment</th>
                <th>Emirate</th>
                <th>Employee</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-ink-soft">
                    Loading…
                  </td>
                </tr>
             ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-ink-soft">
                    No consignments entered for this date yet.
                  </td>
                </tr>
              ) : (
            filteredOrders.map((o, i) => (
                <tr key={o.id}>
                  <td className="font-mono">{i + 1}</td>
                    <td className="font-mono">{o.cnNo}</td>
                    <td>{o.brandName}</td>
                    <td className="text-right font-mono">{fmtNumber(o.total)}</td>
                    <td className="text-right font-mono">{fmtNumber(o.deliveryCharge)}</td>
                    <td>{o.payment}</td>
                    <td>{o.emirate}</td>
                    <td>{o.employee.name}</td>
                    <td>
                      <select
                        value={o.status}
                        onChange={(e) => quickStatus(o.id, e.target.value as OrderStatus)}
                        className="rounded border border-line bg-transparent px-1.5 py-1 text-xs"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="whitespace-nowrap">
                      <button onClick={() => startEdit(o)} className="mr-2 text-xs text-brass hover:underline">
                        Edit
                      </button>
                      <button onClick={() => deleteOrder(o.id)} className="text-xs text-cancelled hover:underline">
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
    </div>
    </AuthGate>
  );
}
