"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, fmtDate, fmtDateTime } from "@/lib/format";
import { confirmDialog } from "@/components/ui/Feedback";

interface PickupOrder {
  date: string;
  status: string;
  total: number;
  vendor: string;
  customer: string | null;
  holder: string | null;
  isAgent: boolean;
}
type PickupType = "CANCEL" | "PICKUP";
interface PickupPending {
  cn: string;
  on: string;
  order: PickupOrder;
}
interface PickupReceived extends PickupPending {
  receivedAt: string;
  by: string | null;
}
interface PickupList {
  pending: PickupPending[];
  received: PickupReceived[];
}
interface PickupData {
  start: string;
  cancel: PickupList;
  pickup: PickupList;
}

const PICK_INFO: Record<PickupType, { title: string; on: string; note: string }> = {
  CANCEL: { title: "Cancelled (RTO)", on: "Cancelled", note: "Cancelled in Daily Entry, or RTO on the agent's Excel — parcel comes back to the office." },
  PICKUP: { title: "Pickup delivery", on: "Picked up", note: "Label says PICKUP — collected from the customer, comes back to the office." },
};

/**
 * Parcels to collect back from the agent. One scan bar — the server decides whether the CN
 * is a Cancelled (RTO) parcel or a Pickup delivery, and it lands in that box as Received back.
 */
export default function ReturnsPage() {
  const [data, setData] = useState<PickupData | null>(null);
  const [error, setError] = useState("");
  const [scan, setScan] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function load() {
    apiFetch<PickupData>("/agent-report/pickup")
      .then((r) => {
        setData(r);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load pickup list"));
  }
  useEffect(() => {
    load();
    inputRef.current?.focus();
  }, []);
  const [who, setWho] = useState("ALL");

  async function receive(raw: string) {
    const cn = raw.replace(/\D/g, "");
    setScan("");
    if (!cn || busy) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ cn: string; type: PickupType; order: PickupOrder | null }>("/agent-report/pickup/receive", { method: "POST", body: { cn } });
      setMsg({
        ok: true,
        text: `✓ CN ${r.cn} received back — ${r.type === "CANCEL" ? "CANCELLED" : "PICKUP"}${r.order ? ` · ${r.order.vendor}${r.order.customer ? " · " + r.order.customer : ""}` : ""}`,
      });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not mark received" });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function undo(cn: string, type: PickupType) {
    if (!(await confirmDialog(`Undo "received back" for CN ${cn}? It goes back on the list to receive.`))) return;
    try {
      await apiFetch("/agent-report/pickup/undo", { method: "POST", body: { cn, type } });
      setMsg({ ok: true, text: `CN ${cn} back on the list to receive` });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Undo failed" });
    }
  }

  const holders = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const l of [data?.cancel, data?.pickup]) for (const r of [...(l?.pending ?? []), ...(l?.received ?? [])]) if (r.order.holder) m.set(r.order.holder, r.order.isAgent);
    return [...m.entries()].sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));
  }, [data]);
  const keep = (r: PickupPending) => who === "ALL" || (who === "AGENT" ? r.order.isAgent : who === "DRIVERS" ? !r.order.isAgent : r.order.holder === who);
  const filt = (l?: PickupList): PickupList | undefined => l && { pending: l.pending.filter(keep), received: l.received.filter(keep) };
  const cancel = filt(data?.cancel);
  const pickup = filt(data?.pickup);
  const nCancel = cancel?.pending.length ?? 0;
  const nPickup = pickup?.pending.length ?? 0;

  return (
    <div className="max-w-6xl">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Operations</p>
      <h1 className="mb-1 font-display text-[26px] font-semibold tracking-tight text-navy md:text-[32px]">Cancel &amp; Pickup</h1>
      <p className="mb-5 max-w-2xl text-sm text-ink-soft">
        Parcels to receive back at the office — from our drivers and the agent. Scan the CN when it&apos;s back; it goes to <b>Cancelled</b> or <b>Pickup</b> on its own. Counting from {data ? fmtDate(data.start) : "…"}.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Cancelled — to receive", nCancel, "text-cancelled"],
          ["Pickup — to receive", nPickup, "text-navy"],
          ["Cancelled — received", cancel?.received.length ?? 0, "text-delivered"],
          ["Pickup — received", pickup?.received.length ?? 0, "text-delivered"],
        ].map(([l, n, c]) => (
          <div key={l as string} className="border border-line bg-white p-3">
            <p className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">{l}</p>
            <p className={`font-display text-2xl font-semibold ${c}`}>{n as number}</p>
          </div>
        ))}
      </div>

    <section className="mb-6 border border-brass bg-white p-3 md:p-4">

      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          receive(scan);
        }}
      >
        <input
          ref={inputRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          inputMode="numeric"
          placeholder="Scan or type CN — received back"
          className="min-w-0 flex-1 rounded border border-line bg-paper px-3 py-2 font-mono text-sm text-navy"
        />
        <button type="submit" disabled={busy || !scan.trim()} className="rounded bg-navy px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-paper disabled:opacity-40">
          {busy ? "…" : "Received"}
        </button>
      </form>
      {msg && (
        <p className={`mb-3 rounded border p-2 text-sm ${msg.ok ? "border-delivered bg-delivered-bg text-delivered" : "border-cancelled bg-cancelled-bg text-cancelled"}`}>{msg.text}</p>
      )}
      {error && <p className="mb-2 text-sm text-cancelled">{error}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono uppercase tracking-wide text-ink-soft">With</span>
        <select value={who} onChange={(e) => setWho(e.target.value)} className="rounded border border-line bg-paper px-2 py-1.5 text-sm text-navy">
          <option value="ALL">Everyone</option>
          <option value="DRIVERS">Our drivers</option>
          <option value="AGENT">Agent</option>
          {holders.map(([h, ag]) => (
            <option key={h} value={h}>
              {h}
              {ag ? " (agent)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <PickupBox type="CANCEL" list={cancel} onUndo={undo} />
        <PickupBox type="PICKUP" list={pickup} onUndo={undo} />
      </div>
    </section>
    </div>
  );
}

function PickupBox({ type, list, onUndo }: { type: PickupType; list?: PickupList; onUndo: (cn: string, type: PickupType) => void }) {
  const [view, setView] = useState<"pending" | "received">("pending");
  const info = PICK_INFO[type];
  const pending = list?.pending ?? [];
  const received = list?.received ?? [];
  const total = pending.reduce((s, r) => s + r.order.total, 0);

  function downloadCsv() {
    const head = ["CN", info.on, "Order date", "Vendor", "Customer", "With", "Amount"];
    const lines = pending.map((r) =>
      [r.cn, fmtDate(r.on), fmtDate(r.order.date), r.order.vendor, r.order.customer ?? "", r.order.holder ?? "", r.order.total]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${type === "CANCEL" ? "cancelled" : "pickup"}-to-receive-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="border border-line p-3">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className={`font-display text-base font-semibold ${type === "CANCEL" ? "text-cancelled" : "text-navy"}`}>
            {type === "PICKUP" ? "⇄ " : ""}
            {info.title}
          </h3>
          <p className="text-[11px] text-ink-soft">{info.note}</p>
        </div>
        {view === "pending" && pending.length > 0 && (
          <button onClick={downloadCsv} className="rounded border border-line bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-navy">
            ⬇ CSV
          </button>
        )}
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {(
          [
            ["pending", `Pending to receive (${pending.length})`],
            ["received", `Received back (${received.length})`],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={`rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide ${view === k ? "bg-navy text-paper" : "border border-line bg-white text-ink-soft"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {view === "pending" &&
        (pending.length === 0 ? (
          <p className="border border-line bg-paper p-3 text-sm text-delivered">✓ Nothing pending to receive.</p>
        ) : (
          <div className="table-wrap border border-line">
            <table className="data-table min-w-[560px]">
              <thead>
                <tr>
                  <th>CN</th>
                  <th>{info.on}</th>
                  <th>Vendor / Customer</th>
                  <th>With</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.cn}>
                    <td className="font-mono font-bold text-navy">
                      {r.cn}
                      <span className="block text-[10px] font-normal text-ink-soft">{fmtDate(r.order.date)}</span>
                    </td>
                    <td className="font-mono text-xs">{fmtDate(r.on)}</td>
                    <td>
                      <span className="block">{r.order.vendor}</span>
                      {r.order.customer && <span className="text-xs text-ink-soft">{r.order.customer}</span>}
                    </td>
                    <td className="text-xs">
                      {r.order.holder ?? ""}
                      {r.order.isAgent && <span className="ml-1 rounded bg-paper-2 px-1 font-mono text-[9px] uppercase text-brass">agent</span>}
                    </td>
                    <td className="text-right font-mono">{fmtNumber(r.order.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Pending to receive ({pending.length})</td>
                  <td className="text-right font-mono">{fmtNumber(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

      {view === "received" &&
        (received.length === 0 ? (
          <p className="border border-line bg-paper p-3 text-sm text-ink-soft">Nothing received back yet.</p>
        ) : (
          <div className="table-wrap border border-line">
            <table className="data-table min-w-[560px]">
              <thead>
                <tr>
                  <th>CN</th>
                  <th>Received back</th>
                  <th>Vendor / Customer</th>
                  <th>With / By</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {received.map((r) => (
                  <tr key={r.cn}>
                    <td className="font-mono font-bold text-navy">
                      {r.cn}
                      <span className="block text-[10px] font-normal text-ink-soft">
                        {info.on} {fmtDate(r.on)}
                      </span>
                    </td>
                    <td className="font-mono text-xs">{fmtDateTime(r.receivedAt)}</td>
                    <td>
                      <span className="block">{r.order.vendor}</span>
                      {r.order.customer && <span className="text-xs text-ink-soft">{r.order.customer}</span>}
                    </td>
                    <td className="text-xs">
                      {r.order.holder ?? ""}
                      {r.by && <span className="block text-[10px] text-ink-soft">by {r.by}</span>}
                    </td>
                    <td className="text-right">
                      <button onClick={() => onUndo(r.cn, type)} className="font-mono text-[11px] uppercase text-cancelled underline">
                        Undo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
