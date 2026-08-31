"use client";

import { Fragment, FormEvent, useCallback, useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { apiFetch, ApiClientError, vendorCreditExportUrl } from "@/lib/api";
import { fmtNumber } from "@/lib/format";

interface VendorCreditRow {
  vendor: { id: string; name: string; active: boolean };
  openingAmount: number;
  openingCancelled: number;
  todayAmount: number;
  todayCancelled: number;
  totalAmount: number;
  adjustmentTotal: number;
  cancelledTotal: number;
  totalDeliveryCharge: number;
  totalPaid: number;
  balance: number;
  pendingTotal: number;
  pendingDeliveryCharge: number;
  pendingPayable: number;
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

function addDaysStr(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const emptyPaymentForm = { date: dubaiToday(), amount: "", note: "" };

export default function VendorCreditPage() {
  const [date, setDate] = useState(dubaiToday());
  const [rows, setRows] = useState<VendorCreditRow[]>([]);
  const [expandedVendorId, setExpandedVendorId] = useState<string | null>(null);
  const [payments, setPayments] = useState<VendorPayment[]>([]);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [adjustInput, setAdjustInput] = useState<Record<string, string>>({});
  const [savingAdjust, setSavingAdjust] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await apiFetch<VendorCreditRow[]>("/vendor-credit", { query: { date } }));
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function addAdjustment(vendorId: string) {
    const amount = Number(adjustInput[vendorId]);
    if (!amount || amount === 0) return;
    setSavingAdjust(vendorId);
    try {
      await apiFetch(`/vendor-credit/${vendorId}/adjustments`, {
        method: "POST",
        body: { date: dubaiToday(), amount },
      });
      setAdjustInput((prev) => ({ ...prev, [vendorId]: "" }));
      await load();
    } finally {
      setSavingAdjust(null);
    }
  }

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
      openingAmount: acc.openingAmount + r.openingAmount,
      openingCancelled: acc.openingCancelled + r.openingCancelled,
      todayAmount: acc.todayAmount + r.todayAmount,
      todayCancelled: acc.todayCancelled + r.todayCancelled,
      totalAmount: acc.totalAmount + r.totalAmount,
      adjustmentTotal: acc.adjustmentTotal + r.adjustmentTotal,
      cancelledTotal: acc.cancelledTotal + r.cancelledTotal,
      totalDeliveryCharge: acc.totalDeliveryCharge + r.totalDeliveryCharge,
      totalPaid: acc.totalPaid + r.totalPaid,
      balance: acc.balance + r.balance,
      pendingTotal: acc.pendingTotal + r.pendingTotal,
      pendingDeliveryCharge: acc.pendingDeliveryCharge + r.pendingDeliveryCharge,
      pendingPayable: acc.pendingPayable + r.pendingPayable,
    }),
    {
      openingAmount: 0,
      openingCancelled: 0,
      todayAmount: 0,
      todayCancelled: 0,
      totalAmount: 0,
      adjustmentTotal: 0,
      cancelledTotal: 0,
      totalDeliveryCharge: 0,
      totalPaid: 0,
      balance: 0,
      pendingTotal: 0,
      pendingDeliveryCharge: 0,
      pendingPayable: 0,
    }
  );

  return (
    <AuthGate allow={["SUPER_ADMIN", "MANAGER"]}>
      <div>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Accounts</p>
            <h1 className="font-display text-3xl font-semibold text-navy">Vendor Credit</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDate(addDaysStr(date, -1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
              ← Prev
            </button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-line px-3 py-2 text-sm" />
            <button onClick={() => setDate(addDaysStr(date, 1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
              Next →
            </button>
            <button onClick={() => setDate(dubaiToday())} className="rounded bg-navy px-3 py-2 font-mono text-xs uppercase text-paper hover:bg-navy-2">
              Today
            </button>
            <a
              href={vendorCreditExportUrl({ date })}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-line bg-white px-3 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass hover:text-navy"
            >
              Download Excel
            </a>
          </div>
        </div>
        <p className="mb-6 max-w-2xl text-sm text-ink-soft">
          Shown as a ledger for <b>{date}</b>: <b>Opening Amount</b> is everything up to the day before, <b>Today</b>{" "}
          columns are just this date's activity, and <b>Total Amount</b> is the running total through this date.
          Balance = Total Amount − Cancelled − Delivery Charge (on Delivered only) − Paid.
        </p>

        <div className="border border-line bg-white p-5">
          {/* Mobile: stacked cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((r) => (
              <div key={r.vendor.id} className={`rounded border border-line p-4 ${r.vendor.active ? "" : "opacity-50"}`}>
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-display text-[15px] font-semibold text-navy">{r.vendor.name}</span>
                  <span className={`font-mono text-base font-bold ${r.balance > 0 ? "text-cancelled" : "text-delivered"}`}>
                    {fmtNumber(r.balance)}
                  </span>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-xs">
                  <div className="flex justify-between"><span className="text-ink-soft">Opening Amount</span><span>{fmtNumber(r.openingAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Opening Cancelled</span><span>{fmtNumber(r.openingCancelled)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Today&apos;s Amount</span><span>{fmtNumber(r.todayAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Today&apos;s Cancelled</span><span>{fmtNumber(r.todayCancelled)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Total Amount</span><span className="font-semibold">{fmtNumber(r.totalAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Cancelled (Total)</span><span>{fmtNumber(r.cancelledTotal)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Delivery Charge</span><span>{fmtNumber(r.totalDeliveryCharge)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Paid</span><span>{fmtNumber(r.totalPaid)}</span></div>
                </div>

                <div className="mb-3 rounded border border-line bg-paper-2 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase text-ink-soft">Adjustment</span>
                    <span className={`font-mono text-xs ${r.adjustmentTotal !== 0 ? (r.adjustmentTotal > 0 ? "text-delivered" : "text-cancelled") : "text-ink-soft"}`}>
                      {r.adjustmentTotal > 0 ? "+" : ""}
                      {fmtNumber(r.adjustmentTotal)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      placeholder="+/-"
                      value={adjustInput[r.vendor.id] ?? ""}
                      onChange={(e) => setAdjustInput((prev) => ({ ...prev, [r.vendor.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && addAdjustment(r.vendor.id)}
                      className="w-full rounded border border-line px-2 py-1 text-xs"
                    />
                    <button
                      onClick={() => addAdjustment(r.vendor.id)}
                      disabled={savingAdjust === r.vendor.id}
                      className="shrink-0 rounded bg-navy px-3 py-1 text-xs text-paper hover:bg-navy-2 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => toggleExpand(r.vendor.id)}
                  className="w-full rounded border border-line py-2 text-xs font-semibold text-brass hover:border-brass"
                >
                  {expandedVendorId === r.vendor.id ? "Close" : "Add / View Payments"}
                </button>

                {expandedVendorId === r.vendor.id && (
                  <div className="mt-3 border-t border-line pt-3">
                    <form onSubmit={(e) => addPayment(r.vendor.id, e)} className="mb-4 space-y-2.5">
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
                        <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Amount Paid (AED)</label>
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
                        <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Note (optional)</label>
                        <input
                          value={paymentForm.note}
                          onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })}
                          className="w-full rounded border border-line px-2.5 py-2 text-sm"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={saving}
                        className="w-full rounded bg-navy py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60"
                      >
                        {saving ? "Saving…" : "Add Payment"}
                      </button>
                      {error && <p className="text-xs text-cancelled">{error}</p>}
                    </form>

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
                              <button onClick={() => removePayment(r.vendor.id, p.id)} className="text-cancelled hover:underline">
                                Remove
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {rows.length > 0 && (
              <div className="rounded border-2 border-navy p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-display text-[15px] font-semibold text-navy">TOTAL</span>
                  <span className={`font-mono text-base font-bold ${totals.balance > 0 ? "text-cancelled" : "text-delivered"}`}>
                    {fmtNumber(totals.balance)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-xs">
                  <div className="flex justify-between"><span className="text-ink-soft">Total Amount</span><span>{fmtNumber(totals.totalAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Cancelled</span><span>{fmtNumber(totals.cancelledTotal)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Delivery Charge</span><span>{fmtNumber(totals.totalDeliveryCharge)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">Paid</span><span>{fmtNumber(totals.totalPaid)}</span></div>
                </div>
              </div>
            )}
          </div>

          {/* Desktop: full table */}
          <div className="table-scroll hidden md:block">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th className="text-right">Opening Amount</th>
                <th className="text-right">Opening Cancelled</th>
                <th className="text-right">Today's Amount</th>
                <th className="text-right">Today's Cancelled</th>
                <th className="text-right">Total Amount</th>
                <th className="text-right">Adjustment</th>
                <th className="text-right">Cancelled (Total)</th>
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
                    <td className="text-right font-mono">{fmtNumber(r.openingAmount)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.openingCancelled)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.todayAmount)}</td>
                    <td className="text-right font-mono">{fmtNumber(r.todayCancelled)}</td>
                    <td className="text-right font-mono font-semibold">{fmtNumber(r.totalAmount)}</td>
                    <td className="text-right font-mono">
                      <div className="flex flex-col items-end gap-1">
                        <span className={r.adjustmentTotal !== 0 ? (r.adjustmentTotal > 0 ? "text-delivered" : "text-cancelled") : "text-ink-soft"}>
                          {r.adjustmentTotal > 0 ? "+" : ""}
                          {fmtNumber(r.adjustmentTotal)}
                        </span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            placeholder="+/-"
                            value={adjustInput[r.vendor.id] ?? ""}
                            onChange={(e) => setAdjustInput((prev) => ({ ...prev, [r.vendor.id]: e.target.value }))}
                            onKeyDown={(e) => e.key === "Enter" && addAdjustment(r.vendor.id)}
                            className="w-16 rounded border border-line px-1.5 py-0.5 text-right text-xs"
                          />
                          <button
                            onClick={() => addAdjustment(r.vendor.id)}
                            disabled={savingAdjust === r.vendor.id}
                            className="rounded bg-navy px-2 py-0.5 text-xs text-paper hover:bg-navy-2 disabled:opacity-50"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </td>
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
                      <td colSpan={12} className="bg-paper-2 p-4">
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
                  <td className="text-right font-mono">{fmtNumber(totals.openingAmount)}</td>
                  <td className="text-right font-mono">{fmtNumber(totals.openingCancelled)}</td>
                  <td className="text-right font-mono">{fmtNumber(totals.todayAmount)}</td>
                  <td className="text-right font-mono">{fmtNumber(totals.todayCancelled)}</td>
                  <td className="text-right font-mono">{fmtNumber(totals.totalAmount)}</td>
                  <td className="text-right font-mono">{fmtNumber(totals.adjustmentTotal)}</td>
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

        <div className="mt-6 border border-line bg-white p-5">
          <h2 className="mb-1 font-display text-[17px] font-semibold text-navy">Pending Consignments Summary</h2>
          <p className="mb-4 max-w-2xl text-sm text-ink-soft">
            View only — what&apos;s sitting in currently Pending orders per vendor, and what would be payable to
            them (Pending Total minus Delivery Charge) once delivered. Not part of the Balance above.
          </p>

          {/* Mobile: stacked cards */}
          <div className="space-y-2.5 md:hidden">
            {rows.map((r) => (
              <div key={r.vendor.id} className={`rounded border border-line p-3.5 ${r.vendor.active ? "" : "opacity-50"}`}>
                <div className="mb-2 font-display text-sm font-semibold text-navy">{r.vendor.name}</div>
                <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
                  <div>
                    <div className="mb-0.5 text-[10px] uppercase text-ink-soft">Pending Total</div>
                    <div className="font-semibold">{fmtNumber(r.pendingTotal)}</div>
                  </div>
                  <div>
                    <div className="mb-0.5 text-[10px] uppercase text-ink-soft">Delivery Charge</div>
                    <div className="font-semibold">{fmtNumber(r.pendingDeliveryCharge)}</div>
                  </div>
                  <div>
                    <div className="mb-0.5 text-[10px] uppercase text-ink-soft">Payable</div>
                    <div className="font-semibold text-brass">{fmtNumber(r.pendingPayable)}</div>
                  </div>
                </div>
              </div>
            ))}
            {rows.length > 0 && (
              <div className="rounded border-2 border-navy p-3.5">
                <div className="mb-2 font-display text-sm font-semibold text-navy">TOTAL</div>
                <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
                  <div className="font-semibold">{fmtNumber(totals.pendingTotal)}</div>
                  <div className="font-semibold">{fmtNumber(totals.pendingDeliveryCharge)}</div>
                  <div className="font-semibold text-brass">{fmtNumber(totals.pendingPayable)}</div>
                </div>
              </div>
            )}
          </div>

          {/* Desktop: table */}
          <table className="data-table hidden md:table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th className="text-right">Pending Total</th>
                <th className="text-right">Delivery Charge</th>
                <th className="text-right">Payable Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.vendor.id} className={r.vendor.active ? "" : "opacity-50"}>
                  <td>{r.vendor.name}</td>
                  <td className="text-right font-mono">{fmtNumber(r.pendingTotal)}</td>
                  <td className="text-right font-mono">{fmtNumber(r.pendingDeliveryCharge)}</td>
                  <td className="text-right font-mono font-semibold text-brass">{fmtNumber(r.pendingPayable)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="font-semibold">
                  <td>TOTAL</td>
                  <td className="text-right font-mono">{fmtNumber(totals.pendingTotal)}</td>
                  <td className="text-right font-mono">{fmtNumber(totals.pendingDeliveryCharge)}</td>
                  <td className="text-right font-mono text-brass">{fmtNumber(totals.pendingPayable)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </AuthGate>
  );
}
