"use client";

import { useEffect, useRef, useState } from "react";

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

/** Counts a number up/down smoothly whenever it changes. */
function useAnimatedNumber(value: number, duration = 900) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (value - from) * eased;
      setDisplay(v);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      fromRef.current = value;
    };
  }, [value, duration]);
  return display;
}

/** Live SVG ring for the Dashboard's Delivery Status card —
 * segments sweep in, every status has a blinking beacon at its tip that
 * bursts when its count changes (socket refresh), a light comet orbits the
 * track, and numbers count up. Hovering a legend row or segment highlights it. */
export default function DeliveryStatusRing({ delivered, pending, transferred, cancelled }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [bursts, setBursts] = useState<Record<string, number>>({});
  const prev = useRef<Record<string, number> | null>(null);

  const items = [
    { key: "delivered", label: "Delivered", value: delivered, color: "rgb(var(--c-delivered))", rgb: "var(--c-delivered)" },
    { key: "pending", label: "Pending", value: pending, color: "rgb(var(--c-pending))", rgb: "var(--c-pending)" },
    { key: "transferred", label: "Transfer", value: transferred, color: "rgb(var(--c-transferred))", rgb: "var(--c-transferred)" },
    { key: "cancelled", label: "Cancelled", value: cancelled, color: "rgb(var(--c-cancelled))", rgb: "var(--c-cancelled)" },
  ];

  // Sweep the ring in after first paint.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // When a live refresh changes a count, fire a burst on that status's beacon.
  useEffect(() => {
    const now = { delivered, pending, transferred, cancelled };
    if (prev.current) {
      const changed = Object.keys(now).filter((k) => prev.current![k] !== now[k as keyof typeof now]);
      if (changed.length) {
        setBursts((b) => {
          const next = { ...b };
          changed.forEach((k) => (next[k] = (next[k] || 0) + 1));
          return next;
        });
      }
    }
    prev.current = now;
  }, [delivered, pending, transferred, cancelled]);

  const total = items.reduce((s, i) => s + i.value, 0);
  const visible = items.filter((i) => i.value > 0);
  const gapTotal = visible.length > 1 ? GAP * visible.length : 0;
  const usable = C - gapTotal;

  let offset = 0;
  const segments = visible.map((i, idx) => {
    const len = total > 0 ? (i.value / total) * usable : 0;
    const end = offset + len;
    // Beacon sits at the leading tip of each segment (SVG is rotated -90°, so 0 rad = top).
    const angle = (end / C) * 2 * Math.PI;
    const seg = { ...i, len, offset, idx, dotX: 100 + R * Math.cos(angle), dotY: 100 + R * Math.sin(angle) };
    offset += len + (visible.length > 1 ? GAP : 0);
    return seg;
  });

  const active = hover ? items.find((i) => i.key === hover) : null;
  const centreTarget = active ? active.value : delivered;
  const pctTarget = total > 0 ? ((active ? active.value : delivered) / total) * 100 : 0;
  const centreLabel = active ? active.label : "Delivered";
  const centreColor = active ? active.color : "rgb(var(--c-delivered))";

  const animPct = useAnimatedNumber(pctTarget, 700);
  const animValue = useAnimatedNumber(centreTarget, 700);
  const animTotal = useAnimatedNumber(total, 900);

  return (
    <div className="dsr flex flex-col items-center gap-6">
      <style>{`
        @keyframes dsr-ping { 0% { transform: scale(1); opacity: .75; } 80%,100% { transform: scale(3.2); opacity: 0; } }
        @keyframes dsr-blink { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
        @keyframes dsr-burst { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(6); opacity: 0; } }
        @keyframes dsr-orbit { to { transform: rotate(360deg); } }
        @keyframes dsr-breathe { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
        @keyframes dsr-pop { 0% { opacity: 0; transform: scale(.2); } 70% { transform: scale(1.25); } 100% { opacity: 1; transform: scale(1); } }
        .dsr .fb { transform-box: fill-box; transform-origin: center; }
        .dsr .ping { animation: dsr-ping 2.2s cubic-bezier(0,0,.2,1) infinite; }
        .dsr .blink { animation: dsr-blink 1.6s ease-in-out infinite; }
        .dsr .burst { animation: dsr-burst 1s ease-out forwards; }
        .dsr .pop { animation: dsr-pop .6s ease-out both; }
        .dsr .orbit { transform-origin: 100px 100px; animation: dsr-orbit 7s linear infinite; }
        .dsr .breathe { animation: dsr-breathe 3s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .dsr .ping, .dsr .blink, .dsr .burst, .dsr .orbit, .dsr .breathe, .dsr .pop { animation: none !important; }
          .dsr .ping, .dsr .burst { opacity: 0; }
        }
      `}</style>

      <div className="relative h-[220px] w-[220px]">
        <svg
          viewBox="0 0 200 200"
          className="h-full w-full -rotate-90 overflow-visible"
          role="img"
          aria-label={`Delivery status: ${items.map((i) => `${i.value} ${i.label.toLowerCase()}`).join(", ")}`}
        >
          <defs>
            <filter id="ring-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="dot-glow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="2.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="comet" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#fff" stopOpacity="0" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0.9" />
            </linearGradient>
          </defs>

          {/* Track */}
          <circle cx="100" cy="100" r={R} fill="none" stroke="rgb(var(--c-paper-2))" strokeWidth={STROKE} opacity={0.6} />

          {/* Segments */}
          {segments.map((s) => (
            <circle
              key={s.key}
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === s.key ? STROKE + 4 : STROKE}
              strokeDasharray={`${mounted ? s.len : 0} ${C}`}
              strokeDashoffset={-s.offset}
              filter={hover === s.key ? "url(#ring-glow)" : undefined}
              opacity={hover && hover !== s.key ? 0.3 : 1}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              style={{
                transition: `stroke-dasharray 1100ms cubic-bezier(.22,1,.36,1) ${s.idx * 120}ms, stroke-dashoffset 700ms ease, opacity 200ms, stroke-width 200ms`,
                cursor: "pointer",
              }}
            />
          ))}

          {/* Orbiting comet — a soft light sweeping around the ring */}
          {total > 0 && (
            <g className="orbit" style={{ pointerEvents: "none" }}>
              <circle
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke="#fff"
                strokeOpacity={0.22}
                strokeWidth={STROKE - 6}
                strokeLinecap="round"
                strokeDasharray={`26 ${C}`}
              />
              <circle cx={100 + R * Math.cos(26 / R)} cy={100 + R * Math.sin(26 / R)} r="2.2" fill="#fff" opacity={0.85} filter="url(#dot-glow)" />
            </g>
          )}

          {/* Inner dashed guide, gently breathing */}
          <circle className="breathe" cx="100" cy="100" r={R - 22} fill="none" stroke="rgb(var(--c-line))" strokeWidth="1" strokeDasharray="2 4" />

          {/* Blinking beacons — one per status, at each segment's tip */}
          {mounted &&
            segments.map((s) => {
              const dim = hover && hover !== s.key;
              return (
                <g
                  key={`dot-${s.key}`}
                  opacity={dim ? 0.25 : 1}
                  style={{ transition: "opacity 200ms", cursor: "pointer" }}
                  onMouseEnter={() => setHover(s.key)}
                  onMouseLeave={() => setHover(null)}
                >
                  {/* Expanding ping ring, staggered per status */}
                  <circle className="fb ping" cx={s.dotX} cy={s.dotY} r="5" fill={s.color} style={{ animationDelay: `${s.idx * 0.45}s` }} />
                  {/* One-off burst when this status's count changes */}
                  {bursts[s.key] ? (
                    <circle key={bursts[s.key]} className="fb burst" cx={s.dotX} cy={s.dotY} r="5" fill="none" stroke={s.color} strokeWidth="2" />
                  ) : null}
                  {/* Core dot */}
                  <g className="fb pop" style={{ animationDelay: `${0.9 + s.idx * 0.12}s` }}>
                    <circle cx={s.dotX} cy={s.dotY} r={hover === s.key ? 7 : 5.5} fill="rgb(var(--c-paper))" stroke={s.color} strokeWidth="2.5" style={{ transition: "r 200ms" }} />
                    <circle className="fb blink" cx={s.dotX} cy={s.dotY} r="2.6" fill={s.color} filter="url(#dot-glow)" style={{ animationDelay: `${s.idx * 0.3}s` }} />
                  </g>
                </g>
              );
            })}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em]" style={{ color: centreColor, transition: "color 200ms" }}>
            {centreLabel}
          </span>
          <span className="font-display text-[40px] font-semibold leading-tight tabular-nums text-navy">{Math.round(animPct)}%</span>
          <span className="text-xs tabular-nums text-ink-soft">
            {Math.round(animValue).toLocaleString("en-US")} of {Math.round(animTotal).toLocaleString("en-US")}
          </span>
          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em]" style={{ color: "rgb(var(--c-delivered))", background: "rgb(var(--c-delivered) / 0.12)" }}>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "rgb(var(--c-delivered))" }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "rgb(var(--c-delivered))" }} />
            </span>
            Live
          </span>
        </div>
      </div>

      <ul className="w-full space-y-1">
        {items.map((i, idx) => {
          const pct = total > 0 ? (i.value / total) * 100 : 0;
          return (
            <li
              key={i.key}
              onMouseEnter={() => setHover(i.key)}
              onMouseLeave={() => setHover(null)}
              className={`rounded-xl px-3 py-2.5 transition ${hover === i.key ? "bg-paper-2" : ""}`}
            >
              <div className="mb-1.5 flex items-center gap-2.5 text-sm">
                {/* Pulsing status dot */}
                <span className="relative flex h-2.5 w-2.5" aria-hidden>
                  {i.value > 0 && (
                    <span
                      className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                      style={{ background: i.color, animationDelay: `${idx * 0.45}s`, animationDuration: "2.2s" }}
                    />
                  )}
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: i.color, boxShadow: `0 0 8px rgb(${i.rgb} / 0.7)` }} />
                </span>
                <span className="flex-1 text-ink-soft">{i.label}</span>
                <span className="font-semibold tabular-nums text-navy">{i.value.toLocaleString("en-US")}</span>
                <span className="w-12 text-right text-xs tabular-nums text-ink-soft">{pct.toFixed(1)}%</span>
              </div>
              <div className="relative h-1 overflow-hidden rounded-full bg-paper-2">
                <div
                  className="h-full rounded-full transition-[width] duration-1000 ease-out"
                  style={{ width: mounted ? `${pct}%` : "0%", background: i.color, boxShadow: `0 0 6px rgb(${i.rgb} / 0.6)` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
