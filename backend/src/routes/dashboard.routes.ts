import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import { dayRange, monthRange, formatDate } from "../utils/dates";
import { Order } from "@prisma/client";

const router = Router();
router.use(authenticate);

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
    const { start, date } = dayRange(req.query.date as string | undefined);
    const orders = await prisma.order.findMany({
      where: { date: start },
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

    const paymentBreakdown = [
      { method: "CASH", ...summarize(orders.filter((o) => o.payment === "CASH")) },
      { method: "BANK", ...summarize(orders.filter((o) => o.payment === "BANK")) },
    ];

    res.json({
      date: formatDate(date),
      summary: summarize(orders),
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
