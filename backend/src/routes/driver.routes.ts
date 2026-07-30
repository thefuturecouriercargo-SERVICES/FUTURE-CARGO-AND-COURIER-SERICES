import { Router } from "express";
import { OrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange } from "../utils/dates";

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
    { status: "PENDING", date: { lt: start } },
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
  const orders = await prisma.order.findMany({ where: { employeeId: req.user!.sub, OR: [{ date: start }, { status: "PENDING", date: { lt: start } }] } });

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

export default router;
