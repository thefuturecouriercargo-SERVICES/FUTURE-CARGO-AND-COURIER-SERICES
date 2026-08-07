import { Router } from "express";
import { OrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange, monthRange } from "../utils/dates";
const router = Router();
router.use(authenticate, requireRole("DRIVER"));

router.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);
    const status = req.query.status as string | undefined;

    const orders = await prisma.order.findMany({
     where: {
  employeeId: req.user!.sub,
  OR: [
    { date: start },
  { status: { in: ["PENDING", "TRANSFER"] }, date: { lt: start } },
  ],
  ...(status ? { status: status as OrderStatus } : {}),
},
      include: { vendor: true, employee: { select: { id: true, name: true } } },
      orderBy: { slNo: "asc" },
    });

    res.json({ date: start.toISOString().slice(0, 10), orders });
  })
);

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);
const orders = await prisma.order.findMany({ where: { employeeId: req.user!.sub, OR: [{ date: start }, { status: { in: ["PENDING", "TRANSFER"] }, date: { lt: start } }] } });

    const delivered = orders.filter((o) => o.status === "DELIVERED");
    res.json({
      date: start.toISOString().slice(0, 10),
      assigned: orders.length,
      delivered: delivered.length,
      pending: orders.filter((o) => o.status === "PENDING").length,
      cancelled: orders.filter((o) => o.status === "CANCELLED").length,
      transferred: orders.filter((o) => o.status === "TRANSFER").length,
      deliveryChargeEarned: delivered.reduce((s, o) => s + o.deliveryCharge, 0),
      cashCollected: delivered.filter((o) => o.payment === "CASH").reduce((s, o) => s + o.total, 0),
      bankCollected: delivered.filter((o) => o.payment === "BANK").reduce((s, o) => s + o.total, 0),
    });
  })
);

router.get(
  "/payroll",
  asyncHandler(async (req, res) => {
    const month = req.query.month as string;
    if (!month) return res.status(400).json({ error: "month is required" });

    const employeeId = req.user!.sub;

    const [employee, payrollRow, entries] = await Promise.all([
      prisma.user.findUnique({ where: { id: employeeId }, select: { id: true, name: true, baseSalary: true } }),
      prisma.payroll.findUnique({ where: { month_employeeId: { month, employeeId } } }),
      prisma.payrollEntry.findMany({
        where: { month, employeeId },
        orderBy: { date: "desc" },
      }),
    ]);

    res.json({
      employee,
      workingDays: payrollRow?.workingDays ?? 30,
      entries,
    });
  })
);
router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);

    const orders = await prisma.order.findMany({
      where: { employeeId: req.user!.sub, date: start },
      include: { vendor: true, employee: { select: { id: true, name: true } } },
      orderBy: { slNo: "asc" },
    });

    const delivered = orders.filter((o) => o.status === "DELIVERED");
    res.json({
      date: start.toISOString().slice(0, 10),
      orders,
      summary: {
        total: orders.length,
        delivered: delivered.length,
        pending: orders.filter((o) => o.status === "PENDING").length,
        transferred: orders.filter((o) => o.status === "TRANSFER").length,
        cancelled: orders.filter((o) => o.status === "CANCELLED").length,
        totalSales: delivered.reduce((s, o) => s + o.total, 0),
        totalDeliveryCharge: delivered.reduce((s, o) => s + o.deliveryCharge, 0),
      },
    });
  })
);

router.get(
  "/performance",
  asyncHandler(async (req, res) => {
    const month = req.query.month as string;
    if (!month) return res.status(400).json({ error: "month is required" });
    const { start, end } = monthRange(month);

    const orders = await prisma.order.findMany({
      where: { employeeId: req.user!.sub, date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
    });

    const byDate = new Map<
      string,
      { date: string; delivered: number; pending: number; transferred: number; cancelled: number; totalSales: number; totalDeliveryCharge: number }
    >();

    for (const o of orders) {
      const key = o.date.toISOString().slice(0, 10);
      if (!byDate.has(key)) {
        byDate.set(key, {
          date: key,
          delivered: 0,
          pending: 0,
          transferred: 0,
          cancelled: 0,
          totalSales: 0,
          totalDeliveryCharge: 0,
        });
      }
      const row = byDate.get(key)!;
      if (o.status === "DELIVERED") {
        row.delivered += 1;
        row.totalSales += o.total;
        row.totalDeliveryCharge += o.deliveryCharge;
      } else if (o.status === "PENDING") {
        row.pending += 1;
      } else if (o.status === "TRANSFER") {
        row.transferred += 1;
      } else if (o.status === "CANCELLED") {
        row.cancelled += 1;
      }
    }

    const days = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    res.json({ month, days });
  })
);

export default router;
