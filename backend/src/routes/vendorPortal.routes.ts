import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticateVendor } from "../middleware/auth";
import { parseDateParam, monthRange, formatDate } from "../utils/dates";

const router = Router();
router.use(authenticateVendor);

router.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const vendorId = req.vendor!.sub;
    const where: Record<string, unknown> = { vendorId };

    if (req.query.from || req.query.to) {
      where.date = {
        ...(req.query.from ? { gte: parseDateParam(req.query.from as string) } : {}),
        ...(req.query.to ? { lte: parseDateParam(req.query.to as string) } : {}),
      };
    }
    if (req.query.status) where.status = req.query.status as string;
    if (req.query.cn) {
      const cnNum = Number(req.query.cn);
      if (!Number.isNaN(cnNum)) where.cnNo = cnNum;
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: [{ date: "desc" }, { slNo: "asc" }],
      take: 1000,
    });

    res.json({ orders });
  })
);

// Monthly summary + day-by-day breakdown, scoped to just this vendor.
router.get(
  "/monthly",
  asyncHandler(async (req, res) => {
    const vendorId = req.vendor!.sub;
    const { start, end, year, month } = monthRange(req.query.month as string | undefined);

    const orders = await prisma.order.findMany({
      where: { vendorId, date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
    });

    function summarize(list: typeof orders) {
      const delivered = list.filter((o) => o.status === "DELIVERED");
      return {
        totalOrders: list.length,
        delivered: delivered.length,
        pending: list.filter((o) => o.status === "PENDING").length,
        transferred: list.filter((o) => o.status === "TRANSFER").length,
        cancelled: list.filter((o) => o.status === "CANCELLED").length,
        totalSales: delivered.reduce((s, o) => s + o.total, 0),
        totalDeliveryCharge: delivered.reduce((s, o) => s + o.deliveryCharge, 0),
      };
    }

    const dateMap = new Map<string, typeof orders>();
    for (const o of orders) {
      const key = formatDate(o.date);
      const list = dateMap.get(key) ?? [];
      list.push(o);
      dateMap.set(key, list);
    }
    const dailyBreakdown = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({ date, ...summarize(list) }));

    res.json({
      month: `${year}-${String(month).padStart(2, "0")}`,
      summary: summarize(orders),
      dailyBreakdown,
    });
  })
);

// Same formula as the admin Vendor Credit page, scoped to just this vendor.
router.get(
  "/credit",
  asyncHandler(async (req, res) => {
    const vendorId = req.vendor!.sub;

    const allOrders = await prisma.order.findMany({
      where: { vendorId },
      select: { cnNo: true, status: true, total: true, deliveryCharge: true, date: true, createdAt: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    const seenCn = new Set<number>();
    const deduped = allOrders.filter((o) => {
      if (seenCn.has(o.cnNo)) return false;
      seenCn.add(o.cnNo);
      return true;
    });

    const totalAmount = deduped.reduce((s, o) => s + o.total, 0);
    const cancelledTotal = deduped.filter((o) => o.status === "CANCELLED").reduce((s, o) => s + o.total, 0);
    const totalDeliveryCharge = deduped
      .filter((o) => o.status === "DELIVERED")
      .reduce((s, o) => s + o.deliveryCharge, 0);

    const [paymentTotal, adjustmentTotal] = await Promise.all([
      prisma.vendorPayment.aggregate({ where: { vendorId }, _sum: { amount: true } }),
      prisma.vendorAdjustment.aggregate({ where: { vendorId }, _sum: { amount: true } }),
    ]);
    const totalPaid = paymentTotal._sum.amount ?? 0;
    const adjustment = adjustmentTotal._sum.amount ?? 0;

    const adjustedTotal = totalAmount + adjustment;
    const balance = adjustedTotal - cancelledTotal - totalDeliveryCharge - totalPaid;

    res.json({
      totalAmount: adjustedTotal,
      cancelledTotal,
      totalDeliveryCharge,
      totalPaid,
      balance,
    });
  })
);

router.get(
  "/credit/payments",
  asyncHandler(async (req, res) => {
    const vendorId = req.vendor!.sub;
    const payments = await prisma.vendorPayment.findMany({
      where: { vendorId },
      orderBy: { date: "desc" },
    });
    res.json(payments);
  })
);

export default router;
