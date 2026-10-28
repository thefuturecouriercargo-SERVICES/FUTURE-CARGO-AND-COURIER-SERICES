"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { Vendor } from "@/types";

import { confirmDialog } from "@/components/ui/Feedback";
import RowActions from "@/components/ui/RowActions";
const emptyForm = { name: "", deliveryCharge: "", username: "", password: "" };

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
    setForm({ name: v.name, deliveryCharge: String(v.deliveryCharge), username: v.username ?? "", password: "" });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        deliveryCharge: Number(form.deliveryCharge),
        username: form.username || undefined,
        ...(form.password ? { password: form.password } : {}),
      };
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
    if (!(await confirmDialog(`Remove vendor ${v.name}?`))) return;
    await apiFetch(`/vendors/${v.id}`, { method: "DELETE" });
    await load();
  }

  async function activateVendor(v: Vendor) {
    await apiFetch(`/vendors/${v.id}`, { method: "PUT", body: { active: true } });
    await load();
  }

  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Partners</p>
      <h1 className="mb-6 font-display text-[26px] font-semibold tracking-tight text-navy md:text-[32px]">Vendor Management</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-soft">
        Each vendor has a fixed delivery charge. Whenever a vendor is selected while creating a consignment, its
        delivery charge is populated automatically. Set a portal username and password to give a vendor their
        own login — they can then view their own consignments and credit balance at <b>/vendor-login</b>.
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3 border border-brass bg-paper-2 px-4 py-3 text-sm">
        <span>
          Default login for every vendor: <b className="font-mono">NAME</b> / <b className="font-mono">NAME321</b> (capitals, no spaces — e.g.{" "}
          <span className="font-mono">INSPIRED</span> / <span className="font-mono">INSPIRED321</span>). Change any vendor with Edit.
        </span>
        <button
          onClick={async () => {
            if (!(await confirmDialog("Reset EVERY vendor's portal login to NAME / NAME321? Any custom passwords will be replaced."))) return;
            await apiFetch("/vendors/reset-logins", { method: "POST" });
            await load();
            alert("Done — all vendors now use NAME / NAME321.");
          }}
          className="ml-auto rounded border border-navy bg-white px-3 py-1.5 font-mono text-[11px] uppercase text-navy hover:bg-paper"
        >
          🔑 Reset all to default
        </button>
      </div>

      <div className="mb-6 border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-[18px] font-semibold text-navy">{editingId ? "Edit Vendor" : "Add Vendor"}</h2>
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
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Portal username (optional)</label>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="For vendor portal login"
              className="rounded border border-line px-2.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">
              {editingId ? "New portal password (optional)" : "Portal password"}
            </label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Only needed with a username"
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
        <h2 className="mb-3 border-b border-line pb-2.5 font-display text-[18px] font-semibold text-navy">Vendors ({vendors.length})</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th className="text-right">Delivery Charge (AED)</th>
              <th>Portal Login</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id} className={v.active ? "" : "opacity-50"}>
                <td>{v.name}</td>
                <td className="text-right font-mono">{v.deliveryCharge}</td>
                <td className="font-mono text-ink-soft">
                  {v.username || "—"}
                  {v.username && <div className="text-[10px]">default pw: {v.username}321</div>}
                </td>
                <td>
                  <span className={`stamp ${v.active ? "delivered" : "cancelled"}`}>{v.active ? "Active" : "Inactive"}</span>
                </td>
                <td className="whitespace-nowrap text-right">
                  <RowActions
                    label={`Actions for ${v.name}`}
                    actions={[
                      { label: "Edit", onClick: () => startEdit(v) },
                      v.active ? { label: "Remove", onClick: () => removeVendor(v), danger: true } : { label: "Activate", onClick: () => activateVendor(v) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
