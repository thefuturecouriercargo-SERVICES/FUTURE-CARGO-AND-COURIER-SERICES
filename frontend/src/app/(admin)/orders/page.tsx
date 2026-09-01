"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { apiFetch, ApiClientError } from "@/lib/api";
import { addDays, fmtNumber, todayStr, isAgingPending } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";

// Minimal typing for the Web Speech API (not in default TS lib).
interface SpeechRecognitionResultLike {
  transcript: string;
}
interface SpeechRecognitionEventLike {
  results: { [key: number]: { [key: number]: SpeechRecognitionResultLike } };
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function useVoiceSearch(onResult: (digits: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);

  function start() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const digits = transcript.replace(/\D/g, "");
      if (digits) onResult(digits);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  return { listening, supported, start };
}
import { Employee, Order, OrderStatus, PAYMENTS, EMIRATES, STATUSES, Vendor } from "@/types";

const emptyForm = {
  cnNo: "",
  vendorId: "",
  payment: "CASH" as (typeof PAYMENTS)[number],
  emirate: "DUBAI",
  employeeId: "",
  total: "",
  status: "PENDING" as OrderStatus,
  editDate: "",
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
  const voiceSearch = useVoiceSearch((digits) => setSearch(digits));
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
const [paymentFilter, setPaymentFilter] = useState<"" | "CASH" | "BANK">("");
const [emirateFilter, setEmirateFilter] = useState("");
const [employeeFilter, setEmployeeFilter] = useState("");
const [vendorFilter, setVendorFilter] = useState("");
const [minAmount, setMinAmount] = useState("");
const [maxAmount, setMaxAmount] = useState("");
const [pendingCarryover, setPendingCarryover] = useState<Order[]>([]);
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [bulkEmirate, setBulkEmirate] = useState("");
const [bulkEmployeeId, setBulkEmployeeId] = useState("");
const [bulkStatus, setBulkStatus] = useState<OrderStatus | "">("");
const [bulkReason, setBulkReason] = useState("");
const [bulkSaving, setBulkSaving] = useState(false);
const cnNoRef = useRef<HTMLInputElement>(null);
const vendorRef = useRef<HTMLSelectElement>(null);
const totalRef = useRef<HTMLInputElement>(null);
const [duplicateGroups, setDuplicateGroups] = useState<{ cnNo: number; orders: Order[] }[]>([]);

  const loadDuplicates = useCallback(async () => {
    const res = await apiFetch<{ groups: { cnNo: number; orders: Order[] }[] }>("/orders/duplicates");
    setDuplicateGroups(res.groups);
  }, []);

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
        await loadDuplicates();
      } finally {
        setLoading(false);
      }
  }, [date, loadDuplicates]);

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
    if (vendorFilter && o.vendorId !== vendorFilter) return false;
    if (minAmount && o.total < Number(minAmount)) return false;
    if (maxAmount && o.total > Number(maxAmount)) return false;
    return true;
  });
}, [orders, pendingCarryover, date, search, statusFilter, paymentFilter, emirateFilter, employeeFilter, vendorFilter, minAmount, maxAmount]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [date]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) =>
      prev.size === filteredOrders.length ? new Set() : new Set(filteredOrders.map((o) => o.id))
    );
  }

  async function applyBulkUpdate() {
    if (selectedIds.size === 0) return;
    if (!bulkEmirate && !bulkEmployeeId && !bulkStatus) {
      setError("Choose an emirate, employee, and/or status to apply to the selected consignments.");
      return;
    }
    if (bulkStatus === "CANCELLED" && !bulkReason.trim()) {
      setError("Enter a reason for cancelling the selected consignments.");
      return;
    }
    setError(null);
    setBulkSaving(true);
    try {
      await apiFetch("/orders/bulk", {
        method: "PATCH",
        body: {
          ids: Array.from(selectedIds),
          ...(bulkEmirate ? { emirate: bulkEmirate } : {}),
          ...(bulkEmployeeId ? { employeeId: bulkEmployeeId } : {}),
          ...(bulkStatus ? { status: bulkStatus } : {}),
          ...(bulkStatus === "CANCELLED" ? { reason: bulkReason.trim() } : {}),
        },
      });
      setSelectedIds(new Set());
      setBulkEmirate("");
      setBulkEmployeeId("");
      setBulkStatus("");
      setBulkReason("");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to update selected consignments");
    } finally {
      setBulkSaving(false);
    }
  }

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
      editDate: order.date.slice(0, 10),
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
        date: editingId ? form.editDate : date,
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

  async function deleteDuplicate(id: string) {
    if (!confirm("Delete this duplicate consignment entry? This cannot be undone.")) return;
    await apiFetch(`/orders/${id}`, { method: "DELETE" });
    await loadDuplicates();
    await load();
  }

  async function quickStatus(id: string, status: OrderStatus) {
    let reason: string | undefined;
    if (status === "CANCELLED") {
      reason = prompt("Reason for cancelling this consignment?") ?? undefined;
      if (!reason || !reason.trim()) return; // aborted or empty — don't cancel
    }
    await apiFetch(`/orders/${id}/status`, { method: "PATCH", body: { status, reason } });
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
          {editingId && (
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-cancelled">Date (correct if needed)</label>
              <input
                type="date"
                value={form.editDate}
                onChange={(e) => setForm({ ...form, editDate: e.target.value })}
                className="w-full rounded border border-cancelled px-2.5 py-2 text-sm"
                required
              />
            </div>
          )}
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
  {voiceSearch.supported && (
    <button
      onClick={voiceSearch.start}
      title="Search by voice"
      type="button"
      className={`rounded border px-2.5 py-1.5 text-sm ${
        voiceSearch.listening ? "border-cancelled bg-cancelled text-white animate-pulse" : "border-line bg-white text-ink-soft hover:border-brass"
      }`}
    >
      🎤
    </button>
  )}
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
  <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="rounded border border-line px-3 py-1.5 text-sm">
    <option value="">All vendors</option>
    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
  </select>
  <input type="number" placeholder="Min AED" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="w-24 rounded border border-line px-3 py-1.5 text-sm" />
  <input type="number" placeholder="Max AED" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="w-24 rounded border border-line px-3 py-1.5 text-sm" />
</div>

{selectedIds.size > 0 && (
  <div className="mb-3 flex flex-wrap items-center gap-2.5 border border-brass bg-brass/10 px-3 py-2.5">
    <span className="font-mono text-xs uppercase text-ink">{selectedIds.size} selected</span>
    <select value={bulkEmirate} onChange={(e) => setBulkEmirate(e.target.value)} className="rounded border border-line px-3 py-1.5 text-sm">
      <option value="">Set emirate…</option>
      {EMIRATES.map((em) => (
        <option key={em} value={em}>
          {em}
        </option>
      ))}
    </select>
    <select value={bulkEmployeeId} onChange={(e) => setBulkEmployeeId(e.target.value)} className="rounded border border-line px-3 py-1.5 text-sm">
      <option value="">Set employee…</option>
      {employees.map((emp) => (
        <option key={emp.id} value={emp.id}>
          {emp.name}
        </option>
      ))}
    </select>
    <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as OrderStatus | "")} className="rounded border border-line px-3 py-1.5 text-sm">
      <option value="">Set status…</option>
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
    {bulkStatus === "CANCELLED" && (
      <input
        value={bulkReason}
        onChange={(e) => setBulkReason(e.target.value)}
        placeholder="Reason for cancelling…"
        className="rounded border border-cancelled px-3 py-1.5 text-sm"
      />
    )}
    <button
      onClick={applyBulkUpdate}
      disabled={bulkSaving || (!bulkEmirate && !bulkEmployeeId && !bulkStatus)}
      className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60"
    >
      {bulkSaving ? "Applying…" : "Apply to selected"}
    </button>
    <button
      type="button"
      onClick={() => setSelectedIds(new Set())}
      className="rounded border border-line px-3 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass"
    >
      Clear selection
    </button>
  </div>
)}

            <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={filteredOrders.length > 0 && selectedIds.size === filteredOrders.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>SL</th>
                <th>CN No.</th>
                <th>Vendor</th>
                <th className="text-right">Total</th>
                <th className="text-right">DL Chg</th>
                <th>Payment</th>
                <th>Emirate</th>
                <th>Employee</th>
                <th>Status</th>
                <th>Entry Date</th>
                <th>Reason</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-ink-soft">
                    Loading…
                  </td>
                </tr>
             ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-ink-soft">
                    No consignments entered for this date yet.
                  </td>
                </tr>
              ) : (
            filteredOrders.map((o, i) => (
                <tr key={o.id}>
                  <td>
                    <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} />
                  </td>
                  <td className="font-mono">{i + 1}</td>
                    <td className="font-mono">{o.cnNo}</td>
                    <td>{o.brandName}</td>
                    <td className="text-right font-mono">{fmtNumber(o.total)}</td>
                    <td className="text-right font-mono">{fmtNumber(o.deliveryCharge)}</td>
                    <td>{o.payment}</td>
                    <td>{o.emirate}</td>
                    <td>{o.employee.name}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
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
                        {isAgingPending(o.status, o.date) && (
                          <span
                            className="rounded bg-cancelled px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-white"
                            title="Pending more than 2 days"
                          >
                            Aging
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap font-mono text-xs text-ink-soft">
                      {new Date(o.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </td>
                    <td className="max-w-[160px] truncate text-ink-soft" title={o.remarks || ""}>
                      {o.remarks || "—"}
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
