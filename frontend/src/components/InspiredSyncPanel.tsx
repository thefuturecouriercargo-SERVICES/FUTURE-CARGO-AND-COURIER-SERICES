"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, fmtDateTime } from "@/lib/format";

interface Status {
  configured: boolean;
  url: string | null;
  vendorName: string;
  statuses: string[];
  lastSync: { at: string; imported: number; skipped: number; updated?: number; rejected?: number; flagged?: number; errors: string[] } | null;
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
export default function InspiredSyncPanel({ onSynced, conn = "inspired", compact = false, up = false }: { onSynced?: () => void; conn?: string; compact?: boolean; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"" | "sync" | "test">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sample, setSample] = useState<TestOrder[] | null>(null);

  const loadStatus = () => apiFetch<Status>(`/integrations/${conn}/status`).then(setStatus).catch(() => {});
  useEffect(() => {
    loadStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn]);

  async function sync() {
    setBusy("sync");
    setMsg(null);
    try {
      const r = await apiFetch<{ imported: number; skipped: number; linked?: number; updated?: number; rejected?: number; flagged?: number; errors: string[] }>(
        `/integrations/${conn}/sync`,
        { method: "POST" }
      );
      const extra = [
        r.linked ? `${r.linked} matched to orders already entered by hand (no duplicate)` : "",
        r.updated ? `${r.updated} updated from website edits` : "",
        r.rejected ? `${r.rejected} rejected (cancelled on website)` : "",
        r.flagged ? `${r.flagged} with a driver flagged ⚠` : "",
      ].filter(Boolean);
      setMsg({
        ok: r.errors.length === 0,
        text: `${r.imported} new website order${r.imported === 1 ? "" : "s"} added, ${r.skipped} already here.${extra.length ? ` ${extra.join(", ")}.` : ""}${
          r.errors.length ? ` Problems: ${r.errors.join("; ")}` : ""
        }`,
      });
      if (r.errors.length) setOpen(true);
      onSynced?.();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Sync failed" });
      setOpen(true);
    } finally {
      setBusy("");
      loadStatus();
    }
  }

  async function test() {
    setBusy("test");
    setMsg(null);
    setSample(null);
    setOpen(true);
    try {
      const r = await apiFetch<{ orders: TestOrder[] }>(`/integrations/${conn}/test`, { method: "POST" });
      setSample(r.orders);
      setMsg({ ok: true, text: `Connected ✓ — latest ${r.orders.length} website orders below (nothing imported).` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Connection failed" });
    } finally {
      setBusy("");
    }
  }

  if (!status) return null;

  const full = (
    <div className="h-full rounded-[10px] border border-line bg-paper-2/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-display text-[15px] font-semibold text-navy">{status.vendorName} website orders</span>{" "}
          {status.configured ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-delivered"><span className="ap-pulse inline-block h-2 w-2 rounded-full bg-delivered" aria-hidden="true" />connected — checks every 5 min</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-cancelled"><span className="inline-block h-2 w-2 rounded-full bg-cancelled" aria-hidden="true" />not connected</span>
          )}
          {status.lastSync && (
            <div className="text-[11px] text-ink-soft">
              Last check {new Date(status.lastSync.at).toLocaleTimeString("en-GB")}: {status.lastSync.imported} added
              {status.lastSync.rejected ? `, ${status.lastSync.rejected} cancelled on website` : ""}
              {status.lastSync.updated ? `, ${status.lastSync.updated} updated` : ""}
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
              <span className={`inline-block ${busy === "sync" ? "ap-spin" : ""}`} aria-hidden="true">⟳</span> {busy === "sync" ? "Checking…" : "Sync now"}
            </button>
          </div>
        )}
      </div>

      {!status.configured && (
        <p className="mt-2 text-xs text-ink-soft">
          Add <code>{conn.toUpperCase()}_WC_URL</code>, <code>{conn.toUpperCase()}_WC_KEY</code> and <code>{conn.toUpperCase()}_WC_SECRET</code> to the backend variables in Railway.
        </p>
      )}

      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-delivered" : "text-cancelled"}`}>{msg.text}</p>}

      {sample && sample.length > 0 && (
        <div className="mt-3 space-y-2">
          {sample.map((o) => (
            <div key={o.id} className="rounded border border-line bg-paper p-2.5 text-sm">
              <div>
                <b className="font-mono">Order #{o.number}</b>
                {String(o.id) !== o.number && <span className="text-ink-soft"> (id {o.id})</span>} · {o.status} · {fmtDateTime(o.date)} ·
                AED {o.total} · {o.paymentMethod}
              </div>
              <div className="text-ink-soft">
                → {o.mapped.customerName} · {o.mapped.customerPhone} · {o.mapped.address}, {o.mapped.emirate} · COD {fmtNumber(o.mapped.codAmount)}
              </div>
              {o.mapped.items && <div className="text-xs text-ink-soft">{o.mapped.items}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
  if (!compact) return full;

  // Small chip for page headers: status dot, name, last check, sync button.
  // Click the name for the full panel (test connection, messages, samples).
  const last = status.lastSync;
  return (
    <div className="relative">
      <div className={`flex h-9 items-center gap-2 rounded-lg border pl-2.5 pr-1 text-xs ${status.configured ? "border-line" : "border-cancelled/60"}`}>
        <span
          className={`inline-block h-2 w-2 flex-none rounded-full ${status.configured ? "ap-pulse bg-delivered" : "bg-cancelled"}`}
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="whitespace-nowrap text-left hover:text-brass"
          title={status.configured ? "Connected — checks every 5 min. Click for details." : "Not connected. Click for details."}
        >
          <b className="font-semibold">{status.vendorName}</b>
          <span className="text-ink-soft">
            {status.configured
              ? last
                ? ` · ${new Date(last.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · ${last.imported} added`
                : " · connected"
              : " · not connected"}
          </span>
          {last && last.errors.length > 0 && <span className="text-cancelled"> · ⚠</span>}
        </button>
        {status.configured && (
          <button
            type="button"
            onClick={sync}
            disabled={!!busy}
            aria-label={`Sync ${status.vendorName} website now`}
            title="Sync now"
            className="grid h-7 w-7 place-items-center rounded-md text-brass hover:bg-brass/10 disabled:opacity-60"
          >
            <span className={`inline-block ${busy === "sync" ? "ap-spin" : ""}`} aria-hidden="true">⟳</span>
          </button>
        )}
      </div>
      {open && (
        <div className={`absolute left-0 z-40 ${up ? "bottom-11" : "top-11"} w-[min(560px,90vw)] rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.45)] [&>div]:bg-[rgb(var(--c-surface))]`}>
          {full}
        </div>
      )}
    </div>
  );
}

/** One box per connected vendor website (Inspired, Escalo, …). */
export function WebsiteSyncPanels({ onSynced, compact = false, up = false }: { onSynced?: () => void; compact?: boolean; up?: boolean }) {
  const [conns, setConns] = useState<string[]>([]);
  useEffect(() => {
    apiFetch<{ conn: string }[]>("/integrations")
      .then((list) => setConns(list.map((c) => c.conn.toLowerCase())))
      .catch(() => setConns(["inspired"]));
  }, []);
  return (
    <>
      {conns.map((c) => (
        <InspiredSyncPanel key={c} conn={c} onSynced={onSynced} compact={compact} up={up} />
      ))}
    </>
  );
}
