"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface LeaderRow {
  id: string | number;
  name: string;
  delivered: number;
  pending: number;
  cancelled: number;
  transferred: number;
  total: number;
}

interface Props {
  rows: LeaderRow[];
  totals: Omit<LeaderRow, "id" | "name">;
}

const MEDALS = ["rgb(var(--c-brass))", "#c0c6d4", "#c9875a"];

/** Employee-wise Performance as a live leaderboard: one card per driver,
 * ranked by Delivered, one compact line each. When a live refresh changes the
 * order, rows slide to their new place (FLIP) and anyone who moved up gets a ▲. */
export default function EmployeeLeaderboard({ rows, totals }: Props) {
  const sorted = [...rows].sort((a, b) => b.delivered - a.delivered || b.total - a.total || a.name.localeCompare(b.name));
  const order = sorted.map((r) => String(r.id)).join(",");

  const refs = useRef(new Map<string, HTMLLIElement>());
  const lastTops = useRef(new Map<string, number>());
  const lastRanks = useRef<Map<string, number> | null>(null);
  const [movedUp, setMovedUp] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<Record<string, number>>({});
  const lastDelivered = useRef(new Map<string, number>());

  // FLIP: animate each card from its old position to its new one.
  useLayoutEffect(() => {
    const tops = new Map<string, number>();
    refs.current.forEach((el, id) => tops.set(id, el.getBoundingClientRect().top));
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      tops.forEach((top, id) => {
        const prev = lastTops.current.get(id);
        const el = refs.current.get(id);
        if (prev === undefined || !el || prev === top) return;
        el.style.transition = "none";
        el.style.transform = `translateY(${prev - top}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "transform 700ms cubic-bezier(.22,1,.36,1)";
          el.style.transform = "";
        });
      });
    }
    lastTops.current = tops;
  }, [order]);

  // Keep stored positions fresh on resize/scroll so the next move starts right.
  useEffect(() => {
    const snap = () => {
      const tops = new Map<string, number>();
      refs.current.forEach((el, id) => tops.set(id, el.getBoundingClientRect().top));
      lastTops.current = tops;
    };
    window.addEventListener("scroll", snap, { passive: true });
    window.addEventListener("resize", snap);
    return () => {
      window.removeEventListener("scroll", snap);
      window.removeEventListener("resize", snap);
    };
  }, []);

  // "Moved up" tags + a flash on cards whose deliveries went up.
  useEffect(() => {
    const ranks = new Map(sorted.map((r, i) => [String(r.id), i]));
    if (lastRanks.current) {
      const up = new Set<string>();
      ranks.forEach((rank, id) => {
        const prev = lastRanks.current!.get(id);
        if (prev !== undefined && rank < prev) up.add(id);
      });
      if (up.size) {
        setMovedUp(up);
        const t = setTimeout(() => setMovedUp(new Set()), 4000);
        lastRanks.current = ranks;
        return () => clearTimeout(t);
      }
    }
    lastRanks.current = ranks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  useEffect(() => {
    const bumped: string[] = [];
    rows.forEach((r) => {
      const id = String(r.id);
      const prev = lastDelivered.current.get(id);
      if (prev !== undefined && r.delivered > prev) bumped.push(id);
      lastDelivered.current.set(id, r.delivered);
    });
    if (bumped.length) setFlash((f) => Object.fromEntries([...Object.entries(f), ...bumped.map((id) => [id, (f[id] || 0) + 1])]));
  }, [rows]);

  if (!rows.length) return null;

  const COLS =
    "grid grid-cols-[24px_minmax(0,1fr)_repeat(5,34px)] items-center gap-x-1.5 sm:grid-cols-[28px_minmax(0,1fr)_repeat(5,60px)] sm:gap-x-2";

  return (
    <div className="elb">
      <style>{`
        @keyframes elb-flash { 0% { box-shadow: 0 0 0 2px rgb(var(--c-delivered) / .7); } 100% { box-shadow: 0 0 0 0 rgb(var(--c-delivered) / 0); } }
        @keyframes elb-in { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
        .elb .flash { animation: elb-flash 1.2s ease-out; }
        .elb .tag { animation: elb-in .3s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .elb .flash, .elb .tag { animation: none !important; } }
      `}</style>

      {/* Column labels, shown once */}
      <div className={`${COLS} px-2.5 pb-1.5 text-[10px] uppercase tracking-wide text-ink-soft`}>
        <span>#</span>
        <span>Employee</span>
        <span className="text-right"><span className="hidden sm:inline">Total</span><span className="sm:hidden">Tot</span></span>
        <span className="text-right"><span className="hidden sm:inline">Pending</span><span className="sm:hidden">Pend</span></span>
        <span className="text-right"><span className="hidden sm:inline">Transfer</span><span className="sm:hidden">Trf</span></span>
        <span className="text-right"><span className="hidden sm:inline">Cancel</span><span className="sm:hidden">Can</span></span>
        <span className="text-right"><span className="hidden sm:inline">Delivered</span><span className="sm:hidden">Del</span></span>
      </div>

      <ul className="space-y-1.5">
        {sorted.map((r, i) => {
          const id = String(r.id);
          const leader = i === 0 && r.delivered > 0;
          const medal = i < 3 && r.delivered > 0 ? MEDALS[i] : null;
          return (
            <li
              key={id}
              ref={(el) => {
                if (el) refs.current.set(id, el);
                else refs.current.delete(id);
              }}
              className="relative rounded-md border bg-paper-2/40 px-2.5 py-2"
              style={{ borderColor: leader ? "rgb(var(--c-brass))" : "rgb(var(--c-line))", willChange: "transform" }}
            >
              <div key={flash[id] || 0} className={`pointer-events-none absolute inset-0 rounded-md ${flash[id] ? "flash" : ""}`} aria-hidden />

              <div className={`${COLS} font-mono text-[12px] tabular-nums sm:text-[13px]`}>
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold"
                  style={medal ? { background: medal, color: "#1a1405" } : { background: "rgb(var(--c-paper-2))", color: "rgb(var(--c-ink-soft))" }}
                  aria-label={`Rank ${i + 1}`}
                >
                  {i + 1}
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-display text-[14px] font-semibold text-navy">{r.name}</span>
                  {movedUp.has(id) && (
                    <span className="tag shrink-0 text-[11px]" style={{ color: "rgb(var(--c-delivered))" }} aria-label="Moved up">
                      ▲
                    </span>
                  )}
                </span>
                <span className="text-right font-semibold text-navy">{r.total}</span>
                <span className="text-right" style={{ color: "rgb(var(--c-pending))" }}>{r.pending}</span>
                <span className="text-right" style={{ color: "rgb(var(--c-transferred))" }}>{r.transferred}</span>
                <span className="text-right" style={{ color: "rgb(var(--c-cancelled))" }}>{r.cancelled}</span>
                <span className="text-right text-[15px] font-semibold" style={{ color: "rgb(var(--c-delivered))" }}>{r.delivered}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className={`${COLS} mt-2 rounded-md border-2 border-navy px-2.5 py-2 font-mono text-[13px] font-semibold tabular-nums`}>
        <span />
        <span className="font-display text-[14px] text-navy">TOTAL</span>
        <span className="text-right text-navy">{totals.total}</span>
        <span className="text-right" style={{ color: "rgb(var(--c-pending))" }}>{totals.pending}</span>
        <span className="text-right" style={{ color: "rgb(var(--c-transferred))" }}>{totals.transferred}</span>
        <span className="text-right" style={{ color: "rgb(var(--c-cancelled))" }}>{totals.cancelled}</span>
        <span className="text-right text-[15px]" style={{ color: "rgb(var(--c-delivered))" }}>{totals.delivered}</span>
      </div>
    </div>
  );
}
