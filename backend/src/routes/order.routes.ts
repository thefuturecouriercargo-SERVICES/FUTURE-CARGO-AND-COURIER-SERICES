import { Router } from "express";
import PDFDocument from "pdfkit";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange, monthRange, formatDate } from "../utils/dates";
import { drawLetterheadHeader, drawLetterheadFooter } from "../utils/letterhead";
import { drawPdfRow, PDF_COLORS } from "../utils/pdfTable";
import { Order } from "@prisma/client";

const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

type OrderWithAgentFlag = Order & { employee?: { isAgent?: boolean } };

function summarize(orders: Order[]) {
  const delivered = orders.filter((o) => o.status === "DELIVERED");
  return {
    totalOrders: orders.length,
    // Total value of every item assigned that day, regardless of status — "how much
    // was handed over" as opposed to totalSales below (which is only what's Delivered).
    totalAssignedValue: orders.reduce((s, o) => s + o.total, 0),
    delivered: delivered.length,
    pending: orders.filter((o) => o.status === "PENDING").length,
    transferred: orders.filter((o) => o.status === "TRANSFER").length,
    cancelled: orders.filter((o) => o.status === "CANCELLED").length,
    totalSales: delivered.reduce((s, o) => s + o.total, 0),
    totalDeliveryCharge: delivered.reduce((s, o) => s + o.deliveryCharge, 0),
    cashCollected: delivered.filter((o) => o.payment === "CASH").reduce((s, o) => s + o.total, 0),
    bankCollected: delivered.filter((o) => o.payment === "BANK").reduce((s, o) => s + o.total, 0),
  };
}

// Agent employees' delivery charges are recorded (needed for vendor credit
// calculations) but must never count toward company revenue/profit.
function revenueDeliveryCharge(orders: OrderWithAgentFlag[]) {
  return orders
    .filter((o) => o.status === "DELIVERED" && !o.employee?.isAgent)
    .reduce((s, o) => s + o.deliveryCharge, 0);
}

 router.get(
  "/daily",
  asyncHandler(async (req, res) => {
    let where: { date: Date } | { date: { gte: Date; lte: Date } };
    let label: string;

    if (req.query.from || req.query.to) {
      const { start: fromStart } = dayRange(req.query.from as string | undefined);
      const { start: toStart } = dayRange(req.query.to as string | undefined);
      where = { date: { gte: fromStart, lte: toStart } };
      label = `${formatDate(fromStart)} to ${formatDate(toStart)}`;
    } else {
      const { start, date } = dayRange(req.query.date as string | undefined);
      where = { date: start };
      label = formatDate(date);
    }

    const rawOrders = await prisma.order.findMany({
      where,
      include: { vendor: true, employee: { select: { id: true, name: true, isAgent: true } } },
    });

    // Guard against duplicate CN No. entries (e.g. leftover double-entries from before
    // the creation-time duplicate check existed) inflating same-day counts. Carryover
    // already dedupes by CN, so the daily view must too — otherwise a duplicate that's
    // counted twice today silently collapses to one the moment it becomes "carryover"
    // tomorrow, making the pending count drop with no actual status change behind it.
    const seenCn = new Set<number>();
    const orders = [...rawOrders]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .filter((o) => {
        if (seenCn.has(o.cnNo)) return false;
        seenCn.add(o.cnNo);
        return true;
      });
const expenses = await prisma.expenseEntry.findMany({
      where: { ...where, source: "ADMIN" },
    });

   function expensesFor(employeeId: string) {
      return expenses
        .filter((e) => e.employeeId === employeeId && e.category !== "OTHER")
        .reduce((s, e) => s + e.amount, 0);
    }

    function otherDeductionFor(employeeId: string) {
      return expenses
        .filter((e) => e.employeeId === employeeId && e.category === "OTHER")
        .reduce((s, e) => s + e.amount, 0);
    }
    function otherDeductionEntriesFor(employeeId: string) {
      return expenses
        .filter((e) => e.employeeId === employeeId && e.category === "OTHER")
        .map((e) => ({ id: e.id, amount: e.amount }));
    }
    const employees = await prisma.user.findMany({ where: { role: "DRIVER", isAgent: false }, orderBy: { name: "asc" } });
 const employeeBreakdown = employees.map((e) => {
      const own = orders.filter((o) => o.employeeId === e.id);
      const ownSummary = summarize(own);
      const totalExpenses = expensesFor(e.id);
      const otherDeduction = otherDeductionFor(e.id);
      const otherDeductionEntries = otherDeductionEntriesFor(e.id);
      return {
        employee: { id: e.id, name: e.name },
        ...ownSummary,
        totalExpenses,
        otherDeduction,
        otherDeductionEntries,
        cashBalance: ownSummary.cashCollected - totalExpenses - otherDeduction,
      };
    }); 

    // Agents are tracked completely separately from drivers — their own performance,
    // cash collection, and delivery-charge totals never mix into the driver breakdown above.
    const agents = await prisma.user.findMany({ where: { isAgent: true }, orderBy: { name: "asc" } });
    const agentBreakdown = agents.map((a) => {
      const own = orders.filter((o) => o.employeeId === a.id);
      const ownSummary = summarize(own);
      const totalExpenses = expensesFor(a.id);
      const otherDeduction = otherDeductionFor(a.id);
      const otherDeductionEntries = otherDeductionEntriesFor(a.id);
      return {
        employee: { id: a.id, name: a.name },
        ...ownSummary,
        totalExpenses,
        otherDeduction,
        otherDeductionEntries,
        cashBalance: ownSummary.cashCollected - totalExpenses - otherDeduction,
      };
    });

    const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });
    const vendorBreakdown = vendors
      .map((v) => {
        const own = orders.filter((o) => o.vendorId === v.id);
        return { vendor: { id: v.id, name: v.name }, ...summarize(own) };
      })
      .filter((v) => v.totalOrders > 0);

    const emirateMap = new Map<string, Order[]>();
    for (const o of orders) {
      const list = emirateMap.get(o.emirate) ?? [];
      list.push(o);
      emirateMap.set(o.emirate, list);
    }
    const emirateBreakdown = Array.from(emirateMap.entries()).map(([emirate, own]) => ({
      emirate,
      ...summarize(own),
    }));

    const paymentBreakdown = [
      { method: "CASH", ...summarize(orders.filter((o) => o.payment === "CASH")) },
      { method: "BANK", ...summarize(orders.filter((o) => o.payment === "BANK")) },
    ];

 const totalExpensesAll = expenses.filter((e) => e.category !== "OTHER").reduce((s, e) => s + e.amount, 0);
    const totalOtherDeductionAll = expenses.filter((e) => e.category === "OTHER").reduce((s, e) => s + e.amount, 0);
    const overallSummary = summarize(orders);
    // Company revenue excludes delivery charge from agent employees (no delivery
    // charge is actually received on their orders — recorded only for vendor credit calc).
    const revenueDlCharge = revenueDeliveryCharge(orders);

    res.json({
      date: label,
      summary: {
        ...overallSummary,
        totalDeliveryCharge: revenueDlCharge,
        totalExpenses: totalExpensesAll,
        otherDeduction: totalOtherDeductionAll,
        netProfit: revenueDlCharge - totalExpensesAll - totalOtherDeductionAll,
        cashBalance: overallSummary.cashCollected - totalExpensesAll - totalOtherDeductionAll,
      },
      employeeBreakdown,
      agentBreakdown,
      vendorBreakdown,
      emirateBreakdown,
      paymentBreakdown,
      orders,
    });
  })
);

router.get(
  "/monthly",
  asyncHandler(async (req, res) => {
    const { start, end, year, month } = monthRange(req.query.month as string | undefined);
    const rawOrders = await prisma.order.findMany({
      where: { date: { gte: start, lte: end } },
      include: { vendor: true, employee: { select: { id: true, name: true, isAgent: true } } },
    });

    // Same duplicate-CN guard as /daily — keeps monthly totals consistent with
    // day-by-day and carryover figures.
    const seenCn = new Set<number>();
    const orders = [...rawOrders]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .filter((o) => {
        if (seenCn.has(o.cnNo)) return false;
        seenCn.add(o.cnNo);
        return true;
      });

    const employees = await prisma.user.findMany({ where: { role: "DRIVER", isAgent: false }, orderBy: { name: "asc" } });
    const employeeBreakdown = employees.map((e) => {
      const own = orders.filter((o) => o.employeeId === e.id);
      return { employee: { id: e.id, name: e.name }, ...summarize(own) };
    });

    // Agents get their own monthly breakdown, kept separate from the driver one above.
    const agents = await prisma.user.findMany({ where: { isAgent: true }, orderBy: { name: "asc" } });
    const agentBreakdown = agents.map((a) => {
      const own = orders.filter((o) => o.employeeId === a.id);
      return { employee: { id: a.id, name: a.name }, ...summarize(own) };
    });

    const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });
    const vendorBreakdown = vendors
      .map((v) => {
        const own = orders.filter((o) => o.vendorId === v.id);
        return { vendor: { id: v.id, name: v.name }, ...summarize(own) };
      })
      .filter((v) => v.totalOrders > 0);

    const emirateMap = new Map<string, Order[]>();
    for (const o of orders) {
      const list = emirateMap.get(o.emirate) ?? [];
      list.push(o);
      emirateMap.set(o.emirate, list);
    }
    const emirateBreakdown = Array.from(emirateMap.entries()).map(([emirate, own]) => ({
      emirate,
      ...summarize(own),
    }));

    const dateMap = new Map<string, Order[]>();
    for (const o of orders) {
      const key = formatDate(o.date);
      const list = dateMap.get(key) ?? [];
      list.push(o);
      dateMap.set(key, list);
    }
    const dailyBreakdown = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, own]) => ({ date, ...summarize(own) }));

    const paymentBreakdown = [
      { method: "CASH", ...summarize(orders.filter((o) => o.payment === "CASH")) },
      { method: "BANK", ...summarize(orders.filter((o) => o.payment === "BANK")) },
    ];

    const monthLabel = `${year}-${String(month).padStart(2, "0")}`;
    const overallSummary = { ...summarize(orders), totalDeliveryCharge: revenueDeliveryCharge(orders) };

    if (req.query.format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="monthly-dashboard-${monthLabel}.pdf"`);

      const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
      doc.pipe(res);

      let y = drawLetterheadHeader(doc, "Monthly Dashboard Report");
      doc.fontSize(11).fillColor(PDF_COLORS.navy).font("Helvetica-Bold").text(`Month: ${monthLabel}`, doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });
      y = doc.y + 14;

      const left = doc.page.margins.left;
      const boxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const boxGap = 10;
      const boxCount = 6;
      const boxW = (boxWidth - boxGap * (boxCount - 1)) / boxCount;
      const boxH = 50;
      function kpiBox(x: number, label: string, value: string | number) {
        doc.rect(x, y, boxW, boxH).fill(PDF_COLORS.zebra);
        doc.font("Helvetica").fontSize(8).fillColor(PDF_COLORS.inkSoft).text(label, x + 8, y + 8, { width: boxW - 16 });
        doc.font("Helvetica-Bold").fontSize(14).fillColor(PDF_COLORS.navy).text(String(value), x + 8, y + 22, { width: boxW - 16 });
      }
      kpiBox(left, "Total Orders", overallSummary.totalOrders);
      kpiBox(left + (boxW + boxGap) * 1, "Delivered", overallSummary.delivered);
      kpiBox(left + (boxW + boxGap) * 2, "Pending", overallSummary.pending);
      kpiBox(left + (boxW + boxGap) * 3, "Cancelled", overallSummary.cancelled);
      kpiBox(left + (boxW + boxGap) * 4, "Total Sales (AED)", overallSummary.totalSales.toLocaleString("en-US"));
      kpiBox(left + (boxW + boxGap) * 5, "Total DL Charge (AED)", overallSummary.totalDeliveryCharge.toLocaleString("en-US"));
      y += boxH + 20;

      function sectionTitle(label: string) {
        if (y > doc.page.height - doc.page.margins.bottom - 120) {
          drawLetterheadFooter(doc);
          doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
          y = doc.page.margins.top;
        }
        doc.rect(left, y - 4, boxWidth, 20).fill(PDF_COLORS.navy);
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#FFFFFF").text(label, left + 6, y);
        y += 22;
      }

      function table(headers: string[], colWidths: number[], rows: (string | number)[][], align?: ("left" | "right")[]) {
        function row(values: (string | number)[], opts: { header?: boolean; zebra?: boolean; summary?: boolean } = {}) {
          drawPdfRow(doc, left, y, 16, values, colWidths, {
            bg: opts.header ? PDF_COLORS.navy : opts.summary ? PDF_COLORS.brassLight : opts.zebra ? PDF_COLORS.zebra : "#FFFFFF",
            color: opts.header ? "#FFFFFF" : undefined,
            bold: opts.header || opts.summary,
            fontSize: 8,
            align: align ?? headers.map((_, i) => (i === 0 ? "left" : "right")),
          });
          y += 16;
          if (y > doc.page.height - doc.page.margins.bottom - 40) {
            drawLetterheadFooter(doc);
            doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
            y = doc.page.margins.top;
          }
        }
        row(headers, { header: true });
        rows.forEach((r, i) => row(r, { zebra: i % 2 === 1 }));
        y += 10;
      }

      sectionTitle("Employee-wise Deliveries & Charges");
      table(
        ["Employee", "Delivered", "Sales", "DL Charge"],
        [200, 130, 130, 130],
        employeeBreakdown.map((r) => [r.employee.name, r.delivered, r.totalSales.toLocaleString("en-US"), r.totalDeliveryCharge.toLocaleString("en-US")])
      );

      sectionTitle("Vendor-wise Deliveries & Charges");
      table(
        ["Vendor", "Delivered", "Sales", "DL Charge"],
        [200, 130, 130, 130],
        vendorBreakdown.map((r) => [r.vendor.name, r.delivered, r.totalSales.toLocaleString("en-US"), r.totalDeliveryCharge.toLocaleString("en-US")])
      );

      if (agentBreakdown.length > 0) {
        sectionTitle("Agent-wise Deliveries & Charges");
        table(
          ["Agent", "Delivered", "Sales", "DL Charge"],
          [200, 130, 130, 130],
          agentBreakdown.map((r) => [r.employee.name, r.delivered, r.totalSales.toLocaleString("en-US"), r.totalDeliveryCharge.toLocaleString("en-US")])
        );
      }

      sectionTitle("Emirate-wise Summary");
      table(
        ["Emirate", "Delivered", "Amount"],
        [200, 130, 130],
        emirateBreakdown.map((r) => [r.emirate, r.delivered, r.totalSales.toLocaleString("en-US")])
      );

      sectionTitle("Payment-wise Summary");
      table(
        ["Method", "Delivered", "Amount"],
        [200, 130, 130],
        paymentBreakdown.map((r) => [r.method, r.delivered, r.totalSales.toLocaleString("en-US")])
      );

      sectionTitle(`Daily Breakdown — ${monthLabel}`);
      table(
        ["Date", "Delivered", "Pending", "Transfer", "Cancelled", "Sales", "DL Charge"],
        [110, 90, 90, 90, 90, 110, 110],
        dailyBreakdown.map((r) => [
          r.date,
          r.delivered,
          r.pending,
          r.transferred,
          r.cancelled,
          r.totalSales.toLocaleString("en-US"),
          r.totalDeliveryCharge.toLocaleString("en-US"),
        ])
      );

      drawLetterheadFooter(doc);
      doc.end();
      return;
    }

    res.json({
      month: monthLabel,
      summary: overallSummary,
      employeeBreakdown,
      agentBreakdown,
      vendorBreakdown,
      emirateBreakdown,
      dailyBreakdown,
      paymentBreakdown,
    });
  })
);

export default router;
