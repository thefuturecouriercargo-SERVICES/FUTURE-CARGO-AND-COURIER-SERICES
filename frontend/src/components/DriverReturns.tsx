"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

interface ReturnRow {
  cn: string;
  on: string;
  receivedAt: string | null;
  vendor: string;
  customer: string | null;
  total: number;
}
interface ReturnsData {
  cancel: ReturnRow[];
  pickup: ReturnRow[];
}

/** Driver's own cancelled and pickup parcels — which still have to go back to the office, which are received. */
export default function DriverReturns({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<ReturnsData | null>(null);
  const [tab, setTab] = useState<"cancel" | "pickup">("cancel");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<ReturnsData>("/driver/returns"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load);

  const rows = data?.[tab] ?? [];
  const toReturn = (l?: ReturnRow[]) => (l ?? []).filter((r) => !r.receivedAt).length;

  return (
    <div className="pb-8">
      <div className="mb-3 flex items-center gap-2.5">
        <button type="button" onClick={onBack} aria-label="Back" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white active:scale-95">←</button>
        <h2 className="font-display text-lg font-semibold uppercase text-navy">Pickups &amp; cancels</h2>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        {([
          ["cancel", "Cancelled", toReturn(data?.cancel)],
          ["pickup", "Pickups", toReturn(data?.pickup)],
        ] as const).map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-2xl px-3 py-3 text-left shadow ring-1 transition ${tab === k ? "bg-navy text-white ring-navy" : "bg-white text-navy ring-line"}`}
          >
            <span className="block font-mono text-[11px] font-bold uppercase">{label}</span>
            <span className={`block text-2xl font-extrabold leading-tight ${n > 0 ? (tab === k ? "text-brass-light" : "text-cancelled") : ""}`}>{n}</span>
            <span className={`block font-mono text-[9.5px] uppercase ${tab === k ? "text-white/70" : "text-ink-soft"}`}>to hand back</span>
          </button>
        ))}
      </div>

      {error && <p className="mb-3 rounded-xl bg-cancelled-bg px-3 py-2 text-xs text-cancelled">{error}</p>}
      {!data ? (
        <p className="py-10 text-center font-mono text-xs uppercase text-ink-soft">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl bg-white py-10 text-center font-mono text-xs uppercase text-ink-soft shadow ring-1 ring-line">
          No {tab === "cancel" ? "cancelled" : "pickup"} parcels
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={tab + r.cn} className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-3 shadow ring-1 ring-line">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[14px] font-extrabold text-navy">CN {r.cn}</div>
                <div className="truncate text-[12px] font-semibold uppercase text-ink">
                  {r.customer ? `${r.customer} · ` : ""}
                  <span className="text-ink-soft">{r.vendor}</span>
                </div>
                <div className="font-mono text-[10px] uppercase text-ink-soft">
                  {tab === "cancel" ? "Cancelled" : "Picked up"} {fmtDate(r.on)}
                  {r.total > 0 ? ` · AED ${fmtNumber(r.total)}` : ""}
                </div>
              </div>
              {r.receivedAt ? (
                <span className="shrink-0 rounded-full bg-delivered-bg px-2.5 py-1 text-center font-mono text-[9.5px] font-bold uppercase leading-tight text-delivered">
                  ✓ Received
                  <br />
                  {fmtDate(r.receivedAt)}
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-cancelled-bg px-2.5 py-1 font-mono text-[10px] font-bold uppercase text-cancelled">To return</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
