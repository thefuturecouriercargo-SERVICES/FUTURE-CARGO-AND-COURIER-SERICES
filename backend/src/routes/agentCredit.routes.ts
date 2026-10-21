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

// New-entries report: for a given day, every consignment each agent GOT that day —
// newly entered for them (by scan or typed in Daily Entry) or transferred to them —
// with the full list for the PDF / Excel export. Orders merely carried over aren't counted.
router.get(
  "/new-entries",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const agents = await prisma.user.findMany({ where: { isAgent: true }, select: { id: true, name: true } });
    const agentIds = agents.map((a) => a.id);
    const nameOf = new Map(agents.map((a) => [a.id, a.name]));

    const select = {
      id: true,
      cnNo: true,
      total: true,
      status: true,
      emirate: true,
      createdAt: true,
      employeeId: true,
      brandName: true,
      vendor: { select: { name: true } },
      booking: { select: { customerName: true, customerPhone: true, address: true, items: true } },
    } as const;

    // 1) Entered that day for an agent.
    const created = await prisma.order.findMany({ where: { employeeId: { in: agentIds }, createdAt: { gte: start, lt: end } }, select });
    // How each was entered: a scan that day created it → Scanned, otherwise typed in → Manual.
    const scans = await prisma.scanLog.findMany({
      where: { createdAt: { gte: start, lt: end }, driverId: { in: agentIds }, result: { in: ["ACCEPTED", "REASSIGNED"] } },
      select: { orderId: true, cnNo: true, driverId: true, result: true, createdAt: true, fromDriver: true },
    });
    const scannedIds = new Set(scans.filter((s) => s.result === "ACCEPTED").map((s) => s.orderId).filter(Boolean) as string[]);

    // 2) Transferred to an agent that day (Transfer button, or moved by scanning).
    const transfers = await prisma.orderTransfer.findMany({
      where: { toEmployeeId: { in: agentIds }, transferredAt: { gte: start, lt: end } },
      select: { orderId: true, toEmployeeId: true, transferredAt: true, fromEmployee: { select: { name: true } } },
    });
    const moved = [
      ...transfers.map((t) => ({ orderId: t.orderId, agentId: t.toEmployeeId, at: t.transferredAt, from: t.fromEmployee.name })),
      ...scans.filter((s) => s.result === "REASSIGNED" && s.orderId).map((s) => ({ orderId: s.orderId!, agentId: s.driverId!, at: s.createdAt, from: s.fromDriver ?? "" })),
    ];
    const movedOrders = moved.length
      ? await prisma.order.findMany({ where: { id: { in: Array.from(new Set(moved.map((m) => m.orderId))) } }, select })
      : [];
    const byId = new Map(movedOrders.map((o) => [o.id, o]));

    type Entry = {
      agentId: string;
      agentName: string;
      type: "SCANNED" | "MANUAL" | "TRANSFERRED";
      at: Date;
      from?: string;
      cnNo: number;
      vendor: string;
      customerName: string;
      customerPhone: string;
      address: string;
      emirate: string;
      items: string;
      total: number;
      status: string;
    };
    const toEntry = (o: (typeof created)[number], agentId: string, type: Entry["type"], at: Date, from?: string): Entry => ({
      agentId,
      agentName: nameOf.get(agentId) ?? "",
      type,
      at,
      from,
      cnNo: o.cnNo,
      vendor: o.vendor?.name ?? o.brandName ?? "",
      customerName: o.booking?.customerName ?? "",
      customerPhone: o.booking?.customerPhone ?? "",
      address: o.booking?.address ?? "",
      emirate: o.emirate,
      items: o.booking?.items ?? "",
      total: o.total,
      status: o.status,
    });

    const seen = new Set<string>(); // one row per agent + CN
    const entries: Entry[] = [];
    for (const o of created) {
      const k = `${o.employeeId}|${o.cnNo}`;
      if (seen.has(k)) continue;
      seen.add(k);
      entries.push(toEntry(o, o.employeeId, scannedIds.has(o.id) ? "SCANNED" : "MANUAL", o.createdAt));
    }
    for (const m of moved) {
      const o = byId.get(m.orderId);
      if (!o) continue;
      const k = `${m.agentId}|${o.cnNo}`;
      if (seen.has(k)) continue;
      seen.add(k);
      entries.push(toEntry(o, m.agentId, "TRANSFERRED", m.at, m.from));
    }
    entries.sort((a, b) => a.agentName.localeCompare(b.agentName) || a.type.localeCompare(b.type) || a.cnNo - b.cnNo);

    const grouped = new Map<string, { agentId: string; agentName: string; count: number; totalAmount: number; scanned: number; manual: number; transferred: number }>();
    for (const e of entries) {
      const g = grouped.get(e.agentId) ?? { agentId: e.agentId, agentName: e.agentName, count: 0, totalAmount: 0, scanned: 0, manual: 0, transferred: 0 };
      g.count += 1;
      g.totalAmount += e.total;
      if (e.type === "SCANNED") g.scanned += 1;
      else if (e.type === "MANUAL") g.manual += 1;
      else g.transferred += 1;
      grouped.set(e.agentId, g);
    }
    const rows = Array.from(grouped.values()).sort((a, b) => a.agentName.localeCompare(b.agentName));
    res.json({ rows, entries });
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
