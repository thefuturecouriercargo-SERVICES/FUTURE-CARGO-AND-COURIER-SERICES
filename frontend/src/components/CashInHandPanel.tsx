"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { toast } from "@/components/ui/Feedback";

interface MonthRow {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
  autoDays: number;
  workingDays: number;
  daysEdited: boolean;
  dailyRate: number;
  calcCost: number;
  costEdited: boolean;
  dailyCost: number;
  isCurrent: boolean;
}
interface CashData {
  startMonth: string;
  months: MonthRow[];
  totalProfit: number;
  manual: { amount: number; note: string; updatedAt: string | null };
  totalDailyCost: number;
  cashInHand: number;
}

const monthName = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
};

/**
 * Profit (every month since Sep) + Manual entry − Daily cost (rate × working days,
 * Sundays off, editable per month) = Cash in hand.
 */
export default function CashInHandPanel() {
  const [data, setData] = useState<CashData | null>(null);
  const [manualAmount, setManualAmount] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [savingManual, setSavingManual] = useState(false);
  const [showMonths, setShowMonths] = useState(false);
  const [edit, setEdit] = useState<{ month: string; days: string; rate: string; cost: string; costTyped: boolean } | null>(null);

  const load = useCallback(async () => {
    const d = await apiFetch<CashData>("/cash-in-hand");
    setData(d);
    setManualAmount(String(d.manual.amount));
    setManualNote(d.manual.note);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function saveManual() {
    const amount = Math.round(Number(manualAmount));
    if (!Number.isFinite(amount)) return toast("Enter a number (use − for minus)", "error");
    setSavingManual(true);
    try {
      await apiFetch("/cash-in-hand/manual", { method: "PUT", body: { amount, note: manualNote.trim() } });
      await load();
      toast("Manual entry saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setSavingManual(false);
    }
  }

  async function saveMonth(auto = false) {
    if (!edit) return;
    const days = auto ? null : Math.round(Number(edit.days));
    const rate = Math.round(Number(edit.rate));
    if (!auto && (!Number.isFinite(days) || (days as number) < 0 || (days as number) > 31)) return toast("Working days must be 0–31", "error");
    if (!Number.isFinite(rate) || rate < 0) return toast("Enter a valid daily amount", "error");
    const cost = Math.round(Number(edit.cost));
    if (edit.costTyped && (edit.cost.trim() === "" || !Number.isFinite(cost) || cost < 0)) return toast("Enter a valid daily cost", "error");
    // Only keep a typed cost if it differs from days × per day.
    const costOverride = auto || !edit.costTyped || cost === (days as number) * rate ? null : cost;
    try {
      await apiFetch(`/cash-in-hand/month/${edit.month}`, { method: "PUT", body: { workingDays: days, dailyRate: rate, costOverride } });
      setEdit(null);
      await load();
      toast(`${monthName(edit.month)} updated`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    }
  }

  if (!data) return null;
  const manualChanged = manualAmount !== String(data.manual.amount) || manualNote !== data.manual.note;

  return (
    <div className="mb-6 border border-brass/50 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2.5">
        <h2 className="font-display text-[18px] font-semibold text-navy">Cash in Hand</h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">Since {monthName(data.startMonth)} · not affected by the dates above</span>
      </div>

      <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-4">
        <div className="bg-white p-4">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">① Profit since {monthName(data.startMonth)}</div>
          <div className={`font-display text-xl font-semibold ${data.totalProfit >= 0 ? "text-navy" : "text-cancelled"}`}>{fmtNumber(data.totalProfit)} AED</div>
          <div className="mt-1 text-[11px] text-ink-soft">Each month&apos;s net profit added up</div>
        </div>

        <div className="bg-white p-4">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">② Manual entry (+ / −)</div>
          <div className="flex gap-1.5">
            <input
              type="number"
              inputMode="numeric"
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)}
              className="w-full min-w-0 rounded border border-line px-2 py-1.5 font-mono"
              aria-label="Manual amount"
            />
          </div>
          <input
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
            placeholder="Note (e.g. opening cash)"
            className="mt-1.5 w-full rounded border border-line px-2 py-1 text-xs"
          />
          {manualChanged && (
            <button onClick={saveManual} disabled={savingManual} className="mt-1.5 w-full rounded bg-navy px-2 py-1.5 text-xs font-semibold text-paper disabled:opacity-60">
              {savingManual ? "Saving…" : "Save"}
            </button>
          )}
        </div>

        <div className="bg-white p-4">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">③ Daily cost (minus)</div>
          <div className="font-display text-xl font-semibold text-cancelled">− {fmtNumber(data.totalDailyCost)} AED</div>
          <button onClick={() => setShowMonths((s) => !s)} className="mt-1 text-[11px] text-navy underline">
            {data.months.reduce((t, m) => t + m.workingDays, 0)} working days · {showMonths ? "hide" : "edit"} months
          </button>
        </div>

        <div className="bg-paper-2 p-4">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-brass">= Final cash in hand</div>
          <div className={`font-display text-2xl font-bold ${data.cashInHand >= 0 ? "text-navy" : "text-cancelled"}`}>{fmtNumber(data.cashInHand)} AED</div>
          <div className="mt-1 text-[11px] text-ink-soft">① + ② − ③</div>
        </div>
      </div>

      {showMonths && (
        <div className="table-wrap mt-4">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Profit</th>
                <th className="text-right">Working days</th>
                <th className="text-right">× Per day</th>
                <th className="text-right">Daily cost</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month}>
                  <td>
                    {monthName(m.month)}
                    {m.isCurrent && <span className="ml-1 text-[10px] text-ink-soft">(so far)</span>}
                  </td>
                  <td className={`text-right font-mono ${m.profit >= 0 ? "" : "text-cancelled"}`}>{fmtNumber(m.profit)}</td>
                  {edit?.month === m.month ? (
                    <>
                      <td className="text-right">
                        <input
                          type="number"
                          value={edit.days}
                          onChange={(e) => setEdit({ ...edit, days: e.target.value, cost: edit.costTyped ? edit.cost : String((Number(e.target.value) || 0) * (Number(edit.rate) || 0)) })}
                          className="w-16 rounded border border-line px-1.5 py-1 text-right font-mono"
                          aria-label="Working days"
                        />
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          value={edit.rate}
                          onChange={(e) => setEdit({ ...edit, rate: e.target.value, cost: edit.costTyped ? edit.cost : String((Number(edit.days) || 0) * (Number(e.target.value) || 0)) })}
                          className="w-20 rounded border border-line px-1.5 py-1 text-right font-mono"
                          aria-label="Amount per day"
                        />
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          inputMode="numeric"
                          value={edit.cost}
                          onChange={(e) => setEdit({ ...edit, cost: e.target.value, costTyped: true })}
                          onKeyDown={(e) => e.key === "Enter" && saveMonth()}
                          className="w-24 rounded border border-brass/60 px-1.5 py-1 text-right font-mono"
                          aria-label="Daily cost"
                        />
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <button onClick={() => saveMonth()} className="mr-2 text-xs font-semibold text-navy underline">Save</button>
                        {(m.daysEdited || m.costEdited) && (
                          <button onClick={() => saveMonth(true)} className="mr-2 text-xs text-ink-soft underline" title={`Back to ${m.autoDays} days (no Sundays) × per day`}>
                            Auto
                          </button>
                        )}
                        <button onClick={() => setEdit(null)} className="text-xs text-ink-soft">✕</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="text-right font-mono">
                        {m.workingDays}
                        {m.daysEdited && <span className="ml-1 text-[10px] text-brass" title={`Auto would be ${m.autoDays}`}>edited</span>}
                      </td>
                      <td className="text-right font-mono">{fmtNumber(m.dailyRate)}</td>
                      <td className="text-right font-mono text-cancelled">
                        − {fmtNumber(m.dailyCost)}
                        {m.costEdited && <span className="ml-1 text-[10px] text-brass" title={`Days × per day would be ${fmtNumber(m.calcCost)}`}>edited</span>}
                      </td>
                      <td className="text-right">
                        <button
                          onClick={() => setEdit({ month: m.month, days: String(m.workingDays), rate: String(m.dailyRate), cost: String(m.dailyCost), costTyped: m.costEdited })}
                          className="text-xs text-navy underline"
                        >
                          Edit
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="text-right font-mono">{fmtNumber(data.totalProfit)}</td>
                <td className="text-right font-mono">{data.months.reduce((t, m) => t + m.workingDays, 0)}</td>
                <td></td>
                <td className="text-right font-mono">− {fmtNumber(data.totalDailyCost)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-[11px] text-ink-soft">
            Working days = days that are not Sunday (whole month; the running month counts up to today). Tap Edit to change a month&apos;s days, the per-day amount, or type the month&apos;s daily cost directly (e.g. what was actually taken). Auto puts it back.
          </p>
        </div>
      )}
    </div>
  );
}
