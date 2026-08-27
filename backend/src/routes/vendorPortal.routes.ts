import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticateVendor } from "../middleware/auth";
import { parseDateParam } from "../utils/dates";

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

    const orders = await prisma.order.findMany({
      where,
      orderBy: [{ date: "desc" }, { slNo: "asc" }],
      take: 1000,
    });

    res.json({ orders });
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
