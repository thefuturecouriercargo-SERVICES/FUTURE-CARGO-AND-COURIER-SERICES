"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { Order } from "@/types";

/**
 * "⋯ → Edit address & phone" for one CN. Admin saves through /orders/:id/contact,
 * a driver through /driver/orders/:id/contact (only his own parcels).
 * Booked orders update the booking itself; office-typed orders keep it on the order.
 */
export default function ContactEditModal({
  order,
  asDriver,
  onClose,
  onSaved,
}: {
  order: Order;
  asDriver?: boolean;
  onClose: () => void;
  onSaved: (o: Order) => void;
}) {
  const [phone, setPhone] = useState(order.booking?.customerPhone ?? "");
  const [address, setAddress] = useState(order.booking?.address ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isBooked = Boolean(order.booking) && !order.booking?.manual;

  async function save() {
    if (isBooked && (!phone.trim() || !address.trim())) {
      setError("Phone and address can't be empty for a vendor booking");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const url = asDriver ? `/driver/orders/${order.id}/contact` : `/orders/${order.id}/contact`;
      const updated = await apiFetch<Order>(url, { method: "PATCH", body: { phone: phone.trim(), address: address.trim() } });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-navy">Edit CN {order.cnNo}</h3>
          <button onClick={onClose} className="px-2 text-xl text-ink-soft" aria-label="Close">
            ×
          </button>
        </div>
        <p className="mb-3 text-xs text-ink-soft">
          {order.brandName}
          {order.booking?.customerName ? ` · ${order.booking.customerName}` : ""}
        </p>
        <label className="mb-1 block font-mono text-[11px] uppercase tracking-wide text-ink-soft">Customer phone</label>
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="05x xxx xxxx"
          className="mb-3 w-full rounded border border-line px-3 py-2"
        />
        <label className="mb-1 block font-mono text-[11px] uppercase tracking-wide text-ink-soft">Address</label>
        <textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={3}
          placeholder="Building, street, area"
          className="mb-3 w-full rounded border border-line px-3 py-2"
        />
        {error && <p className="mb-2 text-sm text-cancelled">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded border border-line px-3 py-2 text-sm">
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="flex-1 rounded bg-navy px-3 py-2 text-sm font-semibold text-paper disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
