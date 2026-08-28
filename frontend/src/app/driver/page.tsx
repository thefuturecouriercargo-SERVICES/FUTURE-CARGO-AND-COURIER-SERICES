"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { fmtNumber, todayStr } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { CashClosing, Employee, Order, OrderStatus, STATUSES, Vendor } from "@/types";

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
  const [statusTab, setStatusTab] = useState<OrderStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [transferOrder, setTransferOrder] = useState<Order | null>(null);
  const [statusOrder, setStatusOrder] = useState<Order | null>(null);
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

  async function updateStatus(order: Order, status: OrderStatus, payment: "CASH" | "BANK", reason?: string) {
    if (payment !== order.payment) {
      await apiFetch(`/orders/${order.id}/payment`, { method: "PATCH", body: { payment } });
    }
    await apiFetch(`/orders/${order.id}/status`, { method: "PATCH", body: { status, reason } });
    showToast(`CN ${order.cnNo} marked ${status}`);
    await load();
  }
  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusTab !== "ALL" && o.status !== statusTab) return false;
      if (search && !String(o.cnNo).includes(search) && !o.brandName.toUpperCase().includes(search.toUpperCase())) return false;
      return true;
    });
  }, [orders, statusTab, search]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">{date}</p>
      <h1 className="mb-6 font-display text-2xl font-semibold text-navy">Today&apos;s Deliveries</h1>

      {summary && (
        <div className="mb-7 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-5">
          <Kpi label="Assigned" value={summary.assigned} />
          <Kpi label="Delivered" value={summary.delivered} />
          <Kpi label="Pending" value={summary.pending} />
          <Kpi label="DL Charge (AED)" value={fmtNumber(summary.deliveryChargeEarned)} />
          <Kpi label="Bank Deliveries" value={orders.filter((o) => o.payment === "BANK").length} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["ALL", ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusTab(s)}
            className={`rounded-full border px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wide ${
              statusTab === s ? "border-navy bg-navy text-paper" : "border-line bg-white text-ink-soft hover:border-brass"
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
                  Total <b className="text-ink">{fmtNumber(o.total)} AED</b> · DL Charge <b className="text-ink">{fmtNumber(o.deliveryCharge)} AED</b> · <span className="font-semibold text-ink">{o.payment}</span> · {o.emirate}
                </div>
                {o.remarks && (
                  <div className="mt-1 text-xs text-cancelled">
                    Reason: {o.remarks}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className={`rounded border px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wide ${statusSelectedClass(o.status)}`}>
                  {o.status}
                </span>
                <button
                  onClick={() => setStatusOrder(o)}
                  className="rounded border border-line px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wide text-ink-soft hover:-translate-y-px"
                >
                  Update Status
                </button>
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

      {statusOrder && (
        <StatusModal
          order={statusOrder}
          onClose={() => setStatusOrder(null)}
          onConfirm={async (status, payment, reason) => {
            await updateStatus(statusOrder, status, payment, reason);
            setStatusOrder(null);
          }}
        />
      )}

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

function StatusModal({
  order,
  onClose,
  onConfirm,
}: {
  order: Order;
  onClose: () => void;
  onConfirm: (status: OrderStatus, payment: "CASH" | "BANK", reason?: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<OrderStatus | null>(null);
  const [payment, setPayment] = useState<"CASH" | "BANK">(order.payment);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!selected) {
      setError("Choose a status.");
      return;
    }
    if (selected === "CANCELLED" && !reason.trim()) {
      setError("Enter a reason for cancelling.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(selected, payment, selected === "CANCELLED" ? reason.trim() : undefined);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to update status");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded border border-line bg-white p-6">
        <h3 className="mb-1 font-display text-lg font-semibold text-navy">Update CN {order.cnNo}</h3>
        <p className="mb-1 text-xs text-ink-soft">
          Total <b className="text-ink">{fmtNumber(order.total)} AED</b> · {order.brandName}
        </p>
        <p className="mb-4 text-xs text-ink-soft">
          Currently <b>{order.status}</b>. Pick the new status below. To reassign this consignment to another
          driver, use the Transfer button instead.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {STATUSES.filter((s) => s !== "TRANSFER").map((s) => (
            <button
              key={s}
              onClick={() => setSelected(s)}
              className={`rounded border px-3 py-2.5 font-mono text-xs font-bold uppercase tracking-wide ${
                selected === s ? statusSelectedClass(s) : "border-line text-ink-soft hover:border-brass"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mb-3">
          <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Payment</label>
          <div className="grid grid-cols-2 gap-2">
            {(["CASH", "BANK"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPayment(p)}
                className={`rounded border px-3 py-2.5 font-mono text-xs font-bold uppercase tracking-wide ${
                  payment === p ? "border-navy bg-navy text-paper" : "border-line text-ink-soft hover:border-brass"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {selected === "CANCELLED" && (
          <div className="mb-3">
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Reason for cancelling</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded border border-line px-3 py-2 text-sm"
              placeholder="e.g. customer refused, wrong address…"
            />
          </div>
        )}
        {error && <p className="mb-3 text-xs text-cancelled">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={confirm}
            disabled={busy || !selected}
            className="flex-1 rounded bg-navy py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Confirm"}
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
  interface PurchaseEntry {
    id: string;
    amount: number;
    note?: string | null;
    vendor?: { id: string; name: string } | null;
  }
  const [preview, setPreview] = useState<{
    totalDelivered: number;
    totalDeliveryCharge: number;
    cashPayments: number;
    onlinePayments: number;
    expenses: { id: string; category: string; amount: number }[];
    totalExpenses: number;
    purchases: PurchaseEntry[];
    totalPurchases: number;
  } | null>(null);
  const [existing, setExisting] = useState<CashClosing | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [payVendorId, setPayVendorId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payError, setPayError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, closings] = await Promise.all([
      apiFetch<typeof preview>("/cash-closings/preview", { query: { date } }),
      apiFetch<CashClosing[]>("/cash-closings", { query: { date } }),
    ]);
    setPreview(p);
    setExisting(closings[0] ?? null);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiFetch<Vendor[]>("/vendors").then(setVendors);
  }, []);

  useSocketEvent("order:changed", load);
  useSocketEvent("purchase:changed", load);

  const balance = preview ? preview.cashPayments - preview.totalExpenses - preview.totalPurchases : 0;

  async function submit() {
    setBusy(true);
    try {
   const closing = await apiFetch<CashClosing>("/cash-closings", {
          method: "POST",
          body: { date },
        });
      setExisting(closing);
      onSubmitted();
    } finally {
      setBusy(false);
    }
  }

  async function payVendor() {
    const amount = Number(payAmount);
    if (!payVendorId) {
      setPayError("Select a vendor.");
      return;
    }
    if (!amount || amount <= 0) {
      setPayError("Enter an amount.");
      return;
    }
    setPayError(null);
    setPayBusy(true);
    try {
      await apiFetch("/purchases", {
        method: "POST",
        body: { date, amount, vendorId: payVendorId, note: payNote || undefined },
      });
      setPayVendorId("");
      setPayAmount("");
      setPayNote("");
      await load();
    } catch (err) {
      setPayError(err instanceof ApiClientError ? err.message : "Failed to log payment");
    } finally {
      setPayBusy(false);
    }
  }

  async function removePurchase(id: string) {
    if (!confirm("Remove this deduction?")) return;
    await apiFetch(`/purchases/${id}`, { method: "DELETE" });
    await load();
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

    <div className="mb-4">
          <label className="mb-2 block font-mono text-[10px] uppercase text-ink-soft">Today&apos;s Expenses (entered by admin)</label>
          {preview.expenses.length === 0 ? (
            <p className="text-xs text-ink-soft">No expenses entered for you today.</p>
          ) : (
            preview.expenses.map((exp) => (
              <div key={exp.id} className="mb-2 flex items-center justify-between rounded border border-line px-3 py-2 text-sm">
                <span>{exp.category}</span>
                <span className="font-mono">{fmtNumber(exp.amount)} AED</span>
              </div>
            ))
          )}
        </div>

      <div className="mb-4">
        <label className="mb-2 block font-mono text-[10px] uppercase text-ink-soft">
          Cash Paid Out to Vendors
        </label>
        <p className="mb-2 text-xs text-ink-soft">
          If you personally handed over collected cash to a vendor today, log it here. It reduces your
          balance cash and counts toward that vendor&apos;s balance.
        </p>
        {preview.purchases.length > 0 && (
          <div className="mb-3 space-y-2">
            {preview.purchases.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded border border-line px-3 py-2 text-sm">
                <span>
                  {entry.vendor ? entry.vendor.name : "General deduction"}
                  {entry.note && <span className="text-ink-soft"> — {entry.note}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{fmtNumber(entry.amount)} AED</span>
                  <button
                    onClick={() => removePurchase(entry.id)}
                    className="text-xs text-cancelled hover:underline"
                  >
                    Remove
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select
            value={payVendorId}
            onChange={(e) => setPayVendorId(e.target.value)}
            className="rounded border border-line px-2.5 py-2 text-sm"
          >
            <option value="">Select vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Amount"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            className="rounded border border-line px-2.5 py-2 text-sm"
          />
          <input
            placeholder="Note (optional)"
            value={payNote}
            onChange={(e) => setPayNote(e.target.value)}
            className="rounded border border-line px-2.5 py-2 text-sm"
          />
          <button
            onClick={payVendor}
            disabled={payBusy}
            className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60"
          >
            {payBusy ? "Saving…" : "Log Payment"}
          </button>
        </div>
        {payError && <p className="mt-2 text-xs text-cancelled">{payError}</p>}
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
