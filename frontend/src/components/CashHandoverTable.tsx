"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtDate, fmtNumber } from "@/lib/format";
import { toast, confirmDialog } from "@/components/ui/Feedback";
import { PageSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Icon from "@/components/Icon";
import { useAuth } from "@/context/AuthContext";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { Vendor } from "@/types";

interface Row {
  driver: { id: string; name: string };
  collected: number;
  purchases?: number;
  expenses?: number;
  spent: number;
  expected: number;
  cashParcels: number;
  bankParcels: number;
  toHandOver: number;
  handover: {
    id: string;
    received: number;
    expected: number;
    lessAmount: number;
    lessReason: LessReason | null;
    toHandOver: number;
    diff: number;
    note: string | null;
    byName: string | null;
    updatedAt: string;
    stale: boolean;
  } | null;
  missingDays: string[];
}
interface DayData {
  date: string;
  startDate: string;
  beforeStart: boolean;
  rows: Row[];
}
interface HistoryRow {
  id: string;
  date: string;
  expected: number;
  lessAmount: number;
  lessReason: LessReason | null;
  received: number;
  diff: number;
  note: string | null;
}
interface Purchase {
  id: string;
  employeeId: string;
  amount: number;
  vendor?: { id: string; name: string } | null;
}
type LessReason = "SALARY" | "SHORT" | "OTHER";
const REASON_LABEL: Record<LessReason, string> = { SALARY: "Salary", SHORT: "Short", OTHER: "Other" };
type Input = { received: string; less: string; reason: LessReason | ""; note: string };
const EMPTY: Input = { received: "", less: "", reason: "", note: "" };
type Panel = "less" | "history" | "purchases";

/** "80 short" / "20 extra" / "0", coloured. Positive = driver gave less than due. */
function Diff({ value, onDark }: { value: number | null; onDark?: boolean }) {
  if (value === null) return <span className={onDark ? "text-white/40" : "text-ink-soft"}>—</span>;
  if (value === 0) return <span className={onDark ? "text-[#97c459]" : "text-delivered"}>0</span>;
  if (value > 0) return <span className={onDark ? "text-[#f09595]" : "text-cancelled"}>{fmtNumber(value)} short</span>;
  return <span className={onDark ? "text-[#85b7eb]" : "text-transferred"}>{fmtNumber(-value)} extra</span>;
}

const initials = (name: string) => {
  const w = name.trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
};

/**
 * Driver cash handover table: Driver · (Expenses · Purchases) · Actual · Received · Difference,
 * totals under each column. Used on the Cash Handover page and on the dashboard
 * (with showSpend, which adds the Expenses and Purchases columns and lets admin add
 * or remove purchases — paid to vendors — from the Purchases cell).
 */
export default function CashHandoverTable({
  date,
  onDateChange,
  onStartDate,
  showSpend = false,
}: {
  date: string;
  onDateChange?: (d: string) => void;
  onStartDate?: (d: string) => void;
  showSpend?: boolean;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<DayData | null>(null);
  const [inputs, setInputs] = useState<Record<string, Input>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; panel: Panel } | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [newPurchase, setNewPurchase] = useState<{ amount: string; vendorId: string }>({ amount: "", vendorId: "" });

  const load = useCallback(async () => {
    const [d, p] = await Promise.all([
      apiFetch<DayData>("/cash-handover", { query: { date } }),
      showSpend ? apiFetch<Purchase[]>("/purchases", { query: { date } }) : Promise.resolve([] as Purchase[]),
    ]);
    setData(d);
    setPurchases(p);
    onStartDate?.(d.startDate);
    setInputs(
      Object.fromEntries(
        d.rows.map((r) => [
          r.driver.id,
          {
            received: r.handover ? String(r.handover.received) : "",
            less: r.handover?.lessAmount ? String(r.handover.lessAmount) : "",
            reason: r.handover?.lessReason ?? "",
            note: r.handover?.note ?? "",
          },
        ])
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, showSpend]);
  useLiveRefresh(load);

  useEffect(() => {
    setData(null);
    setOpen(null);
    load().catch((e) => toast("Could not load cash handover", "error", e instanceof Error ? e.message : undefined));
  }, [load]);

  useEffect(() => {
    if (showSpend) apiFetch<Vendor[]>("/vendors").then(setVendors).catch(() => setVendors([]));
  }, [showSpend]);

  const historyId = open?.panel === "history" ? open.id : null;
  useEffect(() => {
    if (!historyId) return setHistory(null);
    setHistory(null);
    apiFetch<{ rows: HistoryRow[] }>(`/cash-handover/history/${historyId}`).then((r) => setHistory(r.rows)).catch(() => setHistory([]));
  }, [historyId, data]);

  function toggle(id: string, panel: Panel) {
    setOpen((o) => (o?.id === id && o.panel === panel ? null : { id, panel }));
    if (panel === "purchases") setNewPurchase({ amount: "", vendorId: "" });
  }

  function lessOf(inp: Input) {
    const n = Number(inp.less);
    return inp.less.trim() === "" || !Number.isFinite(n) ? 0 : Math.round(n);
  }
  const setInp = (id: string, patch: Partial<Input>) => setInputs((s) => ({ ...s, [id]: { ...(s[id] ?? EMPTY), ...patch } }));

  async function save(r: Row, received?: number) {
    const inp = inputs[r.driver.id] ?? EMPTY;
    const amount = received ?? Number(inp.received);
    const less = lessOf(inp);
    if (inp.received.trim() === "" && received === undefined) return toast("Enter the cash received first", "warning");
    if (!Number.isFinite(amount) || amount < 0) return toast("Enter a valid amount", "warning");
    if (less > 0 && !inp.reason) {
      setOpen({ id: r.driver.id, panel: "less" });
      return toast("Pick a reason for the less amount", "warning");
    }
    setSaving(r.driver.id);
    try {
      await apiFetch("/cash-handover", {
        method: "PUT",
        body: {
          employeeId: r.driver.id,
          date,
          received: Math.round(amount),
          lessAmount: less,
          lessReason: less > 0 ? inp.reason : null,
          note: inp.note || null,
        },
      });
      const diff = r.expected - less - Math.round(amount);
      toast(
        `${r.driver.name}: saved`,
        diff > 0 ? "warning" : "success",
        diff > 0 ? `AED ${fmtNumber(diff)} short` : diff < 0 ? `AED ${fmtNumber(-diff)} extra received` : "Exact amount"
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
    if (!(await confirmDialog(`Remove the saved handover for ${r.driver.name} on ${fmtDate(date)}?`, { confirmText: "Remove", danger: true }))) return;
    await apiFetch(`/cash-handover/${r.handover.id}`, { method: "DELETE" });
    toast("Handover removed", "info");
    load();
  }

  async function addPurchase(employeeId: string) {
    const amount = Math.round(Number(newPurchase.amount));
    if (!amount || amount <= 0) return toast("Enter the purchase amount", "warning");
    setSaving(employeeId);
    try {
      await apiFetch("/purchases", { method: "POST", body: { date, amount, employeeId, vendorId: newPurchase.vendorId || undefined } });
      setNewPurchase({ amount: "", vendorId: "" });
      await load();
    } catch (e) {
      toast("Could not add purchase", "error", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(null);
    }
  }
  async function removePurchase(id: string) {
    await apiFetch(`/purchases/${id}`, { method: "DELETE" });
    await load();
  }

  if (!data) return <PageSkeleton rows={6} cards={0} />;
  if (data.beforeStart) return <EmptyState title={`Cash handover starts from ${fmtDate(data.startDate)}`} />;
  if (data.rows.length === 0) return <EmptyState title="No active drivers" />;

  // Live per-row figures (what the table shows while typing) and the totals under each column.
  const view = data.rows.map((r) => {
    const inp = inputs[r.driver.id] ?? EMPTY;
    const less = lessOf(inp);
    const due = r.expected - less;
    const typed = inp.received.trim() === "" ? null : Number(inp.received);
    const received = typed === null || !Number.isFinite(typed) ? null : Math.round(typed);
    const changed =
      !r.handover ||
      received !== r.handover.received ||
      less !== r.handover.lessAmount ||
      (inp.reason || null) !== (r.handover.lessReason ?? null) ||
      (inp.note || null) !== (r.handover.note ?? null);
    return {
      r,
      inp,
      less,
      due,
      received,
      diff: received === null ? null : due - received,
      changed,
      exp: r.expenses ?? 0,
      pur: r.purchases ?? r.spent - (r.expenses ?? 0),
    };
  });
  const sum = (fn: (v: (typeof view)[number]) => number) => view.reduce((s, v) => s + fn(v), 0);
  const anyReceived = view.some((v) => v.received !== null);
  const totDiff = anyReceived ? sum((v) => v.diff ?? 0) : null;
  const cols = showSpend ? 7 : 5;

  const iconBtn = "flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-soft hover:border-brass hover:text-navy";
  const onIcon = "border-brass text-navy";

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className={`w-full ${showSpend ? "min-w-[820px]" : "min-w-[620px]"} border-collapse text-sm tabular-nums`}>
        <thead>
          <tr className="bg-navy text-left text-[11px] font-semibold uppercase tracking-wider text-brass">
            <th className="px-4 py-3">Driver</th>
            {showSpend && <th className="px-4 py-3 text-right">Expenses</th>}
            {showSpend && <th className="px-4 py-3 text-right">Purchases</th>}
            <th className="px-4 py-3 text-right">Actual</th>
            <th className="px-4 py-3 text-right">Received</th>
            <th className="px-4 py-3 text-right">Difference</th>
            <th className="w-[1%] px-3 py-3" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {view.map(({ r, inp, less, due, received, diff, changed, exp, pur }) => {
            const id = r.driver.id;
            const busy = saving === id;
            const panel = open?.id === id ? open.panel : null;
            const mine = purchases.filter((p) => p.employeeId === id);
            return (
              <Fragment key={id}>
                <tr className="border-b border-line align-middle">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-[10px] font-bold text-brass">{initials(r.driver.name)}</span>
                      <div className="min-w-0">
                        <p className="font-semibold text-navy">{r.driver.name}</p>
                        {r.handover?.stale && <p className="text-[11px] text-pending">Changed after saving — save again</p>}
                      </div>
                    </div>
                  </td>
                  {showSpend && <td className={`px-4 py-2.5 text-right ${exp ? "text-cancelled" : "text-ink-soft"}`}>{exp ? fmtNumber(exp) : "—"}</td>}
                  {showSpend && (
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => toggle(id, "purchases")}
                        title="Purchases (paid to vendors) — tap to add or remove"
                        className={`rounded-lg border px-2.5 py-1 ${panel === "purchases" ? "border-brass" : "border-transparent hover:border-line"} ${pur ? "text-cancelled" : "text-ink-soft"}`}
                      >
                        {pur ? fmtNumber(pur) : "—"}
                        <span className="ml-1.5 text-ink-soft">
                          <Icon name="plus" size="0.9em" />
                        </span>
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-right">
                    <p className="font-semibold text-navy">{fmtNumber(due)}</p>
                    {less > 0 && (
                      <p className="text-[11px] text-cancelled">
                        −{fmtNumber(less)} {inp.reason ? REASON_LABEL[inp.reason] : ""}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <input
                        inputMode="numeric"
                        placeholder="—"
                        aria-label={`Received from ${r.driver.name}`}
                        value={inp.received}
                        onChange={(e) => setInp(id, { received: e.target.value.replace(/[^0-9]/g, "") })}
                        onKeyDown={(e) => e.key === "Enter" && save(r)}
                        className="w-24 rounded-lg border border-line bg-white px-2.5 py-1.5 text-right text-sm font-semibold text-navy focus:border-brass focus:outline-none"
                      />
                      {received !== null && changed && (
                        <button
                          onClick={() => save(r)}
                          disabled={busy}
                          className="rounded-lg bg-navy px-2.5 py-1.5 text-[11px] font-semibold uppercase text-paper hover:bg-navy-2 disabled:opacity-50"
                        >
                          {busy ? "…" : r.handover ? "Update" : "Save"}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold">
                    <Diff value={diff} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {!r.handover && received === null && due > 0 && (
                        <button onClick={() => save(r, due)} disabled={busy} title={`Received exactly ${fmtNumber(due)}`} aria-label="Received exact amount" className={`${iconBtn} text-delivered hover:text-delivered`}>
                          <Icon name="check" />
                        </button>
                      )}
                      <button onClick={() => toggle(id, "less")} title="Less (salary / short) and note" aria-label="Less and note" className={`${iconBtn} ${panel === "less" || less > 0 || inp.note ? onIcon : ""}`}>
                        <Icon name="minus" />
                      </button>
                      <button onClick={() => toggle(id, "history")} title="History" aria-label="History" className={`${iconBtn} ${panel === "history" ? onIcon : ""}`}>
                        <Icon name="clock" />
                      </button>
                      {r.handover && user?.role === "SUPER_ADMIN" && (
                        <button onClick={() => undo(r)} title="Remove saved handover" aria-label="Remove" className={`${iconBtn} hover:text-cancelled`}>
                          <Icon name="trash" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {panel === "purchases" && (
                  <tr className="border-b border-line bg-paper-2">
                    <td colSpan={cols} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {mine.map((p) => (
                          <span key={p.id} className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-xs">
                            <b className="text-navy">{fmtNumber(p.amount)}</b>
                            {p.vendor && <span className="rounded bg-brass/20 px-1.5 text-[10px] uppercase text-brass">{p.vendor.name}</span>}
                            <button onClick={() => removePurchase(p.id)} title="Remove" aria-label="Remove purchase" className="text-ink-soft hover:text-cancelled">
                              <Icon name="trash" size="0.95em" />
                            </button>
                          </span>
                        ))}
                        <select
                          aria-label="Vendor"
                          value={newPurchase.vendorId}
                          onChange={(e) => setNewPurchase((s) => ({ ...s, vendorId: e.target.value }))}
                          className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs"
                        >
                          <option value="">No vendor</option>
                          {vendors.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                        <input
                          inputMode="numeric"
                          placeholder="Amount"
                          aria-label="Purchase amount"
                          value={newPurchase.amount}
                          onChange={(e) => setNewPurchase((s) => ({ ...s, amount: e.target.value.replace(/[^0-9]/g, "") }))}
                          onKeyDown={(e) => e.key === "Enter" && addPurchase(id)}
                          className="w-24 rounded-lg border border-line bg-white px-2.5 py-1.5 text-right text-xs"
                        />
                        <button
                          onClick={() => addPurchase(id)}
                          disabled={busy}
                          className="rounded-lg bg-navy px-3 py-1.5 text-[11px] font-semibold uppercase text-paper hover:bg-navy-2 disabled:opacity-50"
                        >
                          Add
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {panel === "less" && (
                  <tr className="border-b border-line bg-paper-2">
                    <td colSpan={cols} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          inputMode="numeric"
                          placeholder="Less"
                          aria-label="Less amount"
                          value={inp.less}
                          onChange={(e) => setInp(id, { less: e.target.value.replace(/[^0-9]/g, "") })}
                          className="w-24 rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
                        />
                        <select
                          aria-label="Less reason"
                          value={inp.reason}
                          onChange={(e) => setInp(id, { reason: e.target.value as LessReason | "" })}
                          className={`rounded-lg border bg-white px-3 py-1.5 text-sm ${less > 0 && !inp.reason ? "border-cancelled" : "border-line"}`}
                        >
                          <option value="">Reason…</option>
                          <option value="SALARY">Salary</option>
                          <option value="SHORT">Short</option>
                          <option value="OTHER">Other</option>
                        </select>
                        <input
                          placeholder="Note"
                          value={inp.note}
                          maxLength={300}
                          onChange={(e) => setInp(id, { note: e.target.value })}
                          onKeyDown={(e) => e.key === "Enter" && save(r)}
                          className="min-w-[160px] flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
                        />
                        <span className="text-xs text-ink-soft">
                          Collected {fmtNumber(r.collected)}
                          {r.spent ? ` · spent −${fmtNumber(r.spent)}` : ""} · {r.cashParcels} cash
                          {r.bankParcels ? ` · ${r.bankParcels} bank` : ""}
                          {r.handover?.byName ? ` · by ${r.handover.byName}` : ""}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}

                {panel === "history" && (
                  <tr className="border-b border-line bg-paper-2">
                    <td colSpan={cols} className="px-4 py-3">
                      {!history ? (
                        <p className="text-xs text-ink-soft">Loading…</p>
                      ) : history.length === 0 ? (
                        <p className="text-xs text-ink-soft">No handovers saved yet</p>
                      ) : (
                        <div className="max-h-72 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-[10.5px] uppercase tracking-wider text-ink-soft">
                                <th className="py-1.5 pr-3">Day</th>
                                <th className="py-1.5 pr-3 text-right">Actual</th>
                                <th className="py-1.5 pr-3 text-right">Less</th>
                                <th className="py-1.5 pr-3 text-right">Received</th>
                                <th className="py-1.5 text-right">Difference</th>
                              </tr>
                            </thead>
                            <tbody>
                              {history.map((h) => (
                                <tr key={h.id} title={h.note ?? undefined} className="border-t border-line">
                                  <td className="py-1.5 pr-3">
                                    {onDateChange ? (
                                      <button className="hover:underline" onClick={() => onDateChange(h.date)}>
                                        {fmtDate(h.date)}
                                      </button>
                                    ) : (
                                      fmtDate(h.date)
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-3 text-right">{fmtNumber(h.expected - h.lessAmount)}</td>
                                  <td className="py-1.5 pr-3 text-right">{h.lessAmount ? `${fmtNumber(h.lessAmount)}${h.lessReason ? ` ${REASON_LABEL[h.lessReason]}` : ""}` : "—"}</td>
                                  <td className="py-1.5 pr-3 text-right">{fmtNumber(h.received)}</td>
                                  <td className="py-1.5 text-right font-semibold">
                                    <Diff value={h.diff} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-navy font-semibold text-white">
            <td className="px-4 py-3 text-brass">Total</td>
            {showSpend && <td className="px-4 py-3 text-right">{fmtNumber(sum((v) => v.exp))}</td>}
            {showSpend && <td className="px-4 py-3 text-right">{fmtNumber(sum((v) => v.pur))}</td>}
            <td className="px-4 py-3 text-right">{fmtNumber(sum((v) => v.due))}</td>
            <td className="px-4 py-3 text-right">{fmtNumber(sum((v) => v.received ?? 0))}</td>
            <td className="px-4 py-3 text-right">
              <Diff value={totDiff} onDark />
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
