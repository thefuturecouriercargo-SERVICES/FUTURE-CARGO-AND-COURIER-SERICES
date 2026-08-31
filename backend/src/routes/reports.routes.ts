import { Router } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import { parseDateParam, formatDate } from "../utils/dates";
import { drawLetterheadHeader, drawLetterheadFooter } from "../utils/letterhead";
import { drawPdfRow, PDF_COLORS } from "../utils/pdfTable";

const router = Router();
router.use(authenticate);

function buildWhere(query: Record<string, unknown>): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (query.from || query.to) {
    where.date = {
      ...(query.from ? { gte: parseDateParam(query.from as string) } : {}),
      ...(query.to ? { lte: parseDateParam(query.to as string) } : {}),
    };
  }
  if (query.employeeId) where.employeeId = query.employeeId as string;
  if (query.vendorId) where.vendorId = query.vendorId as string;
  if (query.status) where.status = query.status as never;
  if (query.payment) where.payment = query.payment as never;
  if (query.emirate) where.emirate = (query.emirate as string).toUpperCase();
  return where;
}

function fmtAed(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtDayMonthYear(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

router.get(
  "/export",
  asyncHandler(async (req, res) => {
    const format = (req.query.format as string) ?? "excel";
    const q = req.query as Record<string, unknown>;
    const where = buildWhere(q);

    const rangeOrders = await prisma.order.findMany({
      where,
      include: { vendor: true, employee: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { slNo: "asc" }],
      take: 50000,
    });

    // Carry forward any still-unresolved Pending/Transfer orders entered before the
    // "from" date but not yet Delivered/Cancelled — kept as a clearly separate section
    // below, so it's obvious which rows are the requested date range vs. older backlog
    // still open. (Never silently blended together — that's what caused a report for
    // a single day to look dominated by much older dates.)
    let carriedOrders: typeof rangeOrders = [];
    if (q.from) {
      const fromDate = parseDateParam(q.from as string);
      const carryWhere: Record<string, unknown> = {
        date: { lt: fromDate },
        status: { in: ["PENDING", "TRANSFER"] },
      };
      if (q.employeeId) carryWhere.employeeId = q.employeeId as string;
      if (q.vendorId) carryWhere.vendorId = q.vendorId as string;
      if (q.payment) carryWhere.payment = q.payment as never;
      if (q.emirate) carryWhere.emirate = (q.emirate as string).toUpperCase();
      // A status filter narrower than Pending/Transfer means the user explicitly
      // wants only that status, so skip carryover in that case (nothing would match).
      const statusFilter = q.status as string | undefined;
      const skipCarryover = statusFilter && statusFilter !== "PENDING" && statusFilter !== "TRANSFER";

      if (!skipCarryover) {
        const raw = await prisma.order.findMany({
          where: carryWhere,
          include: { vendor: true, employee: { select: { name: true } } },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        });
        // Dedupe by CN No., keeping only the most recent entry per consignment.
        const seenCn = new Set<number>();
        carriedOrders = raw
          .filter((o) => {
            if (seenCn.has(o.cnNo)) return false;
            seenCn.add(o.cnNo);
            return true;
          })
          .sort((a, b) => a.date.getTime() - b.date.getTime());
      }
    }

    const orders = [...rangeOrders, ...carriedOrders];

    const columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "SL No", key: "slNo", width: 8 },
      { header: "CN No", key: "cnNo", width: 12 },
      { header: "Vendor", key: "brand", width: 14 },
      { header: "Total (AED)", key: "total", width: 12 },
      { header: "DL Charge", key: "dl", width: 10 },
      { header: "Payment", key: "payment", width: 10 },
      { header: "Emirate", key: "emirate", width: 12 },
      { header: "Employee", key: "employee", width: 14 },
      { header: "Status", key: "status", width: 12 },
    ];

    const rows = orders.map((o) => ({
      date: formatDate(o.date),
      slNo: o.slNo,
      cnNo: o.cnNo,
      brand: o.brandName,
      total: o.total,
      dl: o.deliveryCharge,
      payment: o.payment,
      emirate: o.emirate,
      employee: o.employee.name,
      status: o.status,
    }));

    const sumTotal = rows.reduce((s, r) => s + r.total, 0);
    // Only count delivery charge on Delivered orders — a Cancelled order's charge
    // was never actually earned, and its total is already removed via sumCancelled below.
    const sumDl = rows.filter((r) => r.status === "DELIVERED").reduce((s, r) => s + r.dl, 0);
    const sumCancelled = rows.filter((r) => r.status === "CANCELLED").reduce((s, r) => s + r.total, 0);
    const balance = sumTotal - sumCancelled - sumDl;

    // A plain-English summary of exactly what was requested, so the report itself
    // states its own scope — not just when it happened to be generated. Formatted
    // DD/MM/YYYY to match the "Exported on" line above it.
    const fromDisplay = q.from ? fmtDayMonthYear(parseDateParam(q.from as string)) : undefined;
    const toDisplay = q.to ? fmtDayMonthYear(parseDateParam(q.to as string)) : undefined;
    const filterParts: string[] = [];
    if (fromDisplay && toDisplay && q.from === q.to) filterParts.push(`Date: ${fromDisplay}`);
    else if (fromDisplay || toDisplay) filterParts.push(`Date: ${fromDisplay ?? "…"} to ${toDisplay ?? "…"}`);
    else filterParts.push("Date: All dates");
    if (q.status) filterParts.push(`Status: ${q.status}`);
    if (q.payment) filterParts.push(`Payment: ${q.payment}`);
    if (q.emirate) filterParts.push(`Emirate: ${q.emirate}`);
    if (q.vendorId) filterParts.push(`Vendor filtered`);
    if (q.employeeId) filterParts.push(`Employee filtered`);
    const filterSummary = filterParts.join("  ·  ");

    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="consignment-report.pdf"');

    const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
      doc.pipe(res);

      let y = drawLetterheadHeader(doc, "Consignment Report");
      doc.fontSize(11).fillColor(PDF_COLORS.navy).font("Helvetica-Bold").text(filterSummary, doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });
      y = doc.y + 4;
      doc.fontSize(9).fillColor("#555").font("Helvetica").text(`${rows.length} records`, doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });
      y = doc.y + 10;

      const colWidths = [55, 40, 55, 65, 60, 55, 55, 60, 65, 65];
      const startX = doc.page.margins.left;
      const rowHeight = 18;
      const statusColIndex = columns.findIndex((c) => c.key === "status");

      function drawRow(values: (string | number)[], opts: { header?: boolean; zebra?: boolean; summary?: boolean } = {}) {
        drawPdfRow(doc, startX, y, rowHeight, values, colWidths, {
          bg: opts.header ? PDF_COLORS.navy : opts.summary ? PDF_COLORS.brassLight : opts.zebra ? PDF_COLORS.zebra : "#FFFFFF",
          color: opts.header ? "#FFFFFF" : undefined,
          bold: opts.header || opts.summary,
          statusColIndex: opts.header || opts.summary ? undefined : statusColIndex,
          align: columns.map((c) => (c.key === "total" || c.key === "dl" ? "right" : "left")),
        });
        y += rowHeight;
        if (y > doc.page.height - doc.page.margins.bottom - 90) {
          drawLetterheadFooter(doc);
          doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
          y = doc.page.margins.top;
        }
      }

      drawRow(columns.map((c) => c.header), { header: true });
      rangeOrders.forEach((o, i) => {
        const r = rows[i];
        drawRow(columns.map((c) => (r as Record<string, unknown>)[c.key] as string | number), { zebra: i % 2 === 1 });
      });

      if (carriedOrders.length > 0) {
        y += 4;
        doc.font("Helvetica-Bold").fontSize(10).fillColor(PDF_COLORS.cancelled).text(
          `Carried Forward — Still Pending From Before ${q.from} (${carriedOrders.length})`,
          startX,
          y
        );
        y += 18;
        carriedOrders.forEach((o, i) => {
          const r = rows[rangeOrders.length + i];
          drawRow(columns.map((c) => (r as Record<string, unknown>)[c.key] as string | number), { zebra: i % 2 === 1 });
        });
      }

      // Totals summary at the end of the report.
      y += 6;
      drawRow(["", "", "", "TOTAL", sumTotal, sumDl, "", "", "", ""], { summary: true });
      drawRow(["", "", "", "CANCELLED", sumCancelled, "", "", "", "", ""], { summary: true });
      drawRow(["", "", "", "BALANCE (Total - Cancelled - DL Charge)", balance, "", "", "", "", ""], { summary: true });

      drawLetterheadFooter(doc);
      doc.end();
      return;
    }

    // Default: Excel export
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Future Courier Operations";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Consignment Report");
    // Set column widths only (no header text yet) so we can place our own summary
    // rows above the actual column header row.
    sheet.columns = columns.map((c) => ({ key: c.key, width: c.width }));

    const filterHeaderRow = sheet.addRow({ date: filterSummary });
    filterHeaderRow.font = { bold: true };
    sheet.addRow({ date: `${rows.length} records` });
    sheet.addRow({});
    const columnHeaderRow = sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, c.header])));
    columnHeaderRow.font = { bold: true };
    rows.slice(0, rangeOrders.length).forEach((r) => sheet.addRow(r));

    if (carriedOrders.length > 0) {
      sheet.addRow({});
      const carryHeaderRow = sheet.addRow({ date: `CARRIED FORWARD — STILL PENDING FROM BEFORE ${q.from} (${carriedOrders.length})` });
      carryHeaderRow.font = { bold: true, color: { argb: "FFAC3529" } };
      rows.slice(rangeOrders.length).forEach((r) => sheet.addRow(r));
    }

    // Totals summary at the end of the report.
    sheet.addRow({});
    const totalRow = sheet.addRow({ brand: "TOTAL", total: sumTotal, dl: sumDl });
    totalRow.font = { bold: true };
    const cancelledRow = sheet.addRow({ brand: "CANCELLED", total: sumCancelled });
    cancelledRow.font = { bold: true };
    const balanceRow = sheet.addRow({ brand: "BALANCE (Total - Cancelled - DL Charge)", total: balance });
    balanceRow.font = { bold: true };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="consignment-report.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  })
);
router.get(
  "/pnl",
  asyncHandler(async (req, res) => {
    const where = buildWhere(req.query as Record<string, unknown>);
    const format = req.query.format as string | undefined;

    const delivered = await prisma.order.findMany({
      where: { ...where, status: "DELIVERED" },
      select: { deliveryCharge: true, employee: { select: { isAgent: true } } },
    });
    // Agent orders keep their real delivery charge (for vendor credit calcs)
    // but are excluded from company revenue since we don't collect a fee on them.
    const revenue = delivered.filter((o) => !o.employee.isAgent).reduce((s, o) => s + o.deliveryCharge, 0);

    const expenseWhere: Record<string, unknown> = {};
    if (req.query.from || req.query.to) {
      expenseWhere.date = {
        ...(req.query.from ? { gte: parseDateParam(req.query.from as string) } : {}),
        ...(req.query.to ? { lte: parseDateParam(req.query.to as string) } : {}),
      };
    }

    const expenses = await prisma.expenseEntry.findMany({ where: expenseWhere });
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    const byCategory: Record<string, number> = {};
    for (const e of expenses) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
    }
    const categoryBreakdown = Object.entries(byCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    const netProfit = revenue - totalExpenses;
    const period =
      req.query.from || req.query.to
        ? `${req.query.from ? formatDate(parseDateParam(req.query.from as string)) : "…"} to ${
            req.query.to ? formatDate(parseDateParam(req.query.to as string)) : "…"
          }`
        : "All time";

    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="pnl-report.pdf"');
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      doc.pipe(res);

      let y = drawLetterheadHeader(doc, "Profit & Loss Report");
      doc.fontSize(9).fillColor("#555").text(`Period: ${period}`, doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });
      y = doc.y + 16;

      const left = doc.page.margins.left;
      const boxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // Three summary boxes: Revenue, Expenses, Net Profit — color-coded.
      const boxGap = 12;
      const boxW = (boxWidth - boxGap * 2) / 3;
      const boxH = 55;
      function summaryBox(x: number, label: string, value: string, bg: string, fg: string) {
        doc.rect(x, y, boxW, boxH).fill(bg);
        doc.font("Helvetica").fontSize(9).fillColor(fg).text(label, x + 10, y + 10, { width: boxW - 20 });
        doc.font("Helvetica-Bold").fontSize(16).fillColor(fg).text(`${value} AED`, x + 10, y + 26, { width: boxW - 20 });
      }
      summaryBox(left, "Revenue (Delivery Charge)", fmtAed(revenue), PDF_COLORS.deliveredBg, PDF_COLORS.delivered);
      summaryBox(left + boxW + boxGap, "Total Expenses", fmtAed(totalExpenses), PDF_COLORS.cancelledBg, PDF_COLORS.cancelled);
      summaryBox(
        left + (boxW + boxGap) * 2,
        "Net Profit",
        fmtAed(netProfit),
        netProfit >= 0 ? PDF_COLORS.deliveredBg : PDF_COLORS.cancelledBg,
        netProfit >= 0 ? PDF_COLORS.delivered : PDF_COLORS.cancelled
      );
      y += boxH + 24;

      doc.rect(left, y - 4, boxWidth, 22).fill(PDF_COLORS.navy);
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#FFFFFF").text("Expense Breakdown by Category", left + 6, y);
      y += 24;

      const catColWidths = [boxWidth - 150, 150];
      categoryBreakdown.forEach((c, i) => {
        drawPdfRow(doc, left, y, 18, [c.category, fmtAed(c.amount)], catColWidths, {
          bg: i % 2 === 1 ? PDF_COLORS.zebra : "#FFFFFF",
          align: ["left", "right"],
        });
        y += 18;
      });

      drawLetterheadFooter(doc);
      doc.end();
      return;
    }

    if (format === "excel") {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Future Courier Operations";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("P&L Report");
      sheet.columns = [
        { header: "Item", key: "item", width: 30 },
        { header: "Amount (AED)", key: "amount", width: 18 },
      ];
      sheet.getRow(1).font = { bold: true };
      sheet.addRow({ item: `Period: ${period}` });
      sheet.addRow({});
      sheet.addRow({ item: "Revenue (Delivery Charge)", amount: revenue });
      sheet.addRow({ item: "Total Expenses", amount: totalExpenses });
      const netRow = sheet.addRow({ item: "Net Profit", amount: netProfit });
      netRow.font = { bold: true };
      sheet.addRow({});
      const headerRow = sheet.addRow({ item: "Expense Breakdown by Category" });
      headerRow.font = { bold: true };
      categoryBreakdown.forEach((c) => sheet.addRow({ item: c.category, amount: c.amount }));

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="pnl-report.xlsx"');
      await workbook.xlsx.write(res);
      res.end();
      return;
    }

    res.json({
      revenue,
      totalExpenses,
      netProfit: revenue - totalExpenses,
      deliveredCount: delivered.length,
      categoryBreakdown,
      topCategory: categoryBreakdown[0] ?? null,
    });
  })
);

// Expense report: individual entries, category totals, and grand total.
router.get(
  "/expenses/export",
  asyncHandler(async (req, res) => {
    const format = (req.query.format as string) ?? "excel";
    const where: Record<string, unknown> = {};
    if (req.query.from || req.query.to) {
      where.date = {
        ...(req.query.from ? { gte: parseDateParam(req.query.from as string) } : {}),
        ...(req.query.to ? { lte: parseDateParam(req.query.to as string) } : {}),
      };
    }
    if (req.query.category) where.category = req.query.category as string;
    if (req.query.employeeId) where.employeeId = req.query.employeeId as string;

    const entries = await prisma.expenseEntry.findMany({
      where,
      include: { employee: { select: { name: true } } },
      orderBy: [{ date: "asc" }],
      take: 50000,
    });

    const rows = entries.map((e) => ({
      date: formatDate(e.date),
      category: e.category,
      amount: e.amount,
      remarks: e.remarks ?? "",
      employee: e.employee?.name ?? "—",
      source: e.source,
    }));
    const grandTotal = rows.reduce((s, r) => s + r.amount, 0);

    const byCategory: Record<string, number> = {};
    for (const r of rows) byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amount;
    const categoryTotals = Object.entries(byCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="expense-report.pdf"');
      const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
      doc.pipe(res);

      let y = drawLetterheadHeader(doc, "Expense Report");
      doc.fontSize(9).fillColor("#555").text(`${rows.length} entries`, doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });
      y = doc.y + 10;

      const colWidths = [70, 90, 70, 150, 90, 70];
      const startX = doc.page.margins.left;
      const rowHeight = 18;

      function drawRow(values: (string | number)[], opts: { header?: boolean; zebra?: boolean; summary?: boolean } = {}) {
        drawPdfRow(doc, startX, y, rowHeight, values, colWidths, {
          bg: opts.header ? PDF_COLORS.navy : opts.summary ? PDF_COLORS.brassLight : opts.zebra ? PDF_COLORS.zebra : "#FFFFFF",
          color: opts.header ? "#FFFFFF" : undefined,
          bold: opts.header || opts.summary,
          align: ["left", "left", "right", "left", "left", "left"],
        });
        y += rowHeight;
        if (y > doc.page.height - doc.page.margins.bottom - 90) {
          drawLetterheadFooter(doc);
          doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
          y = doc.page.margins.top;
        }
      }

      drawRow(["Date", "Category", "Amount", "Remarks", "Employee", "Source"], { header: true });
      rows.forEach((r, i) => drawRow([r.date, r.category, r.amount, r.remarks, r.employee, r.source], { zebra: i % 2 === 1 }));

      y += 6;
      doc.font("Helvetica-Bold").fontSize(10).fillColor(PDF_COLORS.navy).text("Category Totals", startX, y);
      y += 16;
      categoryTotals.forEach((c) => drawRow([c.category, "", c.amount, "", "", ""], { summary: true }));
      drawRow(["GRAND TOTAL", "", grandTotal, "", "", ""], { summary: true });

      drawLetterheadFooter(doc);
      doc.end();
      return;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Future Courier Operations";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Expense Report");
    sheet.columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "Category", key: "category", width: 14 },
      { header: "Amount (AED)", key: "amount", width: 14 },
      { header: "Remarks", key: "remarks", width: 30 },
      { header: "Employee", key: "employee", width: 16 },
      { header: "Source", key: "source", width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };
    rows.forEach((r) => sheet.addRow(r));
    sheet.addRow({});
    const catHeaderRow = sheet.addRow({ date: "CATEGORY TOTALS" });
    catHeaderRow.font = { bold: true };
    categoryTotals.forEach((c) => sheet.addRow({ date: c.category, amount: c.amount }));
    const grandRow = sheet.addRow({ date: "GRAND TOTAL", amount: grandTotal });
    grandRow.font = { bold: true };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="expense-report.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  })
);

router.get(
  "/employee-performance/pdf",
  asyncHandler(async (req, res) => {
    let where: { date: Date } | { date: { gte: Date; lte: Date } };
    let label: string;

    if (req.query.from || req.query.to) {
      const fromStart = parseDateParam(req.query.from as string);
      const toStart = parseDateParam(req.query.to as string);
      where = { date: { gte: fromStart, lte: toStart } };
      label = `${formatDate(fromStart)} to ${formatDate(toStart)}`;
    } else {
      const d = req.query.date ? parseDateParam(req.query.date as string) : new Date();
      where = { date: d };
      label = formatDate(d);
    }

    const orders = await prisma.order.findMany({ where });
    const employees = await prisma.user.findMany({ where: { role: "DRIVER" }, orderBy: { name: "asc" } });

    const rows = employees.map((e) => {
      const own = orders.filter((o) => o.employeeId === e.id);
      const delivered = own.filter((o) => o.status === "DELIVERED");
      return {
        name: e.name,
        delivered: delivered.length,
        sales: delivered.reduce((s, o) => s + o.total, 0),
        dlCharge: delivered.reduce((s, o) => s + o.deliveryCharge, 0),
        pending: own.filter((o) => o.status === "PENDING").length,
        cancelled: own.filter((o) => o.status === "CANCELLED").length,
        transferred: own.filter((o) => o.status === "TRANSFER").length,
      };
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="employee-performance.pdf"');

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.pipe(res);

    let y = drawLetterheadHeader(doc, "Employee-wise Performance");
    doc.fontSize(9).fillColor("#555").text(`Period: ${label}`, doc.page.margins.left, y, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: "center",
    });
    y = doc.y + 14;

    const headers = ["Employee", "Delivered", "Sales", "DL Charge", "Pending", "Cancelled", "Transfer"];
    const colWidths = [110, 60, 65, 65, 60, 65, 65];
    const startX = doc.page.margins.left;
    const rowHeight = 18;

    function drawRow(values: (string | number)[], opts: { header?: boolean; zebra?: boolean; summary?: boolean } = {}) {
      drawPdfRow(doc, startX, y, rowHeight, values, colWidths, {
        bg: opts.header ? PDF_COLORS.navy : opts.summary ? PDF_COLORS.brassLight : opts.zebra ? PDF_COLORS.zebra : "#FFFFFF",
        color: opts.header ? "#FFFFFF" : undefined,
        bold: opts.header || opts.summary,
        align: ["left", "right", "right", "right", "right", "right", "right"],
      });
      y += rowHeight;
    }

    drawRow(headers, { header: true });
    rows.forEach((r, i) => drawRow([r.name, r.delivered, r.sales, r.dlCharge, r.pending, r.cancelled, r.transferred], { zebra: i % 2 === 1 }));

    const totals = rows.reduce(
      (acc, r) => ({
        delivered: acc.delivered + r.delivered,
        sales: acc.sales + r.sales,
        dlCharge: acc.dlCharge + r.dlCharge,
        pending: acc.pending + r.pending,
        cancelled: acc.cancelled + r.cancelled,
        transferred: acc.transferred + r.transferred,
      }),
      { delivered: 0, sales: 0, dlCharge: 0, pending: 0, cancelled: 0, transferred: 0 }
    );
    drawRow(
      ["TOTAL", totals.delivered, totals.sales, totals.dlCharge, totals.pending, totals.cancelled, totals.transferred],
      { summary: true }
    );

    drawLetterheadFooter(doc);
    doc.end();
  })
);

export default router;
