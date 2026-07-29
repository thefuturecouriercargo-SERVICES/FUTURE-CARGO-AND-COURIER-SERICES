"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { fmtNumber, todayStr } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { CashClosing, Employee, Order, OrderStatus, STATUSES } from "@/types";

interface Summary {
  assigned: number;
  delivered: number;
  pending: number;
  cancelled: number;
  transferred: number;
  deliveryChargeEarned: number;
  cashCollected: number;
  bankCollected: number;
}

export default function DriverPortalPage() {
  const date = todayStr();
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState<OrderStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [transferOrder, setTransferOrder] = useState<Order | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ordersRes, summaryRes] = await Promise.all([
      apiFetch<{ date: string; orders: Order[] }>("/driver/orders", { query: { date } }),
      apiFetch<Summary>("/driver/summary", { query: { date } }),
    ]);
    setOrders(ordersRes.orders);
    setSummary(summaryRes);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useSocketEvent("order:assigned", load);
  useSocketEvent("order:removed", load);
  useSocketEvent("order:changed", load);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  async function updateStatus(order: Order, status: OrderStatus) {
    await apiFetch(`/orders/${order.id}/status`, { method: "PATCH", body: { status } });
    showToast(`CN ${order.cnNo} marked ${status}`);
    await load();
  }

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (tab !== "ALL" && o.status !== tab) return false;
      if (search && !String(o.cnNo).includes(search) && !o.brandName.toUpperCase().includes(search.toUpperCase())) return false;
      return true;
    });
  }, [orders, tab, search]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">{date}</p>
      <h1 className="mb-6 font-display text-2xl font-semibold text-navy">Today&apos;s Deliveries</h1>

      {summary && (
        <div className="mb-7 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
          <Kpi label="Assigned" value={summary.assigned} />
          <Kpi label="Delivered" value={summary.delivered} />
          <Kpi label="Pending" value={summary.pending} />
          <Kpi label="DL Charge (AED)" value={fmtNumber(summary.deliveryChargeEarned)} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["ALL", ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`rounded-full border px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wide ${
              tab === s ? "border-navy bg-navy text-paper" : "border-line bg-white text-ink-soft hover:border-brass"
            }`}
          >
            {s === "ALL" ? "All" : s}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search CN No…"
          className="ml-auto rounded border border-line px-3 py-1.5 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded border border-line bg-white py-16 text-center text-ink-soft">
          <div className="mb-1.5 font-display text-lg text-navy">No consignments here</div>
          Nothing matches this filter right now.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => (
            <div key={o.id} className={`flex flex-wrap items-center justify-between gap-3.5 rounded border border-line border-l-4 bg-white p-4 ${statusBorderClass(o.status)}`}>
              <div>
                <div className="font-mono text-[15px] font-bold text-navy">
                  CN {o.cnNo} <span className="font-normal text-ink-soft">— {o.brandName}</span>
                </div>
                <div className="mt-1 text-xs text-ink-soft">
                  Total <b className="text-ink">{fmtNumber(o.total)} AED</b> · DL Charge <b className="text-ink">{fmtNumber(o.deliveryCharge)} AED</b> · {o.payment} · {o.emirate}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(o, s)}
                    className={`rounded px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wide border ${
                      o.status === s ? statusSelectedClass(s) : "border-line text-ink-soft hover:-translate-y-px"
                    }`}
                  >
                    {s}
                  </button>
                ))}
                <button onClick={() => setTransferOrder(o)} className="rounded border border-transferred px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wide text-transferred hover:bg-transferred-bg">
                  Transfer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CashClosingPanel date={date} onSubmitted={() => showToast("Cash closing submitted")} />

      {transferOrder && <TransferModal order={transferOrder} onClose={() => setTransferOrder(null)} onDone={() => { setTransferOrder(null); load(); }} />}

      {toast && (
        <div className="fixed bottom-6 right-6 border-l-2 border-brass bg-navy px-5 py-3 font-mono text-xs text-paper shadow-lg">{toast}</div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white p-4">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">{label}</div>
      <div className="font-display text-xl font-semibold text-navy">{value}</div>
    </div>
  );
}

function statusBorderClass(status: OrderStatus) {
  switch (status) {
    case "DELIVERED":
      return "border-l-delivered";
    case "PENDING":
      return "border-l-pending";
    case "CANCELLED":
      return "border-l-cancelled";
    default:
      return "border-l-transferred";
  }
}

function statusSelectedClass(status: OrderStatus) {
  switch (status) {
    case "DELIVERED":
      return "border-delivered bg-delivered text-white";
    case "PENDING":
      return "border-pending bg-pending text-white";
    case "CANCELLED":
      return "border-cancelled bg-cancelled text-white";
    default:
      return "border-transferred bg-transferred text-white";
  }
}

function TransferModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [toId, setToId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Employee[]>("/employees").then((list) => setEmployees(list.filter((e) => e.id !== order.employeeId)));
  }, [order.employeeId]);

  async function submit() {
    if (!toId) {
      setError("Pick a driver to transfer to.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/orders/${order.id}/transfer`, { method: "POST", body: { toEmployeeId: toId, note } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded border border-line bg-white p-6">
        <h3 className="mb-1 font-display text-lg font-semibold text-navy">Transfer CN {order.cnNo}</h3>
        <p className="mb-4 text-xs text-ink-soft">Pick another driver to hand this consignment to.</p>
        <select value={toId} onChange={(e) => setToId(e.target.value)} className="mb-3 w-full rounded border border-line px-3 py-2 text-sm">
          <option value="">Select driver…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" className="mb-3 w-full rounded border border-line px-3 py-2 text-sm" />
        {error && <p className="mb-3 text-xs text-cancelled">{error}</p>}
        <div className="flex gap-2">
          <button onClick={submit} disabled={busy} className="flex-1 rounded bg-navy py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60">
            {busy ? "Transferring…" : "Confirm transfer"}
          </button>
          <button onClick={onClose} className="rounded border border-line px-4 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CashClosingPanel({ date, onSubmitted }: { date: string; onSubmitted: () => void }) {
  const [preview, setPreview] = useState<{ totalDelivered: number; totalDeliveryCharge: number; cashPayments: number; onlinePayments: number } | null>(null);
  const [existing, setExisting] = useState<CashClosing | null>(null);
  const [expenses, setExpenses] = useState("0");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, closings] = await Promise.all([
      apiFetch<typeof preview>("/cash-closings/preview", { query: { date } }),
      apiFetch<CashClosing[]>("/cash-closings", { query: { date } }),
    ]);
    setPreview(p);
    setExisting(closings[0] ?? null);
    if (closings[0]) {
      setExpenses(String(closings[0].expenses));
      setRemarks(closings[0].expenseRemarks ?? "");
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useSocketEvent("order:changed", load);

  const balance = preview ? preview.cashPayments - Number(expenses || 0) : 0;

  async function submit() {
    setBusy(true);
    try {
      const closing = await apiFetch<CashClosing>("/cash-closings", {
        method: "POST",
        body: { date, expenses: Number(expenses || 0), expenseRemarks: remarks },
      });
      setExisting(closing);
      onSubmitted();
    } finally {
      setBusy(false);
    }
  }

  if (!preview) return null;

  return (
    <div className="mt-10 border border-line bg-white p-6">
      <h2 className="mb-1 font-display text-lg font-semibold text-navy">Day-End Cash Closing</h2>
      <p className="mb-5 text-xs text-ink-soft">
        Totals below are computed automatically from your delivered consignments for {date}. Enter today&apos;s expenses to
        calculate your balance cash.
      </p>

      <div className="mb-5 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
        <Kpi label="Delivered" value={preview.totalDelivered} />
        <Kpi label="DL Charges" value={fmtNumber(preview.totalDeliveryCharge)} />
        <Kpi label="Cash Payments" value={fmtNumber(preview.cashPayments)} />
        <Kpi label="Online Payments" value={fmtNumber(preview.onlinePayments)} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Expenses (AED)</label>
          <input type="number" value={expenses} onChange={(e) => setExpenses(e.target.value)} className="w-full rounded border border-line px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Expense remarks</label>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="w-full rounded border border-line px-3 py-2 text-sm" placeholder="Fuel, tolls, etc." />
        </div>
      </div>

      <div className="mb-5 flex items-center justify-between rounded border border-brass/40 bg-paper-2 px-4 py-3">
        <span className="font-mono text-xs uppercase tracking-wide text-ink-soft">Balance Cash</span>
        <span className="font-display text-xl font-semibold text-navy">{fmtNumber(balance)} AED</span>
      </div>

      <button onClick={submit} disabled={busy} className="rounded bg-navy px-5 py-2.5 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60">
        {busy ? "Submitting…" : existing ? "Re-submit cash closing" : "Submit cash closing"}
      </button>
      {existing && (
        <span className="ml-3 text-xs text-ink-soft">
          Last submitted {new Date(existing.submittedAt).toLocaleTimeString()} · status {existing.status}
        </span>
      )}
    </div>
  );
}
