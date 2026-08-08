import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange, monthRange, formatDate } from "../utils/dates";
import { Order } from "@prisma/client";

const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

function summarize(orders: Order[]) {
  const delivered = orders.filter((o) => o.status === "DELIVERED");
  return {
    totalOrders: orders.length,
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

    const orders = await prisma.order.findMany({
      where,
      include: { vendor: true, employee: { select: { id: true, name: true } } },
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
    const employees = await prisma.user.findMany({ where: { role: "DRIVER" }, orderBy: { name: "asc" } });
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

    res.json({
      date: label,
      summary: {
        ...overallSummary,
        totalExpenses: totalExpensesAll,
        otherDeduction: totalOtherDeductionAll,
        cashBalance: overallSummary.cashCollected - totalExpensesAll - totalOtherDeductionAll,
      },
      employeeBreakdown,
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
    const orders = await prisma.order.findMany({
      where: { date: { gte: start, lte: end } },
      include: { vendor: true, employee: { select: { id: true, name: true } } },
    });

    const employees = await prisma.user.findMany({ where: { role: "DRIVER" }, orderBy: { name: "asc" } });
    const employeeBreakdown = employees.map((e) => {
      const own = orders.filter((o) => o.employeeId === e.id);
      return { employee: { id: e.id, name: e.name }, ...summarize(own) };
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

    res.json({
      month: `${year}-${String(month).padStart(2, "0")}`,
      summary: summarize(orders),
      employeeBreakdown,
      vendorBreakdown,
      emirateBreakdown,
      dailyBreakdown,
      paymentBreakdown,
    });
  })
);

export default router;
