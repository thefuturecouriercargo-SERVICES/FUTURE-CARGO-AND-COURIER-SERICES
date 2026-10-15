"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";

interface Status {
  configured: boolean;
  url: string | null;
  vendorName: string;
  statuses: string[];
  lastSync: { at: string; imported: number; skipped: number; errors: string[] } | null;
}

interface TestOrder {
  id: number;
  number: string;
  status: string;
  date: string;
  total: string;
  paymentMethod?: string;
  mapped: { customerName: string; customerPhone: string; address: string; emirate: string; items?: string; codAmount: number };
}

/** Inspired website connection: status, Sync now, and a Test that shows what the website sends. */
export default function InspiredSyncPanel({ onSynced }: { onSynced?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"" | "sync" | "test">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sample, setSample] = useState<TestOrder[] | null>(null);

  const loadStatus = () => apiFetch<Status>("/integrations/inspired/status").then(setStatus).catch(() => {});
  useEffect(() => {
    loadStatus();
  }, []);

  async function sync() {
    setBusy("sync");
    setMsg(null);
    try {
      const r = await apiFetch<{ imported: number; skipped: number; errors: string[] }>("/integrations/inspired/sync", { method: "POST" });
      setMsg({
        ok: r.errors.length === 0,
        text: `${r.imported} new website order${r.imported === 1 ? "" : "s"} added, ${r.skipped} already here.${r.errors.length ? ` Problems: ${r.errors.join("; ")}` : ""}`,
      });
      onSynced?.();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Sync failed" });
    } finally {
      setBusy("");
      loadStatus();
    }
  }

  async function test() {
    setBusy("test");
    setMsg(null);
    setSample(null);
    try {
      const r = await apiFetch<{ orders: TestOrder[] }>("/integrations/inspired/test", { method: "POST" });
      setSample(r.orders);
      setMsg({ ok: true, text: `Connected ✓ — latest ${r.orders.length} website orders below (nothing imported).` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Connection failed" });
    } finally {
      setBusy("");
    }
  }

  if (!status) return null;

  return (
    <div className="mb-5 max-w-3xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-display text-[15px] font-semibold text-navy">Inspired website orders</span>{" "}
          {status.configured ? (
            <span className="text-xs text-delivered">● connected — checks every 5 min</span>
          ) : (
            <span className="text-xs text-cancelled">● not connected</span>
          )}
          {status.lastSync && (
            <div className="text-[11px] text-ink-soft">
              Last check {new Date(status.lastSync.at).toLocaleTimeString("en-GB")}: {status.lastSync.imported} added
              {status.lastSync.errors.length > 0 && <span className="text-cancelled"> · {status.lastSync.errors[0]}</span>}
            </div>
          )}
        </div>
        {status.configured && (
          <div className="flex gap-2">
            <button onClick={test} disabled={!!busy} className="rounded border border-navy px-3 py-1.5 font-mono text-[11px] uppercase text-navy disabled:opacity-50">
              {busy === "test" ? "Testing…" : "Test connection"}
            </button>
            <button onClick={sync} disabled={!!busy} className="rounded bg-navy px-3 py-1.5 font-mono text-[11px] uppercase text-paper disabled:opacity-50">
              {busy === "sync" ? "Syncing…" : "⟳ Sync now"}
            </button>
          </div>
        )}
      </div>

      {!status.configured && (
        <p className="mt-2 text-xs text-ink-soft">
          Add <code>INSPIRED_WC_URL</code>, <code>INSPIRED_WC_KEY</code> and <code>INSPIRED_WC_SECRET</code> to the backend variables in Railway.
        </p>
      )}

      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-delivered" : "text-cancelled"}`}>{msg.text}</p>}

      {sample && sample.length > 0 && (
        <div className="mt-3 space-y-2">
          {sample.map((o) => (
            <div key={o.id} className="rounded border border-line bg-paper p-2.5 text-sm">
              <div>
                <b className="font-mono">Order #{o.number}</b>
                {String(o.id) !== o.number && <span className="text-ink-soft"> (id {o.id})</span>} · {o.status} · {new Date(o.date).toLocaleString("en-GB")} ·
                AED {o.total} · {o.paymentMethod}
              </div>
              <div className="text-ink-soft">
                → {o.mapped.customerName} · {o.mapped.customerPhone} · {o.mapped.address}, {o.mapped.emirate} · COD {fmtNumber(o.mapped.codAmount)}
              </div>
              {o.mapped.items && <div className="text-xs text-ink-soft">{o.mapped.items}</div>}
            </div>
          ))}
          <p className="text-[11px] text-ink-soft">
            Compare an order number here with the barcode on that order&apos;s printed bill — if they match, scanning their bill works on Scan &amp; Assign.
          </p>
        </div>
      )}
    </div>
  );
}
