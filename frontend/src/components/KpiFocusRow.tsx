"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

/**
 * Dashboard KPI boxes in one row, with one box in focus at the middle.
 * Every few seconds the row slides one step left: the box landing in the
 * middle grows a little and lights up in its own colour, its neighbours step
 * down in size and fade. Hovering pauses it; clicking a box brings it to the
 * middle. On phones and small tablets it falls back to the normal grid.
 */

export interface FocusItem {
  key: string;
  /** Highlight colour for this box (CSS colour). */
  color: string;
  node: ReactNode;
}

const GAP = 10;
const BASE_H = 172; // height of the box in focus; others scale down from this
const STEP_MS = 3500;
// Size and fade for each position, edge → middle → edge.
const SIZE = [0.72, 0.82, 0.92, 1, 0.92, 0.82, 0.72];
const FADE = [0.4, 0.55, 0.75, 1, 0.75, 0.55, 0.4];

/** Spread SIZE/FADE to any count of boxes, middle always 1. */
function profile(n: number, table: number[]) {
  const mid = (n - 1) / 2;
  return Array.from({ length: n }, (_, s) => {
    const d = Math.min(3, Math.round(Math.abs(s - mid)));
    return table[3 - d];
  });
}

export default function KpiFocusRow({ items, gridClassName }: { items: FocusItem[]; gridClassName: string }) {
  const n = items.length;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [wide, setWide] = useState(false);
  const [reduce, setReduce] = useState(false);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const prevSlots = useRef<number[]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setWide(mq.matches);
      setReduce(rm.matches);
    };
    sync();
    mq.addEventListener("change", sync);
    rm.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      rm.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [wide]);

  useEffect(() => {
    if (!wide || reduce || paused || n < 2) return;
    const t = setInterval(() => setActive((a) => (a + 1) % n), STEP_MS);
    return () => clearInterval(t);
  }, [wide, reduce, paused, n]);

  if (!wide) {
    return (
      <div className={gridClassName}>
        {items.map((it) => (
          <div key={it.key}>{it.node}</div>
        ))}
      </div>
    );
  }

  const sizes = profile(n, SIZE);
  const fades = profile(n, FADE);
  const mid = Math.floor(n / 2);
  const unit = width > 0 ? (width - GAP * (n - 1)) / sizes.reduce((a, b) => a + b, 0) : 0;
  const xs: number[] = [];
  let x = 0;
  sizes.forEach((f) => {
    xs.push(x);
    x += f * unit + GAP;
  });

  const slotOf = (i: number) => (((i - active + mid) % n) + n) % n;
  const slots = items.map((_, i) => slotOf(i));
  const prev = prevSlots.current;
  prevSlots.current = slots;

  return (
    <div
      ref={wrapRef}
      className="relative mb-6"
      style={{ height: BASE_H }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {unit > 0 &&
        items.map((it, i) => {
          const s = slots[i];
          const f = sizes[s];
          const focus = s === mid;
          // A box wrapping from one end to the other jumps instead of flying across the row.
          const jumped = prev.length === n && Math.abs(s - prev[i]) > 1;
          return (
            <div
              key={it.key}
              onClick={() => setActive(i)}
              className="absolute left-0 top-0 cursor-pointer rounded-2xl"
              style={{
                width: unit,
                height: BASE_H,
                transformOrigin: "0 0",
                transform: `translate(${xs[s]}px, ${(BASE_H * (1 - f)) / 2}px) scale(${f})`,
                opacity: fades[s],
                zIndex: focus ? 2 : 1,
                boxShadow: focus ? `0 0 0 2px ${it.color}` : "none",
                transition: jumped
                  ? "opacity 700ms ease, box-shadow 400ms ease"
                  : "transform 800ms cubic-bezier(0.65, 0, 0.35, 1), opacity 800ms ease, box-shadow 400ms ease",
              }}
            >
              {it.node}
            </div>
          );
        })}
    </div>
  );
}
