"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { addDays, fmtNumber, todayStr } from "@/lib/format";
import { toast, confirmDialog } from "@/components/ui/Feedback";
import { PageSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import { useAuth } from "@/context/AuthContext";

interface Row {
  driver: { id: string; name: string };
  collected: number;
  spent: number;
  expected: number;
  cashParcels: number;
  bankParcels: number;
  prevBalance: number;
  totalDue: number;
  handover: { id: string; received: number; expected: number; note: string | null; byName: string | null; updatedAt: string; stale: boolean } | null;
  balanceAfter: number | null;
  missingDays: string[];
}
interface DayData {
  date: string;
  rows: Row[];
  totals: { collected: number; spent: number; expected: number; received: number; outstanding: number };
}
interface HistoryRow {
  id: string;
  date: string;
  collected: number;
  spent: number;
  expected: number;
  received: number;
  diff: number;
  balance: number;
  note: string | null;
  byName: string | null;
}

/** "+80 short" / "20 extra" / "settled", coloured. Positive = driver owes. */
function Balance({ value, big }: { value: number; big?: boolean }) {
  const cls = big ? "text-[15px] font-bold" : "text-sm font-semibold";
  if (value === 0) return <span className={`${cls} text-delivered`}>✓ Settled</span>;
  if (value > 0) return <span className={`${cls} text-cancelled`}>{fmtNumber(value)} short</span>;
  return <span className={`${cls} text-transferred`}>{fmtNumber(-value)} extra</span>;
}

function fmtDay(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

export default function CashHandoverPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<DayData | null>(null);
  const [inputs, setInputs] = useState<Record<string, { received: string; note: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);

  const load = useCallback(async () => {
    const d = await apiFetch<DayData>("/cash-handover", { query: { date } });
    setData(d);
    setInputs(
      Object.fromEntries(
        d.rows.map((r) => [r.driver.id, { received: r.handover ? String(r.handover.received) : "", note: r.handover?.note ?? "" }])
      )
    );
  }, [date]);

  useEffect(() => {
    setData(null);
    load().catch((e) => toast("Could not load cash handover", "error", e instanceof Error ? e.message : undefined));
  }, [load]);

  useEffect(() => {
    if (!historyFor) return setHistory(null);
    setHistory(null);
    apiFetch<{ rows: HistoryRow[] }>(`/cash-handover/history/${historyFor.id}`).then((r) => setHistory(r.rows)).catch(() => setHistory([]));
  }, [historyFor, data]);

  async function save(r: Row, received?: number) {
    const inp = inputs[r.driver.id] ?? { received: "", note: "" };
    const amount = received ?? Number(inp.received);
    if (inp.received.trim() === "" && received === undefined) return toast("Enter the cash received first", "warning");
    if (!Number.isFinite(amount) || amount < 0) return toast("Enter a valid amount", "warning");
    setSaving(r.driver.id);
    try {
      await apiFetch("/cash-handover", { method: "PUT", body: { employeeId: r.driver.id, date, received: Math.round(amount), note: inp.note || null } });
      const diff = r.expected - Math.round(amount);
      toast(
        `${r.driver.name}: saved`,
        diff > 0 ? "warning" : "success",
        diff > 0 ? `AED ${fmtNumber(diff)} short — carried forward` : diff < 0 ? `AED ${fmtNumber(-diff)} extra received` : "Exact amount"
      );
      await load();
    } catch (e) {
      toast("Could not save", "error", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(null);
    }
  }

  async function undo(r: Row) {
    if (!r.handover) return;
    if (!(await confirmDialog(`Remove the saved handover for ${r.driver.name} on ${fmtDay(date)}?`, { confirmText: "Remove", danger: true }))) return;
    await apiFetch(`/cash-handover/${r.handover.id}`, { method: "DELETE" });
    toast("Handover removed", "info");
    load();
  }

  const isToday = date === todayStr();
  const pending = data?.rows.filter((r) => !r.handover && r.expected !== 0).length ?? 0;

  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Finance</p>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-navy md:text-[32px]">Cash Handover</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(addDays(date, -1))} className="touch-target rounded-lg border border-line px-3 text-sm hover:border-brass" aria-label="Previous day">
            ‹
          </button>
          <input type="date" value={date} max={todayStr()} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-lg border border-line bg-white px-3 py-2 text-sm" />
          <button
            onClick={() => setDate(addDays(date, 1))}
            disabled={isToday}
            className="touch-target rounded-lg border border-line px-3 text-sm hover:border-brass disabled:opacity-40"
            aria-label="Next day"
          >
            ›
          </button>
          {!isToday && (
            <button onClick={() => setDate(todayStr())} className="rounded-lg border border-line px-3 py-2 text-xs uppercase tracking-wide hover:border-brass">
              Today
            </button>
          )}
        </div>
      </div>
      <p className="mb-5 max-w-3xl text-sm text-ink-soft">
        Cash each driver should hand over for parcels marked <b>Delivered</b> on {fmtDay(date)} (cash COD only), minus that day&apos;s purchases and
        expenses. Type what you received — any short or extra amount carries forward to the driver&apos;s next day.
      </p>

      {!data ? (
        <PageSkeleton rows={6} cards={4} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Cash collected", data.totals.collected],
              ["Should hand over", data.totals.expected],
              ["Received", data.totals.received],
              ["Outstanding (all days)", data.totals.outstanding],
            ].map(([label, v], i) => (
              <div key={label as string} className="border border-line bg-white p-4">
                <p className="mb-1 text-[11px] uppercase tracking-wider text-ink-soft">{label}</p>
                <p className={`font-display text-[22px] font-semibold ${i === 3 && (v as number) > 0 ? "text-cancelled" : "text-navy"}`}>
                  {fmtNumber(v as number)} <span className="text-xs font-normal text-ink-soft">AED</span>
                </p>
              </div>
            ))}
          </div>

          {pending > 0 && (
            <p className="mb-4 rounded-lg border border-brass/40 bg-paper-2 px-4 py-2.5 text-sm">
              <b className="text-brass">{pending}</b> driver{pending === 1 ? "" : "s"} still to hand over for {fmtDay(date)}.
            </p>
          )}

          {data.rows.length === 0 ? (
            <EmptyState title="No active drivers" hint="Add drivers in Employees to track their cash." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.rows.map((r) => {
                const inp = inputs[r.driver.id] ?? { received: "", note: "" };
                const typed = inp.received.trim() === "" ? null : Number(inp.received);
                const liveDiff = typed === null || !Number.isFinite(typed) ? null : r.expected - typed;
                const nothing = r.collected === 0 && r.spent === 0 && r.prevBalance === 0 && !r.handover;
                return (
                  <div key={r.driver.id} className={`border bg-white p-5 ${r.handover ? "border-line" : nothing ? "border-line opacity-70" : "border-brass/50"}`}>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-display text-[17px] font-semibold text-navy">{r.driver.name}</p>
                        <p className="text-xs text-ink-soft">
                          {r.cashParcels} cash parcel{r.cashParcels === 1 ? "" : "s"}
                          {r.bankParcels ? ` · ${r.bankParcels} paid by bank` : ""}
                        </p>
                      </div>
                      {r.handover ? (
                        <span className="rounded-full bg-delivered-bg px-2.5 py-1 text-[11px] font-semibold text-delivered">Saved</span>
                      ) : nothing ? (
                        <span className="rounded-full bg-paper-2 px-2.5 py-1 text-[11px] text-ink-soft">No cash today</span>
                      ) : (
                        <span className="rounded-full bg-pending-bg px-2.5 py-1 text-[11px] font-semibold text-pending">Waiting</span>
                      )}
                    </div>

                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-ink-soft">Cash collected</span>
                        <span className="font-mono">{fmtNumber(r.collected)}</span>
                      </div>
                      {r.spent !== 0 && (
                        <div className="flex justify-between">
                          <span className="text-ink-soft">Purchases / expenses</span>
                          <span className="font-mono text-cancelled">−{fmtNumber(r.spent)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-line pt-1">
                        <span>Should hand over today</span>
                        <b className="font-mono">{fmtNumber(r.expected)}</b>
                      </div>
                      {r.prevBalance !== 0 && (
                        <div className="flex justify-between">
                          <span className="text-ink-soft">Brought forward</span>
                          <Balance value={r.prevBalance} />
                        </div>
                      )}
                      {r.prevBalance !== 0 && (
                        <div className="flex justify-between">
                          <span className="text-ink-soft">Total due</span>
                          <b className="font-mono">{fmtNumber(r.totalDue)}</b>
                        </div>
                      )}
                    </div>

                    {r.handover?.stale && (
                      <p className="mt-3 rounded bg-pending-bg px-3 py-2 text-xs text-pending">
                        This day changed after saving (was {fmtNumber(r.handover.expected)}, now {fmtNumber(r.expected)}). Save again to update.
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <input
                        inputMode="numeric"
                        placeholder="Received"
                        value={inp.received}
                        onChange={(e) => setInputs({ ...inputs, [r.driver.id]: { ...inp, received: e.target.value.replace(/[^0-9]/g, "") } })}
                        onKeyDown={(e) => e.key === "Enter" && save(r)}
                        className="w-28 rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm"
                      />
                      <input
                        placeholder="Note (optional)"
                        value={inp.note}
                        maxLength={300}
                        onChange={(e) => setInputs({ ...inputs, [r.driver.id]: { ...inp, note: e.target.value } })}
                        className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm"
                      />
                      <button
                        onClick={() => save(r)}
                        disabled={saving === r.driver.id}
                        className="rounded-lg bg-navy px-4 py-2 text-xs font-semibold uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-50"
                      >
                        {saving === r.driver.id ? "Saving…" : r.handover ? "Update" : "Save"}
                      </button>
                      {!r.handover && r.expected > 0 && (
                        <button
                          onClick={() => save(r, r.expected)}
                          disabled={saving === r.driver.id}
                          title="Received exactly the expected amount"
                          className="rounded-lg border border-delivered/50 px-3 py-2 text-xs font-semibold text-delivered hover:bg-delivered-bg"
                        >
                          ✓ Exact {fmtNumber(r.expected)}
                        </button>
                      )}
                    </div>

                    {liveDiff !== null && (!r.handover || typed !== r.handover.received) && (
                      <p className="mt-2 text-xs">
                        {liveDiff === 0 ? (
                          <span className="text-delivered">Matches exactly.</span>
                        ) : liveDiff > 0 ? (
                          <span className="text-cancelled">AED {fmtNumber(liveDiff)} short — will carry forward.</span>
                        ) : (
                          <span className="text-transferred">AED {fmtNumber(-liveDiff)} more than expected.</span>
                        )}
                      </p>
                    )}

                    {r.handover && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs">
                        <span className="text-ink-soft">
                          Received {fmtNumber(r.handover.received)} · by {r.handover.byName ?? "—"}
                        </span>
                        <span className="flex items-center gap-2">
                          Balance now <Balance value={r.balanceAfter ?? 0} />
                        </span>
                      </div>
                    )}

                    {r.missingDays.length > 0 && (
                      <p className="mt-3 text-xs text-pending">
                        Not recorded: {r.missingDays.slice(0, 4).map(fmtDay).join(", ")}
                        {r.missingDays.length > 4 ? ` +${r.missingDays.length - 4} more` : ""}
                        {" — "}
                        <button className="underline" onClick={() => setDate(r.missingDays[0])}>
                          open
                        </button>
                      </p>
                    )}

                    <div className="mt-3 flex gap-3 text-xs">
                      <button onClick={() => setHistoryFor(historyFor?.id === r.driver.id ? null : r.driver)} className="text-brass underline-offset-2 hover:underline">
                        {historyFor?.id === r.driver.id ? "Hide history" : "History"}
                      </button>
                      {r.handover && user?.role === "SUPER_ADMIN" && (
                        <button onClick={() => undo(r)} className="text-ink-soft hover:text-cancelled">
                          Remove
                        </button>
                      )}
                    </div>

                    {historyFor?.id === r.driver.id && (
                      <div className="mt-3 border-t border-line pt-3">
                        {!history ? (
                          <p className="text-xs text-ink-soft">Loading…</p>
                        ) : history.length === 0 ? (
                          <p className="text-xs text-ink-soft">No handovers saved yet.</p>
                        ) : (
                          <div className="table-wrap max-h-72 overflow-y-auto">
                            <table className="data-table text-xs">
                              <thead>
                                <tr>
                                  <th>Day</th>
                                  <th className="text-right">Due</th>
                                  <th className="text-right">Received</th>
                                  <th className="text-right">Balance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {history.map((h) => (
                                  <tr key={h.id} title={h.note ?? undefined}>
                                    <td>
                                      <button className="hover:underline" onClick={() => setDate(h.date)}>
                                        {fmtDay(h.date)}
                                      </button>
                                    </td>
                                    <td className="text-right font-mono">{fmtNumber(h.expected)}</td>
                                    <td className={`text-right font-mono ${h.diff > 0 ? "text-cancelled" : ""}`}>{fmtNumber(h.received)}</td>
                                    <td className="text-right">
                                      <Balance value={h.balance} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
