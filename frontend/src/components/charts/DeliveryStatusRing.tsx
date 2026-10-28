"use client";

import { useState } from "react";

interface Props {
  delivered: number;
  pending: number;
  transferred: number;
  cancelled: number;
}

const R = 84;
const STROKE = 14;
const C = 2 * Math.PI * R;
const GAP = 3; // px of empty track between segments

/** Premium, hand-drawn SVG ring for the Dashboard's Delivery Status card —
 * thin segmented ring, delivery rate in the centre, and a legend with counts,
 * shares and bars. Hovering a legend row (or a segment) highlights it. */
export default function DeliveryStatusRing({ delivered, pending, transferred, cancelled }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const items = [
    { key: "delivered", label: "Delivered", value: delivered, color: "rgb(var(--c-delivered))" },
    { key: "pending", label: "Pending", value: pending, color: "rgb(var(--c-pending))" },
    { key: "transferred", label: "Transfer", value: transferred, color: "rgb(var(--c-transferred))" },
    { key: "cancelled", label: "Cancelled", value: cancelled, color: "rgb(var(--c-cancelled))" },
  ];
  const total = items.reduce((s, i) => s + i.value, 0);
  const visible = items.filter((i) => i.value > 0);
  const gapTotal = visible.length > 1 ? GAP * visible.length : 0;
  const usable = C - gapTotal;

  let offset = 0;
  const segments = visible.map((i) => {
    const len = total > 0 ? (i.value / total) * usable : 0;
    const seg = { ...i, len, offset };
    offset += len + (visible.length > 1 ? GAP : 0);
    return seg;
  });

  const active = hover ? items.find((i) => i.key === hover) : null;
  const centreValue = active ? active.value : delivered;
  const centrePct = total > 0 ? Math.round(((active ? active.value : delivered) / total) * 100) : 0;
  const centreLabel = active ? active.label : "Delivered";

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative h-[220px] w-[220px]">
        <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" role="img" aria-label={`Delivery status: ${items.map((i) => `${i.value} ${i.label.toLowerCase()}`).join(", ")}`}>
          <defs>
            <filter id="ring-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle cx="100" cy="100" r={R} fill="none" stroke="rgb(var(--c-paper-2))" strokeWidth={STROKE} opacity={0.6} />
          {segments.map((s) => (
            <circle
              key={s.key}
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === s.key ? STROKE + 4 : STROKE}
              strokeDasharray={`${s.len} ${C}`}
              strokeDashoffset={-s.offset}
              filter={hover === s.key ? "url(#ring-glow)" : undefined}
              opacity={hover && hover !== s.key ? 0.3 : 1}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              style={{ transition: "stroke-dasharray 700ms ease, stroke-dashoffset 700ms ease, opacity 200ms, stroke-width 200ms", cursor: "pointer" }}
            />
          ))}
          <circle cx="100" cy="100" r={R - 22} fill="none" stroke="rgb(var(--c-line))" strokeWidth="1" strokeDasharray="2 4" />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-soft">{centreLabel}</span>
          <span className="font-display text-[40px] font-semibold leading-tight tabular-nums text-navy">{centrePct}%</span>
          <span className="text-xs tabular-nums text-ink-soft">
            {centreValue.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
          </span>
        </div>
      </div>

      <ul className="w-full space-y-1">
        {items.map((i) => {
          const pct = total > 0 ? (i.value / total) * 100 : 0;
          return (
            <li
              key={i.key}
              onMouseEnter={() => setHover(i.key)}
              onMouseLeave={() => setHover(null)}
              className={`rounded-xl px-3 py-2.5 transition ${hover === i.key ? "bg-paper-2" : ""}`}
            >
              <div className="mb-1.5 flex items-center gap-2.5 text-sm">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} aria-hidden />
                <span className="flex-1 text-ink-soft">{i.label}</span>
                <span className="font-semibold tabular-nums text-navy">{i.value.toLocaleString("en-US")}</span>
                <span className="w-12 text-right text-xs tabular-nums text-ink-soft">{pct.toFixed(1)}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-paper-2">
                <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: i.color }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
