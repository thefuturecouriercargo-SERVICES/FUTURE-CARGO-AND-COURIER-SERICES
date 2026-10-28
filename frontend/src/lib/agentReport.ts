/**
 * Reads the status reports agents send us, in the browser.
 *  - Excel: every sheet; finds the header row with a tracking/AWB column and a Status column.
 *  - PDF ("Cash Return Report"): every row on it is a delivered parcel.
 * Returns plain rows; the server matches them to our orders by CN.
 */

export interface ReportRow {
  tracking: string;
  status: string;
  cod: number | null;
  emirate: string | null;
  sender: string | null;
  sheet: string | null;
}

const EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah", "Al Ain"];

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (o.text != null) return String(o.text);
    if (o.result != null) return String(o.result);
  }
  return String(v).trim();
}

function num(v: string): number | null {
  const n = Number(v.replace(/[^\d.-]/g, ""));
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
}

export async function readExcelReport(file: File): Promise<ReportRow[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const out: ReportRow[] = [];

  wb.eachSheet((ws) => {
    let cols: { tracking: number; status: number; cod: number; emirate: number; sender: number } | null = null;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = Array.from(row.values as unknown[], cellText); // 1-based; fills empty cells
      if (!cols) {
        const low = vals.map((v) => v.toLowerCase());
        const find = (...keys: string[]) => low.findIndex((h) => keys.some((k) => h.includes(k)));
        const tracking = find("awb", "tracking", "cn no", "consignment");
        const status = find("status");
        if (tracking > 0 && status > 0) {
          cols = { tracking, status, cod: find("cod", "amount"), emirate: find("emirate", "destination"), sender: find("sender") };
        }
        return;
      }
      const tracking = vals[cols.tracking] ?? "";
      const status = vals[cols.status] ?? "";
      if (!/\d{3,}/.test(tracking) || !status) return;
      out.push({
        tracking: tracking.trim(),
        status: status.trim(),
        cod: cols.cod > 0 ? num(vals[cols.cod] ?? "") : null,
        emirate: cols.emirate > 0 ? vals[cols.emirate] || null : null,
        sender: cols.sender > 0 ? vals[cols.sender] || null : null,
        sheet: ws.name,
      });
    });
  });
  return out;
}

const PDF_VERSION = "3.11.174";

export async function readPdfReport(file: File): Promise<ReportRow[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_VERSION}/build/pdf.worker.min.js`;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const emirateRe = EMIRATES.map((e) => e.replace(/ /g, "\\s+")).join("|");
  // … <tracking> <destination> <cod> <charge> <cash to return>
  const rowRe = new RegExp(`(\\d{3,12})\\s+(${emirateRe})\\s+(-?\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)`, "i");
  const out: ReportRow[] = [];
  let section = "";

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Group text pieces into lines by their vertical position.
    const lines: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      let line = lines.find((l) => Math.abs(l.y - y) < 3);
      if (!line) {
        line = { y, parts: [] };
        lines.push(line);
      }
      line.parts.push({ x, s: it.str.trim() });
    }
    lines.sort((a, b) => b.y - a.y); // top to bottom
    for (const l of lines) {
      const text = l.parts.sort((a, b) => a.x - b.x).map((q) => q.s).join(" ");
      if (/pending till/i.test(text)) section = text.trim();
      const m = text.match(rowRe);
      if (!m) continue;
      out.push({
        tracking: m[1],
        status: "Delivered",
        cod: Number(m[3]),
        emirate: m[2].replace(/\s+/g, " "),
        sender: null,
        sheet: section ? `PDF · ${section}` : `PDF p${p}`,
      });
    }
  }
  return out;
}

export async function readAgentReport(file: File): Promise<ReportRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return readPdfReport(file);
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return readExcelReport(file);
  throw new Error("Upload the agent's Excel (.xlsx) or PDF report");
}
