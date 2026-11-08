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
  /** Which kind of file the row came from. */
  source: "excel" | "pdf";
  /** Excel: the row's delivered/status date · PDF: the PDF's own date — "YYYY-MM-DD", or null if none found. */
  reportDate: string | null;
  file: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ymd = (y: number, m: number, d: number) =>
  y > 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;

/** Every date written in a piece of text (dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, 02 Nov 2026, 02-Nov-26). */
export function datesIn(text: string): string[] {
  const out: string[] = [];
  const t = text.toLowerCase();
  for (const m of t.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const v = ymd(+m[1], +m[2], +m[3]);
    if (v) out.push(v);
  }
  for (const m of t.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g)) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const v = ymd(y, +m[2], +m[1]); // day first (UAE)
    if (v) out.push(v);
  }
  for (const m of t.matchAll(/\b(\d{1,2})[\s-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,-]*(\d{2,4})\b/g)) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const v = ymd(y, MONTHS.indexOf(m[2]) + 1, +m[1]);
    if (v) out.push(v);
  }
  return out;
}

function cellDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 40000 && v < 60000) {
    // Excel serial date
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  if (typeof v === "object" && v && "result" in v) return cellDate((v as { result: unknown }).result);
  return datesIn(cellText(v))[0] ?? null;
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
    let cols: { tracking: number; status: number; cod: number; emirate: number; sender: number; date: number } | null = null;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const raw = Array.from(row.values as unknown[]); // 1-based; fills empty cells
      const vals = raw.map(cellText);
      if (!cols) {
        const low = vals.map((v) => v.toLowerCase());
        const find = (...keys: string[]) => low.findIndex((h) => keys.some((k) => h.includes(k)));
        // Tracking column: older sheets say AWB / Tracking, the newer "Shipment Summary" says "Shipment ID".
        const tracking = find("awb", "tracking", "cn no", "consignment", "shipment id", "shipment no", "shipment #");
        const status = find("status");
        if (tracking > 0 && status > 0) {
          // Delivered date: prefer a delivery/status date column, else any "date" column —
          // but never the booking/pickup date (that is when it was sent, not delivered).
          let date = find("deliver date", "delivered date", "delivery date", "delivered on", "status date", "last update", "updated");
          if (date <= 0 || !low[date].includes("date") && !low[date].includes("updat"))
            date = low.findIndex((h) => h.includes("date") && !/book|pick|creat|order/.test(h));
          // Customer's emirate: "Receiver Emirate", not "Sender Emirate".
          let emirate = find("receiver emirate", "consignee emirate", "destination");
          if (emirate <= 0) emirate = low.findIndex((h) => h.includes("emirate") && !h.includes("sender"));
          let sender = find("sender name", "shipper");
          if (sender <= 0) sender = find("sender");
          cols = { tracking, status, cod: find("cod", "amount"), emirate, sender, date };
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
        source: "excel",
        reportDate: cols.date > 0 ? cellDate(raw[cols.date]) : null,
        file: file.name,
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
  const headerDates: string[] = [];

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
      if (!m) {
        headerDates.push(...datesIn(text));
        continue;
      }
      out.push({
        tracking: m[1],
        status: "Delivered",
        cod: Number(m[3]),
        emirate: m[2].replace(/\s+/g, " "),
        sender: null,
        sheet: section ? `PDF · ${section}` : `PDF p${p}`,
        source: "pdf",
        reportDate: null,
        file: file.name,
      });
    }
  }
  // The PDF's date = the latest date printed on it outside the rows ("Pending till …", report date),
  // else a date in the file name; none → the server uses the upload day.
  const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
  const pdfDate = [...headerDates, ...datesIn(file.name)].filter((d) => d <= today).sort().pop() ?? null;
  for (const r of out) r.reportDate = pdfDate;
  return out;
}

export async function readAgentReport(file: File): Promise<ReportRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return readPdfReport(file);
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return readExcelReport(file);
  throw new Error("Upload the agent's Excel (.xlsx) or PDF report");
}
