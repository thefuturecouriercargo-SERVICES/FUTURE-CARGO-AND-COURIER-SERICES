"use client";

import { FormEvent, useEffect, useState } from "react";
import { Booking, BookingInput, EMIRATES, Vendor } from "@/types";
import { parseWhatsappOrder } from "@/lib/parseWhatsappOrder";
import { apiFetch, ApiClientError } from "@/lib/api";
import { ESCALO_PRODUCTS, INSPIRED_PRODUCTS } from "@/lib/products";

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
  const [aiBusy, setAiBusy] = useState(false);

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
    setForm(next);
    const missing = [
      !p.customerName && "name",
      !p.customerPhone && "phone",
      !p.address && "address",
      !(p.emirate && EMIRATES.includes(p.emirate)) && "emirate",
      !p.items && "items",
      p.codAmount === undefined && "amount",
    ].filter(Boolean);
    const warn: string[] = [];
    if (missing.length && filled.length) warn.push(`⚠ Not found: ${missing.join(", ")} — please type ${missing.length > 1 ? "them" : "it"}.`);
    if (p.codAmount && p.itemSum !== undefined && p.itemSum !== p.codAmount) warn.push(`⚠ Item prices add up to AED ${p.itemSum} but the total says AED ${p.codAmount} — check the amount.`);
    if (p.notes?.startsWith("Prepaid")) warn.push("ℹ Message says paid — amount set to 0.");
    setPasteMsg(
      filled.length
        ? [`✓ Filled ${filled.join(", ")}. ✨ AI is double-checking…`, ...warn].join("\n")
        : "✨ AI is reading the message…"
    );
    aiCheck(paste, next);
  }

  // Second opinion from AI: fixes what the rules got wrong (e.g. a name read as an item).
  // Only fields the user hasn't touched since the rules filled them are replaced.
  async function aiCheck(text: string, ruleForm: typeof EMPTY) {
    setAiBusy(true);
    const low = text.toLowerCase();
    const products = [...ESCALO_PRODUCTS, ...INSPIRED_PRODUCTS].filter((n) => n.length > 2 && low.includes(n.toLowerCase())).slice(0, 60);
    try {
      const res = await apiFetch<{ order: { customerName: string | null; customerPhone: string | null; address: string | null; emirate: string | null; items: string | null; codAmount: number | null; notes: string | null; vendorRef: string | null; unclear: string[] } | null }>(
        `${vendors ? "/bookings" : "/vendor-portal"}/message-read`,
        { method: "POST", body: { text, products } }
      );
      const a = res.order;
      if (!a) throw new Error("no result");
      const changed: string[] = [];
      setForm((cur) => {
        const out = { ...cur };
        const put = (k: keyof typeof EMPTY, v: string | null | undefined, label: string) => {
          if (v == null || v === "" || cur[k] !== ruleForm[k]) return;
          if (k === "emirate" && !EMIRATES.includes(v)) return;
          if (out[k] !== v) changed.push(label);
          out[k] = v;
        };
        put("customerName", a.customerName, "name");
        put("customerPhone", a.customerPhone, "phone");
        put("address", a.address, "address");
        put("emirate", a.emirate, "emirate");
        put("items", a.items, "items");
        put("codAmount", a.codAmount == null ? null : String(a.codAmount), "amount");
        put("notes", a.notes, "notes");
        put("vendorRef", a.vendorRef, "bill no");
        return out;
      });
      const sum = (a.items ?? "").match(/AED\s*([\d,]+)/gi)?.reduce((t, m) => t + Number(m.replace(/[^\d]/g, "")), 0);
      const warn: string[] = [];
      if (sum && a.codAmount != null && sum !== a.codAmount) warn.push(`⚠ Item prices add up to AED ${sum} but the amount is AED ${a.codAmount} — check it.`);
      const missing = [!a.customerName && "name", !a.customerPhone && "phone", !a.address && "address", !a.items && "items", a.codAmount == null && "amount"].filter(Boolean);
      if (missing.length) warn.push(`⚠ Not in the message: ${missing.join(", ")} — please type ${missing.length > 1 ? "them" : "it"}.`);
      if (a.unclear?.length) warn.push(`⚠ AI wasn't sure about: ${a.unclear.join(", ")}.`);
      setPasteMsg([`✨ AI checked the message${changed.length ? ` and corrected ${changed.join(", ")}` : " — all fields agree"}. Please check before saving.`, ...warn].join("\n"));
    } catch {
      setPasteMsg((m) => m.replace("✨ AI is double-checking…", "Please check every field before saving. (AI check not available right now.)").replace("✨ AI is reading the message…", "Couldn't recognise anything — please type the details in."));
    } finally {
      setAiBusy(false);
    }
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
    if (form.codAmount.trim() === "" || Number.isNaN(cod)) return setError("Enter the COD amount (0 if prepaid, minus for a refund).");

    const payload: BookingInput = {
      vendorRef: form.vendorRef.trim() || undefined,
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone.trim(),
      address: form.address.trim(),
      emirate: form.emirate,
      items: form.items.trim() || undefined,
      codAmount: Math.round(cod),
      notes: form.notes.trim() || undefined,
    };

    setSaving(true);
    try {
      try {
        await onSubmit(payload, vendors ? vendorId : undefined);
      } catch (err) {
        // Same phone + amount already entered recently → ask before saving a second CN.
        const details = err instanceof ApiClientError ? (err.details as { code?: string } | undefined) : undefined;
        if (details?.code === "POSSIBLE_DUPLICATE") {
          if (!window.confirm(`${err instanceof Error ? err.message : "Possible duplicate."}\n\nIs this a different order? Press OK to save it anyway, or Cancel to stop.`)) {
            setError("Not saved — looks like a duplicate.");
            return;
          }
          await onSubmit({ ...payload, confirmDuplicate: true }, vendors ? vendorId : undefined);
        } else {
          throw err;
        }
      }
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
              disabled={!paste.trim() || aiBusy}
              className="rounded border border-navy bg-white px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-navy hover:bg-paper-2 disabled:opacity-40"
            >
              {aiBusy ? "✨ Reading…" : "⤵ Fill form from message"}
            </button>
            {pasteMsg && <span className={`whitespace-pre-line text-xs ${pasteMsg.includes("⚠") ? "font-semibold text-cancelled" : "text-ink-soft"}`}>{pasteMsg}</span>}
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
          <div className="flex gap-1">
            <input value={form.codAmount} onChange={set("codAmount")} className={input} required inputMode="numeric" placeholder="0 if prepaid" />
            <button
              type="button"
              onClick={() => setForm({ ...form, codAmount: form.codAmount.trim().startsWith("-") ? form.codAmount.trim().slice(1) : `-${form.codAmount.trim()}` })}
              title="Refund: the driver gives this amount to the customer"
              className={`shrink-0 rounded border px-2 font-mono text-[10px] font-bold uppercase ${form.codAmount.trim().startsWith("-") ? "border-transferred bg-transferred-bg text-transferred" : "border-line bg-white text-ink-soft"}`}
            >
              ↩ Refund
            </button>
          </div>
          {form.codAmount.trim().startsWith("-") && <p className="mt-1 text-xs text-transferred">Refund — the driver gives AED {form.codAmount.trim().slice(1) || "…"} to the customer.</p>}
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Items</label>
          <textarea value={form.items} onChange={set("items")} className={input} rows={2} maxLength={1500} placeholder="e.g. 2 × Akoya (AED 80), 1 × Noir (AED 40)" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Notes for driver</label>
          <input value={form.notes} onChange={set("notes")} className={input} maxLength={500} placeholder="e.g. call before coming, deliver after 5pm" />
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
