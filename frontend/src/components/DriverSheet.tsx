"use client";

import { useState } from "react";
import { Order } from "@/types";
import { DEFAULT_AREA_ROUTE, detectArea } from "@/lib/areas";
import { fmtNumber } from "@/lib/format";

const URGENT_RE =
  /\b(urgent\w*|asap|emergency|immediate(ly)?|priority|important|vip|today\s*itself|same\s*day|must|tomorrow|tmrw|tmw|before\s*\d{1,2}\s*(am|pm|:)?|by\s*\d{1,2}\s*(am|pm))\b|ضروري|عاجل/i;

const areaOf = (o: Order) => o.area || detectArea(o.booking?.address, o.emirate);

/** Route order: office route list first, then the rest A–Z; inside an area by CN. */
function sortForRoute(list: Order[]) {
  const rank = (o: Order) => {
    const i = DEFAULT_AREA_ROUTE.indexOf(`${o.emirate}|${areaOf(o)}`);
    return i < 0 ? 10_000 : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || a.emirate.localeCompare(b.emirate) || areaOf(a).localeCompare(areaOf(b)) || a.cnNo - b.cnNo);
}

/**
 * Driver's daily sheet: one landscape A4/A3 page set per driver (all drivers when
 * no employee is chosen), area by area, with a ✓ box to tick each delivery.
 */
export default function DriverSheet({ orders, date, driverLabel }: { orders: Order[]; date: string; driverLabel?: string }) {
  const [size, setSize] = useState<"a4" | "a3">("a4");
  const [busy, setBusy] = useState(false);

  async function make(mode: "download" | "print") {
    if (!orders.length) return;
    setBusy(true);
    try {
      const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const autoTable = autoTableMod.default;
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: size });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const big = size === "a3";
      const nice = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

      // One sheet per driver.
      const byDriver = new Map<string, Order[]>();
      for (const o of orders) {
        const k = o.employee?.name ?? "—";
        byDriver.set(k, [...(byDriver.get(k) ?? []), o]);
      }
      let first = true;
      for (const [driver, list] of Array.from(byDriver.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        if (!first) doc.addPage();
        first = false;
        const rows = sortForRoute(list);
        const cod = rows.reduce((t, o) => t + (o.total || 0), 0);
        const startPage = doc.getNumberOfPages();

        doc.setFont("helvetica", "bold");
        doc.setFontSize(big ? 20 : 15);
        doc.text(`Driver sheet — ${driver.toUpperCase()}`, 10, 13);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(big ? 12 : 9.5);
        doc.text(`${nice}   ·   ${rows.length} parcels   ·   COD AED ${fmtNumber(cod)}`, 10, big ? 20 : 19);
        doc.text("The Future Courier Service L.L.C", W - 10, 13, { align: "right" });

        let lastArea = "";
        autoTable(doc, {
          startY: big ? 24 : 22,
          margin: { left: 8, right: 8, bottom: 16 },
          head: [["Tick", "#", "CN", "Vendor", "Customer", "Phone", "Area", "Address", "COD", "Note"]],
          body: rows.map((o, i) => {
            const area = areaOf(o);
            const showArea = area !== lastArea;
            lastArea = area;
            const b = o.booking;
            return [
              "",
              String(i + 1),
              String(o.cnNo),
              o.brandName ?? "",
              b?.customerName ?? "",
              b?.customerPhone ?? "",
              showArea ? area : "\"",
              b ? `${b.address}${b.emirate && !b.address.toLowerCase().includes(b.emirate.toLowerCase()) ? `, ${b.emirate}` : ""}` : o.emirate,
              o.total === 0 && b ? "PREPAID" : fmtNumber(o.total),
              [b?.notes, o.driverNote ? `Driver: ${o.driverNote}` : ""].filter(Boolean).join(" · "),
            ];
          }),
          foot: [["", "", "", "", "", "", "", `Total ${rows.length} parcels`, fmtNumber(cod), ""]],
          showFoot: "lastPage",
          theme: "grid",
          styles: { fontSize: big ? 10 : 8, cellPadding: big ? 2 : 1.4, overflow: "linebreak", valign: "middle", lineColor: 120, lineWidth: 0.2, textColor: 20 },
          headStyles: { fillColor: [20, 31, 51], textColor: 255, fontStyle: "bold" },
          footStyles: { fillColor: [236, 231, 216], textColor: 20, fontStyle: "bold" },
          // Widths as shares of the page so A4 and A3 both fill the width.
          columnStyles: (() => {
            const usable = W - 16;
            const share = [0.035, 0.03, 0.075, 0.08, 0.12, 0.095, 0.095, 0.27, 0.06, 0.14];
            const cs: Record<number, { cellWidth: number; halign?: "right" | "center"; fontStyle?: "bold" }> = {};
            share.forEach((p, k) => (cs[k] = { cellWidth: usable * p }));
            cs[1].halign = "center";
            cs[2].fontStyle = "bold";
            cs[8].halign = "right";
            cs[8].fontStyle = "bold";
            return cs;
          })(),
          didParseCell: (d) => {
            if (d.section !== "body") return;
            const o = rows[d.row.index];
            if (d.column.index === 9 && URGENT_RE.test(o.booking?.notes ?? "")) {
              d.cell.styles.fontStyle = "bold";
              d.cell.styles.textColor = [180, 20, 20];
            }
            if (d.column.index === 6 && d.cell.raw !== "\"") d.cell.styles.fontStyle = "bold";
          },
          didDrawCell: (d) => {
            // Empty tick box in the first column.
            if (d.section === "body" && d.column.index === 0) {
              const s = big ? 5 : 4;
              doc.setDrawColor(40);
              doc.setLineWidth(0.3);
              doc.rect(d.cell.x + (d.cell.width - s) / 2, d.cell.y + (d.cell.height - s) / 2, s, s);
            }
          },
        });

        // Footer on every page of this driver: signature lines + page number.
        const endPage = doc.getNumberOfPages();
        for (let p = startPage; p <= endPage; p++) {
          doc.setPage(p);
          doc.setFontSize(big ? 10 : 8);
          doc.setTextColor(60);
          doc.text(`Driver signature: ____________________     Cash handed over AED: ____________     Office: ____________`, 10, H - 7);
          doc.text(`${driver} · page ${p - startPage + 1}/${endPage - startPage + 1}`, W - 10, H - 7, { align: "right" });
          doc.setTextColor(0);
        }
      }

      const name = `driver-sheet-${date}${driverLabel ? `-${driverLabel.replace(/\s+/g, "_")}` : ""}-${size.toUpperCase()}.pdf`;
      if (mode === "download") doc.save(name);
      else {
        doc.autoPrint();
        const url = doc.output("bloburl");
        const w = window.open(url, "_blank");
        if (!w) doc.save(name); // pop-up blocked → just download
      }
    } catch (err) {
      alert(`Could not make the sheet: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-navy/30 bg-paper px-2 py-1">
      <span className="font-mono text-[10px] uppercase text-ink-soft">Driver sheet</span>
      <select value={size} onChange={(e) => setSize(e.target.value as "a4" | "a3")} className="rounded border border-line px-1.5 py-1 text-xs">
        <option value="a4">A4</option>
        <option value="a3">A3</option>
      </select>
      <button onClick={() => make("download")} disabled={busy || !orders.length} className="rounded border border-navy bg-white px-2.5 py-1 font-mono text-[11px] font-bold uppercase text-navy disabled:opacity-40">
        ⬇ PDF
      </button>
      <button onClick={() => make("print")} disabled={busy || !orders.length} className="rounded bg-navy px-2.5 py-1 font-mono text-[11px] font-bold uppercase text-paper disabled:opacity-40">
        🖨 Print
      </button>
    </div>
  );
}
