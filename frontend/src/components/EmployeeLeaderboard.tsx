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
 * ranked by Delivered. When a live refresh changes the order, cards slide to
 * their new place (FLIP) and anyone who moved up gets a "moved up" tag. */
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

  return (
    <div className="elb">
      <style>{`
        @keyframes elb-flash { 0% { box-shadow: 0 0 0 2px rgb(var(--c-delivered) / .7); } 100% { box-shadow: 0 0 0 0 rgb(var(--c-delivered) / 0); } }
        @keyframes elb-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
        @keyframes elb-crown { 0%,100% { transform: translateY(0) rotate(-6deg); } 50% { transform: translateY(-2px) rotate(6deg); } }
        .elb .flash { animation: elb-flash 1.2s ease-out; }
        .elb .tag { animation: elb-in .3s ease-out both; }
        .elb .crown { animation: elb-crown 2.4s ease-in-out infinite; display: inline-block; }
        @media (prefers-reduced-motion: reduce) { .elb .flash, .elb .tag, .elb .crown { animation: none !important; } }
      `}</style>

      <ul className="space-y-2.5">
        {sorted.map((r, i) => {
          const id = String(r.id);
          const pct = r.total > 0 ? Math.round((r.delivered / r.total) * 100) : 0;
          const leader = i === 0 && r.delivered > 0;
          const medal = i < 3 && r.delivered > 0 ? MEDALS[i] : null;
          return (
            <li
              key={id}
              ref={(el) => {
                if (el) refs.current.set(id, el);
                else refs.current.delete(id);
              }}
              className="relative rounded-lg border bg-paper-2/40 p-3.5"
              style={{ borderColor: leader ? "rgb(var(--c-brass))" : "rgb(var(--c-line))", willChange: "transform" }}
            >
              <div key={flash[id] || 0} className={`pointer-events-none absolute inset-0 rounded-lg ${flash[id] ? "flash" : ""}`} aria-hidden />

              <div className="flex items-center gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-semibold"
                  style={medal ? { background: medal, color: "#1a1405" } : { background: "rgb(var(--c-paper-2))", color: "rgb(var(--c-ink-soft))" }}
                  aria-label={`Rank ${i + 1}`}
                >
                  {leader ? <span className="crown">👑</span> : i + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-display text-[15px] font-semibold text-navy">{r.name}</span>
                    {movedUp.has(id) && (
                      <span className="tag rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide" style={{ color: "rgb(var(--c-delivered))", background: "rgb(var(--c-delivered) / .12)" }}>
                        ▲ Moved up
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-ink-soft">{r.total} total</span>
                </div>

                <svg width="42" height="42" viewBox="0 0 42 42" className="shrink-0" aria-label={`${pct}% delivered`}>
                  <circle cx="21" cy="21" r="17" fill="none" stroke="rgb(var(--c-paper-2))" strokeWidth="4" />
                  <circle
                    cx="21"
                    cy="21"
                    r="17"
                    fill="none"
                    stroke="rgb(var(--c-delivered))"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${(pct / 100) * 106.8} 107`}
                    transform="rotate(-90 21 21)"
                    style={{ transition: "stroke-dasharray 600ms ease" }}
                  />
                  <text x="21" y="25" textAnchor="middle" fontSize="10" fill="currentColor" className="text-navy font-mono">
                    {pct}%
                  </text>
                </svg>

                <div className="w-14 shrink-0 text-right">
                  <div className="font-mono text-[22px] font-semibold leading-none tabular-nums" style={{ color: "rgb(var(--c-delivered))" }}>
                    {r.delivered}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-soft">Delivered</div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-1.5">
                <Stat label="Total" value={r.total} />
                <Stat label="Pending" value={r.pending} color="var(--c-pending)" />
                <Stat label="Transfer" value={r.transferred} color="var(--c-transferred)" />
                <Stat label="Cancelled" value={r.cancelled} color="var(--c-cancelled)" />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 rounded-lg border-2 border-navy p-3.5">
        <div className="flex items-center justify-between">
          <span className="font-display text-[15px] font-semibold text-navy">TOTAL</span>
          <div className="text-right">
            <span className="font-mono text-[22px] font-semibold tabular-nums" style={{ color: "rgb(var(--c-delivered))" }}>
              {totals.delivered}
            </span>
            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-soft">Delivered</span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <Stat label="Total" value={totals.total} />
          <Stat label="Pending" value={totals.pending} color="var(--c-pending)" />
          <Stat label="Transfer" value={totals.transferred} color="var(--c-transferred)" />
          <Stat label="Cancelled" value={totals.cancelled} color="var(--c-cancelled)" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-md bg-paper-2/70 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-soft">{label}</div>
      <div className="font-mono text-[13px] font-semibold tabular-nums" style={{ color: color ? `rgb(${color})` : "rgb(var(--c-navy))" }}>
        {value}
      </div>
    </div>
  );
}
