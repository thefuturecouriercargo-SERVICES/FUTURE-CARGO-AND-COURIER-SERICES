"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

interface Ach {
  today: number;
  month: string;
  monthDelivered: number;
  target: number;
  bonusPer: number;
  bonus: number;
  lifetime: number;
  bestDay: { d: string; n: number } | null;
  bestDayMonth: { d: string; n: number } | null;
  bestMonth: { m: string; n: number } | null;
  streak: number;
  days30: number;
  daysWorkedMonth: number;
  badges: { key: string; group: "month" | "overall"; label: string; got: boolean }[];
}
interface Stats {
  daysLeft: number;
}

const monName = (m: string) =>
  new Date(m + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" }).toUpperCase();

/** Monthly target, personal records and badges for the driver. */
export default function DriverTargets({ onBack }: { onBack: () => void }) {
  const [a, setA] = useState<Ach | null>(null);
  const [st, setSt] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [x, y] = await Promise.all([apiFetch<Ach>("/driver/achievements"), apiFetch<Stats>("/driver/race-stats").catch(() => null)]);
      setA(x);
      if (y) setSt(y);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load);

  const left = a ? Math.max(0, a.target - a.monthDelivered) : 0;
  const extra = a ? Math.max(0, a.monthDelivered - a.target) : 0;
  const pct = a ? Math.min(100, Math.round((a.monthDelivered / a.target) * 100)) : 0;
  const daysLeft = st?.daysLeft ?? 0;
  const nextTen = a ? Math.ceil((a.today + 1) / 10) * 10 : 10;

  return (
    <div className="pb-8">
      <div className="mb-3 flex items-center gap-2.5">
        <button type="button" onClick={onBack} aria-label="Back" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white active:scale-95">←</button>
        <h2 className="font-display text-lg font-semibold uppercase text-navy">Targets &amp; achievements</h2>
      </div>

      {error && <p className="mb-3 rounded-xl bg-cancelled-bg px-3 py-2 text-xs text-cancelled">{error}</p>}
      {!a ? (
        <p className="py-10 text-center font-mono text-xs uppercase text-ink-soft">Loading…</p>
      ) : (
        <div className="space-y-3">
          {/* Monthly target */}
          <section className="rounded-2xl bg-navy p-4 text-white shadow">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-widest text-brass-light">
                {monName(a.month)} target {fmtNumber(a.target)}
              </span>
              {daysLeft > 0 && <span className="font-mono text-[10px] uppercase text-white/60">{daysLeft} days left</span>}
            </div>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-[40px] font-extrabold leading-none">{fmtNumber(a.monthDelivered)}</span>
              <span className="mb-1 font-mono text-[11px] uppercase text-white/70">delivered · {pct}%</span>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-brass transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {left > 0 ? (
                <>
                  <MiniTile label="To target" value={fmtNumber(left)} />
                  <MiniTile label="Per day" value={String(Math.ceil(left / Math.max(1, daysLeft)))} />
                  <MiniTile label="Days worked" value={String(a.daysWorkedMonth)} />
                </>
              ) : (
                <>
                  <MiniTile label="Extra" value={`+${fmtNumber(extra)}`} />
                  <MiniTile label="Bonus" value={`AED ${fmtNumber(a.bonus)}`} />
                  <MiniTile label="Days worked" value={String(a.daysWorkedMonth)} />
                </>
              )}
            </div>
            <div className="mt-3 rounded-xl bg-white/10 px-3 py-2.5">
              <div className="flex items-baseline justify-between font-mono text-[10px] font-bold uppercase tracking-wide text-white/70">
                <span>Bonus calculation</span>
                <span>AED {a.bonusPer} per delivery after {fmtNumber(a.target)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[13px] font-bold uppercase">
                <span>
                  {fmtNumber(a.monthDelivered)} − {fmtNumber(a.target)} = <span className="text-brass-light">{fmtNumber(extra)}</span> extra
                </span>
                <span>
                  {fmtNumber(extra)} × {a.bonusPer} = <span className="text-[16px] text-brass-light">AED {fmtNumber(extra * a.bonusPer)}</span>
                </span>
              </div>
              {left > 0 && (
                <div className="mt-1 font-mono text-[10px] uppercase text-white/60">
                  Bonus starts after {fmtNumber(left)} more · 100 extra = AED {fmtNumber(100 * a.bonusPer)}
                </div>
              )}
            </div>
          </section>

          {/* Today */}
          <section className="rounded-2xl bg-white p-4 shadow ring-1 ring-line">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-widest text-ink-soft">Today</span>
              <span className="font-mono text-[11px] font-bold uppercase text-brass">next goal {nextTen}</span>
            </div>
            <div className="mt-1 text-[30px] font-extrabold leading-none text-navy">{a.today}</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-delivered transition-all" style={{ width: `${((a.today % 10) / 10) * 100}%` }} />
            </div>
            {a.bestDay && a.today > 0 && a.today >= a.bestDay.n && (
              <div className="mt-2 font-mono text-[10.5px] font-bold uppercase text-delivered">★ Personal best day!</div>
            )}
          </section>

          {/* Records */}
          <section className="grid grid-cols-2 gap-2">
            <Record label="Best day ever" value={a.bestDay ? String(a.bestDay.n) : "—"} sub={a.bestDay ? fmtDate(a.bestDay.d) : ""} />
            <Record label="Best day this month" value={a.bestDayMonth ? String(a.bestDayMonth.n) : "—"} sub={a.bestDayMonth ? fmtDate(a.bestDayMonth.d) : ""} />
            <Record label="Best month" value={a.bestMonth ? fmtNumber(a.bestMonth.n) : "—"} sub={a.bestMonth ? monName(a.bestMonth.m) : ""} />
            <Record label="All-time delivered" value={fmtNumber(a.lifetime)} sub="Future Courier" />
            <Record label="20+ day streak" value={String(a.streak)} sub={a.streak === 1 ? "day in a row" : "days in a row"} />
            <Record label="30+ days" value={String(a.days30)} sub="this month" />
          </section>

          {/* Badges */}
          {([
            ["month", `${monName(a.month)} badges`],
            ["overall", "Overall badges"],
          ] as const).map(([g, title]) => {
            const list = a.badges.filter((b) => (b.group ?? "overall") === g);
            if (!list.length) return null;
            return (
              <section key={g} className="rounded-2xl bg-white p-4 shadow ring-1 ring-line">
                <div className="mb-2.5 flex items-baseline justify-between font-mono text-[10.5px] font-bold uppercase tracking-widest text-ink-soft">
                  <span>{title}</span>
                  <span className="text-brass">
                    {list.filter((b) => b.got).length}/{list.length}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {list.map((b) => (
                    <div
                      key={b.key}
                      className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-center ${b.got ? "bg-brass/15 ring-1 ring-brass/50" : "bg-paper opacity-60"}`}
                    >
                      <span className={`flex h-9 w-9 items-center justify-center rounded-full text-base ${b.got ? (g === "month" ? "bg-brass text-white" : "bg-navy text-brass-light") : "bg-line text-ink-soft"}`}>
                        {b.got ? "★" : "🔒"}
                      </span>
                      <span className={`font-mono text-[9.5px] font-bold uppercase leading-tight ${b.got ? "text-navy" : "text-ink-soft"}`}>{b.label}</span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MiniTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-1 py-2">
      <div className="font-mono text-[9px] uppercase tracking-wide text-white/70">{label}</div>
      <div className="text-[16px] font-extrabold text-brass-light">{value}</div>
    </div>
  );
}

function Record({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-white px-3.5 py-3 shadow ring-1 ring-line">
      <div className="font-mono text-[9.5px] font-bold uppercase tracking-wide text-ink-soft">{label}</div>
      <div className="text-[24px] font-extrabold leading-tight text-navy">{value}</div>
      <div className="font-mono text-[9.5px] uppercase text-brass">{sub}</div>
    </div>
  );
}
