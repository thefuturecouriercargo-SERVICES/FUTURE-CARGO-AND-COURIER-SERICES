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
