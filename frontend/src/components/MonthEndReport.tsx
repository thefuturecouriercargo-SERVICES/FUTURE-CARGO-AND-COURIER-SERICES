"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { detectArea } from "@/lib/areas";
import { toast } from "@/components/ui/Feedback";

interface Stats {
  orders: number;
  delivered: number;
  cancelled: number;
  pending: number;
  rtoPct: number;
  sales: number;
  dlCharge: number;
}
interface Summary extends Stats {
  agentOrders: number;
  agentDelivered: number;
  expenses: number;
  profit: number;
}
interface MonthEnd {
  month: string;
  prevMonth: string;
  current: Summary;
  previous: Summary;
  vendors: ({ name: string } & Stats)[];
  drivers: ({ name: string } & Stats)[];
  emirates: ({ name: string } & Stats)[];
  areaRows: [string, string, string, string][];
}
type AreaStat = { name: string; orders: number; delivered: number; cancelled: number; rtoPct: number };

function monthName(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "+12%" vs last month; for RTO the change is in points and "up" is bad. */
function Change({ now, before, points, invert }: { now: number; before: number; points?: boolean; invert?: boolean }) {
  if (points) {
    const d = Math.round((now - before) * 10) / 10;
    if (!before && !now) return null;
    const good = invert ? d < 0 : d > 0;
    return <span className={`text-xs ${d === 0 ? "text-ink-soft" : good ? "text-delivered" : "text-cancelled"}`}>{d > 0 ? "▲" : d < 0 ? "▼" : "•"} {Math.abs(d)} pts</span>;
  }
  if (!before) return <span className="text-xs text-ink-soft">new</span>;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  const good = invert ? pct < 0 : pct > 0;
  return <span className={`text-xs ${pct === 0 ? "text-ink-soft" : good ? "text-delivered" : "text-cancelled"}`}>{pct > 0 ? "▲" : pct < 0 ? "▼" : "•"} {Math.abs(pct)}%</span>;
}

function areaStats(rows: MonthEnd["areaRows"]): AreaStat[] {
  const m = new Map<string, AreaStat>();
  for (const [chosen, address, emirate, st] of rows) {
    const name = chosen || detectArea(address, emirate);
    const a = m.get(name) ?? { name, orders: 0, delivered: 0, cancelled: 0, rtoPct: 0 };
    a.orders++;
    if (st === "D") a.delivered++;
    if (st === "C") a.cancelled++;
    m.set(name, a);
  }
  for (const a of m.values()) {
    const f = a.delivered + a.cancelled;
    a.rtoPct = f ? Math.round((a.cancelled / f) * 1000) / 10 : 0;
  }
  return [...m.values()].filter((a) => a.name !== "NO ADDRESS" && a.name !== "OTHER AREA").sort((a, b) => b.orders - a.orders);
}

export default function MonthEndReport({ month }: { month: string }) {
  const [data, setData] = useState<MonthEnd | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setData(null);
    setErr("");
    apiFetch<MonthEnd>("/month-end", { query: { month } })
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load"));
  }, [month]);

  const areas = useMemo(() => (data ? areaStats(data.areaRows) : []), [data]);
  // Areas with enough parcels to judge, worst RTO first.
  const hotspots = useMemo(() => areas.filter((a) => a.delivered + a.cancelled >= 10 && a.rtoPct > 0).sort((a, b) => b.rtoPct - a.rtoPct).slice(0, 5), [areas]);

  async function downloadPdf() {
    if (!data) return;
    try {
      const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const autoTable = autoTableMod.default;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const c = data.current;
      const p = data.previous;
      const navy: [number, number, number] = [10, 16, 32];
      const gold: [number, number, number] = [212, 175, 90];

      doc.setFillColor(...navy);
      doc.rect(0, 0, 210, 30, "F");
      doc.setTextColor(...gold);
      doc.setFontSize(9);
      doc.text("THE FUTURE COURIER SERVICE L.L.C", 14, 11);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.text(`Month-end report · ${monthName(data.month)}`, 14, 21);
      doc.setFontSize(8);
      doc.text(`Compared with ${monthName(data.prevMonth)} · generated ${new Date().toLocaleString("en-GB")}`, 14, 26.5);
      doc.setTextColor(20, 20, 20);

      const pct = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / Math.abs(b)) * 100)}%` : "new");
      autoTable(doc, {
        startY: 36,
        head: [["Figure", monthName(data.month), monthName(data.prevMonth), "Change"]],
        body: [
          ["Parcels", fmtNumber(c.orders), fmtNumber(p.orders), pct(c.orders, p.orders)],
          ["Delivered", fmtNumber(c.delivered), fmtNumber(p.delivered), pct(c.delivered, p.delivered)],
          ["Cancelled (RTO)", fmtNumber(c.cancelled), fmtNumber(p.cancelled), pct(c.cancelled, p.cancelled)],
          ["RTO %", `${c.rtoPct}%`, `${p.rtoPct}%`, `${Math.round((c.rtoPct - p.rtoPct) * 10) / 10} pts`],
          ["Still pending", fmtNumber(c.pending), fmtNumber(p.pending), ""],
          ["COD sales (AED)", fmtNumber(c.sales), fmtNumber(p.sales), pct(c.sales, p.sales)],
          ["Delivery charges (AED)", fmtNumber(c.dlCharge), fmtNumber(p.dlCharge), pct(c.dlCharge, p.dlCharge)],
          ["Expenses (AED)", fmtNumber(c.expenses), fmtNumber(p.expenses), pct(c.expenses, p.expenses)],
          ["Profit (AED)", fmtNumber(c.profit), fmtNumber(p.profit), pct(c.profit, p.profit)],
          ["Sent with agent", fmtNumber(c.agentOrders), fmtNumber(p.agentOrders), ""],
        ],
        headStyles: { fillColor: navy, textColor: gold },
        styles: { fontSize: 9 },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
      });

      const section = (title: string, head: string[], body: (string | number)[][]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const y = ((doc as any).lastAutoTable?.finalY ?? 40) + 9;
        doc.setFontSize(11);
        doc.setTextColor(...navy);
        doc.text(title, 14, y);
        autoTable(doc, {
          startY: y + 2,
          head: [head],
          body,
          headStyles: { fillColor: navy, textColor: gold },
          styles: { fontSize: 8.5 },
          columnStyles: Object.fromEntries(head.map((_, i) => [i, { halign: i === 0 ? "left" : "right" }])),
        });
      };
      section(
        "Vendors",
        ["Vendor", "Parcels", "Delivered", "RTO", "RTO %", "DL charge"],
        data.vendors.map((v) => [v.name, fmtNumber(v.orders), fmtNumber(v.delivered), fmtNumber(v.cancelled), `${v.rtoPct}%`, fmtNumber(v.dlCharge)])
      );
      section(
        "Drivers",
        ["Driver", "Parcels", "Delivered", "RTO", "Success %"],
        data.drivers.map((d) => [d.name, fmtNumber(d.orders), fmtNumber(d.delivered), fmtNumber(d.cancelled), `${Math.round((100 - d.rtoPct) * 10) / 10}%`])
      );
      section(
        "Top areas",
        ["Area", "Parcels", "Delivered", "RTO", "RTO %"],
        areas.slice(0, 15).map((a) => [a.name, fmtNumber(a.orders), fmtNumber(a.delivered), fmtNumber(a.cancelled), `${a.rtoPct}%`])
      );
      if (hotspots.length)
        section(
          "RTO hotspots (10+ finished parcels)",
          ["Area", "Finished", "RTO", "RTO %"],
          hotspots.map((a) => [a.name, fmtNumber(a.delivered + a.cancelled), fmtNumber(a.cancelled), `${a.rtoPct}%`])
        );

      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor(120, 120, 120);
        doc.text(`Future Courier · Month-end ${data.month} · page ${i}/${pages}`, 196, 290, { align: "right" });
      }
      doc.save(`month-end-report-${data.month}.pdf`);
    } catch (e) {
      toast("Could not make the PDF", "error", e instanceof Error ? e.message : undefined);
    }
  }

  const box = "border border-line bg-white p-5";
  const h2 = "mb-3 border-b border-line pb-2.5 font-display text-[18px] font-semibold text-navy";

  if (err) return <div className={`${box} mb-5 text-sm text-cancelled`}>Month-end report: {err}</div>;
  if (!data) return <div className={`${box} mb-5 h-40 animate-pulse`} />;

  const c = data.current;
  const p = data.previous;
  const cards: { label: string; value: string; change: JSX.Element | null; tone?: string }[] = [
    { label: "Parcels", value: fmtNumber(c.orders), change: <Change now={c.orders} before={p.orders} /> },
    { label: "Delivered", value: fmtNumber(c.delivered), change: <Change now={c.delivered} before={p.delivered} /> },
    { label: "RTO %", value: `${c.rtoPct}%`, change: <Change now={c.rtoPct} before={p.rtoPct} points invert />, tone: c.rtoPct >= 15 ? "text-cancelled" : undefined },
    { label: "Delivery charges", value: fmtNumber(c.dlCharge), change: <Change now={c.dlCharge} before={p.dlCharge} /> },
    { label: "Expenses", value: fmtNumber(c.expenses), change: <Change now={c.expenses} before={p.expenses} invert /> },
    { label: "Profit", value: fmtNumber(c.profit), change: <Change now={c.profit} before={p.profit} />, tone: c.profit < 0 ? "text-cancelled" : "text-delivered" },
  ];
  const maxVendor = Math.max(1, ...data.vendors.map((v) => v.orders));

  return (
    <div className={`${box} mb-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h2 className="font-display text-[18px] font-semibold text-navy">Month-end report — {monthName(data.month)}</h2>
          <p className="text-xs text-ink-soft">Compared with {monthName(data.prevMonth)} · agent parcels kept out of company figures</p>
        </div>
        <button onClick={downloadPdf} className="rounded bg-brass px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wide text-[#0A1020] hover:opacity-90">
          ⬇ Month-end PDF
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((k) => (
          <div key={k.label} className="rounded-lg bg-paper-2 p-3">
            <p className="text-[11px] uppercase tracking-wider text-ink-soft">{k.label}</p>
            <p className={`font-display text-[20px] font-semibold ${k.tone ?? "text-navy"}`}>{k.value}</p>
            {k.change}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className={h2}>Vendors</h3>
          <div className="space-y-2">
            {data.vendors.slice(0, 10).map((v) => (
              <div key={v.name}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{v.name}</span>
                  <span className="font-mono text-xs">
                    {fmtNumber(v.orders)} parcels · <span className={v.rtoPct >= 20 ? "text-cancelled" : v.rtoPct >= 10 ? "text-pending" : "text-delivered"}>RTO {v.rtoPct}%</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-paper-2">
                  <div className="h-1.5 rounded bg-brass" style={{ width: `${(v.orders / maxVendor) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className={h2}>Drivers</h3>
          <div className="table-wrap">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th className="text-right">Delivered</th>
                  <th className="text-right">RTO</th>
                  <th className="text-right">Success</th>
                </tr>
              </thead>
              <tbody>
                {data.drivers.map((d) => (
                  <tr key={d.name}>
                    <td>{d.name}</td>
                    <td className="text-right font-mono">{fmtNumber(d.delivered)}</td>
                    <td className="text-right font-mono">{fmtNumber(d.cancelled)}</td>
                    <td className="text-right font-mono">{d.delivered + d.cancelled ? `${Math.round((100 - d.rtoPct) * 10) / 10}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className={h2}>Top areas</h3>
          <div className="table-wrap">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  <th>Area</th>
                  <th className="text-right">Parcels</th>
                  <th className="text-right">RTO %</th>
                </tr>
              </thead>
              <tbody>
                {areas.slice(0, 10).map((a) => (
                  <tr key={a.name}>
                    <td>{a.name}</td>
                    <td className="text-right font-mono">{fmtNumber(a.orders)}</td>
                    <td className={`text-right font-mono ${a.rtoPct >= 20 ? "text-cancelled" : ""}`}>{a.rtoPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className={h2}>RTO hotspots</h3>
          {hotspots.length === 0 ? (
            <p className="text-sm text-ink-soft">No area has 10+ finished parcels with returns this month.</p>
          ) : (
            <div className="space-y-2">
              {hotspots.map((a) => (
                <div key={a.name} className="flex items-center justify-between rounded-lg bg-cancelled-bg px-3 py-2 text-sm">
                  <span className="font-medium">{a.name}</span>
                  <span className="font-mono text-xs text-cancelled">
                    {a.cancelled} of {a.delivered + a.cancelled} returned · {a.rtoPct}%
                  </span>
                </div>
              ))}
            </div>
          )}
          <h3 className={`${h2} mt-5`}>By emirate</h3>
          <div className="flex flex-wrap gap-2">
            {data.emirates.map((e) => (
              <span key={e.name} className="rounded-full border border-line px-3 py-1 text-xs">
                {e.name.replace(/_/g, " ")} · <b>{fmtNumber(e.orders)}</b> · RTO {e.rtoPct}%
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
