"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, todayStr } from "@/lib/format";

interface Entry {
  id: string;
  at: string;
  batch: string;
  file: string | null;
  by: string | null;
  from: string | null;
  to: string | null;
  tracking: string | null;
  cnNo: number | null;
  vendor: string | null;
  customer: string | null;
  holder: string | null;
  total: number | null;
  statusNow: string | null;
}

const CLS: Record<string, string> = {
  DELIVERED: "bg-delivered-bg text-delivered",
  CANCELLED: "bg-cancelled-bg text-cancelled",
  PENDING: "bg-pending-bg text-pending",
  TRANSFER: "bg-transferred-bg text-transferred",
};
const Pill = ({ s }: { s: string | null }) =>
  s ? <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${CLS[s] ?? "bg-paper-2"}`}>{s}</span> : null;

/** Date-wise list of every order an agent-report upload changed. */
export default function AgentReportHistory({ refreshKey }: { refreshKey: number }) {
  const [date, setDate] = useState(todayStr());
  const [days, setDays] = useState<{ date: string; count: number }[]>([]);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ days: { date: string; count: number }[]; entries: Entry[] }>("/agent-report/history", { query: { date } });
      setDays(r.days);
      setEntries(r.entries);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history");
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Group the day's entries by upload (batch).
  const batches: { key: string; file: string | null; by: string | null; at: string; list: Entry[] }[] = [];
  for (const e of entries ?? []) {
    let b = batches.find((x) => x.key === e.batch);
    if (!b) {
      b = { key: e.batch, file: e.file, by: e.by, at: e.at, list: [] };
      batches.push(b);
    }
    b.list.push(e);
  }

  const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });

  return (
    <section className="mt-10">
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">History</p>
      <h2 className="mb-3 font-display text-2xl font-semibold text-navy">Updates from reports — date wise</h2>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="date" value={date} max={todayStr()} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded border border-line px-2 py-1.5 text-sm" />
        {days.slice(0, 10).map((d) => (
          <button
            key={d.date}
            onClick={() => setDate(d.date)}
            className={`rounded px-2.5 py-1 font-mono text-[11px] ${d.date === date ? "bg-navy text-paper" : "border border-line bg-white text-ink-soft"}`}
          >
            {fmtDay(d.date)} · {d.count}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-cancelled">{error}</p>}
      {entries && entries.length === 0 && <p className="text-sm text-ink-soft">No updates from agent reports on {fmtDay(date)}.</p>}

      {batches.map((b) => {
        const del = b.list.filter((e) => e.to === "DELIVERED").length;
        const can = b.list.filter((e) => e.to === "CANCELLED").length;
        return (
          <div key={b.key} className="mb-4 border border-line bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-paper px-3 py-2 text-sm">
              <span>
                <b className="text-navy">{new Date(b.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</b>
                {b.file && <span className="ml-2 text-ink-soft">{b.file}</span>}
                {b.by && <span className="ml-2 text-xs text-ink-soft">by {b.by}</span>}
              </span>
              <span className="font-mono text-xs">
                <b className="text-delivered">{del} delivered</b> · <b className="text-cancelled">{can} cancelled</b>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="p-2 text-left">CN</th>
                    <th className="p-2 text-left">Changed</th>
                    <th className="p-2 text-left">Now</th>
                    <th className="p-2 text-left">Customer / Vendor</th>
                    <th className="p-2 text-left">With</th>
                    <th className="p-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {b.list.map((e) => (
                    <tr key={e.id} className="border-t border-line">
                      <td className="p-2 font-mono font-bold text-navy">{e.cnNo ?? e.tracking}</td>
                      <td className="p-2">
                        <Pill s={e.from} /> <span className="text-ink-soft">→</span> <Pill s={e.to} />
                      </td>
                      <td className="p-2">
                        <Pill s={e.statusNow} />
                        {e.statusNow && e.statusNow !== e.to && <span className="ml-1 text-[10px] text-pending">changed again since</span>}
                      </td>
                      <td className="p-2">
                        {e.customer && <span className="block">{e.customer}</span>}
                        <span className="text-xs text-ink-soft">{e.vendor}</span>
                      </td>
                      <td className="p-2 text-xs">{e.holder}</td>
                      <td className="p-2 text-right font-mono text-xs">{e.total != null ? fmtNumber(e.total) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}
