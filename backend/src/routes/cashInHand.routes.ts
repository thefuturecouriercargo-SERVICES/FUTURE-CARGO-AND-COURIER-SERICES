import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { writeAuditLog } from "../services/audit.service";

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

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const today = dubaiToday();
    const months = monthsFromStart(today);
    const [saved, manual] = await Promise.all([
      prisma.cashInHandMonth.findMany({ where: { month: { in: months } } }),
      prisma.cashInHandManual.findUnique({ where: { id: 1 } }),
    ]);
    const savedBy = new Map(saved.map((s) => [s.month, s]));

    const rows = [];
    for (const month of months) {
      const [y, m] = month.split("-").map(Number);
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 0));
      const isCurrent = today >= start && today <= end;

      const [delivered, expenses] = await Promise.all([
        prisma.order.aggregate({
          where: { date: { gte: start, lte: end }, status: "DELIVERED", employee: { isAgent: false } },
          _sum: { deliveryCharge: true },
        }),
        prisma.expenseEntry.aggregate({ where: { date: { gte: start, lte: end } }, _sum: { amount: true } }),
      ]);
      const revenue = delivered._sum.deliveryCharge ?? 0;
      const expense = expenses._sum.amount ?? 0;
      const profit = revenue - expense;

      const s = savedBy.get(month);
      // Whole month for past months; up to today for the running month.
      const autoDays = nonSundays(y, m, isCurrent ? today : end);
      const workingDays = s?.workingDays ?? autoDays;
      const dailyRate = s?.dailyRate ?? DEFAULT_RATE;
      rows.push({
        month,
        revenue,
        expenses: expense,
        profit,
        autoDays,
        workingDays,
        daysEdited: s?.workingDays != null,
        dailyRate,
        dailyCost: workingDays * dailyRate,
        isCurrent,
      });
    }

    const totalProfit = rows.reduce((t, r) => t + r.profit, 0);
    const totalDailyCost = rows.reduce((t, r) => t + r.dailyCost, 0);
    const manualAmount = manual?.amount ?? 0;
    res.json({
      startMonth: START_MONTH,
      months: rows,
      totalProfit,
      manual: { amount: manualAmount, note: manual?.note ?? "", updatedAt: manual?.updatedAt ?? null },
      totalDailyCost,
      cashInHand: totalProfit + manualAmount - totalDailyCost,
    });
  })
);

const monthSchema = z.object({
  // null = back to automatic (days that are not Sunday)
  workingDays: z.number().int().min(0).max(31).nullable().optional(),
  dailyRate: z.number().int().min(0).max(100000).optional(),
});

router.put(
  "/month/:month",
  asyncHandler(async (req, res) => {
    const month = req.params.month;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, "Month must be YYYY-MM");
    const data = monthSchema.parse(req.body);
    const row = await prisma.cashInHandMonth.upsert({
      where: { month },
      create: { month, workingDays: data.workingDays ?? null, dailyRate: data.dailyRate ?? DEFAULT_RATE },
      update: {
        ...(data.workingDays !== undefined ? { workingDays: data.workingDays } : {}),
        ...(data.dailyRate !== undefined ? { dailyRate: data.dailyRate } : {}),
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
