"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, todayStr } from "@/lib/format";
import { detectArea } from "@/lib/areas";
import { splitItems } from "@/components/ShippingLabel";
import { useSocketEvent } from "@/lib/useSocketEvent";

/** Every scan of a day (office Scan & Assign + drivers taking parcels), with filters, sorting and PDF. */

interface ScanRow {
  id: string;
  createdAt: string;
  byName: string;
  byRole: "OFFICE" | "DRIVER";
  driverName: string | null;
  code: string;
  result: "ACCEPTED" | "REASSIGNED" | "ALREADY" | "FAILED";
  message: string;
  cnNo: number | null;
  vendorName: string | null;
  total: number | null;
  emirate: string | null;
  address: string | null;
  fromDriver: string | null;
  orderStatus?: string | null;
  area?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  items?: string | null;
  notes?: string | null;
}

type SortKey = "time" | "driver" | "vendor" | "area" | "emirate" | "cn" | "by";

const RESULT_LABEL: Record<ScanRow["result"], string> = {
  ACCEPTED: "Assigned",
  REASSIGNED: "Moved",
  ALREADY: "Already",
  FAILED: "Failed",
};
const RESULT_CLASS: Record<ScanRow["result"], string> = {
  ACCEPTED: "text-delivered",
  REASSIGNED: "text-transferred",
  ALREADY: "text-ink-soft",
  FAILED: "text-cancelled",
};

function addDays(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Dubai" });
const areaOfRow = (r: ScanRow) => (r.cnNo ? r.area || detectArea(r.address, r.emirate) : "");
/** Items as plain lines for the PDF: "1 x Alf" — combo headings as "Combo name (AED 220):". */
function itemsText(items?: string | null) {
  return splitItems(items)
    .map((it) => (it.header ? `${it.name}${it.price ? ` (AED ${it.price})` : ""}:` : `${it.qty} x ${it.name}${it.price ? ` (AED ${it.price})` : ""}`))
    .join("\n");
}
const uniq = (list: (string | null | undefined)[]) => Array.from(new Set(list.filter(Boolean) as string[])).sort();

export default function ScanHistory() {
  const [day, setDay] = useState(todayStr());
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [by, setBy] = useState<"" | "OFFICE" | "DRIVER">("");
  const [driver, setDriver] = useState("");
  const [result, setResult] = useState<"" | ScanRow["result"] | "OK">("OK");
  const [vendor, setVendor] = useState("");
  const [emirate, setEmirate] = useState("");
  const [area, setArea] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("time");
  const [making, setMaking] = useState(false);
  const [everyScan, setEveryScan] = useState(false); // false = one row per CN (its latest scan)

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch<{ scans: ScanRow[] }>("/bookings/scan-log", { query: { day } });
      setRows(r.scans);
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => {
    load();
  }, [load]);
  useSocketEvent("order:changed", () => {
    if (day === todayStr()) load();
  });

  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    // A parcel scanned twice (e.g. driver took it, office moved it, or scanned again)
    // counts once: keep only its latest successful scan unless "every scan" is on.
    let base = rows;
    if (!everyScan) {
      const latest = new Map<string, ScanRow>();
      const failed: ScanRow[] = [];
      for (const r of rows) {
        if (r.result === "FAILED" || r.cnNo == null) {
          failed.push(r);
          continue;
        }
        const k = String(r.cnNo);
        const prev = latest.get(k);
        // "Already" never replaces a real assignment.
        if (!prev || r.result !== "ALREADY" || prev.result === "ALREADY") latest.set(k, r);
      }
      base = [...latest.values(), ...failed];
    }
    const list = base.filter((r) => {
      if (by && r.byRole !== by) return false;
      if (driver && r.driverName !== driver) return false;
      if (result === "OK" ? r.result !== "ACCEPTED" && r.result !== "REASSIGNED" : result && r.result !== result) return false;
      if (vendor && r.vendorName !== vendor) return false;
      if (emirate && r.emirate !== emirate) return false;
      if (area && areaOfRow(r) !== area) return false;
      if (qq && !`${r.cnNo ?? ""} ${r.code} ${r.message}`.toLowerCase().includes(qq)) return false;
      return true;
    });
    const key = (r: ScanRow): string | number => {
      switch (sort) {
        case "driver":
          return `${r.driverName ?? ""}|${r.createdAt}`;
        case "vendor":
          return `${r.vendorName ?? "~"}|${r.createdAt}`;
        case "area":
          return `${r.emirate ?? "~"}|${areaOfRow(r) || "~"}|${r.createdAt}`;
        case "emirate":
          return `${r.emirate ?? "~"}|${r.createdAt}`;
        case "cn":
          return r.cnNo ?? Number.MAX_SAFE_INTEGER;
        case "by":
          return `${r.byRole}|${r.byName}|${r.createdAt}`;
        default:
          return r.createdAt;
      }
    };
    return [...list].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
    });
  }, [rows, by, driver, result, vendor, emirate, area, q, sort, everyScan]);

  const ok = shown.filter((r) => r.result === "ACCEPTED" || r.result === "REASSIGNED");
  const cod = ok.reduce((s, r) => s + (r.total ?? 0), 0);
  const perDriver = useMemo(() => {
    const m = new Map<string, { name: string; count: number; cod: number; office: number; self: number }>();
    for (const r of shown) {
      if (r.result !== "ACCEPTED" && r.result !== "REASSIGNED") continue;
      const k = r.driverName ?? "?";
      const v = m.get(k) ?? { name: k, count: 0, cod: 0, office: 0, self: 0 };
      v.count++;
      v.cod += r.total ?? 0;
      if (r.byRole === "OFFICE") v.office++;
      else v.self++;
      m.set(k, v);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [shown]);

  const filterText = [
    by && `Scanned by: ${by === "OFFICE" ? "Office" : "Driver"}`,
    driver && `Driver: ${driver}`,
    result && `Result: ${result === "OK" ? "Assigned + moved" : RESULT_LABEL[result]}`,
    vendor && `Vendor: ${vendor}`,
    emirate && `Emirate: ${emirate}`,
    area && `Area: ${area}`,
    q && `Search: ${q}`,
  ]
    .filter(Boolean)
    .join(" · ");

  async function downloadPdf() {
    setMaking(true);
    try {
      const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const autoTable = autoTableMod.default;
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const nice = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
      doc.setFontSize(15);
      doc.text(`Future Courier — Scan report · ${nice}`, 12, 14);
      doc.setFontSize(9);
      doc.text(`${shown.length} scans · ${ok.length} assigned/moved · COD AED ${fmtNumber(cod)}${filterText ? ` · ${filterText}` : ""}`, 12, 20);
      doc.text(`Sorted by: ${sort} · ${everyScan ? "every scan" : "one row per CN (latest scan)"}`, 12, 25);

      autoTable(doc, {
        startY: 29,
        head: [["Driver", "Parcels", "COD (AED)", "By office", "By driver"]],
        body: perDriver.map((d) => [d.name, d.count, fmtNumber(d.cod), d.office, d.self]),
        // With one driver the total row would just repeat his row — only show it for 2+ drivers.
        foot: perDriver.length > 1 ? [["Total", ok.length, fmtNumber(cod), perDriver.reduce((s, d) => s + d.office, 0), perDriver.reduce((s, d) => s + d.self, 0)]] : undefined,
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [20, 31, 51] },
        footStyles: { fillColor: [236, 231, 216], textColor: 20 },
        tableWidth: 140,
      });

      autoTable(doc, {
        startY: ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 40) + 6,
        head: [["#", "Time", "CN", "Vendor", "Customer", "Phone", "Address / Area", "Items", "COD", "Driver", "Scanned by", "Result / Note"]],
        body: shown.map((r, i) => [
          i + 1,
          timeOf(r.createdAt),
          r.cnNo ?? r.code,
          r.vendorName ?? "",
          r.customerName ?? "",
          r.customerPhone ?? "",
          [r.address, [areaOfRow(r), r.emirate].filter(Boolean).join(" · ")].filter(Boolean).join("\n"),
          [itemsText(r.items), r.notes ? `Note: ${r.notes}` : ""].filter(Boolean).join("\n"),
          r.total != null ? fmtNumber(r.total) : "",
          r.driverName ?? "",
          `${r.byName} (${r.byRole === "OFFICE" ? "office" : "driver"})`,
          [RESULT_LABEL[r.result], r.result === "REASSIGNED" && r.fromDriver ? `from ${r.fromDriver}` : r.result === "FAILED" ? r.message : "", r.orderStatus ? `Now: ${r.orderStatus}` : ""]
            .filter(Boolean)
            .join("\n"),
        ]),
        styles: { fontSize: 7, cellPadding: 1.2, overflow: "linebreak", valign: "top" },
        headStyles: { fillColor: [20, 31, 51] },
        columnStyles: {
          0: { cellWidth: 7 },
          1: { cellWidth: 14 },
          2: { cellWidth: 17 },
          3: { cellWidth: 17 },
          4: { cellWidth: 26 },
          5: { cellWidth: 22 },
          6: { cellWidth: 52 },
          7: { cellWidth: 46 },
          8: { halign: "right", cellWidth: 12 },
          9: { cellWidth: 17 },
          10: { cellWidth: 22 },
          11: { cellWidth: 21 },
        },
        margin: { left: 8, right: 8 },
        didDrawPage: () => {
          const page = doc.getNumberOfPages();
          doc.setFontSize(7);
          doc.text(`Page ${page}`, 285, 205, { align: "right" });
        },
      });
      doc.save(`scan-report-${day}${driver ? `-${driver.replace(/\s+/g, "_")}` : ""}.pdf`);
    } catch (err) {
      alert(`Could not make the PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMaking(false);
    }
  }

  const sel = "rounded border border-line px-2 py-1.5 text-sm";

  return (
    <div className="mt-8 border border-line bg-white p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold text-navy">Scan history</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setDay(addDays(day, -1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
            ◀
          </button>
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="rounded border border-line px-2.5 py-2 text-sm" />
          <button onClick={() => setDay(addDays(day, 1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
            ▶
          </button>
          {day !== todayStr() && (
            <button onClick={() => setDay(todayStr())} className="rounded bg-navy px-3 py-2 font-mono text-xs uppercase text-paper">
              Today
            </button>
          )}
          <button
            onClick={downloadPdf}
            disabled={making || shown.length === 0}
            className="rounded border border-navy bg-white px-3 py-2 font-mono text-xs font-bold uppercase text-navy hover:bg-paper-2 disabled:opacity-50"
          >
            {making ? "Making PDF…" : `⬇ PDF (${shown.length})`}
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={by} onChange={(e) => setBy(e.target.value as typeof by)} className={sel}>
          <option value="">Scanned by: all</option>
          <option value="OFFICE">Scanned by office</option>
          <option value="DRIVER">Scanned by driver</option>
        </select>
        <select value={driver} onChange={(e) => setDriver(e.target.value)} className={sel}>
          <option value="">All drivers</option>
          {uniq(rows.map((r) => r.driverName)).map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select value={result} onChange={(e) => setResult(e.target.value as typeof result)} className={sel}>
          <option value="OK">Assigned + moved</option>
          <option value="">All results</option>
          <option value="ACCEPTED">Assigned only</option>
          <option value="REASSIGNED">Moved between drivers</option>
          <option value="ALREADY">Already with driver</option>
          <option value="FAILED">Failed scans</option>
        </select>
        <select value={vendor} onChange={(e) => setVendor(e.target.value)} className={sel}>
          <option value="">All vendors</option>
          {uniq(rows.map((r) => r.vendorName)).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select value={emirate} onChange={(e) => setEmirate(e.target.value)} className={sel}>
          <option value="">All emirates</option>
          {uniq(rows.map((r) => r.emirate)).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select value={area} onChange={(e) => setArea(e.target.value)} className={sel}>
          <option value="">All areas</option>
          {uniq(rows.map(areaOfRow)).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={sel}>
          <option value="time">Sort: time</option>
          <option value="driver">Sort: driver</option>
          <option value="vendor">Sort: vendor</option>
          <option value="area">Sort: area</option>
          <option value="emirate">Sort: emirate</option>
          <option value="cn">Sort: CN</option>
          <option value="by">Sort: scanned by</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search CN…" className={`${sel} w-32`} />
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          <input type="checkbox" checked={everyScan} onChange={(e) => setEveryScan(e.target.checked)} />
          Show every scan (repeats too)
        </label>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
        {[
          { l: "Scans shown", v: shown.length },
          { l: "Assigned + moved", v: ok.length },
          { l: "Failed", v: shown.filter((r) => r.result === "FAILED").length },
          { l: "COD (AED)", v: fmtNumber(cod) },
        ].map((k) => (
          <div key={k.l} className="bg-white p-3">
            <div className="font-mono text-[10px] uppercase text-ink-soft">{k.l}</div>
            <div className="font-display text-2xl font-semibold text-navy">{k.v}</div>
          </div>
        ))}
      </div>

      {perDriver.length > 0 && (
        <div className="table-scroll mb-4">
          <table className="data-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th className="text-right">Parcels</th>
                <th className="text-right">COD</th>
                <th className="text-right">By office</th>
                <th className="text-right">By driver</th>
              </tr>
            </thead>
            <tbody>
              {perDriver.map((d) => (
                <tr key={d.name} onClick={() => setDriver(driver === d.name ? "" : d.name)} className={`cursor-pointer ${driver === d.name ? "bg-paper-2 font-bold" : "hover:bg-paper"}`}>
                  <td>{d.name}</td>
                  <td className="text-right font-mono">{d.count}</td>
                  <td className="text-right font-mono">{fmtNumber(d.cod)}</td>
                  <td className="text-right font-mono">{d.office}</td>
                  <td className="text-right font-mono">{d.self}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="text-right">#</th>
              <th>Time</th>
              <th>CN</th>
              <th>Vendor</th>
              <th>Customer</th>
              <th>Area</th>
              <th className="text-right">COD</th>
              <th>Driver</th>
              <th>Scanned by</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-ink-soft">
                  {loading ? "Loading…" : "No scans for this day / filter."}
                </td>
              </tr>
            ) : (
              shown.map((r, i) => (
                <tr key={r.id}>
                  <td className="text-right font-mono text-xs text-ink-soft">{i + 1}</td>
                  <td className="whitespace-nowrap font-mono text-xs">{timeOf(r.createdAt)}</td>
                  <td className="font-mono font-bold">{r.cnNo ?? r.code}</td>
                  <td>{r.vendorName ?? "—"}</td>
                  <td className="text-xs">
                    {r.customerName ?? "—"}
                    {r.customerPhone && <div className="font-mono text-ink-soft">{r.customerPhone}</div>}
                  </td>
                  <td className="text-xs">
                    {areaOfRow(r)}
                    {r.emirate ? <span className="text-ink-soft"> · {r.emirate}</span> : null}
                  </td>
                  <td className="text-right font-mono">{r.total != null ? fmtNumber(r.total) : "—"}</td>
                  <td>{r.driverName ?? "—"}</td>
                  <td className="text-xs">
                    {r.byName}
                    <div className="font-mono text-[9px] uppercase text-ink-soft">{r.byRole === "OFFICE" ? "office" : "driver"}</div>
                  </td>
                  <td className={`text-xs font-bold ${RESULT_CLASS[r.result]}`}>
                    {RESULT_LABEL[r.result]}
                    {r.result === "REASSIGNED" && r.fromDriver && <div className="font-normal text-ink-soft">from {r.fromDriver}</div>}
                    {r.result === "FAILED" && <div className="max-w-[260px] font-normal">{r.message}</div>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-soft">Scans are recorded from today onwards. Click a driver in the table above to filter.</p>
    </div>
  );
}
