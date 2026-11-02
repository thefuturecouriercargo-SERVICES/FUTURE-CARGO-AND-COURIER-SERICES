"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, currentMonthStr } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";

interface DayRow {
  date: string;
  weekday: number;
  delivered: number;
  charges: number;
  salary: number;
  expenses: number;
  expenseByCategory: Record<string, number>;
  profit: number;
}
interface DriverRow {
  id: string;
  name: string;
  salary: number;
  dailySalary: number;
  days: DayRow[];
  totals: {
    delivered: number;
    charges: number;
    salary: number;
    expenses: number;
    expenseByCategory: Record<string, number>;
    profit: number;
    workedDays: number;
    profitDays: number;
    lossDays: number;
    avgPerWorkedDay: number;
    breakEvenPerDay: number | null;
  };
}
interface Data {
  month: string;
  from: string;
  to: string;
  isRunning: boolean;
  drivers: DriverRow[];
}

const CAT: Record<string, string> = {
  FUEL: "Fuel",
  SALIK: "Salik",
  DARB: "Darb",
  PARKING: "Parking",
  CAR_WASH: "Car wash",
  WORKSHOP: "Workshop",
  CAR_RENT: "Car rent",
  ROOM_RENT: "Room rent",
  INSURANCE: "Insurance",
  STATIONARY: "Stationery",
  VISA: "Visa",
  MEDICAL: "Medical",
  COMMISSION: "Commission",
  OTHER: "Other",
};
const catText = (by: Record<string, number>) =>
  Object.entries(by)
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `${CAT[c] ?? c} ${fmtNumber(v)}`)
    .join(" · ");
const money = (n: number) => fmtNumber(Math.round(n));
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;

/**
 * Per driver, per day: delivery charges − salary ÷ 30 − his expenses = profit.
 * Shown on the P&L page.
 */
export default function DriverDailyProfitPanel() {
  const [month, setMonth] = useState(currentMonthStr());
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hideOff, setHideOff] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<Data>("/driver-profit", { query: { month } });
      setData(d);
      setSelected((s) => (s && d.drivers.some((x) => x.id === s) ? s : d.drivers[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const drv = data?.drivers.find((d) => d.id === selected) ?? null;
  const shownDays = drv ? (hideOff ? drv.days.filter((d) => d.delivered > 0 || d.expenses > 0) : drv.days) : [];

  return (
    <div className="mb-6 border border-brass/50 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
        <div>
          <h2 className="font-display text-[18px] font-semibold text-navy">Driver Daily Profit</h2>
          <p className="text-[11px] text-ink-soft">Delivery charges − salary ÷ 30 − his expenses (fuel, Salik, parking…) = profit each day</p>
        </div>
        <input
          type="month"
          value={month}
          max={currentMonthStr()}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="rounded border border-line px-2 py-1.5 font-mono text-sm"
          aria-label="Month"
        />
      </div>

      {loading && !data ? (
        <div className="space-y-2.5 py-2" role="status" aria-label="Loading">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ) : error ? (
        <p className="text-sm text-cancelled">{error}</p>
      ) : !data || data.drivers.length === 0 ? (
        <p className="text-sm text-ink-soft">No drivers with a salary or deliveries this month.</p>
      ) : (
        <div className={loading ? "opacity-60" : ""}>
          {/* All drivers — month summary */}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th className="text-right">Salary</th>
                  <th className="text-right">Days worked</th>
                  <th className="text-right">Deliveries</th>
                  <th className="text-right">DL charges</th>
                  <th className="text-right">Salary cost</th>
                  <th className="text-right">Expenses</th>
                  <th className="text-right">Profit</th>
                  <th className="text-right">Profit / loss days</th>
                  <th className="text-right">Avg / day</th>
                  <th className="text-right">Needs / day</th>
                </tr>
              </thead>
              <tbody>
                {data.drivers.map((d) => {
                  const t = d.totals;
                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelected(d.id)}
                      className={`cursor-pointer hover:bg-paper-2 ${selected === d.id ? "bg-brass/10" : ""}`}
                    >
                      <td className="font-semibold">
                        <span className="mr-1.5 inline-block w-3 text-brass">{selected === d.id ? "▸" : ""}</span>
                        {d.name}
                      </td>
                      <td className="text-right font-mono">{money(d.salary)}</td>
                      <td className="text-right font-mono">{t.workedDays}</td>
                      <td className="text-right font-mono">{t.delivered}</td>
                      <td className="text-right font-mono">{money(t.charges)}</td>
                      <td className="text-right font-mono text-cancelled">− {money(t.salary)}</td>
                      <td className="text-right font-mono text-cancelled" title={catText(t.expenseByCategory)}>
                        − {money(t.expenses)}
                      </td>
                      <td className={`text-right font-mono font-semibold ${t.profit >= 0 ? "text-delivered" : "text-cancelled"}`}>{signed(t.profit)}</td>
                      <td className="whitespace-nowrap text-right font-mono">
                        <span className="text-delivered">{t.profitDays}</span>
                        <span className="text-ink-soft"> / </span>
                        <span className="text-cancelled">{t.lossDays}</span>
                      </td>
                      <td className="text-right font-mono">{t.avgPerWorkedDay}</td>
                      <td className={`text-right font-mono ${t.breakEvenPerDay !== null && t.avgPerWorkedDay < t.breakEvenPerDay ? "text-cancelled" : ""}`}>
                        {t.breakEvenPerDay ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {data.drivers.length > 1 && (
                <tfoot>
                  <tr>
                    <td>All drivers</td>
                    <td></td>
                    <td></td>
                    <td className="text-right font-mono">{data.drivers.reduce((s, d) => s + d.totals.delivered, 0)}</td>
                    <td className="text-right font-mono">{money(data.drivers.reduce((s, d) => s + d.totals.charges, 0))}</td>
                    <td className="text-right font-mono">− {money(data.drivers.reduce((s, d) => s + d.totals.salary, 0))}</td>
                    <td className="text-right font-mono">− {money(data.drivers.reduce((s, d) => s + d.totals.expenses, 0))}</td>
                    <td className="text-right font-mono">{signed(data.drivers.reduce((s, d) => s + d.totals.profit, 0))}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Selected driver — day by day */}
          {drv && (
            <div className="mt-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {data.drivers.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setSelected(d.id)}
                      className={`rounded border px-3 py-1.5 text-xs font-semibold ${
                        d.id === drv.id ? "border-brass bg-brass/15 text-navy" : "border-line text-ink-soft hover:border-brass"
                      }`}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-xs text-ink-soft">
                  <input type="checkbox" checked={hideOff} onChange={(e) => setHideOff(e.target.checked)} />
                  Hide days with no work
                </label>
              </div>
              <p className="mb-2 text-[11px] text-ink-soft">
                {drv.name}: salary {money(drv.salary)} ÷ 30 = <span className="font-mono text-navy">{fmtNumber(drv.dailySalary)}</span> AED a day, counted every day (Sundays and days off too).
                {data.isRunning && " Running month — up to today."}
              </p>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th className="text-right">Deliveries</th>
                      <th className="text-right">DL charges</th>
                      <th className="text-right">Salary / day</th>
                      <th className="text-right">Expenses</th>
                      <th>Expense detail</th>
                      <th className="text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownDays.map((d) => {
                      const off = d.delivered === 0;
                      return (
                        <Fragment key={d.date}>
                          <tr className={off ? "opacity-60" : ""}>
                            <td className="whitespace-nowrap">
                              {dayLabel(d.date)}
                              {off && <span className="ml-1.5 text-[10px] text-ink-soft">{d.weekday === 0 ? "Sunday" : "no deliveries"}</span>}
                            </td>
                            <td className="text-right font-mono">{d.delivered}</td>
                            <td className="text-right font-mono">{money(d.charges)}</td>
                            <td className="text-right font-mono text-cancelled">− {money(d.salary)}</td>
                            <td className="text-right font-mono text-cancelled">{d.expenses ? `− ${money(d.expenses)}` : "0"}</td>
                            <td className="text-xs text-ink-soft">{catText(d.expenseByCategory) || "—"}</td>
                            <td className={`text-right font-mono font-semibold ${d.profit >= 0 ? "text-delivered" : "text-cancelled"}`}>
                              {signed(d.profit)}
                              <span className="ml-1 text-[10px]">{d.profit >= 0 ? "▲" : "▼"}</span>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="text-right font-mono">{drv.totals.delivered}</td>
                      <td className="text-right font-mono">{money(drv.totals.charges)}</td>
                      <td className="text-right font-mono">− {money(drv.totals.salary)}</td>
                      <td className="text-right font-mono">− {money(drv.totals.expenses)}</td>
                      <td className="text-xs">{catText(drv.totals.expenseByCategory) || "—"}</td>
                      <td className={`text-right font-mono ${drv.totals.profit >= 0 ? "text-delivered" : "text-cancelled"}`}>{signed(drv.totals.profit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-ink-soft">
                Only delivered orders count (agent orders excluded). Expenses are the ones entered against this driver; salary payment entries are left out because salary is already counted per day.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
