import { Router } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import { parseDateParam, formatDate } from "../utils/dates";
import { drawLetterheadHeader, drawLetterheadFooter } from "../utils/letterhead";

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

router.get(
  "/export",
  asyncHandler(async (req, res) => {
    const format = (req.query.format as string) ?? "excel";
    const where = buildWhere(req.query as Record<string, unknown>);

    const orders = await prisma.order.findMany({
      where,
      include: { vendor: true, employee: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { slNo: "asc" }],
      take: 50000,
    });

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
    const sumDl = rows.reduce((s, r) => s + r.dl, 0);
    const sumCancelled = rows.filter((r) => r.status === "CANCELLED").reduce((s, r) => s + r.total, 0);
    const balance = sumTotal - sumCancelled - sumDl;

    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="consignment-report.pdf"');

    const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
      doc.pipe(res);

      let y = drawLetterheadHeader(doc, "Consignment Report");
      doc.fontSize(9).fillColor("#555").text(`${rows.length} records`, doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });
      y = doc.y + 10;

      const colWidths = [55, 40, 55, 65, 60, 55, 55, 60, 65, 65];
      const startX = doc.page.margins.left;

      function drawRow(values: (string | number)[], bold = false) {
        let x = startX;
        doc.fontSize(8).fillColor("#000");
        values.forEach((v, i) => {
          doc.font(bold ? "Helvetica-Bold" : "Helvetica").text(String(v), x, y, { width: colWidths[i], ellipsis: true });
          x += colWidths[i];
        });
      y += 16;
        if (y > doc.page.height - doc.page.margins.bottom - 90) {
          drawLetterheadFooter(doc);
          doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
          y = doc.page.margins.top;
        }
      }

      drawRow(columns.map((c) => c.header), true);
      rows.forEach((r) => drawRow(columns.map((c) => (r as Record<string, unknown>)[c.key] as string | number)));

      // Totals summary at the end of the report.
      y += 6;
      drawRow(["", "", "", "TOTAL", sumTotal, sumDl, "", "", "", ""], true);
      drawRow(["", "", "", "CANCELLED", sumCancelled, "", "", "", "", ""], true);
      drawRow(["", "", "", "BALANCE (Total - Cancelled - DL Charge)", balance, "", "", "", "", ""], true);

      drawLetterheadFooter(doc);
      doc.end();
      return;
    }

    // Default: Excel export
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Future Courier Operations";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Consignment Report");
    sheet.columns = columns;
    sheet.getRow(1).font = { bold: true };
    rows.forEach((r) => sheet.addRow(r));

    // Totals summary at the end of the report.
    const totalRow = sheet.addRow({ brand: "TOTAL", total: sumTotal, dl: sumDl });
    totalRow.font = { bold: true };
    const cancelledRow = sheet.addRow({ brand: "CANCELLED", total: sumCancelled });
    cancelledRow.font = { bold: true };
    const balanceRow = sheet.addRow({ brand: "BALANCE (Total - Cancelled - DL Charge)", total: balance });
    balanceRow.font = { bold: true };

    sheet.autoFilter = { from: "A1", to: `J${rows.length + 1}` };

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
      function line(label: string, value: string, bold = false) {
        doc
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(11)
          .fillColor("#000")
          .text(label, left, y, { width: 300 })
          .text(value, left + 300, y, { width: 150, align: "right" });
        y += 20;
      }
      line("Revenue (Delivery Charge)", fmtAed(revenue));
      line("Total Expenses", fmtAed(totalExpenses));
      y += 6;
      line("Net Profit", fmtAed(netProfit), true);
      y += 20;

      doc.font("Helvetica-Bold").fontSize(12).text("Expense Breakdown by Category", left, y);
      y += 20;
      categoryBreakdown.forEach((c) => line(c.category, fmtAed(c.amount)));

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
      function drawRow(values: (string | number)[], bold = false) {
        let x = startX;
        doc.fontSize(8).fillColor("#000");
        values.forEach((v, i) => {
          doc.font(bold ? "Helvetica-Bold" : "Helvetica").text(String(v), x, y, { width: colWidths[i], ellipsis: true });
          x += colWidths[i];
        });
        y += 16;
        if (y > doc.page.height - doc.page.margins.bottom - 90) {
          drawLetterheadFooter(doc);
          doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
          y = doc.page.margins.top;
        }
      }

      drawRow(["Date", "Category", "Amount", "Remarks", "Employee", "Source"], true);
      rows.forEach((r) => drawRow([r.date, r.category, r.amount, r.remarks, r.employee, r.source]));

      y += 6;
      doc.font("Helvetica-Bold").fontSize(10).text("Category Totals", startX, y);
      y += 16;
      categoryTotals.forEach((c) => drawRow([c.category, "", c.amount, "", "", ""], true));
      drawRow(["GRAND TOTAL", "", grandTotal, "", "", ""], true);

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

    function drawRow(values: (string | number)[], bold = false) {
      let x = startX;
      values.forEach((v, i) => {
        doc
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9)
          .fillColor("#000")
          .text(String(v), x, y, { width: colWidths[i], align: i === 0 ? "left" : "right" });
        x += colWidths[i];
      });
      y += 18;
    }

    drawRow(headers, true);
    rows.forEach((r) => drawRow([r.name, r.delivered, r.sales, r.dlCharge, r.pending, r.cancelled, r.transferred]));

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
      true
    );

    drawLetterheadFooter(doc);
    doc.end();
  })
);

export default router;
