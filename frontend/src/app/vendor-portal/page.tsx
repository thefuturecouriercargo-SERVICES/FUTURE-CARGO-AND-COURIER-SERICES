"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { VendorAuthProvider, useVendorAuth } from "@/context/VendorAuthContext";

interface VendorOrder {
  id: string;
  date: string;
  cnNo: number;
  total: number;
  deliveryCharge: number;
  status: "PENDING" | "DELIVERED" | "TRANSFER" | "CANCELLED";
  emirate: string;
}

interface CreditSummary {
  totalAmount: number;
  cancelledTotal: number;
  totalDeliveryCharge: number;
  totalPaid: number;
  balance: number;
}

interface VendorPayment {
  id: string;
  date: string;
  amount: number;
  note?: string | null;
}

function statusClass(status: VendorOrder["status"]) {
  switch (status) {
    case "DELIVERED":
      return "bg-delivered text-white";
    case "PENDING":
      return "bg-pending text-white";
    case "CANCELLED":
      return "bg-cancelled text-white";
    default:
      return "bg-transferred text-white";
  }
}

function VendorPortalContent() {
  const { vendor, loading, logout } = useVendorAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<VendorOrder[]>([]);
  const [credit, setCredit] = useState<CreditSummary | null>(null);
  const [payments, setPayments] = useState<VendorPayment[]>([]);
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    const [ordersRes, creditRes, paymentsRes] = await Promise.all([
      apiFetch<{ orders: VendorOrder[] }>("/vendor-portal/orders"),
      apiFetch<CreditSummary>("/vendor-portal/credit"),
      apiFetch<VendorPayment[]>("/vendor-portal/credit/payments"),
    ]);
    setOrders(ordersRes.orders);
    setCredit(creditRes);
    setPayments(paymentsRes);
  }, []);

  useEffect(() => {
    if (!loading && !vendor) {
      router.push("/vendor-login");
    }
  }, [loading, vendor, router]);

  useEffect(() => {
    if (vendor) load();
  }, [vendor, load]);

  if (loading || !vendor) {
    return <div className="flex min-h-screen items-center justify-center text-ink-soft">Loading…</div>;
  }

  const filtered = statusFilter ? orders.filter((o) => o.status === statusFilter) : orders;

  return (
    <div className="min-h-screen bg-paper">
      <div className="flex h-16 items-center justify-between border-b-[3px] border-brass bg-navy px-4 text-paper md:px-6">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-lg font-bold md:text-xl">{vendor.name}</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-brass-light sm:inline">
            Vendor Portal
          </span>
        </div>
        <button
          onClick={logout}
          className="rounded border border-white/25 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-line hover:border-brass-light hover:text-white"
        >
          Sign out
        </button>
      </div>

      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Overview</p>
        <h1 className="mb-6 font-display text-3xl font-semibold text-navy">Your Account</h1>

        {credit && (
          <div className="mb-8 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-5">
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Total Amount</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(credit.totalAmount)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Cancelled</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(credit.cancelledTotal)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Delivery Charge</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(credit.totalDeliveryCharge)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Paid</div>
              <div className="font-display text-xl font-semibold text-navy">{fmtNumber(credit.totalPaid)}</div>
            </div>
            <div className="bg-white p-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Balance</div>
              <div className={`font-display text-xl font-semibold ${credit.balance > 0 ? "text-cancelled" : "text-delivered"}`}>
                {fmtNumber(credit.balance)}
              </div>
            </div>
          </div>
        )}

        <div className="mb-8 border border-line bg-white p-5">
          <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">
            Payment History
          </h2>
          {payments.length === 0 ? (
            <p className="text-sm text-ink-soft">No payments recorded yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="text-right">Amount</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.date.slice(0, 10)}</td>
                    <td className="text-right font-mono">{fmtNumber(p.amount)}</td>
                    <td className="text-ink-soft">{p.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border border-line bg-white p-5">
          <div className="mb-3 flex items-center justify-between border-b border-line pb-2.5">
            <h2 className="font-display text-[17px] font-semibold text-navy">Your Consignments</h2>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded border border-line px-2.5 py-1.5 text-xs"
            >
              <option value="">All statuses</option>
              <option value="DELIVERED">Delivered</option>
              <option value="PENDING">Pending</option>
              <option value="TRANSFER">Transfer</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>CN No.</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">DL Charge</th>
                  <th>Emirate</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-ink-soft">
                      No consignments found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((o) => (
                    <tr key={o.id}>
                      <td>{o.date.slice(0, 10)}</td>
                      <td className="font-mono">{o.cnNo}</td>
                      <td className="text-right font-mono">{fmtNumber(o.total)}</td>
                      <td className="text-right font-mono">{fmtNumber(o.deliveryCharge)}</td>
                      <td>{o.emirate}</td>
                      <td>
                        <span className={`rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide ${statusClass(o.status)}`}>
                          {o.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VendorPortalPage() {
  return (
    <VendorAuthProvider>
      <VendorPortalContent />
    </VendorAuthProvider>
  );
}
