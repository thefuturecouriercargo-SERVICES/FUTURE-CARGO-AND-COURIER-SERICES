import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";

const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

// Vendor credit = what's left to pay each vendor.
//   Balance = Total Amount (every consignment/order we've taken from them, any status)
//           - Cancelled Total (orders that never got delivered — no money involved)
//           - Delivery Charge Total (our fee, only counted once an order is actually Delivered)
//           - Paid Amount (manually logged payments)
// Pending/Transfer orders stay counted in Total Amount as-is (expected to convert to
// Delivered soon); once they do, their delivery charge gets deducted automatically.
//
// Safeguard: the same consignment (CN No) must never be counted twice for a vendor,
// even if it was accidentally entered more than once. Before totalling anything, orders
// are deduplicated by (vendorId, cnNo) — keeping only the most recent entry for each
// consignment number.
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });

    const allOrders = await prisma.order.findMany({
      select: { vendorId: true, cnNo: true, status: true, total: true, deliveryCharge: true, date: true, createdAt: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    // Dedupe: for a given vendor + CN No, keep only the most recent entry
    // (orderBy above means the first one seen per key is the most recent).
    const seenKeys = new Set<string>();
    const dedupedOrders = allOrders.filter((o) => {
      const key = `${o.vendorId}::${o.cnNo}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    const totalMap = new Map<string, number>();
    const cancelledMap = new Map<string, number>();
    const chargeMap = new Map<string, number>();

    for (const o of dedupedOrders) {
      totalMap.set(o.vendorId, (totalMap.get(o.vendorId) ?? 0) + o.total);
      if (o.status === "CANCELLED") {
        cancelledMap.set(o.vendorId, (cancelledMap.get(o.vendorId) ?? 0) + o.total);
      }
      if (o.status === "DELIVERED") {
        chargeMap.set(o.vendorId, (chargeMap.get(o.vendorId) ?? 0) + o.deliveryCharge);
      }
    }

    const paymentTotals = await prisma.vendorPayment.groupBy({
      by: ["vendorId"],
      _sum: { amount: true },
    });
    const paymentMap = new Map(paymentTotals.map((p) => [p.vendorId, p._sum.amount ?? 0]));

    const rows = vendors.map((v) => {
      const totalAmount = totalMap.get(v.id) ?? 0;
      const cancelledTotal = cancelledMap.get(v.id) ?? 0;
      const totalDeliveryCharge = chargeMap.get(v.id) ?? 0;
      const totalPaid = paymentMap.get(v.id) ?? 0;
      const balance = totalAmount - cancelledTotal - totalDeliveryCharge - totalPaid;
      return {
        vendor: { id: v.id, name: v.name, active: v.active },
        totalAmount,
        cancelledTotal,
        totalDeliveryCharge,
        totalPaid,
        balance,
      };
    });

    res.json(rows);
  })
);

router.get(
  "/:vendorId/payments",
  asyncHandler(async (req, res) => {
    const payments = await prisma.vendorPayment.findMany({
      where: { vendorId: req.params.vendorId },
      orderBy: { date: "desc" },
    });
    res.json(payments);
  })
);

const paymentSchema = z.object({
  date: z.string(),
  amount: z.number().int().positive(),
  note: z.string().max(300).optional(),
});

router.post(
  "/:vendorId/payments",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.vendorId } });
    if (!vendor) throw new ApiError(404, "Vendor not found");

    const data = paymentSchema.parse(req.body);
    const { start } = dayRange(data.date);
    const payment = await prisma.vendorPayment.create({
      data: { vendorId: req.params.vendorId, date: start, amount: data.amount, note: data.note },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "VENDOR_PAYMENT_CREATE",
      entity: "VendorPayment",
      entityId: payment.id,
      meta: { vendorId: req.params.vendorId, amount: data.amount },
    });
    emitGlobal("vendorPayment:changed", { type: "created", payment });
    res.status(201).json(payment);
  })
);

router.delete(
  "/payments/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.vendorPayment.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Payment entry not found");

    await prisma.vendorPayment.delete({ where: { id: req.params.id } });
    await writeAuditLog({
      userId: req.user!.sub,
      action: "VENDOR_PAYMENT_DELETE",
      entity: "VendorPayment",
      entityId: req.params.id,
    });
    emitGlobal("vendorPayment:changed", { type: "deleted", id: req.params.id });
    res.json({ deleted: true });
  })
);

export default router;
