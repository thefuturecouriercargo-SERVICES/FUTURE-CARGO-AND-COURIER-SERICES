"use client";

import { Fragment, FormEvent, useCallback, useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { apiFetch, ApiClientError } from "@/lib/api";
import { fmtNumber } from "@/lib/format";

interface VendorCreditRow {
  vendor: { id: string; name: string; active: boolean };
  totalAmount: number;
  cancelledTotal: number;
  totalDeliveryCharge: number;
  totalPaid: number;
  balance: number;
}

interface VendorPayment {
  id: string;
  vendorId: string;
  date: string;
  amount: number;
  note?: string | null;
  createdAt: string;
}

function dubaiToday(): string {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

const emptyPaymentForm = { date: dubaiToday(), amount: "", note: "" };

export default function VendorCreditPage() {
  const [rows, setRows] = useState<VendorCreditRow[]>([]);
  const [expandedVendorId, setExpandedVendorId] = useState<string | null>(null);
  const [payments, setPayments] = useState<VendorPayment[]>([]);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);

  const load = useCallback(async () => {
    setRows(await apiFetch<VendorCreditRow[]>("/vendor-credit"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleExpand(vendorId: string) {
    if (expandedVendorId === vendorId) {
      setExpandedVendorId(null);
      return;
    }
    setExpandedVendorId(vendorId);
    setPaymentForm(emptyPaymentForm);
    setError(null);
    setLoadingPayments(true);
    try {
      setPayments(await apiFetch<VendorPayment[]>(`/vendor-credit/${vendorId}/payments`));
    } finally {
      setLoadingPayments(false);
    }
  }

  async function addPayment(vendorId: string, e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiFetch(`/vendor-credit/${vendorId}/payments`, {
        method: "POST",
        body: { date: paymentForm.date, amount: Number(paymentForm.amount), note: paymentForm.note || undefined },
      });
      setPaymentForm(emptyPaymentForm);
      setPayments(await apiFetch<VendorPayment[]>(`/vendor-credit/${vendorId}/payments`));
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save payment");
    } finally {
      setSaving(false);
    }
  }

  async function removePayment(vendorId: string, paymentId: string) {
    if (!confirm("Remove this payment entry?")) return;
    await apiFetch(`/vendor-credit/payments/${paymentId}`, { method: "DELETE" });
    setPayments(await apiFetch<VendorPayment[]>(`/vendor-credit/${vendorId}/payments`));
    await load();
  }

  const totals = rows.reduce(
    (acc, r) => ({
      totalAmount: acc.totalAmount + r.totalAmount,
      cancelledTotal: acc.cancelledTotal + r.cancelledTotal,
      totalDeliveryCharge: acc.totalDeliveryCharge + r.totalDeliveryCharge,
      totalPaid: acc.totalPaid + r.totalPaid,
      balance: acc.balance + r.balance,
    }),
    { totalAmount: 0, cancelledTotal: 0, totalDeliveryCharge: 0, totalPaid: 0, balance: 0 }
  );

  return (
    <AuthGate allow={["SUPER_ADMIN", "MANAGER"]}>
      <div>
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Accounts</p>
        <h1 className="mb-2 font-display text-3xl font-semibold text-navy">Vendor Credit</h1>
        <p className="mb-6 max-w-2xl text-sm text-ink-soft">
          What's left to pay each vendor: total amount of every consignment taken from them, minus cancelled
          orders, minus our delivery charge (only counted once an order is actually delivered), minus what
          you&apos;ve already paid. Pending orders stay counted in the total — once delivered, their delivery
          charge is deducted automatically.
        </p>

        <div className="border border-line bg-white p-5">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th className="text-right">Total Amount</th>
                <th className="text-right">Cancelled</th>
                <th className="text-right">Delivery Charge</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Balance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.vendor.id}>
                  <tr className={r.vendor.active ? "" : "opacity-50"}>
                    <td>{r.vendor.name}</td>
                    <td className="text-right font-mono">{fmtNumber(r.totalAmount)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.cancelledTotal)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.totalDeliveryCharge)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.totalPaid)}</td>
                    <td className={`text-right font-mono font-semibold ${r.balance > 0 ? "text-cancelled" : "text-delivered"}`}>
                      {fmtNumber(r.balance)}
                    </td>
                    <td>
                      <button
                        onClick={() => toggleExpand(r.vendor.id)}
                        className="text-xs text-brass hover:underline"
                      >
                        {expandedVendorId === r.vendor.id ? "Close" : "Add / View Payments"}
                      </button>
                    </td>
                  </tr>
                  {expandedVendorId === r.vendor.id && (
                    <tr>
                      <td colSpan={7} className="bg-paper-2 p-4">
                        <form
                          onSubmit={(e) => addPayment(r.vendor.id, e)}
                          className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4"
                        >
                          <div>
                            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Date</label>
                            <input
                              type="date"
                              required
                              value={paymentForm.date}
                              onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                              className="w-full rounded border border-line px-2.5 py-2 text-sm"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">
                              Amount Paid (AED)
                            </label>
                            <input
                              type="number"
                              required
                              min={1}
                              value={paymentForm.amount}
                              onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                              className="w-full rounded border border-line px-2.5 py-2 text-sm"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">
                              Note (optional)
                            </label>
                            <input
                              value={paymentForm.note}
                              onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })}
                              className="w-full rounded border border-line px-2.5 py-2 text-sm"
                            />
                          </div>
                          <div className="flex items-end gap-3">
                            <button
                              type="submit"
                              disabled={saving}
                              className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60"
                            >
                              {saving ? "Saving…" : "Add Payment"}
                            </button>
                          </div>
                          {error && <span className="col-span-full text-xs text-cancelled">{error}</span>}
                        </form>

                        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-ink-soft">
                          Payment history
                        </h3>
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
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {payments.map((p) => (
                                <tr key={p.id}>
                                  <td>{p.date.slice(0, 10)}</td>
                                  <td className="text-right font-mono">{fmtNumber(p.amount)}</td>
                                  <td className="text-ink-soft">{p.note || "—"}</td>
                                  <td>
                                    <button
                                      onClick={() => removePayment(r.vendor.id, p.id)}
                                      className="text-xs text-cancelled hover:underline"
                                    >
                                      Remove
                                    </button>
                                  </td>
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
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="font-semibold">
                  <td>TOTAL</td>
                  <td className="text-right font-mono">{fmtNumber(totals.totalAmount)}</td>
                  <td className="text-right font-mono">{fmtNumber(totals.cancelledTotal)}</td>
                  <td className="text-right font-mono">{fmtNumber(totals.totalDeliveryCharge)}</td>
                  <td className="text-right font-mono">{fmtNumber(totals.totalPaid)}</td>
                  <td className="text-right font-mono">{fmtNumber(totals.balance)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </AuthGate>
  );
}
