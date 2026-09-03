import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";

const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

// New-entries report: for a given day, how many genuinely new consignments each
// agent got. "New" means created that day — not orders merely carried over or
// resolved that day. Same rule used on the Vendor Credit page's equivalent report.
router.get(
  "/new-entries",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const agents = await prisma.user.findMany({ where: { isAgent: true }, select: { id: true, name: true } });
    const agentIds = agents.map((a) => a.id);

    const orders = await prisma.order.findMany({
      where: { employeeId: { in: agentIds }, createdAt: { gte: start, lt: end } },
      select: { employeeId: true, total: true, cnNo: true },
    });

    const seenCn = new Set<number>();
    const grouped = new Map<string, { agentId: string; agentName: string; count: number; totalAmount: number }>();

    for (const o of orders) {
      if (seenCn.has(o.cnNo)) continue;
      seenCn.add(o.cnNo);
      const agent = agents.find((a) => a.id === o.employeeId);
      if (!agent) continue;
      const existing = grouped.get(o.employeeId) ?? { agentId: o.employeeId, agentName: agent.name, count: 0, totalAmount: 0 };
      existing.count += 1;
      existing.totalAmount += o.total;
      grouped.set(o.employeeId, existing);
    }

    const rows = Array.from(grouped.values()).sort((a, b) => a.agentName.localeCompare(b.agentName));

    res.json({ rows });
  })
);

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
      } else {
        // Same rule as Vendor Credit: deduct delivery charge for anything not
        // Cancelled (Pending/Transfer included), not just once actually Delivered.
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

// Excel statement of the agent credit ledger shown on screen.
router.get(
  "/export",
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
      } else {
        chargeMap.set(o.employeeId, (chargeMap.get(o.employeeId) ?? 0) + o.deliveryCharge);
      }
    }
    const paymentTotals = await prisma.agentPayment.groupBy({ by: ["employeeId"], _sum: { amount: true } });
    const paymentMap = new Map(paymentTotals.map((p) => [p.employeeId, p._sum.amount ?? 0]));

    const rows = agents.map((a) => {
      const totalAmount = totalMap.get(a.id) ?? 0;
      const cancelledTotal = cancelledMap.get(a.id) ?? 0;
      const totalDeliveryCharge = chargeMap.get(a.id) ?? 0;
      const totalPaid = paymentMap.get(a.id) ?? 0;
      const balance = totalAmount - cancelledTotal - totalDeliveryCharge - totalPaid;
      return { agent: a.name, totalAmount, cancelledTotal, totalDeliveryCharge, totalPaid, balance };
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Future Courier Operations";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Agent Credit Statement");
    sheet.columns = [
      { header: "Agent", key: "agent", width: 20 },
      { header: "Total Amount", key: "totalAmount", width: 15 },
      { header: "Cancelled", key: "cancelledTotal", width: 14 },
      { header: "DL Charge (Kept)", key: "totalDeliveryCharge", width: 16 },
      { header: "Paid Back", key: "totalPaid", width: 14 },
      { header: "Balance Owed", key: "balance", width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    rows.forEach((r) => sheet.addRow(r));

    const totals = rows.reduce(
      (acc, r) => ({
        totalAmount: acc.totalAmount + r.totalAmount,
        cancelledTotal: acc.cancelledTotal + r.cancelledTotal,
        totalDeliveryCharge: acc.totalDeliveryCharge + r.totalDeliveryCharge,
        totalPaid: acc.totalPaid + r.totalPaid,
        balance: acc.balance + r.balance,
      }),
      { totalAmount: 0, cancelledTotal: 0, totalDeliveryCharge: 0, totalPaid: 0, balance: 0 }
    );
    const totalRow = sheet.addRow({ agent: "TOTAL", ...totals });
    totalRow.font = { bold: true };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="agent-credit-statement.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
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
