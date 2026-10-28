"use client";

interface LiveFlowPanelProps {
  pending: number;
  transferred: number;
  delivered: number;
  cancelled: number;
  totalConsignments: number;
}

const pctOf = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

function FlowNode({ count, label, pct, tone }: { count: number; label: string; pct: number; tone: string }) {
  return (
    <div className="z-10 flex min-w-[64px] flex-col items-center gap-1.5 text-center md:min-w-[88px]">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-full border-2 font-display text-sm font-semibold tabular-nums md:h-16 md:w-16 md:text-lg border-${tone} bg-${tone}-bg text-${tone} shadow-[0_0_24px_-6px_currentColor]`}
      >
        {count.toLocaleString("en-US")}
      </div>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-soft md:text-[11px]">{label}</div>
      <div className="text-[11px] tabular-nums text-ink-soft/70">{pct}%</div>
    </div>
  );
}

function FlowLine({ tone, delay }: { tone: string; delay: string }) {
  return (
    <div className="relative mx-1 mb-10 h-0.5 flex-1 overflow-hidden rounded-full bg-line md:mx-2">
      <div
        className={`absolute -top-[2px] h-1.5 w-1.5 rounded-full bg-${tone}`}
        style={{ animation: "flow-move 2.2s linear infinite", animationDelay: delay }}
      />
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
        <FlowNode count={pending} label="Pending" pct={pctOf(pending, t)} tone="pending" />
        <FlowLine tone="pending" delay="0s" />
        <FlowNode count={transferred} label="Transfer" pct={pctOf(transferred, t)} tone="transferred" />
        <FlowLine tone="delivered" delay="0.7s" />
        <FlowNode count={delivered} label="Delivered" pct={pctOf(delivered, t)} tone="delivered" />
        <FlowLine tone="cancelled" delay="1.4s" />
        <FlowNode count={cancelled} label="Cancelled" pct={pctOf(cancelled, t)} tone="cancelled" />
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
