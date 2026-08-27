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

// Agent credit = what each agent still owes us.
//   Balance = Total Amount (every consignment/order the agent has taken, any status)
//           - Cancelled Total (orders that never got delivered — no money involved)
//           - Delivery Charge Total (the agent's own fee, only counted once Delivered —
//             this is money the agent keeps for themselves, not money owed to us)
//           - Paid Back (amount the agent has already handed back to us)
// This mirrors Vendor Credit, but the direction of the debt is reversed: here the
// agent owes the company, rather than the company owing a vendor.
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const agents = await prisma.user.findMany({ where: { isAgent: true }, orderBy: { name: "asc" } });

    const allOrders = await prisma.order.findMany({
      where: { employeeId: { in: agents.map((a) => a.id) } },
      select: { employeeId: true, status: true, total: true, deliveryCharge: true },
    });

    const totalMap = new Map<string, number>();
    const cancelledMap = new Map<string, number>();
    const chargeMap = new Map<string, number>();

    for (const o of allOrders) {
      totalMap.set(o.employeeId, (totalMap.get(o.employeeId) ?? 0) + o.total);
      if (o.status === "CANCELLED") {
        cancelledMap.set(o.employeeId, (cancelledMap.get(o.employeeId) ?? 0) + o.total);
      }
      if (o.status === "DELIVERED") {
        chargeMap.set(o.employeeId, (chargeMap.get(o.employeeId) ?? 0) + o.deliveryCharge);
      }
    }

    const paymentTotals = await prisma.agentPayment.groupBy({
      by: ["employeeId"],
      _sum: { amount: true },
    });
    const paymentMap = new Map(paymentTotals.map((p) => [p.employeeId, p._sum.amount ?? 0]));

    const rows = agents.map((a) => {
      const totalAmount = totalMap.get(a.id) ?? 0;
      const cancelledTotal = cancelledMap.get(a.id) ?? 0;
      const totalDeliveryCharge = chargeMap.get(a.id) ?? 0;
      const totalPaid = paymentMap.get(a.id) ?? 0;
      const balance = totalAmount - cancelledTotal - totalDeliveryCharge - totalPaid;
      return {
        agent: { id: a.id, name: a.name, active: a.active },
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
  "/:agentId/payments",
  asyncHandler(async (req, res) => {
    const payments = await prisma.agentPayment.findMany({
      where: { employeeId: req.params.agentId },
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
  "/:agentId/payments",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const agent = await prisma.user.findUnique({ where: { id: req.params.agentId } });
    if (!agent || !agent.isAgent) throw new ApiError(404, "Agent not found");

    const data = paymentSchema.parse(req.body);
    const { start } = dayRange(data.date);
    const payment = await prisma.agentPayment.create({
      data: { employeeId: req.params.agentId, date: start, amount: data.amount, note: data.note },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "AGENT_PAYMENT_CREATE",
      entity: "AgentPayment",
      entityId: payment.id,
      meta: { agentId: req.params.agentId, amount: data.amount },
    });
    emitGlobal("agentPayment:changed", { type: "created", payment });
    res.status(201).json(payment);
  })
);

router.delete(
  "/payments/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.agentPayment.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Payment entry not found");

    await prisma.agentPayment.delete({ where: { id: req.params.id } });
    await writeAuditLog({
      userId: req.user!.sub,
      action: "AGENT_PAYMENT_DELETE",
      entity: "AgentPayment",
      entityId: req.params.id,
    });
    emitGlobal("agentPayment:changed", { type: "deleted", id: req.params.id });
    res.json({ deleted: true });
  })
);

export default router;
