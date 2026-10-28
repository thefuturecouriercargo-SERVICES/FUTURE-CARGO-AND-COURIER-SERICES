"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiClientError } from "@/lib/api";
import { VendorAuthProvider } from "@/context/VendorAuthContext";
import VendorShell from "@/components/VendorShell";

interface CustomerRequest {
  id: string;
  customerName: string;
  customerPhone: string;
  address: string;
  emirate: string;
  landmark?: string | null;
  notes?: string | null;
  lat?: number | null;
  lng?: number | null;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  bookingId?: string | null;
  createdAt: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });

function Requests() {
  const router = useRouter();
  const [tab, setTab] = useState<"PENDING" | "ACCEPTED" | "REJECTED">("PENDING");
  const [data, setData] = useState<{ enabled: boolean; slug: string | null; requests: CustomerRequest[] } | null>(null);
  const [form, setForm] = useState<Record<string, { items: string; cod: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; bookingId?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    apiFetch<{ enabled: boolean; slug: string | null; requests: CustomerRequest[] }>("/vendor-portal/customer-requests", { query: { status: tab } })
      .then(setData)
      .catch(() => setData({ enabled: false, slug: null, requests: [] }));
  }, [tab]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // new requests appear by themselves
    return () => clearInterval(t);
  }, [load]);

  const link = data?.slug && typeof window !== "undefined" ? `${window.location.origin}/order/${data.slug}` : "";

  async function accept(r: CustomerRequest, confirmDuplicate = false) {
    const f = form[r.id] ?? { items: "", cod: "" };
    const cod = Number(f.cod);
    if (f.cod.trim() === "" || !Number.isFinite(cod)) return setMsg({ ok: false, text: "Enter the COD amount (0 if prepaid)." });
    setBusyId(r.id);
    setMsg(null);
    try {
      const res = await apiFetch<{ booking: { id: string; cnNo: number } }>(`/vendor-portal/customer-requests/${r.id}/accept`, {
        method: "POST",
        body: { items: f.items.trim() || undefined, codAmount: Math.round(cod), ...(confirmDuplicate ? { confirmDuplicate: true } : {}) },
      });
      setMsg({ ok: true, text: `✓ Accepted — ${r.customerName} is CN ${res.booking.cnNo}. It's in your consignments, ready to print.`, bookingId: res.booking.id });
      load();
    } catch (err) {
      const code = (err instanceof ApiClientError ? (err.details as { code?: string } | undefined)?.code : undefined) ?? "";
      if (code === "POSSIBLE_DUPLICATE" && !confirmDuplicate && window.confirm(`${(err as Error).message}\n\nSave anyway?`)) return accept(r, true);
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not accept" });
    } finally {
      setBusyId(null);
    }
  }

  async function reject(r: CustomerRequest) {
    if (!window.confirm(`Reject ${r.customerName}'s request?`)) return;
    setBusyId(r.id);
    try {
      await apiFetch(`/vendor-portal/customer-requests/${r.id}/reject`, { method: "POST" });
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt("Copy this link:", link);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!data) return <p className="text-sm text-ink-soft">Loading…</p>;
  if (!data.enabled)
    return <p className="text-sm text-ink-soft">The customer order link isn&apos;t switched on for your shop yet. Ask Future Courier to enable it.</p>;

  const share = `Hello! Please send your delivery details and location here so our courier can reach you easily:\n${link}`;

  return (
    <>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Customer link</p>
      <h1 className="mb-3 font-display text-[26px] font-semibold tracking-tight text-navy md:text-[32px]">📥 Customer requests</h1>

      <div className="mb-5 rounded border border-line bg-white p-3">
        <div className="mb-1.5 text-sm text-ink-soft">Send this link to your customer — they fill in their address and location:</div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-paper px-2 py-1.5 text-sm text-navy">{link}</code>
          <button onClick={copyLink} className="rounded border border-navy bg-white px-3 py-1.5 font-mono text-[11px] font-bold uppercase text-navy">
            {copied ? "✓ Copied" : "📋 Copy"}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(share)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-delivered px-3 py-1.5 font-mono text-[11px] font-bold uppercase text-white"
          >
            💬 Share on WhatsApp
          </a>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-1 rounded border border-line bg-white p-1">
        {(["PENDING", "ACCEPTED", "REJECTED"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded py-1.5 font-mono text-[11px] font-bold uppercase ${tab === k ? "bg-navy text-paper" : "text-ink-soft"}`}>
            {k === "PENDING" ? "New" : k === "ACCEPTED" ? "Accepted" : "Rejected"}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm ${msg.ok ? "border-delivered bg-delivered-bg text-delivered" : "border-cancelled bg-cancelled-bg text-cancelled"}`}>
          <span>{msg.text}</span>
          {msg.bookingId && (
            <button onClick={() => router.push(`/vendor-portal/labels?ids=${msg.bookingId}`)} className="rounded bg-navy px-3 py-1 font-mono text-[11px] font-bold uppercase text-paper">
              🖨 Print label
            </button>
          )}
        </div>
      )}

      {data.requests.length === 0 ? (
        <div className="rounded border border-line bg-white py-12 text-center text-sm text-ink-soft">
          {tab === "PENDING" ? "No new requests. Share the link above with your customers." : "Nothing here."}
        </div>
      ) : (
        <div className="space-y-3">
          {data.requests.map((r) => {
            const f = form[r.id] ?? { items: "", cod: "" };
            const set = (k: "items" | "cod", v: string) => setForm((prev) => ({ ...prev, [r.id]: { ...f, [k]: v } }));
            const hasPin = r.lat != null && r.lng != null;
            return (
              <div key={r.id} className="rounded border border-line bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-base">
                    👤 <b>{r.customerName}</b> · <a href={`tel:${r.customerPhone}`} className="font-mono text-navy underline">{r.customerPhone}</a>
                  </div>
                  <span className="font-mono text-[11px] text-ink-soft">{when(r.createdAt)}</span>
                </div>
                <div className="mt-1 text-sm">
                  {r.address}, <b>{r.emirate}</b>
                  {r.landmark && <span className="text-ink-soft"> · near {r.landmark}</span>}
                </div>
                {r.notes && <div className="mt-1 text-sm text-pending">Note: {r.notes}</div>}
                <div className="mt-2">
                  {hasPin ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block rounded border border-delivered px-2.5 py-1 font-mono text-[11px] font-bold uppercase text-delivered"
                    >
                      📍 Location pinned — view map
                    </a>
                  ) : (
                    <span className="inline-block rounded bg-pending-bg px-2.5 py-1 font-mono text-[11px] font-bold uppercase text-pending">No GPS pin — address only</span>
                  )}
                </div>

                {r.status === "PENDING" ? (
                  <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_120px_auto]">
                    <input value={f.items} onChange={(e) => set("items", e.target.value)} placeholder="Items, e.g. 2 × Akoya, 1 × Noir" className="rounded border border-line px-3 py-2 text-sm" />
                    <input value={f.cod} onChange={(e) => set("cod", e.target.value)} inputMode="numeric" placeholder="COD AED" className="rounded border border-line px-3 py-2 text-sm" />
                    <span className="flex gap-2">
                      <button onClick={() => accept(r)} disabled={busyId === r.id} className="flex-1 rounded bg-navy px-4 py-2 font-mono text-[11px] font-bold uppercase text-paper disabled:opacity-50">
                        {busyId === r.id ? "Saving…" : "✓ Accept"}
                      </button>
                      <button onClick={() => reject(r)} disabled={busyId === r.id} className="rounded border border-line px-3 py-2 font-mono text-[11px] uppercase text-ink-soft">
                        Reject
                      </button>
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 font-mono text-[11px] uppercase text-ink-soft">{r.status === "ACCEPTED" ? "✓ Accepted — in your consignments" : "Rejected"}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function VendorRequestsPage() {
  return (
    <VendorAuthProvider>
      <VendorShell>
        <Requests />
      </VendorShell>
    </VendorAuthProvider>
  );
}
