"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { Vendor } from "@/types";

const emptyForm = { name: "", deliveryCharge: "" };

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setVendors(await apiFetch<Vendor[]>("/vendors", { query: { includeInactive: true } }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function startEdit(v: Vendor) {
    setEditingId(v.id);
    setForm({ name: v.name, deliveryCharge: String(v.deliveryCharge) });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = { name: form.name, deliveryCharge: Number(form.deliveryCharge) };
      if (editingId) {
        await apiFetch(`/vendors/${editingId}`, { method: "PUT", body: payload });
      } else {
        await apiFetch("/vendors", { method: "POST", body: payload });
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save vendor");
    } finally {
      setSaving(false);
    }
  }

  async function removeVendor(v: Vendor) {
    if (!confirm(`Remove vendor ${v.name}?`)) return;
    await apiFetch(`/vendors/${v.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Settings</p>
      <h1 className="mb-6 font-display text-3xl font-semibold text-navy">Vendor Management</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-soft">
        Each vendor has a fixed delivery charge. Whenever a vendor is selected while creating a consignment, its
        delivery charge is populated automatically.
      </p>

      <div className="mb-6 border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-[17px] font-semibold text-navy">{editingId ? "Edit Vendor" : "Add Vendor"}</h2>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Vendor name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded border border-line px-2.5 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Delivery charge (AED)</label>
            <input
              required
              type="number"
              value={form.deliveryCharge}
              onChange={(e) => setForm({ ...form, deliveryCharge: e.target.value })}
              className="rounded border border-line px-2.5 py-2 text-sm"
            />
          </div>
          <button type="submit" disabled={saving} className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60">
            {saving ? "Saving…" : editingId ? "Save changes" : "Add vendor"}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="rounded border border-line px-4 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass">
              Cancel
            </button>
          )}
          {error && <span className="text-xs text-cancelled">{error}</span>}
        </form>
      </div>

      <div className="border border-line bg-white p-5">
        <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">Vendors ({vendors.length})</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th className="text-right">Delivery Charge (AED)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id} className={v.active ? "" : "opacity-50"}>
                <td>{v.name}</td>
                <td className="text-right font-mono">{v.deliveryCharge}</td>
                <td>
                  <span className={`stamp ${v.active ? "delivered" : "cancelled"}`}>{v.active ? "Active" : "Inactive"}</span>
                </td>
                <td className="whitespace-nowrap">
                  <button onClick={() => startEdit(v)} className="mr-2 text-xs text-brass hover:underline">
                    Edit
                  </button>
                  <button onClick={() => removeVendor(v)} className="text-xs text-cancelled hover:underline">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
