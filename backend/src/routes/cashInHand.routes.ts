import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { writeAuditLog } from "../services/audit.service";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { drawLetterheadHeader, drawLetterheadFooter } from "../utils/letterhead";
import { drawPdfRow, PDF_COLORS } from "../utils/pdfTable";

/**
 * P&L → Cash in hand.
 *   Profit (each month from September 2026, same formula as the P&L page:
 *   delivery charges of delivered orders, agents excluded, minus expenses)
 * + Manual entry
 * − Daily cost (rate × working days, Sundays not counted; editable per month)
 * = Cash in hand
 */
const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

const START_MONTH = "2026-09";
const DEFAULT_RATE = 200;
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

function dubaiToday() {
  const d = new Date(Date.now() + DUBAI_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function monthsFromStart(today: Date) {
  const out: string[] = [];
  let [y, m] = START_MONTH.split("-").map(Number);
  const endKey = today.getUTCFullYear() * 12 + today.getUTCMonth();
  while (y * 12 + (m - 1) <= endKey) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Days that are not Sunday, from the 1st up to `until` (inclusive). */
function nonSundays(year: number, month: number, until: Date) {
  let n = 0;
  for (let d = new Date(Date.UTC(year, month - 1, 1)); d.getUTCMonth() === month - 1 && d <= until; d = new Date(d.getTime() + 86400000)) {
    if (d.getUTCDay() !== 0) n++;
  }
  return n;
}

/** Every month from START_MONTH to now, with profit, daily cost, and the running cash position. */
async function computeCashMonths() {
  const today = dubaiToday();
  const months = monthsFromStart(today);
  const [saved, manual] = await Promise.all([
    prisma.cashInHandMonth.findMany({ where: { month: { in: months } } }),
    prisma.cashInHandManual.findUnique({ where: { id: 1 } }),
  ]);
  const savedBy = new Map(saved.map((s) => [s.month, s]));
  const manualAmount = manual?.amount ?? 0;

  // The manual entry has no date of its own, so it is treated as the opening
  // balance at the start of the first month. Each month then closes at:
  // opening + revenue − expenses − daily cost, and that becomes next month's opening.
  let running = manualAmount;
  const rows = [];
  for (const month of months) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0));
    const isCurrent = today >= start && today <= end;

    const [delivered, expenseGroups] = await Promise.all([
      prisma.order.aggregate({
        where: { date: { gte: start, lte: end }, status: "DELIVERED", employee: { isAgent: false } },
        _sum: { deliveryCharge: true },
        _count: { _all: true },
      }),
      prisma.expenseEntry.groupBy({ by: ["category"], where: { date: { gte: start, lte: end } }, _sum: { amount: true } }),
    ]);
    const revenue = delivered._sum.deliveryCharge ?? 0;
    const expenseCategories = expenseGroups
      .map((g) => ({ category: g.category, amount: g._sum.amount ?? 0 }))
      .filter((c) => c.amount !== 0)
      .sort((a, b) => b.amount - a.amount);
    const expense = expenseCategories.reduce((t, c) => t + c.amount, 0);
    const profit = revenue - expense;

    const s = savedBy.get(month);
    // Whole month for past months; up to today for the running month.
    const autoDays = nonSundays(y, m, isCurrent ? today : end);
    const workingDays = s?.workingDays ?? autoDays;
    const dailyRate = s?.dailyRate ?? DEFAULT_RATE;
    const calcCost = workingDays * dailyRate;
    const costOverride = s?.costOverride ?? null;
    const dailyCost = costOverride ?? calcCost;
    const netForMonth = profit - dailyCost;
    const openingCash = running;
    running += netForMonth;
    rows.push({
      month,
      revenue,
      deliveredCount: delivered._count._all,
      expenses: expense,
      expenseCategories,
      profit,
      autoDays,
      workingDays,
      daysEdited: s?.workingDays != null,
      dailyRate,
      calcCost,
      costEdited: costOverride != null,
      dailyCost,
      netForMonth,
      openingCash,
      closingCash: running,
      isCurrent,
    });
  }

  const totalProfit = rows.reduce((t, r) => t + r.profit, 0);
  const totalDailyCost = rows.reduce((t, r) => t + r.dailyCost, 0);
  return {
    startMonth: START_MONTH,
    months: rows,
    totalProfit,
    manual: { amount: manualAmount, note: manual?.note ?? "", updatedAt: manual?.updatedAt ?? null },
    totalDailyCost,
    cashInHand: totalProfit + manualAmount - totalDailyCost,
  };
}

const monthLabel = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};
const aed = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await computeCashMonths());
  })
);

/**
 * Monthly P&L statement for officials — one month (?month=YYYY-MM) or all months.
 * ?format=pdf | excel downloads it; otherwise JSON.
 */
router.get(
  "/statement",
  asyncHandler(async (req, res) => {
    const data = await computeCashMonths();
    const only = typeof req.query.month === "string" ? req.query.month : undefined;
    const rows = only ? data.months.filter((r) => r.month === only) : data.months;
    if (only && rows.length === 0) throw new ApiError(404, "No statement for that month");
    const format = req.query.format as string | undefined;
    const fileBase = only ? `pnl-statement-${only}` : "pnl-statement-all-months";

    if (format === "excel") {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Future Courier Operations";
      const sheet = workbook.addWorksheet("Monthly P&L");
      sheet.columns = [
        { header: "Month", key: "month", width: 18 },
        { header: "Opening Cash", key: "opening", width: 15 },
        { header: "Revenue (DL Charges)", key: "revenue", width: 20 },
        { header: "Expenses", key: "expenses", width: 13 },
        { header: "Gross Profit", key: "profit", width: 14 },
        { header: "Daily Cost", key: "daily", width: 13 },
        { header: "Net for Month", key: "net", width: 15 },
        { header: "Cash in Hand (Month End)", key: "closing", width: 24 },
      ];
      sheet.getRow(1).font = { bold: true };
      for (const r of rows) {
        sheet.addRow({
          month: monthLabel(r.month) + (r.isCurrent ? " (to date)" : ""),
          opening: r.openingCash,
          revenue: r.revenue,
          expenses: r.expenses,
          profit: r.profit,
          daily: r.dailyCost,
          net: r.netForMonth,
          closing: r.closingCash,
        });
      }
      sheet.getColumn("closing").font = { bold: true };
      sheet.getColumn(1).font = {};
      for (let c = 2; c <= 8; c++) sheet.getColumn(c).numFmt = "#,##0;-#,##0";

      const cat = workbook.addWorksheet("Expenses by Category");
      cat.columns = [
        { header: "Month", key: "month", width: 18 },
        { header: "Category", key: "category", width: 28 },
        { header: "Amount (AED)", key: "amount", width: 15 },
      ];
      cat.getRow(1).font = { bold: true };
      for (const r of rows) for (const c of r.expenseCategories) cat.addRow({ month: monthLabel(r.month), category: c.category, amount: c.amount });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
      return;
    }

    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.pdf"`);
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      doc.pipe(res);
      const left = doc.page.margins.left;
      const width = doc.page.width - left - doc.page.margins.right;
      const bottomLimit = doc.page.height - 110;

      let y = drawLetterheadHeader(doc, "Monthly Profit & Loss Statement");
      const periodText = only
        ? `Period: ${monthLabel(only)}${rows[0].isCurrent ? " (month to date)" : ""}`
        : `Period: ${monthLabel(rows[0].month)} to ${monthLabel(rows[rows.length - 1].month)}`;
      doc.font("Helvetica").fontSize(9).fillColor(PDF_COLORS.inkSoft).text(periodText, left, y, { width, align: "center" });
      doc.text("All amounts in AED", left, doc.y + 2, { width, align: "center" });
      y = doc.y + 14;

      const newPageIfNeeded = (h: number) => {
        if (y + h > bottomLimit) {
          drawLetterheadFooter(doc);
          doc.addPage();
          y = drawLetterheadHeader(doc, "Monthly Profit & Loss Statement");
        }
      };
      const band = (title: string) => {
        newPageIfNeeded(30);
        doc.rect(left, y - 4, width, 22).fill(PDF_COLORS.navy);
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#FFFFFF").text(title, left + 6, y + 1);
        y += 24;
      };

      // 1) Summary table — every month with its month-end cash in hand.
      if (!only) {
        band("Summary — Cash in Hand at Month End");
        const cols = [width - 6 * 70, 70, 70, 70, 70, 70, 70];
        drawPdfRow(doc, left, y, 18, ["Month", "Opening", "Revenue", "Expenses", "Daily Cost", "Net", "Cash in Hand"], cols, {
          bg: PDF_COLORS.zebra, bold: true, align: ["left", "right", "right", "right", "right", "right", "right"],
        });
        y += 18;
        for (const r of rows) {
          newPageIfNeeded(18);
          drawPdfRow(
            doc, left, y, 18,
            [monthLabel(r.month) + (r.isCurrent ? " *" : ""), aed(r.openingCash), aed(r.revenue), aed(r.expenses), aed(r.dailyCost), aed(r.netForMonth), aed(r.closingCash)],
            cols, { align: ["left", "right", "right", "right", "right", "right", "right"] }
          );
          y += 18;
        }
        if (rows.some((r) => r.isCurrent)) {
          doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(PDF_COLORS.inkSoft).text("* Current month — figures to date, not final.", left, y + 2);
          y = doc.y + 6;
        }
        y += 10;
      }

      // 2) One statement block per month.
      for (const r of rows) {
        const lines = 9 + r.expenseCategories.length;
        newPageIfNeeded(Math.min(lines * 17 + 40, 400));
        band(`${monthLabel(r.month)}${r.isCurrent ? " — month to date" : ""}`);
        const cols = [width - 130, 130];
        const line = (label: string, value: string, opts: { bold?: boolean; indent?: boolean; bg?: string; color?: string } = {}) => {
          newPageIfNeeded(17);
          drawPdfRow(doc, left, y, 17, [(opts.indent ? "      " : "") + label, value], cols, {
            bold: opts.bold, bg: opts.bg, color: opts.color, align: ["left", "right"],
          });
          y += 17;
        };
        line("Opening cash (start of month)", aed(r.openingCash), { bg: PDF_COLORS.zebra });
        line(`Revenue — delivery charges (${r.deliveredCount} delivered orders)`, aed(r.revenue), { bold: true });
        line("Less: Expenses", aed(-r.expenses), { bold: true });
        if (r.expenseCategories.length === 0) line("No expenses recorded", "0", { indent: true, color: PDF_COLORS.inkSoft });
        for (const c of r.expenseCategories) line(c.category, aed(c.amount), { indent: true, color: PDF_COLORS.inkSoft });
        line("Gross profit", aed(r.profit), { bold: true, bg: PDF_COLORS.zebra });
        line(`Less: Daily cost (${r.costEdited ? "fixed amount" : `${r.workingDays} working days × ${aed(r.dailyRate)}`})`, aed(-r.dailyCost));
        line("Net for the month", aed(r.netForMonth), {
          bold: true, bg: r.netForMonth >= 0 ? PDF_COLORS.deliveredBg : PDF_COLORS.cancelledBg,
          color: r.netForMonth >= 0 ? PDF_COLORS.delivered : PDF_COLORS.cancelled,
        });
        newPageIfNeeded(24);
        doc.rect(left, y - 4, width, 22).fill(PDF_COLORS.brass);
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#FFFFFF")
          .text(r.isCurrent ? "CASH IN HAND (as of today)" : "CASH IN HAND AT MONTH END", left + 6, y + 1, { width: width - 140 })
          .text(`${aed(r.closingCash)} AED`, left + width - 136, y + 1, { width: 130, align: "right" });
        y += 34;
      }

      drawLetterheadFooter(doc);
      doc.end();
      return;
    }

    res.json({ ...data, months: rows });
  })
);

const monthSchema = z.object({
  // null = back to automatic (days that are not Sunday)
  workingDays: z.number().int().min(0).max(31).nullable().optional(),
  dailyRate: z.number().int().min(0).max(100000).optional(),
  // null = back to working days × per day
  costOverride: z.number().int().min(0).max(10000000).nullable().optional(),
});

router.put(
  "/month/:month",
  asyncHandler(async (req, res) => {
    const month = req.params.month;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, "Month must be YYYY-MM");
    const data = monthSchema.parse(req.body);
    const row = await prisma.cashInHandMonth.upsert({
      where: { month },
      create: { month, workingDays: data.workingDays ?? null, dailyRate: data.dailyRate ?? DEFAULT_RATE, costOverride: data.costOverride ?? null },
      update: {
        ...(data.workingDays !== undefined ? { workingDays: data.workingDays } : {}),
        ...(data.dailyRate !== undefined ? { dailyRate: data.dailyRate } : {}),
        ...(data.costOverride !== undefined ? { costOverride: data.costOverride } : {}),
      },
    });
    await writeAuditLog({ userId: req.user!.sub, action: "UPDATE", entity: "CashInHandMonth", entityId: month, meta: data });
    res.json(row);
  })
);

const manualSchema = z.object({ amount: z.number().int().min(-10000000).max(10000000), note: z.string().max(300).optional() });

router.put(
  "/manual",
  asyncHandler(async (req, res) => {
    const { amount, note } = manualSchema.parse(req.body);
    const row = await prisma.cashInHandManual.upsert({
      where: { id: 1 },
      create: { id: 1, amount, note: note || null },
      update: { amount, note: note || null },
    });
    await writeAuditLog({ userId: req.user!.sub, action: "UPDATE", entity: "CashInHandManual", entityId: "1", meta: { amount, note } });
    res.json(row);
  })
);

export default router;
