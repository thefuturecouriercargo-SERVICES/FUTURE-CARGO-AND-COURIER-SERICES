const ACCENTS: Record<string, string> = {
  gold: "bg-brass",
  violet: "bg-[#C9A0FF]",
  delivered: "bg-[rgb(var(--c-delivered))]",
  pending: "bg-[rgb(var(--c-pending))]",
  transferred: "bg-[rgb(var(--c-transferred))]",
  cancelled: "bg-[rgb(var(--c-cancelled))]",
  neutral: "bg-[rgb(var(--c-ink))]",
};

export default function KpiCard({
  label,
  value,
  unit,
  tone,
  accent,
  sub,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "positive" | "negative";
  accent?: keyof typeof ACCENTS;
  sub?: string;
}) {
  const display = typeof value === "number" ? value.toLocaleString("en-US") : value;
  return (
    <div className="h-full rounded-2xl border border-line bg-white p-4 transition hover:border-brass/40 md:p-5">
      <div className="mb-2.5 flex items-center gap-2">
        {accent && <span className={`h-2 w-2 rounded-[3px] ${ACCENTS[accent]}`} aria-hidden />}
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">{label}</span>
      </div>
      <div
        className={`font-display text-2xl font-semibold tabular-nums md:text-[28px] ${
          tone === "positive" ? "text-delivered" : tone === "negative" ? "text-cancelled" : "text-navy"
        }`}
      >
        {display}
        {unit && <span className="ml-1.5 text-sm font-normal text-ink-soft">{unit}</span>}
      </div>
      {sub && <div className="mt-2 text-xs text-ink-soft">{sub}</div>}
    </div>
  );
}
