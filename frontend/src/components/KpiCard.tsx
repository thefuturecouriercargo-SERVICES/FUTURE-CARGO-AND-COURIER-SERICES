"use client";

import { useEffect, useRef, useState } from "react";

const ACCENTS: Record<string, string> = {
  gold: "rgb(var(--c-brass))",
  violet: "#C9A0FF",
  delivered: "rgb(var(--c-delivered))",
  pending: "rgb(var(--c-pending))",
  transferred: "rgb(var(--c-transferred))",
  cancelled: "rgb(var(--c-cancelled))",
  neutral: "rgb(var(--c-ink))",
};

/** Animates a number from its previous value to the new one (ease-out, ~0.8s). */
function useCountUp(target: number) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 800);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(begin + (target - begin) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target]);
  return shown;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${26 - ((v - min) / (max - min || 1)) * 22}`);
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-2 h-8 w-full" aria-hidden>
      <polygon points={`0,30 ${pts.join(" ")} 100,30`} fill={color} opacity={0.12} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function KpiCard({
  label,
  value,
  unit,
  tone,
  accent,
  sub,
  delta,
  upIsGood = true,
  spark,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "positive" | "negative";
  accent?: keyof typeof ACCENTS;
  sub?: string;
  /** Change vs yesterday; shown as a ▲/▼ chip. */
  delta?: number | null;
  upIsGood?: boolean;
  /** Last few days' values, oldest first, drawn as a small line. */
  spark?: number[];
}) {
  const numeric = typeof value === "number" ? value : null;
  const animated = useCountUp(numeric ?? 0);
  const display = numeric !== null ? Math.round(animated).toLocaleString("en-US") : value;
  const color = accent ? ACCENTS[accent] : ACCENTS.gold;

  let chip: JSX.Element | null = null;
  if (delta !== undefined && delta !== null) {
    const good = delta === 0 ? null : delta > 0 === upIsGood;
    chip = (
      <span
        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums ${
          good === null ? "bg-paper-2 text-ink-soft" : good ? "bg-delivered-bg text-delivered" : "bg-cancelled-bg text-cancelled"
        }`}
        title="Compared with the day before" aria-label={`${delta > 0 ? "Up" : delta < 0 ? "Down" : "No change"} ${Math.abs(Math.round(delta))} vs yesterday`}
      >
        {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(Math.round(delta)).toLocaleString("en-US")}
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-line bg-white p-4 transition hover:border-brass/40 md:p-5">
      <div className="mb-2.5 flex items-center gap-2">
        {accent && <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden />}
        <span className="text-[11px] font-medium uppercase leading-tight tracking-[0.12em] text-ink-soft">{label}</span>
      </div>
      <div
        className={`font-display text-2xl font-semibold tabular-nums xl:text-[26px] 2xl:text-[28px] ${
          tone === "positive" ? "text-delivered" : tone === "negative" ? "text-cancelled" : "text-navy"
        }`}
      >
        {display}
        {unit && <span className="ml-1.5 text-sm font-normal text-ink-soft">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-xs text-ink-soft">{sub}</div>}
      {chip && (
        <div className="mt-2 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-ink-soft">
          {chip}
          <span className="hidden 2xl:inline">vs yesterday</span>
        </div>
      )}
      {spark && <div className="mt-auto">{<Sparkline values={spark} color={color} />}</div>}
    </div>
  );
}
