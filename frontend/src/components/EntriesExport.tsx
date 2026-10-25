"use client";

import { useState } from "react";
import { fmtNumber } from "@/lib/format";

export interface EntryRow {
  /** Agent or vendor the entry belongs to (one PDF page / filter per group). */
  groupId: string;
  groupName: string;
  type: "SCANNED" | "MANUAL" | "TRANSFERRED";
  at: string;
  from?: string;
  scan?: { by: string; role: "office" | "driver"; at: string };
  driver?: string;
  deliveryCharge?: number;
  cnNo: number;
  vendor: string;
  customerName: string;
  customerPhone: string;
  address: string;
  emirate: string;
  items: string;
  total: number;
  status: string;
}

const SECTIONS: { type: EntryRow["type"]; title: string }[] = [
  { type: "SCANNED", title: "Scanned" },
  { type: "MANUAL", title: "Manual entry" },
  { type: "TRANSFERRED", title: "Transferred" },
];
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
const plain = (s: string) => s.replace(/▸\s*/g, "").replace(/×/g, "x");

/** What happened: who scanned it and when, typed in by hand, or transferred from whom. */
const detail = (e: EntryRow) =>
  e.type === "SCANNED" && e.scan
    ? `Scanned by ${e.scan.by} (${e.scan.role}) ${time(e.scan.at)}`
    : e.type === "TRANSFERRED"
      ? `Transferred from ${e.from || "another driver"} ${time(e.at)}`
      : `Typed in ${time(e.at)}`;

/**
 * PDF / Excel of one day's entries, split into Scanned, Manual entry and Transferred,
 * one page per agent / vendor (or just the one chosen).
 */
export default function EntriesExport({
  entries,
  date,
  groupLabel,
  fileLabel,
}: {
  entries: EntryRow[];
  date: string;
  groupLabel: "Agent" | "Vendor";
  fileLabel: string;
}) {
  const agents = Array.from(new Map(entries.map((e) => [e.groupId, e.groupName])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const list = agentId ? entries.filter((e) => e.groupId === agentId) : entries;
  const label = agentId ? agents.find((a) => a[0] === agentId)?.[1] ?? "" : `all-${groupLabel.toLowerCase()}s`;
  const isVendor = groupLabel === "Vendor";

  const head = ["#", "CN", isVendor ? "Driver" : "Vendor", "Customer", "Phone", "Address", "Items", "Amount", ...(isVendor ? ["DL"] : []), "Scan details"];
  const row = (e: EntryRow, i: number) => [
    String(i + 1),
    String(e.cnNo),
    isVendor ? e.driver ?? "" : e.vendor,
    e.customerName,
    e.customerPhone,
    [e.address, e.emirate].filter(Boolean).join(", "),
    plain(e.items),
    fmtNumber(e.total),
    ...(isVendor ? [fmtNumber(e.deliveryCharge ?? 0)] : []),
    detail(e),
  ];

  async function pdf() {
    setBusy(true);
    try {
      const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const autoTable = autoTableMod.default;
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      let first = true;
      for (const [id, name] of agents.filter((a) => !agentId || a[0] === agentId)) {
        if (!first) doc.addPage();
        first = false;
        const mine = list.filter((e) => e.groupId === id);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.text(`${fileLabel} — ${name.toUpperCase()}`, 10, 13);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        const c = (t: EntryRow["type"]) => mine.filter((e) => e.type === t).length;
        doc.text(
          `${date}   ·   ${mine.length} entries   ·   AED ${fmtNumber(mine.reduce((s, e) => s + e.total, 0))}   ·   Scanned ${c("SCANNED")} · Manual ${c("MANUAL")} · Transferred ${c("TRANSFERRED")}`,
          10,
          19
        );
        doc.text("The Future Courier Service L.L.C", W - 10, 13, { align: "right" });
        let y = 24;
        for (const sec of SECTIONS) {
          const rows = mine.filter((e) => e.type === sec.type);
          if (!rows.length) continue;
          autoTable(doc, {
            startY: y,
            margin: { left: 8, right: 8 },
            head: [[{ content: `${sec.title} — ${rows.length} · AED ${fmtNumber(rows.reduce((s, e) => s + e.total, 0))}`, colSpan: head.length }], head],
            body: rows.map(row),
            theme: "grid",
            styles: { fontSize: 7.5, cellPadding: 1.3, overflow: "linebreak", lineColor: 140, lineWidth: 0.15 },
            headStyles: { fillColor: [20, 31, 51], textColor: 255 },
            columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 20, fontStyle: "bold" }, 7: { halign: "right", cellWidth: 16 }, ...(isVendor ? { 8: { halign: "right" as const, cellWidth: 12 } } : {}) },
          });
          y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
        }
      }
      doc.save(`${fileLabel.toLowerCase().replace(/\s+/g, "-")}-${date}-${label.replace(/\s+/g, "_")}.pdf`);
    } catch (err) {
      alert(`Could not make the PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function excel() {
    setBusy(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const cols = [
        { header: groupLabel, key: "agent", width: 14 },
        { header: "Type", key: "type", width: 13 },
        { header: "Time", key: "time", width: 8 },
        { header: "CN", key: "cn", width: 11 },
        { header: isVendor ? "Driver" : "Vendor", key: "vendor", width: 14 },
        { header: "Customer", key: "customer", width: 22 },
        { header: "Phone", key: "phone", width: 15 },
        { header: "Address", key: "address", width: 40 },
        { header: "Emirate", key: "emirate", width: 12 },
        { header: "Items", key: "items", width: 30 },
        { header: "Amount", key: "amount", width: 10 },
        ...(isVendor ? [{ header: "DL charge", key: "dl", width: 10 }] : []),
        { header: "Scanned by", key: "by", width: 16 },
        { header: "By", key: "role", width: 8 },
        { header: "Transferred from", key: "from", width: 16 },
      ];
      const add = (name: string, rows: EntryRow[]) => {
        const ws = wb.addWorksheet(name.slice(0, 31));
        ws.columns = cols;
        rows.forEach((e) =>
          ws.addRow({
            agent: e.groupName,
            type: SECTIONS.find((s) => s.type === e.type)!.title,
            time: time(e.at),
            cn: e.cnNo,
            vendor: isVendor ? e.driver ?? "" : e.vendor,
            customer: e.customerName,
            phone: e.customerPhone,
            address: e.address,
            emirate: e.emirate,
            items: plain(e.items),
            amount: e.total,
            dl: e.deliveryCharge ?? 0,
            by: e.scan?.by ?? "",
            role: e.scan?.role ?? (e.type === "MANUAL" ? "typed in" : ""),
            from: e.from ?? "",
          })
        );
        const h = ws.getRow(1);
        h.font = { bold: true, color: { argb: "FFFFFFFF" } };
        h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF141F33" } };
        ws.views = [{ state: "frozen", ySplit: 1 }];
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
        ws.getColumn("amount").numFmt = "#,##0";
        const t = ws.addRow({ agent: "TOTAL", cn: rows.length, amount: rows.reduce((s, e) => s + e.total, 0) });
        t.font = { bold: true };
      };
      for (const sec of SECTIONS) {
        const rows = list.filter((e) => e.type === sec.type);
        if (rows.length || sec.type !== "TRANSFERRED") add(sec.title, rows);
      }
      add("All", list);
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileLabel.toLowerCase().replace(/\s+/g, "-")}-${date}-${label.replace(/\s+/g, "_")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      alert(`Could not make the Excel file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="rounded border border-line px-2 py-1.5 text-xs">
        <option value="">All {groupLabel.toLowerCase()}s</option>
        {agents.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <button onClick={pdf} disabled={busy || !list.length} className="rounded border border-navy bg-white px-2.5 py-1.5 font-mono text-[11px] font-bold uppercase text-navy disabled:opacity-40">
        ⬇ PDF
      </button>
      <button onClick={excel} disabled={busy || !list.length} className="rounded border border-green-700 bg-white px-2.5 py-1.5 font-mono text-[11px] font-bold uppercase text-green-800 disabled:opacity-40">
        ⬇ Excel
      </button>
    </div>
  );
}
