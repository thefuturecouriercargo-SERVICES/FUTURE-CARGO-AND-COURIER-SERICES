"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, fmtDate, todayStr } from "@/lib/format";
import { saveBlob, savePdf } from "@/lib/savePdf";
import Icon from "@/components/Icon";

interface Row {
  orderId: string;
  cnNo: number;
  handedOn: string;
  days: number;
  agent: string;
  vendor: string;
  billNo: string | null;
  customer: string | null;
  phone: string | null;
  address: string | null;
  emirate: string;
  area: string | null;
  total: number;
}

const MIN_DAYS = 5;
const BANDS = [
  { label: "5–6 DAYS", test: (d: number) => d < 7, cls: "bg-yellow-100 text-yellow-800" },
  { label: "7–9 DAYS", test: (d: number) => d >= 7 && d < 10, cls: "bg-orange-100 text-orange-800" },
  { label: "10+ DAYS", test: (d: number) => d >= 10, cls: "bg-red-100 text-red-800" },
];
const bandOf = (d: number) => BANDS.find((b) => b.test(d))!;
const who = (r: Row) => [r.vendor, r.billNo ? `BILL ${r.billNo}` : r.customer].filter(Boolean).join(" · ");
const place = (r: Row) => [r.area, r.emirate].filter(Boolean).join(", ");

/** CNs still pending with the agent for 5 or more days — oldest first, with Excel and PDF. */
export default function AgentAgeing({ refreshKey = 0 }: { refreshKey?: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [agent, setAgent] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ rows: Row[] }>(`/agent-report/ageing?days=${MIN_DAYS}`);
      setRows(r.rows);
    } catch {
      setRows([]);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const agents = [...new Set((rows ?? []).map((r) => r.agent))];
  const list = (rows ?? []).filter((r) => !agent || r.agent === agent);
  const sum = list.reduce((s, r) => s + r.total, 0);
  const fileBase = `agent-5-days-${todayStr()}${agent ? `-${agent.replace(/\s+/g, "_")}` : ""}`;

  async function excel() {
    setBusy(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("With agent 5+ days");
      ws.columns = [
        { header: "CN", key: "cn", width: 10 },
        { header: "Handed on", key: "on", width: 13 },
        { header: "Days", key: "days", width: 7 },
        { header: "Agent", key: "agent", width: 12 },
        { header: "Vendor", key: "vendor", width: 14 },
        { header: "Bill no", key: "bill", width: 9 },
        { header: "Customer", key: "customer", width: 20 },
        { header: "Phone", key: "phone", width: 15 },
        { header: "Address", key: "address", width: 40 },
        { header: "Area", key: "area", width: 20 },
        { header: "COD", key: "cod", width: 9 },
      ];
      list.forEach((r) =>
        ws.addRow({
          cn: r.cnNo,
          on: fmtDate(r.handedOn),
          days: r.days,
          agent: r.agent,
          vendor: r.vendor,
          bill: r.billNo ?? "",
          customer: r.customer ?? "",
          phone: r.phone ?? "",
          address: r.address ?? "",
          area: place(r),
          cod: r.total,
        })
      );
      const h = ws.getRow(1);
      h.font = { bold: true, color: { argb: "FFFFFFFF" } };
      h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF141F33" } };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };
      ws.getColumn("cod").numFmt = "#,##0";
      ws.addRow({ cn: "TOTAL", days: list.length, cod: sum }).font = { bold: true };
      const buf = await wb.xlsx.writeBuffer();
      await saveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${fileBase}.xlsx`);
    } catch (e) {
      alert(`Could not make the Excel file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function pdf() {
    setBusy(true);
    try {
      const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const autoTable = autoTableMod.default;
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text(`WITH AGENT ${MIN_DAYS}+ DAYS${agent ? ` — ${agent.toUpperCase()}` : ""}`, 10, 13);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text(`${fmtDate(todayStr())}   ·   ${list.length} CNs   ·   AED ${fmtNumber(sum)}`, 10, 19);
      doc.text("The Future Courier Service L.L.C", W - 10, 13, { align: "right" });
      autoTable(doc, {
        startY: 24,
        margin: { left: 8, right: 8 },
        head: [["CN", "HANDED ON", "DAYS", "VENDOR", "BILL", "CUSTOMER", "PHONE", "ADDRESS", "AREA", "COD"]],
        body: list.map((r) => [r.cnNo, fmtDate(r.handedOn), r.days, r.vendor, r.billNo ?? "", r.customer ?? "", r.phone ?? "", r.address ?? "", place(r), fmtNumber(r.total)]),
        foot: [["TOTAL", "", list.length, "", "", "", "", "", "", fmtNumber(sum)]],
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 1.3, overflow: "linebreak", lineColor: 140, lineWidth: 0.15 },
        headStyles: { fillColor: [20, 31, 51], textColor: 255 },
        footStyles: { fillColor: [240, 236, 224], textColor: 20, fontStyle: "bold" },
        columnStyles: { 0: { cellWidth: 14, fontStyle: "bold" }, 1: { cellWidth: 20 }, 2: { cellWidth: 10, halign: "center" }, 9: { halign: "right", cellWidth: 14 } },
      });
      await savePdf(doc, `${fileBase}.pdf`);
    } catch (e) {
      alert(`Could not make the PDF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) return null;

  return (
    <section className="mb-6 border border-brass bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-navy">
          <Icon name="hourglass" />
          WITH AGENT {MIN_DAYS}+ DAYS
          <span className="rounded-full bg-cancelled-bg px-2 py-0.5 text-xs text-cancelled">{list.length}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {agents.length > 1 && (
            <select value={agent} onChange={(e) => setAgent(e.target.value)} className="rounded border border-line px-2 py-1 text-xs">
              <option value="">ALL AGENTS</option>
              {agents.map((a) => (
                <option key={a} value={a}>{a.toUpperCase()}</option>
              ))}
            </select>
          )}
          <button onClick={excel} disabled={busy || !list.length} className="rounded border border-navy bg-white px-3 py-1 font-mono text-[11px] font-bold uppercase text-navy disabled:opacity-40">
            Excel
          </button>
          <button onClick={pdf} disabled={busy || !list.length} className="rounded border border-navy bg-white px-3 py-1 font-mono text-[11px] font-bold uppercase text-navy disabled:opacity-40">
            PDF
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-delivered">NO CN WITH THE AGENT FOR {MIN_DAYS}+ DAYS.</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {BANDS.map((b) => (
              <div key={b.label} className="border border-line bg-paper p-2">
                <p className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">{b.label}</p>
                <p className="font-display text-xl font-semibold text-navy">{list.filter((r) => b.test(r.days)).length}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto border border-line">
            <table className="data-table min-w-[680px]">
              <thead className="bg-paper font-mono text-[10px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="p-2 text-left">CN</th>
                  <th className="p-2 text-left">Handed on</th>
                  <th className="p-2 text-left">Days</th>
                  <th className="p-2 text-left">Vendor / Customer</th>
                  <th className="p-2 text-left">Area</th>
                  <th className="p-2 text-right">COD</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.orderId} className="border-t border-line">
                    <td className="p-2 font-mono font-bold text-navy">{r.cnNo}</td>
                    <td className="p-2 text-xs">{fmtDate(r.handedOn)}</td>
                    <td className="p-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${bandOf(r.days).cls}`}>{r.days}</span>
                    </td>
                    <td className="p-2 text-xs">{who(r)}</td>
                    <td className="p-2 text-xs">{place(r)}</td>
                    <td className="p-2 text-right font-mono text-xs">{fmtNumber(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            TOTAL COD STUCK: <b className="text-navy">AED {fmtNumber(sum)}</b>
          </p>
        </>
      )}
    </section>
  );
}
