"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";

type Tone = "good" | "warn" | "bad" | "info";
interface Insight {
  tone: Tone;
  title: string;
  text: string;
}
interface MonthRow {
  month: string;
  isCurrent: boolean;
  revenue: number;
  expenses: number;
  profit: number;
  draw: number;
  delivered: number;
  cancelled: number;
}
interface InsightsData {
  basedOn: string;
  kpis: {
    avgCharge: number;
    costPerDelivery: number;
    margin: number;
    cancelRate: number;
    perDriverDay: number;
    breakEvenPerDay: number;
    actualPerDay: number;
  };
  months: MonthRow[];
  projection: { revenue: number; expenses: number; profit: number; daysSoFar: number; daysFull: number };
  topVendors: { name: string; revenue: number; delivered: number; share: number }[];
  trends: Insight[];
  suggestions: Insight[];
  expenseIdeas: Insight[];
  expert: Insight[];
}

const monthName = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
};
const one = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");

const TONE: Record<Tone, { dot: string; label: string }> = {
  good: { dot: "bg-delivered", label: "Good" },
  warn: { dot: "bg-pending", label: "Watch" },
  bad: { dot: "bg-cancelled", label: "Action" },
  info: { dot: "bg-brass", label: "Note" },
};

const SECTIONS: { key: "trends" | "suggestions" | "expenseIdeas" | "expert"; title: string; hint: string }[] = [
  { key: "trends", title: "Trends", hint: "Where the numbers are heading" },
  { key: "suggestions", title: "Suggestions", hint: "What to act on" },
  { key: "expenseIdeas", title: "Expense control", hint: "Biggest costs and how to cut them" },
  { key: "expert", title: "Expert notes", hint: "How to think about courier profit" },
];

function InsightList({ items }: { items: Insight[] }) {
  if (items.length === 0) return <p className="text-sm text-ink-soft">Not enough data yet.</p>;
  return (
    <ul className="space-y-3">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE[it.tone].dot}`} title={TONE[it.tone].label} aria-label={TONE[it.tone].label} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-navy">{it.title}</div>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{it.text}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** P&L → Insights: trends, suggestions, expense-control ideas and expert notes. */
export default function PnlInsightsPanel() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<(typeof SECTIONS)[number]["key"]>("suggestions");

  useEffect(() => {
    apiFetch<InsightsData>("/pnl-insights")
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;

  const maxBar = data ? Math.max(1, ...data.months.map((m) => Math.max(m.revenue, m.expenses))) : 1;
  const k = data?.kpis;

  return (
    <div className="mb-6 border border-brass/50 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2.5">
        <h2 className="font-display text-[18px] font-semibold text-navy">Insights &amp; Suggestions</h2>
        <div className="flex items-baseline gap-3">
          {data && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">
              Based on {monthName(data.basedOn)} · last 6 months · not affected by the dates above
            </span>
          )}
          <button onClick={() => setOpen((o) => !o)} className="text-xs text-navy underline">
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {!data ? (
        <div className="space-y-2.5 py-2" role="status" aria-label="Loading">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      ) : (
        open && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Avg charge / delivery", value: `${one(k!.avgCharge)} AED` },
                { label: "Cost / delivery", value: `${one(k!.costPerDelivery)} AED`, bad: k!.costPerDelivery > k!.avgCharge },
                { label: "Net margin", value: `${one(k!.margin)}%`, bad: k!.margin < 5 },
                { label: "Return rate", value: `${one(k!.cancelRate)}%`, bad: k!.cancelRate >= 10 },
                { label: "Per driver / day", value: one(k!.perDriverDay) },
                {
                  label: "Break-even / day",
                  value: one(k!.breakEvenPerDay),
                  sub: `you did ${one(k!.actualPerDay)}`,
                  bad: k!.actualPerDay < k!.breakEvenPerDay,
                },
              ].map((t) => (
                <div key={t.label} className="bg-white p-3.5">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-ink-soft">{t.label}</div>
                  <div className={`font-display text-lg font-semibold ${t.bad ? "text-cancelled" : "text-navy"}`}>{t.value}</div>
                  {t.sub && <div className="text-[11px] text-ink-soft">{t.sub}</div>}
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-5">
              {/* Monthly trend */}
              <div className="border border-line p-4 lg:col-span-3">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-display text-[15px] font-semibold text-navy">Monthly trend</h3>
                  <div className="flex gap-3 text-[11px] text-ink-soft">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-3 bg-brass" /> Revenue
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-3 bg-cancelled/70" /> Expenses
                    </span>
                  </div>
                </div>
                <div className="space-y-2.5">
                  {data.months.map((m) => (
                    <div key={m.month} className="grid grid-cols-[52px_1fr_78px] items-center gap-2">
                      <div className="text-xs text-ink-soft">
                        {monthName(m.month)}
                        {m.isCurrent && <span className="block text-[9px]">so far</span>}
                      </div>
                      <div className="space-y-1">
                        <div className="h-2.5 bg-brass" style={{ width: `${(m.revenue / maxBar) * 100}%`, minWidth: m.revenue ? 2 : 0 }} title={`Revenue ${fmtNumber(m.revenue)} AED`} />
                        <div className="h-2.5 bg-cancelled/70" style={{ width: `${(m.expenses / maxBar) * 100}%`, minWidth: m.expenses ? 2 : 0 }} title={`Expenses ${fmtNumber(m.expenses)} AED`} />
                      </div>
                      <div className={`text-right font-mono text-xs ${m.profit >= 0 ? "text-delivered" : "text-cancelled"}`} title="Profit">
                        {m.profit >= 0 ? "+" : ""}
                        {fmtNumber(m.profit)}
                      </div>
                    </div>
                  ))}
                </div>
                {data.projection.daysSoFar >= 3 && (
                  <p className="mt-3 border-t border-line pt-2.5 text-xs text-ink-soft">
                    This month projected: <span className="font-mono text-navy">{fmtNumber(data.projection.revenue)}</span> revenue −{" "}
                    <span className="font-mono text-navy">{fmtNumber(data.projection.expenses)}</span> expenses ={" "}
                    <span className={`font-mono font-semibold ${data.projection.profit >= 0 ? "text-delivered" : "text-cancelled"}`}>{fmtNumber(data.projection.profit)} AED</span>{" "}
                    ({data.projection.daysSoFar} of {data.projection.daysFull} working days)
                  </p>
                )}
              </div>

              {/* Top vendors */}
              <div className="border border-line p-4 lg:col-span-2">
                <h3 className="mb-3 font-display text-[15px] font-semibold text-navy">Top vendors · last 90 days</h3>
                {data.topVendors.length === 0 ? (
                  <p className="text-sm text-ink-soft">No deliveries yet.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {data.topVendors.map((v) => (
                      <li key={v.name}>
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate text-navy">{v.name}</span>
                          <span className="shrink-0 font-mono text-xs text-ink-soft">
                            {fmtNumber(v.revenue)} AED · {one(v.share)}%
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 bg-line">
                          <div className={`h-1.5 ${v.share >= 40 ? "bg-pending" : "bg-brass"}`} style={{ width: `${Math.min(100, v.share)}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Insight sections */}
            <div className="mt-4 border border-line">
              <div className="flex overflow-x-auto border-b border-line">
                {SECTIONS.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setTab(s.key)}
                    className={`shrink-0 border-b-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide ${
                      tab === s.key ? "border-brass text-navy" : "border-transparent text-ink-soft hover:text-navy"
                    }`}
                  >
                    {s.title}
                    <span className="ml-1.5 rounded-full bg-paper-2 px-1.5 font-mono text-[10px]">{data[s.key].length}</span>
                  </button>
                ))}
              </div>
              <div className="p-4">
                <p className="mb-3 text-[11px] uppercase tracking-widest text-ink-soft">{SECTIONS.find((s) => s.key === tab)!.hint}</p>
                <InsightList items={data[tab]} />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-ink-soft">
              Worked out from your own orders and expenses (agent orders excluded, same as the P&amp;L). Dots: green good · amber watch · red act now · gold note.
            </p>
          </>
        )
      )}
    </div>
  );
}
