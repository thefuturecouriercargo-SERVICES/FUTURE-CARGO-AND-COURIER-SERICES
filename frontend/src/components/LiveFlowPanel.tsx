"use client";

interface LiveFlowPanelProps {
  pending: number;
  transferred: number;
  delivered: number;
  cancelled: number;
  totalConsignments: number;
}

function FlowNode({ count, label, color, bg, border }: { count: number; label: string; color: string; bg: string; border: string }) {
  return (
    <div className="z-10 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full border-2 text-[11px] font-semibold"
        style={{ backgroundColor: bg, borderColor: border, color }}
      >
        {count}
      </div>
      <div className="mt-1 font-mono text-[10px] text-ink-soft">{label}</div>
    </div>
  );
}

function FlowLine({ dotColor, delay }: { dotColor: string; delay: string }) {
  return (
    <div className="relative mx-2 h-0.5 flex-1 overflow-hidden bg-line">
      <div
        className="absolute -top-[2px] h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: dotColor, animation: "flow-move 2.2s linear infinite", animationDelay: delay }}
      />
    </div>
  );
}

/** Ambient, always-running visuals for the Dashboard — a conveyor-belt style flow
 * showing consignments moving through Pending/Transfer to Delivered or Cancelled,
 * and a shimmering progress bar for today's delivery rate. Purely decorative status
 * overview, not a strict causal process diagram. */
export default function LiveFlowPanel({ pending, transferred, delivered, cancelled, totalConsignments }: LiveFlowPanelProps) {
  const deliveredPct = totalConsignments > 0 ? Math.round((delivered / totalConsignments) * 100) : 0;

  return (
    <div className="mb-5 border border-line bg-white p-5">
      <h2 className="mb-4 border-b border-line pb-2.5 font-display text-[17px] font-semibold text-navy">Live Flow</h2>

      <div className="mb-6 flex items-center justify-between">
        <FlowNode count={pending} label="PENDING" color="#B9760C" bg="#FBEEDA" border="#B9760C" />
        <FlowLine dotColor="#B08A34" delay="0s" />
        <FlowNode count={transferred} label="TRANSFER" color="#2B5AA6" bg="#E4EBF7" border="#2B5AA6" />
        <FlowLine dotColor="#1E7145" delay="0.7s" />
        <FlowNode count={delivered} label="DELIVERED" color="#1E7145" bg="#E4F0E7" border="#1E7145" />
        <FlowLine dotColor="#AC3529" delay="1.4s" />
        <FlowNode count={cancelled} label="CANCELLED" color="#AC3529" bg="#F7E6E3" border="#AC3529" />
      </div>

      <div>
        <div className="mb-1.5 flex justify-between font-mono text-[11px] text-ink-soft">
          <span>{delivered.toLocaleString("en-US")} delivered</span>
          <span>{totalConsignments.toLocaleString("en-US")} total</span>
        </div>
        <div className="h-3.5 overflow-hidden bg-paper-2">
          <div className="relative h-full overflow-hidden bg-delivered transition-[width] duration-700 ease-out" style={{ width: `${deliveredPct}%` }}>
            <div className="absolute inset-y-0 left-0 w-2/5 bg-white/30" style={{ animation: "shimmer-sweep 2s ease-in-out infinite" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
