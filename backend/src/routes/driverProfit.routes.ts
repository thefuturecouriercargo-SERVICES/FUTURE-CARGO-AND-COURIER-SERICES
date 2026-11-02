import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { salariesForMonth } from "../lib/salary";

/**
 * P&L → Driver daily profit.
 * For each driver and each day of the month:
 *   delivery charges of his DELIVERED orders
 * − salary ÷ 30 (salary for that month, from Payroll salary history)
 * − his own expenses that day (fuel, Salik, parking… — SALARY entries left out,
 *   since salary is already counted per day)
 * = profit for the day
 */
const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

function dubaiToday() {
  const d = new Date(Date.now() + DUBAI_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const today = dubaiToday();
    const month =
      typeof req.query.month === "string" && req.query.month
        ? req.query.month
        : `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, "Month must be YYYY-MM");

    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0));
    if (start > today) throw new ApiError(400, "That month hasn't started yet");
    const end = monthEnd < today ? monthEnd : today; // running month: up to today
    const range = { gte: start, lte: end };

    const [orderGroups, expenseRows, drivers] = await Promise.all([
      prisma.order.groupBy({
        by: ["employeeId", "date"],
        where: { date: range, status: "DELIVERED", employee: { isAgent: false } },
        _sum: { deliveryCharge: true },
        _count: { _all: true },
      }),
      prisma.expenseEntry.groupBy({
        by: ["employeeId", "date", "category"],
        where: { date: range, employeeId: { not: null }, category: { not: "SALARY" } },
        _sum: { amount: true },
      }),
      prisma.user.findMany({
        where: { role: "DRIVER", isAgent: false },
        select: { id: true, name: true, active: true, baseSalary: true },
        orderBy: { name: "asc" },
      }),
    ]);

    const salaryHistory = await salariesForMonth(
      month,
      drivers.map((d) => d.id)
    );

    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const delBy = new Map<string, { delivered: number; charges: number }>();
    for (const g of orderGroups) {
      delBy.set(`${g.employeeId}|${dayKey(g.date)}`, { delivered: g._count._all, charges: g._sum.deliveryCharge ?? 0 });
    }
    const expBy = new Map<string, Record<string, number>>();
    for (const g of expenseRows) {
      if (!g.employeeId) continue;
      const k = `${g.employeeId}|${dayKey(g.date)}`;
      const cur = expBy.get(k) ?? {};
      cur[g.category] = (cur[g.category] ?? 0) + (g._sum.amount ?? 0);
      expBy.set(k, cur);
    }

    const dates: Date[] = [];
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) dates.push(d);

    const out = [];
    for (const drv of drivers) {
      const hadActivity = dates.some((d) => delBy.has(`${drv.id}|${dayKey(d)}`) || expBy.has(`${drv.id}|${dayKey(d)}`));
      // Inactive drivers only show if they worked in this month.
      if (!drv.active && !hadActivity) continue;
      const salary = salaryHistory[drv.id] ?? drv.baseSalary;
      if (salary === 0 && !hadActivity) continue;
      const dailySalary = Math.round((salary / 30) * 100) / 100;

      let tDelivered = 0,
        tCharges = 0,
        tExpenses = 0,
        tSalary = 0,
        profitDays = 0,
        lossDays = 0;
      const tByCat: Record<string, number> = {};
      const days = dates.map((d) => {
        const k = `${drv.id}|${dayKey(d)}`;
        const del = delBy.get(k) ?? { delivered: 0, charges: 0 };
        const byCat = expBy.get(k) ?? {};
        const expenses = Object.values(byCat).reduce((t, v) => t + v, 0);
        const profit = Math.round((del.charges - dailySalary - expenses) * 100) / 100;
        tDelivered += del.delivered;
        tCharges += del.charges;
        tExpenses += expenses;
        tSalary += dailySalary;
        for (const [c, v] of Object.entries(byCat)) tByCat[c] = (tByCat[c] ?? 0) + v;
        if (del.delivered > 0) {
          if (profit >= 0) profitDays++;
          else lossDays++;
        }
        return {
          date: dayKey(d),
          weekday: d.getUTCDay(),
          delivered: del.delivered,
          charges: del.charges,
          salary: dailySalary,
          expenses,
          expenseByCategory: byCat,
          profit,
        };
      });
      const workedDays = profitDays + lossDays;
      out.push({
        id: drv.id,
        name: drv.name,
        salary,
        dailySalary,
        days,
        totals: {
          delivered: tDelivered,
          charges: tCharges,
          salary: Math.round(tSalary),
          expenses: tExpenses,
          expenseByCategory: tByCat,
          profit: Math.round(tCharges - tSalary - tExpenses),
          workedDays,
          profitDays,
          lossDays,
          avgPerWorkedDay: workedDays ? Math.round((tDelivered / workedDays) * 10) / 10 : 0,
          // Deliveries a day he needs to cover salary + his average daily expenses.
          breakEvenPerDay:
            tDelivered && workedDays
              ? Math.round(((dailySalary * dates.length + tExpenses) / workedDays / (tCharges / tDelivered)) * 10) / 10
              : null,
        },
      });
    }

    out.sort((a, b) => b.totals.profit - a.totals.profit);
    res.json({ month, from: dayKey(start), to: dayKey(end), isRunning: end < monthEnd, drivers: out });
  })
);

export default router;
