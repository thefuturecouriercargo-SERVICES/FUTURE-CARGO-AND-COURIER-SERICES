import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticateVendor } from "../middleware/auth";
import { parseDateParam, monthRange, formatDate, dayRange } from "../utils/dates";

const router = Router();
router.use(authenticateVendor);

// Converts a timestamp to its Dubai calendar date (midnight UTC of that day).
function toDubaiDateOnly(d: Date): number {
  const dubaiOffsetMs = 4 * 60 * 60 * 1000;
  const shifted = new Date(d.getTime() + dubaiOffsetMs);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

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

// Same date-wise ledger the admin Vendor Credit page uses, scoped to just this vendor.
//   Opening Amount    = running Total Amount from everything BEFORE the selected date
//   Opening Cancelled = running Cancelled Total from before the selected date
//   Today Amount / Today Cancelled = just the selected date's own activity
//   Total Amount (running through selected date) = Opening Amount + Today Amount
router.get(
  "/credit",
  asyncHandler(async (req, res) => {
    const vendorId = req.vendor!.sub;
    const { start: selectedDate } = dayRange(req.query.date as string | undefined);

    const allOrders = await prisma.order.findMany({
      where: { vendorId, date: { lte: selectedDate } },
      select: { cnNo: true, status: true, total: true, deliveryCharge: true, date: true, createdAt: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    const seenCn = new Set<number>();
    const deduped = allOrders.filter((o) => {
      if (seenCn.has(o.cnNo)) return false;
      seenCn.add(o.cnNo);
      return true;
    });

    let openingAmount = 0;
    let openingCancelled = 0;
    let openingCharge = 0;
    let todayAmount = 0;
    let todayCancelled = 0;
    let todayCharge = 0;
    // Delivered-only figures, tracked separately — Balance for just what's actually
    // Delivered (Total − Delivery Charge), not the overall running Balance above.
    let openingDeliveredAmount = 0;
    let openingDeliveredCharge = 0;
    let todayDeliveredAmount = 0;
    let todayDeliveredCharge = 0;

    for (const o of deduped) {
      // Same rule as the admin Vendor Credit page: "today" means genuinely entered
      // today, not just resolved today (which would bump `date` forward).
      const isToday = toDubaiDateOnly(o.createdAt) === selectedDate.getTime();
      if (isToday) {
        todayAmount += o.total;
        if (o.status === "CANCELLED") todayCancelled += o.total;
        // Delivery charge deducted for anything not Cancelled (Pending/Transfer
        // included), matching the same rule used on the admin Vendor Credit page.
        else todayCharge += o.deliveryCharge;
      } else {
        openingAmount += o.total;
        if (o.status === "CANCELLED") openingCancelled += o.total;
        else openingCharge += o.deliveryCharge;
      }
      if (o.status === "DELIVERED") {
        if (isToday) {
          todayDeliveredAmount += o.total;
          todayDeliveredCharge += o.deliveryCharge;
        } else {
          openingDeliveredAmount += o.total;
          openingDeliveredCharge += o.deliveryCharge;
        }
      }
    }

    const [openingPayments, todayPayments, openingAdjustments, todayAdjustments] = await Promise.all([
      prisma.vendorPayment.aggregate({ where: { vendorId, date: { lt: selectedDate } }, _sum: { amount: true } }),
      prisma.vendorPayment.aggregate({ where: { vendorId, date: selectedDate }, _sum: { amount: true } }),
      prisma.vendorAdjustment.aggregate({ where: { vendorId, date: { lt: selectedDate } }, _sum: { amount: true } }),
      prisma.vendorAdjustment.aggregate({ where: { vendorId, date: selectedDate }, _sum: { amount: true } }),
    ]);

    const openingAdj = openingAdjustments._sum.amount ?? 0;
    const todayAdj = todayAdjustments._sum.amount ?? 0;
    openingAmount += openingAdj;
    todayAmount += todayAdj;

    const openingPaid = openingPayments._sum.amount ?? 0;
    const todayPaid = todayPayments._sum.amount ?? 0;

    const totalAmount = openingAmount + todayAmount;
    const cancelledTotal = openingCancelled + todayCancelled;
    const totalDeliveryCharge = openingCharge + todayCharge;
    const totalPaid = openingPaid + todayPaid;
    const balance = totalAmount - cancelledTotal - totalDeliveryCharge - totalPaid;

    // Delivered-only balance: what's actually been Delivered, minus its own delivery
    // charge, minus what's already been paid — decreases as payments come in, just
    // like the overall Balance above.
    const deliveredTotal = openingDeliveredAmount + todayDeliveredAmount;
    const deliveredCharge = openingDeliveredCharge + todayDeliveredCharge;
    const deliveredBalance = deliveredTotal - deliveredCharge - totalPaid;

    res.json({
      openingAmount,
      openingCancelled,
      todayAmount,
      todayCancelled,
      totalAmount,
      cancelledTotal,
      totalDeliveryCharge,
      totalPaid,
      balance,
      deliveredTotal,
      deliveredCharge,
      deliveredBalance,
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
