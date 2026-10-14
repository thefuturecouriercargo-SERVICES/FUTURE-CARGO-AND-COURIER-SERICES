"use client";

import { FormEvent, useEffect, useState } from "react";
import { Booking, BookingInput, EMIRATES, Vendor } from "@/types";
import { parseWhatsappOrder } from "@/lib/parseWhatsappOrder";

interface Props {
  /** When set, the form edits this booking instead of creating a new one. */
  editing?: Booking | null;
  /** Office mode: show a vendor picker. */
  vendors?: Vendor[];
  onSubmit: (input: BookingInput, vendorId?: string) => Promise<void>;
  onCancelEdit?: () => void;
}

const EMPTY = { vendorRef: "", customerName: "", customerPhone: "", address: "", emirate: "DUBAI", items: "", codAmount: "", notes: "" };

const input = "w-full rounded border border-line px-2.5 py-2 text-sm";
const labelCls = "mb-1 block font-mono text-[10px] uppercase text-ink-soft";

export default function BookingForm({ editing, vendors, onSubmit, onCancelEdit }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [vendorId, setVendorId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");

  function fillFromMessage() {
    const p = parseWhatsappOrder(paste);
    const filled: string[] = [];
    const next = { ...form };
    if (p.customerName) { next.customerName = p.customerName; filled.push("name"); }
    if (p.customerPhone) { next.customerPhone = p.customerPhone; filled.push("phone"); }
    if (p.address) { next.address = p.address; filled.push("address"); }
    if (p.emirate && EMIRATES.includes(p.emirate)) { next.emirate = p.emirate; filled.push("emirate"); }
    if (p.items) { next.items = p.items; filled.push("items"); }
    if (p.codAmount !== undefined) { next.codAmount = String(p.codAmount); filled.push("amount"); }
    if (p.notes) { next.notes = p.notes; filled.push("notes"); }
    if (p.vendorRef) { next.vendorRef = p.vendorRef; filled.push("order No."); }
    setForm(next);
    setPasteMsg(
      filled.length
        ? `Filled ${filled.join(", ")}. Please check every field before saving.`
        : "Couldn't recognise anything — please type the details in."
    );
  }

  useEffect(() => {
    if (editing) {
      setForm({
        vendorRef: editing.vendorRef ?? "",
        customerName: editing.customerName,
        customerPhone: editing.customerPhone,
        address: editing.address,
        emirate: editing.emirate,
        items: editing.items ?? "",
        codAmount: String(editing.codAmount),
        notes: editing.notes ?? "",
      });
      setVendorId(editing.vendorId);
    } else {
      setForm(EMPTY);
    }
    setError("");
  }, [editing]);

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });


  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (vendors && !vendorId) return setError("Choose a vendor.");
    const cod = Number(form.codAmount);
    if (form.codAmount.trim() === "" || Number.isNaN(cod) || cod < 0) return setError("Enter the COD amount (0 if prepaid).");

    setSaving(true);
    try {
      await onSubmit(
        {
          vendorRef: form.vendorRef.trim() || undefined,
          customerName: form.customerName.trim(),
          customerPhone: form.customerPhone.trim(),
          address: form.address.trim(),
          emirate: form.emirate,
          items: form.items.trim() || undefined,
          codAmount: Math.round(cod),
          notes: form.notes.trim() || undefined,
        },
        vendors ? vendorId : undefined
      );
      if (!editing) {
        setForm({ ...EMPTY, emirate: form.emirate });
        setPaste("");
        setPasteMsg("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="border border-line bg-white p-5">
      <h2 className="mb-4 font-display text-[17px] font-semibold text-navy">
        {editing ? `Edit consignment CN ${editing.cnNo}` : "New consignment"}
      </h2>

      {!editing && (
        <div className="mb-4 border border-dashed border-brass bg-paper p-3">
          <label className={labelCls}>Paste WhatsApp order (optional)</label>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={4}
            className={input}
            placeholder={"Paste the customer's WhatsApp message here, e.g.\nName: Fatima\nPhone: 050 123 4567\nAddress: Al Nahda, Sharjah\nTotal: 250 AED"}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={fillFromMessage}
              disabled={!paste.trim()}
              className="rounded border border-navy bg-white px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-navy hover:bg-paper-2 disabled:opacity-40"
            >
              ⤵ Fill form from message
            </button>
            {pasteMsg && <span className="text-xs text-ink-soft">{pasteMsg}</span>}
          </div>
        </div>
      )}

      {vendors && (
        <div className="mb-3">
          <label className={labelCls}>Vendor</label>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={input} disabled={Boolean(editing)}>
            <option value="">Choose vendor…</option>
            {vendors
              .filter((v) => v.active !== false)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Customer name *</label>
          <input value={form.customerName} onChange={set("customerName")} className={input} required maxLength={120} />
        </div>
        <div>
          <label className={labelCls}>Customer phone *</label>
          <input value={form.customerPhone} onChange={set("customerPhone")} className={input} required inputMode="tel" placeholder="05x xxx xxxx" maxLength={30} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Address *</label>
          <textarea value={form.address} onChange={set("address")} className={input} required rows={2} maxLength={500} placeholder="Building, street, area, landmark" />
        </div>
        <div>
          <label className={labelCls}>Emirate *</label>
          <select value={form.emirate} onChange={set("emirate")} className={input}>
            {EMIRATES.filter((e) => e !== "EXCHANGED").map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>COD amount (AED) *</label>
          <input value={form.codAmount} onChange={set("codAmount")} className={input} required inputMode="numeric" placeholder="0 if prepaid" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Items</label>
          <input value={form.items} onChange={set("items")} className={input} maxLength={500} placeholder="e.g. 2 × T-shirt, 1 × perfume" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Notes for driver</label>
          <input value={form.notes} onChange={set("notes")} className={input} maxLength={500} placeholder="e.g. call before coming, deliver after 5pm" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Your order / bill No. (optional)</label>
          <input
            value={form.vendorRef}
            onChange={set("vendorRef")}
            className={`${input} font-mono`}
            maxLength={50}
            placeholder="e.g. 20308 — the number on your own bill or barcode"
          />
          <p className="mt-1 text-[11px] text-ink-soft">
            Kept as your reference only. Future Courier gives every consignment its own CN number after you save.
          </p>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-cancelled">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={saving} className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-50">
          {saving ? "Saving…" : editing ? "Save changes" : "Save consignment"}
        </button>
        {editing && onCancelEdit && (
          <button type="button" onClick={onCancelEdit} className="rounded border border-line px-4 py-2 font-mono text-xs uppercase tracking-wide hover:border-brass">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
