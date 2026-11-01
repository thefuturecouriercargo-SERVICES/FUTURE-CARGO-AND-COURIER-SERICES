"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { apiFetch } from "@/lib/api";
import { fmtNumber, todayStr } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { useAuth } from "@/context/AuthContext";
import { confirmDialog, toast } from "@/components/ui/Feedback";
import { PageSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";

type Mode = "AFTER_DELIVERY" | "ADVANCE";
type MoneyType = "PAYMENT" | "RECEIPT" | "OPENING" | "ADJUSTMENT";

interface Row {
  vendor: { id: string; name: string; active: boolean; deliveryCharge: number };
  mode: Mode;
  parcels: number;
  earned: number;
  cancelled: number;
  cancelledValue: number;
  deliveredOfAdvance: number;
  paid: number;
  received: number;
  adjustments: number;
  balance: number;
  earnedToday: number;
  paidToday: number;
  lastPayment: string | null;
  pendingCount: number;
  pendingPayable: number;
  state: "DUE" | "VENDOR_OWES" | "SETTLED";
}
interface Overview {
  startDate: string;
  today: string;
  rows: Row[];
  totals: {
    weOwe: number;
    theyOwe: number;
    net: number;
    earned: number;
    paid: number;
    received: number;
    earnedToday: number;
    paidToday: number;
    pendingPayable: number;
    parcels: number;
  };
}
interface Line {
  kind: "PARCEL" | "PAYMENT" | "DRIVER_PAYMENT" | "RECEIPT" | "OPENING" | "ADJUSTMENT";
  id: string;
  day: string;
  amount: number;
  balance: number;
  cnNo?: number;
  status?: string;
  total?: number;
  deliveryCharge?: number;
  enteredOn?: string;
  deliveredOn?: string | null;
  customer?: string | null;
  note?: string | null;
  by?: string | null;
}
interface Ledger {
  vendor: { id: string; name: string };
  mode: Mode;
  startDate: string;
  lines: Line[];
}

const MODE_LABEL: Record<Mode, string> = { AFTER_DELIVERY: "Pay after delivery", ADVANCE: "Paid in advance" };
const KIND_LABEL: Record<Line["kind"], string> = {
  PARCEL: "Parcel",
  PAYMENT: "Paid to vendor",
  DRIVER_PAYMENT: "Paid by driver",
  RECEIPT: "Vendor paid us",
  OPENING: "Opening balance",
  ADJUSTMENT: "Adjustment",
};
const MONEY_HELP: Record<MoneyType, string> = {
  PAYMENT: "Money we gave the vendor. Also shows on the old Vendor Credit page.",
  RECEIPT: "Money the vendor gave back to us (e.g. for cancelled advance parcels).",
  OPENING: "What we already owed (+) or the vendor owed us (−) on the start day.",
  ADJUSTMENT: "Correction: + we owe more, − we owe less.",
};

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });

function Balance({ n, big }: { n: number; big?: boolean }) {
  const cls = n > 0 ? "text-navy" : n < 0 ? "text-cancelled" : "text-ink-soft";
  return (
    <span className={`font-mono ${big ? "text-lg" : ""} font-bold ${cls}`}>
      {fmtNumber(Math.abs(n))}
      <span className="ml-1 text-[10px] font-semibold uppercase">{n > 0 ? "we owe" : n < 0 ? "owes us" : "settled"}</span>
    </span>
  );
}

export default function VendorCreditTrialPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN";
  const [data, setData] = useState<Overview | null>(null);
  const [filter, setFilter] = useState<"ALL" | Mode | "DUE" | "VENDOR_OWES">("ALL");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [money, setMoney] = useState<{ vendorId: string; vendorName: string; type: MoneyType; date: string; amount: string; note: string } | null>(null);
  const [startEdit, setStartEdit] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await apiFetch<Overview>("/vendor-credit-trial"));
  }, []);
  const loadLedger = useCallback(async (id: string) => {
    setLedger(await apiFetch<Ledger>(`/vendor-credit-trial/${id}/ledger`));
  }, []);

  useEffect(() => {
    load().catch((e) => toast(e instanceof Error ? e.message : "Could not load", "error"));
  }, [load]);
  useEffect(() => {
    if (openId) loadLedger(openId).catch(() => setLedger(null));
    else setLedger(null);
  }, [openId, loadLedger]);

  const refresh = useCallback(() => {
    load().catch(() => undefined);
    if (openId) loadLedger(openId).catch(() => undefined);
  }, [load, loadLedger, openId]);
  useSocketEvent("order:changed", refresh);
  useSocketEvent("vendorPayment:changed", refresh);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.rows
      .filter((r) => (filter === "ALL" ? true : filter === "DUE" || filter === "VENDOR_OWES" ? r.state === filter : r.mode === filter))
      .filter((r) => !q || r.vendor.name.toLowerCase().includes(q))
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || a.vendor.name.localeCompare(b.vendor.name));
  }, [data, filter, search]);

  async function changeMode(r: Row, mode: Mode) {
    if (mode === r.mode) return;
    const ok = await confirmDialog(
      `Change ${r.vendor.name} to "${MODE_LABEL[mode]}"? Its whole trial balance is worked out again the new way, from ${data ? fmtDay(data.startDate) : "the start"}.`,
      { title: "Change payment type" }
    );
    if (!ok) return;
    try {
      await apiFetch(`/vendor-credit-trial/${r.vendor.id}/mode`, { method: "PUT", body: { mode } });
      toast(`${r.vendor.name}: ${MODE_LABEL[mode]}`, "success");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not change", "error");
    }
  }

  async function saveMoney() {
    if (!money) return;
    const amount = Math.round(Number(money.amount));
    if (!Number.isFinite(amount) || amount === 0) return toast("Enter an amount", "error");
    try {
      await apiFetch(`/vendor-credit-trial/${money.vendorId}/money`, {
        method: "POST",
        body: { type: money.type, date: money.date, amount, note: money.note.trim() || undefined },
      });
      toast(`${KIND_LABEL[money.type]} saved — ${money.vendorName} ${fmtNumber(Math.abs(amount))}`, "success");
      setMoney(null);
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    }
  }

  async function removeLine(l: Line) {
    if (!(await confirmDialog(`Delete this ${KIND_LABEL[l.kind].toLowerCase()} of ${fmtNumber(Math.abs(l.amount))}?`, { danger: true }))) return;
    try {
      await apiFetch(`/vendor-credit-trial/money/${l.kind}/${l.id}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "error");
    }
  }

  async function saveStart() {
    if (!startEdit) return;
    const ok = await confirmDialog(
      `Start counting from ${fmtDay(startEdit)}? Nothing is deleted — everything before this date is just left out of this page.`,
      { title: "New start date" }
    );
    if (!ok) return;
    try {
      await apiFetch("/vendor-credit-trial/settings", { method: "PUT", body: { startDate: startEdit } });
      setStartEdit(null);
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    }
  }

  const openRow = rows.find((r) => r.vendor.id === openId) ?? data?.rows.find((r) => r.vendor.id === openId);

  return (
    <AuthGate allow={["SUPER_ADMIN", "MANAGER"]}>
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Finance · Trial</p>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-display text-[26px] font-semibold tracking-tight text-navy md:text-[32px]">Vendor Credit (New)</h1>
          {data && (
            <div className="flex items-center gap-2 text-sm">
              {startEdit === null ? (
                <>
                  <span className="rounded border border-brass/50 bg-paper-2 px-2.5 py-1.5 font-mono text-xs">Counting from {fmtDay(data.startDate)}</span>
                  {isAdmin && (
                    <button onClick={() => setStartEdit(data.startDate)} className="text-xs text-navy underline">
                      New start
                    </button>
                  )}
                </>
              ) : (
                <>
                  <input type="date" value={startEdit} onChange={(e) => setStartEdit(e.target.value)} className="rounded border border-line px-2 py-1.5" />
                  <button onClick={saveStart} className="rounded bg-navy px-3 py-1.5 text-xs font-semibold text-paper">Save</button>
                  <button onClick={() => setStartEdit(null)} className="text-xs text-ink-soft">Cancel</button>
                </>
              )}
            </div>
          )}
        </div>
        <p className="mb-5 max-w-3xl text-sm text-ink-soft">
          Separate from the old Vendor Credit page. <b>Pay after delivery</b>: a parcel is owed to the vendor once it is delivered
          (COD − delivery charge). <b>Paid in advance</b>: owed as soon as it&apos;s entered; if it&apos;s cancelled later it drops
          out, so money already paid for it shows as owed back. Payments here are the same payments as the old page.
        </p>

        {!data ? (
          <PageSkeleton rows={8} cards={4} />
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-5">
              {[
                ["We owe vendors", data.totals.weOwe, "text-navy", "Sum of vendors we still have to pay"],
                ["Vendors owe us", data.totals.theyOwe, "text-cancelled", "Overpaid / cancelled advance / prepaid fees"],
                ["Earned since start", data.totals.earned, "text-navy", `${data.totals.parcels} parcels`],
                ["Paid since start", data.totals.paid, "text-delivered", `Today ${fmtNumber(data.totals.paidToday)}`],
                ["Coming (pending)", data.totals.pendingPayable, "text-pending", "Pay-after-delivery parcels not delivered yet"],
              ].map(([label, n, cls, sub]) => (
                <div key={label as string} className="bg-white p-4">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-ink-soft">{label}</div>
                  <div className={`font-display text-xl font-semibold ${cls}`}>{fmtNumber(n as number)} AED</div>
                  <div className="mt-0.5 text-[11px] text-ink-soft">{sub}</div>
                </div>
              ))}
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              {(
                [
                  ["ALL", "All"],
                  ["AFTER_DELIVERY", "Pay after delivery"],
                  ["ADVANCE", "Paid in advance"],
                  ["DUE", "We owe"],
                  ["VENDOR_OWES", "Owes us"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide ${filter === k ? "bg-navy text-paper" : "border border-line bg-white text-ink-soft"}`}
                >
                  {l}
                </button>
              ))}
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor" className="ml-auto w-40 rounded border border-line px-2.5 py-1.5 text-sm" />
            </div>

            {rows.length === 0 ? (
              <EmptyState compact title="No vendors here" icon="inbox" />
            ) : (
              <div className="table-wrap border border-line bg-white">
                <table className="data-table min-w-[980px]">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Payment type</th>
                      <th className="text-right">Parcels</th>
                      <th className="text-right">Earned</th>
                      <th className="text-right">Paid</th>
                      <th className="text-right">Back / Adj.</th>
                      <th className="text-right">Balance</th>
                      <th className="text-right">Today</th>
                      <th className="text-right">Coming</th>
                      <th>Last paid</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.vendor.id} className={openId === r.vendor.id ? "bg-paper-2" : ""}>
                        <td>
                          <button onClick={() => setOpenId(openId === r.vendor.id ? null : r.vendor.id)} className="text-left font-semibold text-navy underline-offset-2 hover:underline">
                            {r.vendor.name}
                          </button>
                          {!r.vendor.active && <span className="ml-1 text-[10px] text-ink-soft">(inactive)</span>}
                        </td>
                        <td>
                          {isAdmin ? (
                            <select value={r.mode} onChange={(e) => changeMode(r, e.target.value as Mode)} className="rounded border border-line px-1.5 py-1 text-xs" aria-label={`Payment type for ${r.vendor.name}`}>
                              <option value="AFTER_DELIVERY">After delivery</option>
                              <option value="ADVANCE">In advance</option>
                            </select>
                          ) : (
                            <span className="text-xs">{MODE_LABEL[r.mode]}</span>
                          )}
                        </td>
                        <td className="text-right font-mono">
                          {r.parcels}
                          {r.cancelled > 0 && <span className="block text-[10px] text-cancelled">{r.cancelled} cancelled</span>}
                        </td>
                        <td className="text-right font-mono">{fmtNumber(r.earned)}</td>
                        <td className="text-right font-mono text-delivered">{fmtNumber(r.paid)}</td>
                        <td className="text-right font-mono text-ink-soft">{r.received || r.adjustments ? fmtNumber(r.received + r.adjustments) : "—"}</td>
                        <td className="text-right">
                          <Balance n={r.balance} />
                        </td>
                        <td className="text-right font-mono text-xs">
                          {r.earnedToday ? <span className="block">+{fmtNumber(r.earnedToday)}</span> : null}
                          {r.paidToday ? <span className="block text-delivered">−{fmtNumber(r.paidToday)}</span> : null}
                          {!r.earnedToday && !r.paidToday && "—"}
                        </td>
                        <td className="text-right font-mono text-xs text-pending">
                          {r.mode === "AFTER_DELIVERY" && r.pendingCount ? `${r.pendingCount} · ${fmtNumber(r.pendingPayable)}` : r.mode === "ADVANCE" && r.pendingCount ? `${r.pendingCount} out` : "—"}
                        </td>
                        <td className="font-mono text-xs">{r.lastPayment ? fmtDay(r.lastPayment) : "—"}</td>
                        <td className="whitespace-nowrap text-right">
                          <button
                            onClick={() => setMoney({ vendorId: r.vendor.id, vendorName: r.vendor.name, type: "PAYMENT", date: todayStr(), amount: r.balance > 0 ? String(r.balance) : "", note: "" })}
                            className="rounded bg-navy px-2.5 py-1 text-xs font-semibold text-paper"
                          >
                            + Pay
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Total ({rows.length})</td>
                      <td className="text-right font-mono">{rows.reduce((t, r) => t + r.parcels, 0)}</td>
                      <td className="text-right font-mono">{fmtNumber(rows.reduce((t, r) => t + r.earned, 0))}</td>
                      <td className="text-right font-mono">{fmtNumber(rows.reduce((t, r) => t + r.paid, 0))}</td>
                      <td className="text-right font-mono">{fmtNumber(rows.reduce((t, r) => t + r.received + r.adjustments, 0))}</td>
                      <td className="text-right">
                        <Balance n={rows.reduce((t, r) => t + r.balance, 0)} />
                      </td>
                      <td colSpan={4}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {openId && openRow && (
              <section className="mt-6 border border-brass/50 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-navy">{openRow.vendor.name}</h2>
                    <p className="text-xs text-ink-soft">
                      {MODE_LABEL[openRow.mode]} · DL charge {openRow.vendor.deliveryCharge} · since {fmtDay(data.startDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <Balance n={openRow.balance} big />
                    <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                      {(["PAYMENT", "RECEIPT", "OPENING", "ADJUSTMENT"] as MoneyType[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => setMoney({ vendorId: openRow.vendor.id, vendorName: openRow.vendor.name, type: t, date: t === "OPENING" ? data.startDate : todayStr(), amount: "", note: "" })}
                          className="rounded border border-line px-2 py-1 text-[11px] text-navy hover:border-brass"
                        >
                          + {KIND_LABEL[t]}
                        </button>
                      ))}
                      <button onClick={() => setOpenId(null)} className="px-2 text-ink-soft" aria-label="Close">
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
                {!ledger || ledger.vendor.id !== openId ? (
                  <PageSkeleton rows={5} />
                ) : ledger.lines.length === 0 ? (
                  <EmptyState compact title="Nothing since the start date yet" icon="inbox" />
                ) : (
                  <div className="table-wrap">
                    <table className="data-table min-w-[820px]">
                      <thead>
                        <tr>
                          <th>Day</th>
                          <th>What</th>
                          <th>Details</th>
                          <th className="text-right">COD</th>
                          <th className="text-right">DL</th>
                          <th className="text-right">+ / −</th>
                          <th className="text-right">Running balance</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...ledger.lines].reverse().map((l) => (
                          <tr key={`${l.kind}-${l.id}`}>
                            <td className="font-mono text-xs">{fmtDay(l.day)}</td>
                            <td className="text-xs">
                              {l.kind === "PARCEL" ? (
                                <>
                                  <b className="font-mono text-navy">CN {l.cnNo}</b>{" "}
                                  <span
                                    className={`ml-1 rounded px-1 py-0.5 font-mono text-[9px] font-bold uppercase ${
                                      l.status === "DELIVERED" ? "bg-delivered-bg text-delivered" : l.status === "CANCELLED" ? "bg-cancelled-bg text-cancelled" : "bg-pending-bg text-pending"
                                    }`}
                                  >
                                    {l.status}
                                  </span>
                                </>
                              ) : (
                                <b>{KIND_LABEL[l.kind]}</b>
                              )}
                            </td>
                            <td className="max-w-[260px] truncate text-xs text-ink-soft">
                              {l.kind === "PARCEL"
                                ? [l.customer, `entered ${fmtDay(l.enteredOn!)}`, l.deliveredOn ? `delivered ${fmtDay(l.deliveredOn)}` : null, l.by].filter(Boolean).join(" · ")
                                : [l.by, l.note].filter(Boolean).join(" · ") || "—"}
                            </td>
                            <td className="text-right font-mono text-xs">{l.kind === "PARCEL" ? fmtNumber(l.total) : ""}</td>
                            <td className="text-right font-mono text-xs">{l.kind === "PARCEL" ? fmtNumber(l.deliveryCharge) : ""}</td>
                            <td className={`text-right font-mono ${l.amount > 0 ? "text-navy" : l.amount < 0 ? "text-delivered" : "text-ink-soft"}`}>
                              {l.kind === "PARCEL" && l.status === "CANCELLED" ? "0 (cancelled)" : `${l.amount > 0 ? "+" : ""}${fmtNumber(l.amount)}`}
                            </td>
                            <td className="text-right">
                              <Balance n={l.balance} />
                            </td>
                            <td className="text-right">
                              {l.kind !== "PARCEL" && l.kind !== "DRIVER_PAYMENT" && (
                                <button onClick={() => removeLine(l)} className="text-xs text-ink-soft hover:text-cancelled" aria-label="Delete">
                                  ✕
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {money && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={() => setMoney(null)}>
            <div className="w-full max-w-sm rounded-xl border border-line bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-1 font-display text-lg font-semibold text-navy">{money.vendorName}</h3>
              <div className="mb-3 flex flex-wrap gap-1">
                {(["PAYMENT", "RECEIPT", "OPENING", "ADJUSTMENT"] as MoneyType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setMoney({ ...money, type: t })}
                    className={`rounded px-2 py-1 text-[11px] ${money.type === t ? "bg-navy text-paper" : "border border-line text-ink-soft"}`}
                  >
                    {KIND_LABEL[t]}
                  </button>
                ))}
              </div>
              <p className="mb-3 text-xs text-ink-soft">{MONEY_HELP[money.type]}</p>
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Date</label>
              <input
                type="date"
                value={money.date}
                min={data?.startDate}
                onChange={(e) => setMoney({ ...money, date: e.target.value })}
                className="mb-3 w-full rounded border border-line px-3 py-2"
              />
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">
                Amount (AED){money.type === "OPENING" || money.type === "ADJUSTMENT" ? " — use − for minus" : ""}
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={money.amount}
                onChange={(e) => setMoney({ ...money, amount: e.target.value })}
                className="mb-3 w-full rounded border border-line px-3 py-2 font-mono"
                autoFocus
              />
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Note</label>
              <input value={money.note} onChange={(e) => setMoney({ ...money, note: e.target.value })} className="mb-4 w-full rounded border border-line px-3 py-2" placeholder="Cash / bank / reference" />
              <div className="flex gap-2">
                <button onClick={() => setMoney(null)} className="flex-1 rounded border border-line px-3 py-2 text-sm">
                  Cancel
                </button>
                <button onClick={saveMoney} className="flex-1 rounded bg-navy px-3 py-2 text-sm font-semibold text-paper">
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGate>
  );
}
