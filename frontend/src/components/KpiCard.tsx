export default function KpiCard({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="border border-line bg-white p-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-soft">{label}</div>
      <div
        className={`font-display text-2xl font-semibold ${
          tone === "positive" ? "text-delivered" : tone === "negative" ? "text-cancelled" : "text-navy"
        }`}
      >
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-ink-soft">{unit}</span>}
      </div>
    </div>
  );
}
