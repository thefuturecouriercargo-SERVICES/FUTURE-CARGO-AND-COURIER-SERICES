"use client";

import { useEffect, useRef, useState } from "react";

interface LiveFlowPanelProps {
  pending: number;
  transferred: number;
  delivered: number;
  cancelled: number;
  totalConsignments: number;
}

const pctOf = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

type Tone = "pending" | "transferred" | "delivered" | "cancelled";
/** One "something just happened" effect: which circle, and a key that restarts the animation. */
type Fx = { target: Tone; key: number } | null;

const ZAP_STEP = 0.45; // seconds per line segment
// Which lines light up (in order) on the way to each circle.
const PATH: Record<Tone, number[]> = { pending: [], transferred: [0], delivered: [0, 1], cancelled: [0, 1, 2] };

function FlowNode({ count, label, pct, tone, ripple }: { count: number; label: string; pct: number; tone: Tone; ripple?: { key: number; delay: number } }) {
  return (
    <div className="z-10 flex min-w-[64px] flex-col items-center gap-1.5 text-center md:min-w-[88px]">
      <div
        className={`relative flex h-12 w-12 items-center justify-center rounded-full border-2 font-display text-sm font-semibold tabular-nums md:h-16 md:w-16 md:text-lg border-${tone} bg-${tone}-bg text-${tone} shadow-[0_0_24px_-6px_currentColor]`}
      >
        {count.toLocaleString("en-US")}
        {ripple &&
          [0, 0.25].map((extra) => (
            <span
              key={`${ripple.key}-${extra}`}
              aria-hidden
              className="lf-fx pointer-events-none absolute -inset-[2px] rounded-full border-2 opacity-0"
              style={{
                borderColor: `rgb(var(--c-${tone}))`,
                animation: `lf-ripple 1.2s ease-out ${ripple.delay + extra}s 1 forwards`,
              }}
            />
          ))}
      </div>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-soft md:text-[11px]">{label}</div>
      <div className="text-[11px] tabular-nums text-ink-soft/70">{pct}%</div>
    </div>
  );
}

function FlowLine({ tone, delay, zap }: { tone: string; delay: string; zap?: { key: number; tone: Tone; delay: number } }) {
  return (
    <div className="relative mx-1 mb-10 h-0.5 flex-1 overflow-hidden rounded-full bg-line md:mx-2">
      <div
        className={`absolute -top-[2px] h-1.5 w-1.5 rounded-full bg-${tone}`}
        style={{ animation: "flow-move 2.2s linear infinite", animationDelay: delay }}
      />
      {zap && (
        <span
          key={zap.key}
          aria-hidden
          className="lf-fx absolute inset-y-0 w-[40%] rounded-full"
          style={{
            left: "-40%",
            background: `rgb(var(--c-${zap.tone}))`,
            boxShadow: `0 0 8px rgb(var(--c-${zap.tone}))`,
            animation: `lf-zap ${ZAP_STEP + 0.05}s linear ${zap.delay}s 1 both`,
          }}
        />
      )}
    </div>
  );
}

/** Ambient, always-running visuals for the Dashboard — a conveyor-belt style flow
 * showing consignments moving through Pending/Transfer to Delivered or Cancelled,
 * and a segmented progress bar for today's status mix. Purely decorative status
 * overview, not a strict causal process diagram. */
export default function LiveFlowPanel({ pending, transferred, delivered, cancelled, totalConsignments }: LiveFlowPanelProps) {
  const t = totalConsignments;
  const seg = (n: number) => (t > 0 ? `${(n / t) * 100}%` : "0%");

  // Spot what just changed (a delivery, transfer, cancel or new order) and play the effect once.
  // Big jumps (switching dates, first load) are ignored so only real live actions animate.
  const [fx, setFx] = useState<Fx>(null);
  const prev = useRef<{ pending: number; transferred: number; delivered: number; cancelled: number } | null>(null);
  useEffect(() => {
    const now = { pending, transferred, delivered, cancelled };
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    const small = (d: number) => d > 0 && d <= 10;
    const order: Tone[] = ["delivered", "cancelled", "transferred", "pending"];
    const target = order.find((k) => small(now[k] - before[k]));
    if (target) setFx({ target, key: Date.now() });
  }, [pending, transferred, delivered, cancelled]);

  const zapFor = (line: number) => {
    if (!fx) return undefined;
    const step = PATH[fx.target].indexOf(line);
    return step === -1 ? undefined : { key: fx.key, tone: fx.target, delay: step * ZAP_STEP };
  };
  const rippleFor = (tone: Tone) =>
    fx && fx.target === tone ? { key: fx.key, delay: PATH[tone].length * ZAP_STEP } : undefined;

  return (
    <div className="mb-5 rounded-2xl border border-line bg-white p-5 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-[18px] font-semibold text-navy">Live Flow</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-delivered-bg px-2.5 py-1 text-[11px] font-medium text-delivered">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-delivered" aria-hidden />
            Live
          </span>
        </div>
        <span className="text-[13px] text-ink-soft">
          <b className="font-semibold text-navy">{delivered.toLocaleString("en-US")}</b> of {t.toLocaleString("en-US")} delivered
        </span>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <FlowNode count={pending} label="Pending" pct={pctOf(pending, t)} tone="pending" ripple={rippleFor("pending")} />
        <FlowLine tone="pending" delay="0s" zap={zapFor(0)} />
        <FlowNode count={transferred} label="Transfer" pct={pctOf(transferred, t)} tone="transferred" ripple={rippleFor("transferred")} />
        <FlowLine tone="delivered" delay="0.7s" zap={zapFor(1)} />
        <FlowNode count={delivered} label="Delivered" pct={pctOf(delivered, t)} tone="delivered" ripple={rippleFor("delivered")} />
        <FlowLine tone="cancelled" delay="1.4s" zap={zapFor(2)} />
        <FlowNode count={cancelled} label="Cancelled" pct={pctOf(cancelled, t)} tone="cancelled" ripple={rippleFor("cancelled")} />
      </div>

      <div className="relative flex h-3 gap-[3px] overflow-hidden rounded-full bg-paper-2">
        <div className="h-full bg-[rgb(var(--c-delivered))] transition-[width] duration-700 ease-out" style={{ width: seg(delivered) }} />
        <div className="h-full bg-[rgb(var(--c-pending))] transition-[width] duration-700 ease-out" style={{ width: seg(pending) }} />
        <div className="h-full bg-[rgb(var(--c-transferred))] transition-[width] duration-700 ease-out" style={{ width: seg(transferred) }} />
        <div className="h-full bg-[rgb(var(--c-cancelled))] transition-[width] duration-700 ease-out" style={{ width: seg(cancelled) }} />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-white/10" style={{ animation: "shimmer-sweep 2.4s ease-in-out infinite" }} />
      </div>
    </div>
  );
}
